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
import { migrateDatabase, setDatabase } from '../src/db.js';
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

  const route = CARAVANS_CONFIG.routes[0]!; // sindr_shards -> merchant_chromara
  const now = 10 * GAME_HOUR_MS;

  const fromBalBefore = getAccountBalance(route.fromMerchant, db);
  const toBalBefore = getAccountBalance(route.toMerchant, db);

  const result = dispatchCaravanRoute(route, now, db);
  assert.equal(result.dispatched, true);
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
    .prepare("SELECT sender, receiver, amount, reason, ref_id FROM ledger_entries WHERE ref_id LIKE ?")
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
    .prepare("SELECT from_id, to_id, quantity, reason FROM item_ledger WHERE ref_id LIKE ?")
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

  assert.equal(verifyWorldSupply(db), true);
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

test('Step 2.5: World director detects dominating nation, fires firestorm closing route, and moves prices', () => {
  const db = setupTestDb();
  const now = 24 * GAME_HOUR_MS;

  // Seed heavy trade in IGNIS so IGNIS dominates (> 35% of volume)
  recordTransaction(
    {
      from: 'rival_guild',
      to: 'sindr_arms',
      amount: 10_000,
      reason: 'merchant_buy',
      timestamp: now - 2 * GAME_HOUR_MS,
    },
    db,
  );
  recordTransaction(
    {
      from: 'rival_guild',
      to: 'sindr_shards',
      amount: 5_000,
      reason: 'merchant_buy',
      timestamp: now - 1 * GAME_HOUR_MS,
    },
    db,
  );

  const domination = evaluateNationDomination(now, db);
  assert.equal(domination.dominantNation, 'IGNIS');
  assert.ok(domination.dominantShare >= DIRECTOR_CONFIG.dominationThreshold);

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

  // Advance time past firestorm duration
  const afterFirestorm = now + (DIRECTOR_CONFIG.firestormDurationHours + 1) * GAME_HOUR_MS;
  assert.equal(isRouteClosedByDirector(triggeredEvent.closedRoute, afterFirestorm, db), false);

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
