// Ensure offline execution during tests (no remote LLM or network calls)
delete process.env.NVIDIA_API_KEY;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CLOUDFLARE_ACCOUNT_ID;
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.NEAR_AI_API_KEY;
delete process.env.NEAR_ENV;
delete process.env.NEAR_ACCOUNT_ID;
delete process.env.NEAR_PRIVATE_KEY;

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  GAME_HOUR_MS,
  TREASURY_ACCOUNT_ID,
  RIVAL_GUILD_ACCOUNT_ID,
  MASTER_ACCOUNT_IDS,
  SINDR_MERCHANTS,
  CARAVANS_CONFIG,
  MASTERS_CONFIG,
  DIRECTOR_CONFIG,
  AGENT_CONFIG,
} from '@elements/shared';
import { migrateDatabase, setDatabase, saveAccount } from '../src/db.js';
import {
  getAllAccountBalances,
  getAccountBalance,
  verifyWorldSupply,
  recordTransaction,
} from '../src/economy/ledgerService.js';
import { ensureSindrMerchants, tickAllMerchantAgents } from '../src/economy/agents/agentLoop.js';
import { RuleDecider } from '../src/economy/agents/ruleDecider.js';
import { dispatchCaravanRoute, tickCaravans } from '../src/economy/caravanService.js';
import {
  getAllMasters,
  getMasterStudentCount,
  getMasterTrainingFee,
  collectMasterTrainingFee,
} from '../src/economy/masterService.js';
import { tickRivalClanTrade } from '../src/economy/rivalClanService.js';
import {
  evaluateNationDomination,
  triggerFirestormPushback,
  isRouteClosedByDirector,
  getActiveFirestorm,
  tickWorldDirector,
} from '../src/economy/worldDirectorService.js';
import { quoteMerchantTrade } from '../src/economy/merchantService.js';
import { startEconomyLoop } from '../src/economy/worldLoop.js';

function setupTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);
  return db;
}

test('Step 2.1: Keepers ship tribute on schedule every game day with no players', async () => {
  const db = setupTestDb();
  assert.equal(verifyWorldSupply(db), true);

  const decider = new RuleDecider();

  // At hour 0 (before schedule interval elapsed), no tribute yet
  const resHour0 = await tickAllMerchantAgents({ now: 8 * GAME_HOUR_MS, decider, db });
  assert.ok(resHour0.length > 0);

  const initialTributes = (db
    .prepare("SELECT count(*) as count FROM ledger_entries WHERE reason = 'merchant_tribute'")
    .get() as { count: number }).count;
  assert.equal(initialTributes, 0);

  // Advance to Day 1 schedule (hour 24, e.g. 24 * GAME_HOUR_MS) during open hours (e.g. 10:00 AM on Day 2 = hour 34)
  const hour34 = 34 * GAME_HOUR_MS;
  const resDay1 = await tickAllMerchantAgents({ now: hour34, decider, db });
  assert.ok(resDay1.length > 0);

  const tributesDay1 = (db
    .prepare("SELECT count(*) as count FROM ledger_entries WHERE reason = 'merchant_tribute'")
    .get() as { count: number }).count;
  assert.ok(tributesDay1 > 0, 'Keepers must produce tribute ledger entries on schedule');

  // Verify sender of tribute payout is treasury and recipient is merchant
  const rows = db
    .prepare("SELECT sender, receiver, amount, reason FROM ledger_entries WHERE reason = 'merchant_tribute'")
    .all() as Array<{ sender: string; receiver: string; amount: number; reason: string }>;
  for (const row of rows) {
    assert.equal(row.sender, TREASURY_ACCOUNT_ID);
    assert.ok(row.receiver.startsWith('sindr_'));
    assert.ok(row.amount > 0);
  }

  // World supply must stay conserved
  assert.equal(verifyWorldSupply(db), true);
});

test('Step 2.2: Caravans carry stock between keepers and nations with coin paid the other way', () => {
  const db = setupTestDb();
  assert.equal(verifyWorldSupply(db), true);

  // Every route in CARAVANS_CONFIG connects two real merchants who stock the item
  for (const route of CARAVANS_CONFIG.routes) {
    const fromBalBefore = getAccountBalance(route.fromMerchant, db);
    const toBalBefore = getAccountBalance(route.toMerchant, db);

    const result = dispatchCaravanRoute(route, 10 * GAME_HOUR_MS, db);
    assert.equal(result.dispatched, true, `Route ${route.id} must be able to dispatch with seeded inventories`);
    assert.equal(result.routeId, route.id);
    assert.ok(result.totalPrice > 0);
    assert.ok(result.quantity > 0);

    // Check coin transfer: toMerchant paid fromMerchant
    const fromBalAfter = getAccountBalance(route.fromMerchant, db);
    const toBalAfter = getAccountBalance(route.toMerchant, db);
    assert.equal(fromBalAfter, fromBalBefore + result.totalPrice);
    assert.equal(toBalAfter, toBalBefore - result.totalPrice);

    // Check ledger entry
    const entry = db
      .prepare("SELECT sender, receiver, amount, reason, ref_id FROM ledger_entries WHERE ref_id LIKE ? ORDER BY timestamp DESC LIMIT 1")
      .get(`caravan:${route.id}:%`) as {
      sender: string;
      receiver: string;
      amount: number;
      reason: string;
      ref_id: string;
    };
    assert.ok(entry);
    assert.equal(entry.sender, route.toMerchant);
    assert.equal(entry.receiver, route.fromMerchant);
    assert.equal(entry.reason, 'trade_payment');

    // Check item move in item_ledger
    const itemMove = db
      .prepare("SELECT from_id, to_id, quantity, reason FROM item_ledger WHERE ref_id LIKE ? ORDER BY timestamp DESC LIMIT 1")
      .get(`caravan:${route.id}:%`) as {
      from_id: string;
      to_id: string;
      quantity: number;
      reason: string;
    };
    assert.ok(itemMove);
    assert.equal(itemMove.from_id, route.fromMerchant);
    assert.equal(itemMove.to_id, route.toMerchant);
    assert.equal(itemMove.quantity, result.quantity);
    assert.equal(itemMove.reason, 'trade');
  }

  assert.equal(verifyWorldSupply(db), true);
});

test('Step 2.2b: tickCaravans respects caravan row at timestamp 0 and does not re-dispatch early', () => {
  const db = setupTestDb();
  const route = CARAVANS_CONFIG.routes[0]!;

  // Dispatch first caravan at timestamp 0
  const res0 = dispatchCaravanRoute(route, 0, db);
  assert.equal(res0.dispatched, true);

  // Advance to time 1000 (well within 12h interval)
  const earlyDispatches = tickCaravans({ now: 1000 }, db);
  assert.equal(earlyDispatches.length, 0, 'Caravan at timestamp 0 must prevent early re-dispatch');

  // Advance past interval (12 hours + 1ms)
  const laterDispatches = tickCaravans({ now: CARAVANS_CONFIG.intervalHours * GAME_HOUR_MS + 1 }, db);
  assert.ok(laterDispatches.length > 0, 'Caravans dispatch once interval has passed');
});

test('Step 2.3: Masters collect training fees that rise with rising students (+10% a week)', () => {
  const db = setupTestDb();

  // Masters exist with genesis accounts and funds
  const masters = getAllMasters(db);
  assert.equal(masters.length, 4);
  for (const m of masters) {
    assert.equal(m.balance, 250_000);
    assert.ok(MASTER_ACCOUNT_IDS.includes(m.id as any));
  }

  // Check student existence in server: none exist
  const studentCheck = getMasterStudentCount('master_ignis', db);
  assert.equal(studentCheck.currentStudents, 0);
  assert.equal(studentCheck.studentsImplemented, false);

  // Training fee calculation rule
  const baseFee = MASTERS_CONFIG.baseTrainingFee; // 50

  // 1 week of rising students (e.g. 10 -> 20 students)
  const risingFee = getMasterTrainingFee({
    masterId: 'master_ignis',
    currentStudents: 20,
    priorStudents: 10,
    weeks: 1,
  });
  assert.ok(risingFee.fee > baseFee);
  assert.equal(risingFee.fee, Math.round(baseFee * (1 + MASTERS_CONFIG.weeklyGrowthRate)));

  // Falling students (e.g. 20 -> 10 students)
  const fallingFee = getMasterTrainingFee({
    masterId: 'master_ignis',
    currentStudents: 10,
    priorStudents: 20,
    weeks: 1,
  });
  assert.ok(fallingFee.fee < baseFee);

  // Collect tithe from an account that has CHROMA
  const payer = 'rival_guild';
  const feeResult = collectMasterTrainingFee(
    {
      masterId: 'master_ignis',
      studentAccountId: payer,
      fee: risingFee.fee,
      now: 1000,
    },
    db,
  );
  assert.equal(feeResult.fee, risingFee.fee);
  assert.equal(feeResult.masterBalance, 250_000 + risingFee.fee);

  // World supply is conserved
  assert.equal(verifyWorldSupply(db), true);
});

test('Step 2.4: The rival clan trades with keepers on its own account', () => {
  const db = setupTestDb();
  assert.equal(verifyWorldSupply(db), true);

  const rivalBefore = getAccountBalance(RIVAL_GUILD_ACCOUNT_ID, db);
  assert.equal(rivalBefore, 500_000);

  const trade = tickRivalClanTrade({ now: 12 * GAME_HOUR_MS, force: true }, db);
  assert.equal(trade.executed, true);
  assert.equal(trade.action, 'buy');
  assert.ok(trade.totalPrice > 0);
  assert.ok(trade.merchantId.length > 0);

  const rivalAfter = getAccountBalance(RIVAL_GUILD_ACCOUNT_ID, db);
  assert.equal(rivalAfter, rivalBefore - trade.totalPrice);

  // Check ledger entry: sender must be rival_guild
  const entry = db
    .prepare("SELECT sender, receiver, amount, reason FROM ledger_entries WHERE sender = ? AND reason = 'merchant_buy' ORDER BY timestamp DESC LIMIT 1")
    .get(RIVAL_GUILD_ACCOUNT_ID) as {
    sender: string;
    receiver: string;
    amount: number;
    reason: string;
  };
  assert.ok(entry);
  assert.equal(entry.sender, RIVAL_GUILD_ACCOUNT_ID);
  assert.equal(entry.receiver, trade.merchantId);
  assert.equal(entry.amount, trade.totalPrice);

  // World supply is conserved
  assert.equal(verifyWorldSupply(db), true);
});

test('Step 2.5a: A seeded world where only Sindr keepers trade and players are spread over nations fires nothing', () => {
  const db = setupTestDb();
  const now = 24 * GAME_HOUR_MS;

  // Create players spread across all 4 nations
  saveAccount('player_ignis', 'Shaper', 'IGNIS', db);
  saveAccount('player_aques', 'Shaper', 'AQUES', db);
  saveAccount('player_terra', 'Shaper', 'TERRA', db);
  saveAccount('player_aura', 'Shaper', 'AURA', db);

  // Keepers trade among themselves and Lord treasury pays keeper tribute (no player earnings)
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: 'sindr_shards',
      amount: 15_000,
      reason: 'merchant_tribute',
      timestamp: now - 5 * GAME_HOUR_MS,
    },
    db,
  );
  recordTransaction(
    {
      from: 'rival_guild',
      to: 'sindr_supplies',
      amount: 5_000,
      reason: 'merchant_buy',
      timestamp: now - 3 * GAME_HOUR_MS,
    },
    db,
  );

  const report = evaluateNationDomination(now, db);
  assert.equal(report.dominantNation, null, 'Keeper-only trade must never cause nation domination');
  assert.equal(report.totalVolume, 0, 'Keeper volume is not player earnings');

  const { triggeredEvent } = tickWorldDirector({ now }, db);
  assert.equal(triggeredEvent, null, 'World director must fire nothing when only keepers trade');
  assert.equal(getActiveFirestorm('IGNIS', now, db), null);
});

test('Step 2.5b: A lone player cannot trigger domination pushback (minActivePlayers requirement)', () => {
  const db = setupTestDb();
  const now = 24 * GAME_HOUR_MS;

  // Single lone IGNIS player receives large payment
  saveAccount('lone_ignis_player', 'Shaper', 'IGNIS', db);
  recordTransaction(
    {
      from: 'merchant_ignis',
      to: 'lone_ignis_player',
      amount: 50_000,
      reason: 'merchant_sell',
      timestamp: now - 2 * GAME_HOUR_MS,
    },
    db,
  );

  const report = evaluateNationDomination(now, db);
  assert.equal(report.nationPlayerCounts['IGNIS'], 1);
  assert.equal(report.dominantNation, null, 'A lone player cannot trigger domination pushback');

  const { triggeredEvent } = tickWorldDirector({ now }, db);
  assert.equal(triggeredEvent, null);
});

/** A world old enough for the director to judge: one small earning a full lookback window before `now`. */
function seedFullWindow(now: number, db: DatabaseSync): void {
  saveAccount('early_aura_player', 'Shaper', 'AURA', db);
  recordTransaction(
    { from: 'merchant_aura', to: 'early_aura_player', amount: 10, reason: 'merchant_sell', timestamp: now - DIRECTOR_CONFIG.lookbackDays * 24 * GAME_HOUR_MS },
    db,
  );
}

test('Step 2.5c: IGNIS players earning over threshold fires firestorm closing route, moving prices, then expires', () => {
  const db = setupTestDb();
  const now = (DIRECTOR_CONFIG.lookbackDays * 24 + 1) * GAME_HOUR_MS;
  seedFullWindow(now, db);

  // Two IGNIS players earn over the threshold (satisfies minActivePlayers = 2)
  saveAccount('ignis_player_1', 'Shaper', 'IGNIS', db);
  saveAccount('ignis_player_2', 'Shaper', 'IGNIS', db);
  saveAccount('aques_player_1', 'Shaper', 'AQUES', db);

  recordTransaction(
    {
      from: 'merchant_ignis',
      to: 'ignis_player_1',
      amount: 25_000,
      reason: 'merchant_sell',
      timestamp: now - 3 * GAME_HOUR_MS,
    },
    db,
  );
  recordTransaction(
    {
      from: 'merchant_ignis',
      to: 'ignis_player_2',
      amount: 25_000,
      reason: 'merchant_sell',
      timestamp: now - 2 * GAME_HOUR_MS,
    },
    db,
  );
  recordTransaction(
    {
      from: 'merchant_aques',
      to: 'aques_player_1',
      amount: 5_000,
      reason: 'merchant_sell',
      timestamp: now - 1 * GAME_HOUR_MS,
    },
    db,
  );

  const report = evaluateNationDomination(now, db);
  assert.equal(report.dominantNation, 'IGNIS');
  assert.ok(report.dominantShare >= DIRECTOR_CONFIG.dominationThreshold);
  assert.equal(report.nationPlayerCounts['IGNIS'], 2);

  // Check normal quote before firestorm
  const quoteBefore = quoteMerchantTrade(
    {
      merchantId: 'sindr_shards',
      itemType: 'shard',
      action: 'buy',
      quantity: 1,
      now,
    },
    db,
  );

  // Tick world director to trigger pushback
  const { triggeredEvent } = tickWorldDirector({ now }, db);
  assert.ok(triggeredEvent);
  assert.equal(triggeredEvent.nation, 'IGNIS');
  assert.ok(triggeredEvent.closedRoute);
  assert.equal(isRouteClosedByDirector(triggeredEvent.closedRoute, now, db), true);

  // Caravans attempting to use closed route are skipped
  const closedRouteConfig = CARAVANS_CONFIG.routes.find((r) => r.id === triggeredEvent.closedRoute)!;
  const caravanAttempt = dispatchCaravanRoute(closedRouteConfig, now, db);
  assert.equal(caravanAttempt.dispatched, false);
  assert.match(caravanAttempt.skippedReason ?? '', /blocked by an active firestorm/);

  // Caravan route NOT touching IGNIS (e.g. Aques -> Terra) can still dispatch
  const openRouteConfig = CARAVANS_CONFIG.routes.find(
    (r) => r.fromNation !== 'IGNIS' && r.toNation !== 'IGNIS',
  )!;
  const openAttempt = dispatchCaravanRoute(openRouteConfig, now, db);
  assert.equal(openAttempt.dispatched, true);

  // Prices in IGNIS move due to firestorm multiplier
  const quoteDuring = quoteMerchantTrade(
    {
      merchantId: 'sindr_shards',
      itemType: 'shard',
      action: 'buy',
      quantity: 1,
      now,
    },
    db,
  );
  assert.ok(
    quoteDuring.unitPrice > quoteBefore.unitPrice,
    `Firestorm price (${quoteDuring.unitPrice}) must be higher than base quote (${quoteBefore.unitPrice})`,
  );
  assert.ok(quoteDuring.steps.some((s) => s.rule === 'world_director_firestorm'));

  // Advance time past firestorm duration: it expires
  const afterFirestorm = now + (DIRECTOR_CONFIG.firestormDurationHours + 1) * GAME_HOUR_MS;
  assert.equal(isRouteClosedByDirector(triggeredEvent.closedRoute, afterFirestorm, db), false);
  assert.equal(getActiveFirestorm('IGNIS', afterFirestorm, db), null);

  const quoteAfter = quoteMerchantTrade(
    {
      merchantId: 'sindr_shards',
      itemType: 'shard',
      action: 'buy',
      quantity: 1,
      now: afterFirestorm,
    },
    db,
  );
  assert.equal(quoteAfter.unitPrice, quoteBefore.unitPrice);

  assert.equal(verifyWorldSupply(db), true);
});

test('Full Day Autonomous World Loop: produces tribute rows and at least one caravan with zero players', async () => {
  const db = setupTestDb();
  assert.equal(verifyWorldSupply(db), true);

  let currentTime = 0;
  const loop = startEconomyLoop({
    db,
    now: () => currentTime,
    checkEveryMs: 1_000_000, // manual stepping
  });

  try {
    // Step across 24 game hours in 30-minute intervals (48 steps) with ZERO players
    for (let step = 0; step <= 48; step++) {
      currentTime = step * 30 * (GAME_HOUR_MS / 60);
      await loop.step();
    }

    // 1. Tribute rows must have been produced
    const tributeRows = db
      .prepare("SELECT count(*) as count FROM ledger_entries WHERE reason = 'merchant_tribute'")
      .get() as { count: number };
    assert.ok(tributeRows.count > 0, `Expected scheduled tribute rows, got ${tributeRows.count}`);

    // 2. At least one caravan must have been dispatched
    const caravanRows = db
      .prepare("SELECT count(*) as count FROM ledger_entries WHERE reason = 'trade_payment' AND ref_id LIKE 'caravan:%'")
      .get() as { count: number };
    assert.ok(caravanRows.count > 0, `Expected at least one caravan trade, got ${caravanRows.count}`);

    // 3. Rival clan trades occurred
    const rivalRows = db
      .prepare("SELECT count(*) as count FROM ledger_entries WHERE sender = ? AND reason = 'merchant_buy'")
      .get(RIVAL_GUILD_ACCOUNT_ID) as { count: number };
    assert.ok(rivalRows.count > 0, `Expected rival clan trades, got ${rivalRows.count}`);

    // 4. World supply strictly conserved across the entire day
    assert.equal(verifyWorldSupply(db), true);
  } finally {
    loop.stop();
  }
});

/** Two IGNIS players and one AQUES player earn in a world with a full window behind it. */
function ignisLead(now: number, db: DatabaseSync): void {
  seedFullWindow(now, db);
  saveAccount('ignis_player_1', 'Shaper', 'IGNIS', db);
  saveAccount('ignis_player_2', 'Shaper', 'IGNIS', db);
  saveAccount('aques_player_1', 'Shaper', 'AQUES', db);
  saveAccount('aques_player_2', 'Shaper', 'AQUES', db);
  for (const [to, amount, h] of [['ignis_player_1', 25_000, 3], ['ignis_player_2', 25_000, 2], ['aques_player_1', 5_000, 1]] as const) {
    recordTransaction({ from: 'merchant_ignis', to, amount, reason: 'merchant_sell', timestamp: now - h * GAME_HOUR_MS }, db);
  }
}

test('Director: a young world is not judged until a full lookback window of earnings exists', () => {
  const db = setupTestDb();
  const now = 24 * GAME_HOUR_MS;
  saveAccount('ignis_player_1', 'Shaper', 'IGNIS', db);
  saveAccount('ignis_player_2', 'Shaper', 'IGNIS', db);
  for (const to of ['ignis_player_1', 'ignis_player_2']) {
    recordTransaction({ from: 'merchant_ignis', to, amount: 25_000, reason: 'merchant_sell', timestamp: now - GAME_HOUR_MS }, db);
  }
  assert.equal(tickWorldDirector({ now }, db).triggeredEvent, null);
});

test('Director: earnings a storm answered never bring the storm back', () => {
  const db = setupTestDb();
  const now = (DIRECTOR_CONFIG.lookbackDays * 24 + 1) * GAME_HOUR_MS;
  ignisLead(now, db);
  const first = tickWorldDirector({ now }, db).triggeredEvent;
  assert.equal(first?.nation, 'IGNIS');

  // Past the storm and the rest that follows it, with no new IGNIS earnings: the same lead is spent.
  const later = first!.expiresAt + (DIRECTOR_CONFIG.restHoursBetweenStorms + 1) * GAME_HOUR_MS;
  const { report, triggeredEvent } = tickWorldDirector({ now: later }, db);
  assert.equal(triggeredEvent, null);
  assert.equal(report.nationVolumes['IGNIS'], 0);
});

test('Director: one storm at a time, and the world rests after each storm', () => {
  const db = setupTestDb();
  const now = (DIRECTOR_CONFIG.lookbackDays * 24 + 1) * GAME_HOUR_MS;
  ignisLead(now, db);
  const first = tickWorldDirector({ now }, db).triggeredEvent!;

  // AQUES pulls ahead while IGNIS burns, and keeps ahead through the rest: no second storm until the rest is over.
  const surge = (at: number) => {
    for (const to of ['aques_player_1', 'aques_player_2']) {
      recordTransaction({ from: 'merchant_aques', to, amount: 40_000, reason: 'merchant_sell', timestamp: at }, db);
    }
  };
  surge(now + GAME_HOUR_MS);
  assert.equal(tickWorldDirector({ now: now + 2 * GAME_HOUR_MS }, db).triggeredEvent, null, 'IGNIS still burns');
  const resting = first.expiresAt + GAME_HOUR_MS;
  assert.equal(tickWorldDirector({ now: resting }, db).triggeredEvent, null, 'the world rests');
  const rested = first.expiresAt + (DIRECTOR_CONFIG.restHoursBetweenStorms + 1) * GAME_HOUR_MS;
  surge(rested - GAME_HOUR_MS);
  assert.equal(tickWorldDirector({ now: rested }, db).triggeredEvent?.nation, 'AQUES');
});
