import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express, { type Application } from 'express';
import { DatabaseSync } from 'node:sqlite';
import {
  TOTAL_CHROMA_SUPPLY,
  TREASURY_ACCOUNT_ID,
  INITIAL_BALANCES,
  COUNTING_HOUSES,
  GAME_HOUR_MS,
  AGENT_CONFIG,
  MERCHANT_CONFIG,
  SHOPS_CONFIG,
  SINDR_MERCHANTS,
  type AgentAction,
  type AgentObservation,
} from '@elements/shared';
import {
  migrateDatabase,
  setDatabase,
  getActiveShopOwnership,
  getPlayerOwnedShops,
  insertShopOwnership,
  getShopSales,
} from '../src/db.js';
import { setupApi } from '../src/api.js';
import { setTokenVerifier } from '../src/auth.js';
import {
  getAllAccountBalances,
  getAccountBalance,
  verifyWorldSupply,
  grantPlayerStartingPurse,
  recordTransaction,
  getLedgerHistory,
  getMerchant,
  saveMerchant,
  quoteMerchantTrade,
  buyFromMerchant,
  sellToMerchant,
  recordMerchantDemand,
  tickAllMerchantsDay,
  depositToCountingHouse,
  withdrawFromCountingHouse,
  getAccountNotes,
  addRedFlag,
  getActiveRedFlags,
  createBounty,
  getOpenBounties,
  claimBounty,
  pardonBounty,
  processJailSentence,
  executePlayerTrade,
  createLootPile,
  createLootPileFromFight,
  getLootPileById,
  listLootPiles,
  claimLootPile,
  sweepExpiredPiles,
  ensureSindrMerchants,
  tickMerchantAgent,
  tickAllMerchantAgents,
  tickMerchantAgentsDay,
  getMerchantMind,
  RuleDecider,
  NearAiDecider,
  type AgentDecider,
  getShopsForSale,
  buyShop,
  setShopPrices,
  stockShop,
  withdrawShopProfit,
  payShopUpkeep,
  tickShopDay,
  tickAllShopsDay,
  getShopOwnership,
} from '../src/economy/index.js';

interface TestServer {
  app: Application;
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
  const app = express();
  setupApi(app);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to obtain server address');
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    app,
    server,
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

test('Database ledger: genesis supply is exactly 10,000,000 and player grants preserve world invariant', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  assert.equal(verifyWorldSupply(db), true);
  assert.equal(getAccountBalance(TREASURY_ACCOUNT_ID, db), INITIAL_BALANCES.treasury);

  // Grant starting purse to player_1
  const grant1 = grantPlayerStartingPurse('player_1', db);
  assert.ok(grant1);
  assert.equal(getAccountBalance('player_1', db), 100);
  assert.equal(getAccountBalance(TREASURY_ACCOUNT_ID, db), INITIAL_BALANCES.treasury - 100);
  assert.equal(verifyWorldSupply(db), true);

  // Second grant call is idempotent (returns null, no double dipping)
  const grant2 = grantPlayerStartingPurse('player_1', db);
  assert.equal(grant2, null);
  assert.equal(getAccountBalance('player_1', db), 100);

  // Overdraw fails
  assert.throws(() => {
    recordTransaction(
      {
        from: 'player_1',
        to: 'player_2',
        amount: 500,
        reason: 'trade_payment',
      },
      db,
    );
  }, /Insufficient balance/);

  // Valid transfer
  recordTransaction(
    {
      from: 'player_1',
      to: 'player_2',
      amount: 40,
      reason: 'trade_payment',
    },
    db,
  );
  assert.equal(getAccountBalance('player_1', db), 60);
  assert.equal(getAccountBalance('player_2', db), 40);
  assert.equal(verifyWorldSupply(db), true);

  const history = getLedgerHistory('player_1', 10, db);
  assert.ok(history.length >= 2);
});

test('Merchant service: dynamic pricing follows stock, sales tax feeds treasury, broke merchants close and bailout', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const merchantId = 'merchant_ignis';
  const player = 'customer_1';

  // Seed player with coin from treasury
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: player,
      amount: 5000,
      reason: 'player_starting_grant',
    },
    db,
  );

  const mBefore = getMerchant(merchantId, db);
  assert.ok(mBefore);
  const initialStock = mBefore.inventory.shard.stock;

  // Initial quote at full stock
  const quote1 = quoteMerchantTrade(
    {
      merchantId,
      itemType: 'shard',
      action: 'buy',
      quantity: 1,
    },
    db,
  );
  assert.equal(quote1.unitPrice, 10);

  // Customer buys 100 shards
  const treasuryBalBefore = getAccountBalance(TREASURY_ACCOUNT_ID, db);
  const buyRes = buyFromMerchant(
    {
      merchantId,
      buyerAccountId: player,
      itemType: 'shard',
      quantity: 100,
    },
    db,
  );
  assert.ok(buyRes.totalPrice > 0);
  assert.ok(buyRes.taxAmount > 0);

  // Verify 5% sales tax received by Treasury
  const treasuryBalAfter = getAccountBalance(TREASURY_ACCOUNT_ID, db);
  assert.equal(treasuryBalAfter - treasuryBalBefore, buyRes.taxAmount);

  // Now stock is depleted by 100; quote should rise due to scarcity
  const quote2 = quoteMerchantTrade(
    {
      merchantId,
      itemType: 'shard',
      action: 'buy',
      quantity: 1,
    },
    db,
  );
  assert.ok(quote2.unitPrice > quote1.unitPrice);

  // Drain merchant balance below 1000 to test broke status
  const mNow = getMerchant(merchantId, db);
  assert.ok(mNow);
  recordTransaction(
    {
      from: merchantId,
      to: TREASURY_ACCOUNT_ID,
      amount: mNow.balance - 500,
      reason: 'training_tithe',
    },
    db,
  );

  // Now merchant has 500 balance, attempts to sell to merchant pause
  const sellRes = quoteMerchantTrade(
    {
      merchantId,
      itemType: 'shard',
      action: 'sell',
      quantity: 10,
    },
    db,
  );
  // Status check after tick
  tickAllMerchantsDay(db); // day 1 broke
  tickAllMerchantsDay(db); // day 2 broke
  tickAllMerchantsDay(db); // day 3 triggers close and automatic bailout
  const mRevived = getMerchant(merchantId, db);
  assert.ok(mRevived);
  assert.equal(mRevived.status, 'open');
  assert.ok(mRevived.balance >= 100_000);
});

test('Counting house service: deposits issue sealed notes redeemable at any branch; refuses marked players', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const player = 'traveler_1';
  grantPlayerStartingPurse(player, db);
  assert.equal(getAccountBalance(player, db), 100);

  const chSindr = COUNTING_HOUSES[4].id; // Sindr Upper Ledger
  const chBank = COUNTING_HOUSES[0].id; // Chromara Central Bank

  // Deposit 60 CHROMA at Sindr
  const note = depositToCountingHouse(
    {
      accountId: player,
      amount: 60,
      countingHouseId: chSindr,
    },
    db,
  );
  assert.equal(note.amount, 60);
  assert.equal(note.status, 'active');
  assert.equal(getAccountBalance(player, db), 40);

  // Traveler arrives in Chromara and draws at Central Bank
  const withdrawRes = withdrawFromCountingHouse(
    {
      accountId: player,
      noteId: note.noteId,
      countingHouseId: chBank,
    },
    db,
  );
  assert.equal(withdrawRes.withdrawnAmount, 60);
  assert.equal(withdrawRes.note.status, 'redeemed');
  assert.equal(getAccountBalance(player, db), 100);

  // Trying to redeem twice fails
  assert.throws(() => {
    withdrawFromCountingHouse(
      {
        accountId: player,
        noteId: note.noteId,
        countingHouseId: chBank,
      },
      db,
    );
  }, /Note is redeemed/);

  // If marked with red flag, counting house refuses access
  addRedFlag(player, 'Spoke unapproved name', db);
  assert.throws(() => {
    depositToCountingHouse(
      {
        accountId: player,
        amount: 20,
        countingHouseId: chSindr,
      },
      db,
    );
  }, /refuse all services to persons bearing a red flag/);
});

test('Crime service: red flags convert to bounties; jail seizes 40% including vault but never land', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const outlaw = 'brigand_1';
  const hunter = 'bounty_hunter_1';
  grantPlayerStartingPurse(outlaw, db);
  grantPlayerStartingPurse(hunter, db);

  // Accumulate 3 red flags
  addRedFlag(outlaw, 'Brawling in town market', db);
  addRedFlag(outlaw, 'Disturbing trade stall', db);
  const flag3 = addRedFlag(outlaw, 'Resisting arrest', db);

  assert.equal(flag3.convertedToBounty, true);
  assert.ok(flag3.bounty);

  const openBounties = getOpenBounties(db);
  assert.equal(openBounties.length, 1);
  assert.equal(openBounties[0].targetAccountId, outlaw);

  // Bounty hunter claims bounty
  const hunterBalBefore = getAccountBalance(hunter, db);
  const claimed = claimBounty({ bountyId: openBounties[0].id, claimantId: hunter }, db);
  assert.equal(claimed.status, 'claimed');
  assert.equal(getAccountBalance(hunter, db), hunterBalBefore + openBounties[0].rewardChroma);

  // Outlaw gets sent to jail: seizes 40% of liquid and vault CHROMA, plus fine; never land
  const jailResult = processJailSentence(
    {
      accountId: outlaw,
      vaultChroma: 200,
      materialsCount: 30,
      gearCount: 5,
      hasLand: true,
    },
    db,
  );

  assert.equal(jailResult.landSeized, 0); // Land is immune
  assert.equal(jailResult.seizedVaultChroma, 80); // 40% of 200
  assert.equal(jailResult.seizedMaterialsCount, 12); // 40% of 30
  assert.equal(jailResult.seizedGearCount, 2); // 40% of 5
  assert.equal(jailResult.fineToLeave, 50);

  // Check red flags cleared upon sentence
  const remainingFlags = getActiveRedFlags(outlaw, db);
  assert.equal(remainingFlags.length, 0);
});

test('Trade service: Lit-to-Lit pays 20% market tax, trades involving Dim pay 5%', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  // Setup Lit (Shaper) and Dim (Hush) accounts
  db.prepare("INSERT INTO accounts (id, role, element, created_at) VALUES ('lit_1', 'Shaper', 'IGNIS', 1000)").run();
  db.prepare("INSERT INTO risings (account_id, role, element, created_at) VALUES ('lit_1', 'Shaper', 'IGNIS', 1000)").run();

  db.prepare("INSERT INTO accounts (id, role, element, created_at) VALUES ('lit_2', 'Shaper', 'AQUES', 1000)").run();
  db.prepare("INSERT INTO risings (account_id, role, element, created_at) VALUES ('lit_2', 'Shaper', 'AQUES', 1000)").run();

  db.prepare("INSERT INTO accounts (id, role, element, created_at) VALUES ('dim_1', 'Hush', NULL, 1000)").run();
  db.prepare("INSERT INTO risings (account_id, role, element, created_at) VALUES ('dim_1', 'Hush', NULL, 1000)").run();

  grantPlayerStartingPurse('lit_1', db);
  grantPlayerStartingPurse('lit_2', db);
  grantPlayerStartingPurse('dim_1', db);

  // 1. Lit-to-Lit trade of 50 CHROMA
  const treasuryBeforeLit = getAccountBalance(TREASURY_ACCOUNT_ID, db);
  const tradeLit = executePlayerTrade(
    {
      buyerId: 'lit_1',
      sellerId: 'lit_2',
      amount: 50,
    },
    db,
  );
  assert.equal(tradeLit.taxAmount, 10); // 20% of 50
  assert.equal(tradeLit.sellerReceives, 40);
  assert.equal(getAccountBalance(TREASURY_ACCOUNT_ID, db) - treasuryBeforeLit, 10);
  assert.equal(verifyWorldSupply(db), true);

  // 2. Lit-to-Dim trade of 50 CHROMA
  const treasuryBeforeDim = getAccountBalance(TREASURY_ACCOUNT_ID, db);
  const tradeDim = executePlayerTrade(
    {
      buyerId: 'lit_1',
      sellerId: 'dim_1',
      amount: 40,
    },
    db,
  );
  assert.equal(tradeDim.taxAmount, 2); // 5% of 40
  assert.equal(tradeDim.sellerReceives, 38);
  assert.equal(getAccountBalance(TREASURY_ACCOUNT_ID, db) - treasuryBeforeDim, 2);
  assert.equal(verifyWorldSupply(db), true);
});

test('HTTP API: handles economy endpoints end-to-end', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  setTokenVerifier(async (token) => {
    if (token === 'valid_alice') return { userId: 'alice_1' };
    if (token === 'valid_bob') return { userId: 'bob_1' };
    throw new Error('Invalid token');
  });

  const server = await startTestServer();

  try {
    // 1. Grant starting purse
    const grantRes = await fetch(`${server.baseUrl}/api/economy/grant-starting-purse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_alice',
      },
    });
    assert.equal(grantRes.status, 200);
    const grantData = (await grantRes.json()) as { balance: number; granted: boolean };
    assert.equal(grantData.balance, 100);
    assert.equal(grantData.granted, true);

    // 2. Query balance
    const balRes = await fetch(`${server.baseUrl}/api/economy/balance/alice_1`);
    assert.equal(balRes.status, 200);
    const balData = (await balRes.json()) as { balance: number };
    assert.equal(balData.balance, 100);

    // 3. List merchants and get quote
    const listRes = await fetch(`${server.baseUrl}/api/economy/merchants`);
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { merchants: Array<{ id: string }> };
    assert.equal(listData.merchants.length, 5);

    const quoteRes = await fetch(
      `${server.baseUrl}/api/economy/merchants/merchant_ignis/quote?itemType=shard&action=buy&quantity=2`,
    );
    assert.equal(quoteRes.status, 200);
    const quoteData = (await quoteRes.json()) as { quote: { canExecute: boolean; totalPrice: number } };
    assert.equal(quoteData.quote.canExecute, true);
    assert.equal(quoteData.quote.totalPrice, 20);

    // 4. Counting house deposit & withdraw via HTTP
    const depRes = await fetch(`${server.baseUrl}/api/economy/counting-house/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_alice',
      },
      body: JSON.stringify({
        amount: 30,
        countingHouseId: COUNTING_HOUSES[0].id,
      }),
    });
    assert.equal(depRes.status, 200);
    const depData = (await depRes.json()) as { note: { noteId: string; amount: number } };
    assert.equal(depData.note.amount, 30);

    const notesRes = await fetch(`${server.baseUrl}/api/economy/counting-house/notes/alice_1`);
    assert.equal(notesRes.status, 200);
    const notesData = (await notesRes.json()) as { notes: Array<{ noteId: string }> };
    assert.equal(notesData.notes.length, 1);

    const withdrawRes = await fetch(`${server.baseUrl}/api/economy/counting-house/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_alice',
      },
      body: JSON.stringify({
        noteId: depData.note.noteId,
        countingHouseId: COUNTING_HOUSES[4].id,
      }),
    });
    assert.equal(withdrawRes.status, 200);
  } finally {
    await server.close();
  }
});

test('Merchant demand service: flooding a merchant with 2 x maxStock shards drops buy price >= 25% and decays after 24h', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const merchantId = 'merchant_ignis';
  const t0 = 1000000;
  const neutralSales = { IGNIS: 25, AQUES: 25, TERRA: 25, AURA: 25 };

  // Fresh quote for selling to merchant (merchant buy price) with neutral shard sales
  const freshQuote = quoteMerchantTrade(
    {
      merchantId,
      itemType: 'shard',
      action: 'sell',
      quantity: 1,
      shardSales: neutralSales,
      now: t0,
    },
    db,
  );
  assert.equal(freshQuote.canExecute, true);
  assert.ok(freshQuote.unitPrice > 0);

  // Flood merchant with 2 x maxStock (400 units) sold by players
  recordMerchantDemand(
    {
      merchantId,
      itemType: 'shard',
      action: 'sell',
      quantity: 400,
      timestamp: t0,
    },
    db,
  );

  // Flooded quote at t0
  const floodedQuote = quoteMerchantTrade(
    {
      merchantId,
      itemType: 'shard',
      action: 'sell',
      quantity: 1,
      shardSales: neutralSales,
      now: t0,
    },
    db,
  );
  assert.equal(floodedQuote.canExecute, true);

  const dropRatio = (freshQuote.unitPrice - floodedQuote.unitPrice) / freshQuote.unitPrice;
  assert.ok(
    dropRatio >= 0.25,
    `Expected drop >= 25%, got ${dropRatio * 100}% (fresh: ${freshQuote.unitPrice}, flooded: ${floodedQuote.unitPrice})`,
  );

  // Decayed quote after 24 game hours
  const tDecayed = t0 + 24 * GAME_HOUR_MS + 1000;
  const decayedQuote = quoteMerchantTrade(
    {
      merchantId,
      itemType: 'shard',
      action: 'sell',
      quantity: 1,
      shardSales: neutralSales,
      now: tDecayed,
    },
    db,
  );

  assert.equal(
    decayedQuote.unitPrice,
    freshQuote.unitPrice,
    `Expected price to decay back to ${freshQuote.unitPrice}, got ${decayedQuote.unitPrice}`,
  );
});

test('Merchant service: colour balance kicks in at 41% and not at 39%', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const t0 = 2000000;

  const neutralSales = { IGNIS: 25, AQUES: 25, TERRA: 25, AURA: 25 };
  const neutralIgnis = quoteMerchantTrade(
    {
      merchantId: 'merchant_ignis',
      itemType: 'shard_ignis',
      action: 'sell',
      quantity: 1,
      shardSales: neutralSales,
      now: t0,
    },
    db,
  );
  const neutralAques = quoteMerchantTrade(
    {
      merchantId: 'merchant_aques',
      itemType: 'shard_aques',
      action: 'sell',
      quantity: 1,
      shardSales: neutralSales,
      now: t0,
    },
    db,
  );

  assert.ok(neutralIgnis.unitPrice > 0);
  assert.ok(neutralAques.unitPrice > 0);

  // 41% sales: kicks in
  const sales41 = { IGNIS: 41, AQUES: 20, TERRA: 20, AURA: 19 };
  const quoteIgnis41 = quoteMerchantTrade(
    {
      merchantId: 'merchant_ignis',
      itemType: 'shard_ignis',
      action: 'sell',
      quantity: 1,
      shardSales: sales41,
      now: t0,
    },
    db,
  );
  const quoteAques41 = quoteMerchantTrade(
    {
      merchantId: 'merchant_aques',
      itemType: 'shard_aques',
      action: 'sell',
      quantity: 1,
      shardSales: sales41,
      now: t0,
    },
    db,
  );

  assert.ok(
    quoteIgnis41.unitPrice < neutralIgnis.unitPrice,
    `Expected IGNIS price drop at 41% (${quoteIgnis41.unitPrice}) < neutral (${neutralIgnis.unitPrice})`,
  );
  assert.equal(quoteIgnis41.unitPrice, Math.round(neutralIgnis.unitPrice * 0.8));

  assert.ok(
    quoteAques41.unitPrice > neutralAques.unitPrice,
    `Expected AQUES price premium at 41% (${quoteAques41.unitPrice}) > neutral (${neutralAques.unitPrice})`,
  );
  assert.equal(quoteAques41.unitPrice, Math.round(neutralAques.unitPrice * 1.2));

  // 39% sales: does not kick in
  const sales39 = { IGNIS: 39, AQUES: 21, TERRA: 20, AURA: 20 };
  const quoteIgnis39 = quoteMerchantTrade(
    {
      merchantId: 'merchant_ignis',
      itemType: 'shard_ignis',
      action: 'sell',
      quantity: 1,
      shardSales: sales39,
      now: t0,
    },
    db,
  );
  const quoteAques39 = quoteMerchantTrade(
    {
      merchantId: 'merchant_aques',
      itemType: 'shard_aques',
      action: 'sell',
      quantity: 1,
      shardSales: sales39,
      now: t0,
    },
    db,
  );

  assert.equal(quoteIgnis39.unitPrice, neutralIgnis.unitPrice);
  assert.equal(quoteAques39.unitPrice, neutralAques.unitPrice);
});

test('HTTP API: merchant quote endpoint returns reasoning steps and summary', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const server = await startTestServer();

  try {
    const res = await fetch(
      `${server.baseUrl}/api/economy/merchants/merchant_ignis/quote?itemType=shard&action=buy&quantity=1`,
    );
    assert.equal(res.status, 200);

    const data = (await res.json()) as {
      quote: {
        unitPrice: number;
        totalPrice: number;
        canExecute: boolean;
        steps: Array<{ rule: string; effect: number; words: string }>;
        summary: string;
      };
    };

    assert.ok(data.quote);
    assert.equal(data.quote.canExecute, true);
    assert.ok(data.quote.unitPrice > 0);
    assert.ok(Array.isArray(data.quote.steps), 'quote.steps must be an array');
    assert.ok(data.quote.steps.length >= 1, 'quote.steps must have at least one step');
    assert.ok(typeof data.quote.summary === 'string' && data.quote.summary.length > 0, 'quote.summary must be non-empty');

    for (const step of data.quote.steps) {
      assert.ok(step.rule.length > 0);
      assert.ok(typeof step.effect === 'number');
      assert.ok(step.words.length > 0);
    }
  } finally {
    await server.close();
  }
});

test('Loot service: claiming from 1.6 m fails and 1.4 m succeeds', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const pile = createLootPile(
    {
      x: 0,
      z: 0,
      zone: 'sindr',
      contents: { chroma: 25, shards: { IGNIS: 1, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {} },
      source: 'villain',
    },
    db,
  );

  // Claiming from 1.6 m fails (claimRadius is 1.5 m)
  assert.throws(
    () => claimLootPile({ pileId: pile.id, accountId: 'player_1', x: 1.6, z: 0 }, db),
    /too far away/,
  );

  assert.equal(getLootPileById(pile.id, db)?.claimed, false);

  // Claiming from 1.4 m succeeds
  const claim = claimLootPile({ pileId: pile.id, accountId: 'player_1', x: 1.4, z: 0 }, db);
  assert.equal(claim.pile.claimed, true);
  assert.equal(claim.contents.chroma, 25);
  assert.equal(getAccountBalance('player_1', db), 25);
  assert.equal(getAccountBalance(pile.id, db), 0);
  assert.equal(verifyWorldSupply(db), true);
});

test('Loot service: non-owner cannot claim in first 60 s and can claim after', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const t0 = 10_000;
  const pile = createLootPile(
    {
      x: 5,
      z: 5,
      zone: 'sindr',
      contents: { chroma: 30, shards: { IGNIS: 0, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {} },
      source: 'villain',
      ownerId: 'victor_player',
      now: t0,
    },
    db,
  );

  // At 30s: non-owner cannot claim
  assert.throws(
    () =>
      claimLootPile(
        { pileId: pile.id, accountId: 'scavenger_player', x: 5, z: 5, now: t0 + 30_000 },
        db,
      ),
    /reserved for fight victor/,
  );

  // At 61s: non-owner can claim
  const claim = claimLootPile(
    { pileId: pile.id, accountId: 'scavenger_player', x: 5, z: 5, now: t0 + 61_000 },
    db,
  );
  assert.equal(claim.pile.claimed, true);
  assert.equal(claim.pile.claimedBy, 'scavenger_player');
  assert.equal(getAccountBalance('scavenger_player', db), 30);
  assert.equal(verifyWorldSupply(db), true);
});

test('Loot service: expired pile cannot be claimed and its CHROMA is back in the treasury', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const t0 = 10_000;
  const treasuryInitial = getAccountBalance(TREASURY_ACCOUNT_ID, db);

  const pile = createLootPile(
    {
      x: 0,
      z: 0,
      zone: 'sindr',
      contents: { chroma: 40, shards: { IGNIS: 0, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {} },
      source: 'villain',
      now: t0,
    },
    db,
  );

  // Treasury transferred 40 to pile
  assert.equal(getAccountBalance(TREASURY_ACCOUNT_ID, db), treasuryInitial - 40);
  assert.equal(getAccountBalance(pile.id, db), 40);

  // Advance time past 15 minutes (expiry)
  const expireTime = t0 + 16 * 60 * 1000;
  const sweep = sweepExpiredPiles(expireTime, db);
  assert.equal(sweep.sweptPiles.length, 1);
  assert.equal(sweep.reclaimedChroma, 40);

  // CHROMA is back in treasury
  assert.equal(getAccountBalance(TREASURY_ACCOUNT_ID, db), treasuryInitial);
  assert.equal(getAccountBalance(pile.id, db), 0);
  assert.equal(verifyWorldSupply(db), true);

  // Expired pile cannot be claimed
  assert.throws(
    () => claimLootPile({ pileId: pile.id, accountId: 'player_1', x: 0, z: 0, now: expireTime }, db),
    /expired/,
  );
});

test('Loot service: world supply is conserved through drop, claim and expiry (use verifyWorldSupply)', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  // Initial check
  assert.equal(verifyWorldSupply(db), true);

  // Drop 1: Villain drop 100 CHROMA
  const p1 = createLootPile(
    {
      x: 1,
      z: 1,
      zone: 'sindr',
      contents: { chroma: 100, shards: { IGNIS: 0, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {} },
      source: 'villain',
    },
    db,
  );
  assert.equal(verifyWorldSupply(db), true);

  // Drop 2: Monster drop 0 CHROMA, 1 shard
  const p2 = createLootPile(
    {
      x: 2,
      z: 2,
      zone: 'sindr',
      contents: { chroma: 0, shards: { IGNIS: 1, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {} },
      source: 'monster',
    },
    db,
  );
  assert.equal(verifyWorldSupply(db), true);

  // Drop 3: Death drop 0 CHROMA, materials
  const p3 = createLootPile(
    {
      x: 3,
      z: 3,
      zone: 'sindr',
      contents: { chroma: 0, shards: { IGNIS: 0, AQUES: 0, TERRA: 0, AURA: 0 }, materials: { iron: 5 } },
      source: 'player_death',
    },
    db,
  );
  assert.equal(verifyWorldSupply(db), true);

  // Drop 4: Villain drop 75 CHROMA
  const p4 = createLootPile(
    {
      x: 4,
      z: 4,
      zone: 'sindr',
      contents: { chroma: 75, shards: { IGNIS: 0, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {} },
      source: 'villain',
      now: 1000,
    },
    db,
  );
  assert.equal(verifyWorldSupply(db), true);

  // Claim p1
  claimLootPile({ pileId: p1.id, accountId: 'player_hero', x: 1, z: 1 }, db);
  assert.equal(verifyWorldSupply(db), true);

  // Claim p2
  claimLootPile({ pileId: p2.id, accountId: 'player_hero', x: 2, z: 2 }, db);
  assert.equal(verifyWorldSupply(db), true);

  // Claim p3
  claimLootPile({ pileId: p3.id, accountId: 'player_hero', x: 3, z: 3 }, db);
  assert.equal(verifyWorldSupply(db), true);

  // p4 expires unclaimed
  sweepExpiredPiles(1000 + 16 * 60 * 1000, db);
  assert.equal(verifyWorldSupply(db), true);
});

test('HTTP API: handles loot listing and claiming endpoints end-to-end', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const server = await startTestServer();

  try {
    const pile = createLootPile(
      {
        x: 10,
        z: 20,
        zone: 'sindr',
        contents: { chroma: 50, shards: { IGNIS: 1, AQUES: 0, TERRA: 0, AURA: 0 }, materials: { linen: 2 } },
        source: 'villain',
      },
      db,
    );

    // List piles in zone near (10, 20)
    const resNear = await fetch(`${server.baseUrl}/api/economy/loot?zone=sindr&x=10&z=20&r=5`);
    assert.equal(resNear.status, 200);
    const dataNear = (await resNear.json()) as { piles: Array<{ id: string; x: number; z: number }> };
    assert.equal(dataNear.piles.length, 1);
    assert.equal(dataNear.piles[0]?.id, pile.id);

    // List piles in zone far away (100, 200)
    const resFar = await fetch(`${server.baseUrl}/api/economy/loot?zone=sindr&x=100&z=200&r=5`);
    assert.equal(resFar.status, 200);
    const dataFar = (await resFar.json()) as { piles: Array<{ id: string }> };
    assert.equal(dataFar.piles.length, 0);

    // Claim attempt from too far away
    const resFarClaim = await fetch(`${server.baseUrl}/api/economy/loot/${pile.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'api_player', x: 50, z: 50 }),
    });
    assert.equal(resFarClaim.status, 400);

    // Valid claim within 1.5 m (e.g. 10.8, 20 -> dist 0.8 m)
    const resValidClaim = await fetch(`${server.baseUrl}/api/economy/loot/${pile.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'api_player', x: 10.8, z: 20 }),
    });
    assert.equal(resValidClaim.status, 200);
    const claimData = (await resValidClaim.json()) as { success: boolean; contents: { chroma: number } };
    assert.equal(claimData.success, true);
    assert.equal(claimData.contents.chroma, 50);

    assert.equal(getAccountBalance('api_player', db), 50);
    assert.equal(verifyWorldSupply(db), true);
  } finally {
    await server.close();
  }
});

test('Agent decider: with a fake decider that returns illegal actions, nothing illegal is applied and purse never goes negative', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  const initialMerchant = getMerchant('sindr_shards', db);
  assert.ok(initialMerchant);
  const initialPurse = initialMerchant.balance;
  const initialStock = initialMerchant.inventory.shard?.stock ?? 100;

  // Fake decider that returns illegal actions: overspend, overstock, price change, and excessive tribute
  const fakeDecider: AgentDecider = {
    async decide(_obs: AgentObservation) {
      return {
        actions: [
          ({ type: 'set_price', itemType: 'shard', price: 9999 } as unknown) as AgentAction,
          { type: 'restock', itemType: 'shard', quantity: 999999 },
          { type: 'restock', itemType: 'shard', quantity: 500 },
          { type: 'tribute', itemType: 'shard', quantity: 999999 },
          { type: 'say', line: 'Clean and honest trade today.' },
        ],
        reasoning: 'Attempted hostile market manipulation.',
      };
    },
  };

  const result = await tickMerchantAgent({
    merchantId: 'sindr_shards',
    now: 12 * GAME_HOUR_MS,
    decider: fakeDecider,
    db,
  });

  // Verify only the valid say action was applied
  assert.equal(result.actionsApplied.length, 1);
  assert.equal(result.actionsApplied[0]?.type, 'say');

  // Verify all 4 illegal actions were dropped
  assert.equal(result.actionsDropped.length, 4);

  // Verify merchant state was NOT corrupted
  const updatedMerchant = getMerchant('sindr_shards', db);
  assert.ok(updatedMerchant);
  assert.equal(updatedMerchant.balance, initialPurse);
  assert.ok(updatedMerchant.balance >= 0, 'Purse must never go negative');
  assert.equal(updatedMerchant.inventory.shard?.stock, initialStock);
  assert.ok(
    (updatedMerchant.inventory.shard?.stock ?? 0) <=
      (updatedMerchant.inventory.shard?.maxStock ?? 200),
    'Stock must never exceed maxStock',
  );
});

test('NearAiDecider: falls back cleanly when env is missing and parses valid mock responses', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  const obs: AgentObservation = {
    merchantId: 'sindr_shards',
    purse: 20000,
    stock: { shard: { stock: 20, maxStock: 200, basePrice: 10 } },
    demandWindows: {},
    recentTrades: [],
    tributeSchedule: { nextTributeTime: 1000, intervalMs: 1000 },
    timeOfDay: 12,
    isOpen: true,
    status: 'open',
    daysBroke: 0,
    personality: 'A sharp-eyed firebrand.',
    now: 12 * GAME_HOUR_MS,
  };

  // Case 1: Missing env variables (clean fallback to RuleDecider)
  const deciderMissingEnv = new NearAiDecider({
    baseUrl: undefined,
    apiKey: undefined,
    model: undefined,
  });
  const fallbackResult = await deciderMissingEnv.decide(obs);
  assert.ok(fallbackResult.actions.length > 0, 'RuleDecider must restock low stock');
  assert.equal(fallbackResult.actions[0]?.type, 'restock');
  assert.ok(fallbackResult.reasoning.length > 0);

  // Case 2: Injected fake fetch returning valid AI response
  const fakeFetchValid: typeof fetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [{ type: 'restock', itemType: 'shard', quantity: 25 }],
                reasoning: 'Racks are empty so I purchased 25 shards from the Lord.',
              }),
            },
          },
        ],
      }),
    } as unknown as Response;
  };

  const deciderWithFakeAi = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'mock-key',
    model: 'meta-llama/Llama-3.2-3B-Instruct',
    fetchFn: fakeFetchValid,
  });

  const aiResult = await deciderWithFakeAi.decide(obs);
  assert.equal(aiResult.actions.length, 1);
  assert.equal(aiResult.actions[0]?.type, 'restock');
  assert.equal((aiResult.actions[0] as { quantity: number }).quantity, 25);
  assert.equal(aiResult.reasoning, 'Racks are empty so I purchased 25 shards from the Lord.');

  // Case 3: Injected fake fetch returning illegal actions (dropped cleanly)
  const fakeFetchIllegal: typeof fetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [
                  { type: 'set_price', itemType: 'shard', price: 99 },
                  { type: 'restock', itemType: 'shard', quantity: 999999 },
                ],
                reasoning: 'Tried to change prices and overspend.',
              }),
            },
          },
        ],
      }),
    } as unknown as Response;
  };

  const deciderIllegal = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'mock-key',
    model: 'meta-llama/Llama-3.2-3B-Instruct',
    fetchFn: fakeFetchIllegal,
  });

  const illegalResult = await deciderIllegal.decide(obs);
  assert.equal(illegalResult.actions.length, 0, 'Illegal actions from AI must be dropped');
  assert.equal(illegalResult.reasoning, 'Tried to change prices and overspend.');

  // Case 4: Fake fetch throwing network error or timeout (clean fallback to RuleDecider for that tick)
  const fakeFetchError: typeof fetch = async () => {
    throw new Error('Connection timed out after 5000ms');
  };

  const deciderError = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'mock-key',
    model: 'meta-llama/Llama-3.2-3B-Instruct',
    fetchFn: fakeFetchError,
  });

  const timeoutResult = await deciderError.decide(obs);
  assert.ok(timeoutResult.actions.length > 0, 'Must fall back to RuleDecider on fetch error');
  assert.equal(timeoutResult.actions[0]?.type, 'restock');
});

test('RuleDecider over 7 simulated days keeps all three merchants solvent and ledger conserves world supply', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  assert.equal(verifyWorldSupply(db), true, 'Genesis supply must be intact');

  // Seed a player with 15,000 CHROMA from treasury for customer transactions
  const player = 'customer_citizen';
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: player,
      amount: 15000,
      reason: 'player_starting_grant',
    },
    db,
  );
  assert.equal(verifyWorldSupply(db), true);

  const decider = new RuleDecider();
  const tickMinutes = AGENT_CONFIG.tickGameMinutes;
  const ticksPerDay = (24 * 60) / tickMinutes;
  const totalDays = 7;

  const simulationLog: Array<{
    day: number;
    purses: Record<string, number>;
    status: Record<string, string>;
  }> = [];

  let currentTime = 0;

  for (let day = 1; day <= totalDays; day++) {
    for (let tick = 0; tick < ticksPerDay; tick++) {
      currentTime += tickMinutes * 60 * 1000;
      const hourOfDay = ((currentTime / GAME_HOUR_MS) % 24 + 24) % 24;

      // During daylight hours (08:00 to 18:00), simulate regular customer trade
      if (hourOfDay >= 8 && hourOfDay <= 18 && tick % 4 === 0) {
        try {
          buyFromMerchant(
            {
              merchantId: 'sindr_shards',
              buyerAccountId: player,
              itemType: 'shard',
              quantity: 2,
              now: currentTime,
            },
            db,
          );
        } catch {
          // ignore if stock temporarily low
        }

        try {
          sellToMerchant(
            {
              merchantId: 'sindr_shards',
              sellerAccountId: player,
              itemType: 'material',
              quantity: 1,
              now: currentTime,
            },
            db,
          );
        } catch {
          // ignore
        }

        try {
          buyFromMerchant(
            {
              merchantId: 'sindr_supplies',
              buyerAccountId: player,
              itemType: 'potion',
              quantity: 1,
              now: currentTime,
            },
            db,
          );
        } catch {
          // ignore
        }

        try {
          buyFromMerchant(
            {
              merchantId: 'sindr_arms',
              buyerAccountId: player,
              itemType: 'item',
              quantity: 1,
              now: currentTime,
            },
            db,
          );
        } catch {
          // ignore
        }
      }

      // Tick all three merchants with RuleDecider
      await tickAllMerchantAgents({ now: currentTime, decider, db });
    }

    // Daily solvency tick
    tickMerchantAgentsDay(currentTime, db);

    const mShards = getMerchant('sindr_shards', db);
    const mSupplies = getMerchant('sindr_supplies', db);
    const mArms = getMerchant('sindr_arms', db);

    assert.ok(mShards && mSupplies && mArms);
    simulationLog.push({
      day,
      purses: {
        sindr_shards: mShards.balance,
        sindr_supplies: mSupplies.balance,
        sindr_arms: mArms.balance,
      },
      status: {
        sindr_shards: mShards.status,
        sindr_supplies: mSupplies.status,
        sindr_arms: mArms.status,
      },
    });

    // Invariant: world supply must be strictly conserved after every single day
    assert.equal(
      verifyWorldSupply(db),
      true,
      `World supply invariant must hold on day ${day}`,
    );
  }

  // Verify all 3 merchants remain solvent after 7 days
  for (const entry of simulationLog) {
    for (const [id, purse] of Object.entries(entry.purses)) {
      assert.ok(
        purse >= MERCHANT_CONFIG.brokeThreshold,
        `Merchant ${id} must remain solvent on day ${entry.day} (purse: ${purse})`,
      );
    }
    for (const [id, status] of Object.entries(entry.status)) {
      assert.equal(
        status,
        'open',
        `Merchant ${id} status must be open on day ${entry.day}`,
      );
    }
  }

  // Print simulation table for report
  console.log('--- 7-DAY SIMULATION TABLE ---');
  console.table(
    simulationLog.map((row) => ({
      Day: row.day,
      'Shards Purse': row.purses.sindr_shards,
      'Supplies Purse': row.purses.sindr_supplies,
      'Arms Purse': row.purses.sindr_arms,
      'All Open': Object.values(row.status).every((s) => s === 'open') ? 'Yes' : 'No',
    })),
  );
});

test('Merchant solvency: forced flood of 20 x maxStock shards drains purse below 1,000 and closes shop after 3 days', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  const merchantId = 'sindr_shards';
  const merchant = getMerchant(merchantId, db);
  assert.ok(merchant);

  const maxStock = merchant.inventory.shard?.maxStock ?? 200;
  const floodQuantity = 20 * maxStock; // 4,000 shards

  const seller = 'flooding_wholesaler';

  // Seller dumps shards in repeated sells until merchant purse is drained below 1,000
  let now = 1000;
  let soldCount = 0;
  const batchSize = 50;

  while (soldCount < floodQuantity) {
    now += 60000;
    const m = getMerchant(merchantId, db);
    if (!m || m.balance < 1000 || m.status === 'broke_buying_paused') {
      break;
    }

    try {
      sellToMerchant(
        {
          merchantId,
          sellerAccountId: seller,
          itemType: 'shard',
          quantity: batchSize,
          now,
        },
        db,
      );
      soldCount += batchSize;
    } catch {
      break;
    }
  }

  const brokeMerchant = getMerchant(merchantId, db);
  assert.ok(brokeMerchant);
  assert.ok(
    brokeMerchant.balance < 1000,
    `Purse must drop below 1,000 after dumping goods (actual: ${brokeMerchant.balance})`,
  );
  assert.equal(
    brokeMerchant.status,
    'broke_buying_paused',
    'Merchant status must switch to broke_buying_paused',
  );

  // Attempting to sell more to a broke merchant must be refused
  assert.throws(() => {
    sellToMerchant(
      {
        merchantId,
        sellerAccountId: seller,
        itemType: 'shard',
        quantity: 1,
        now,
      },
      db,
    );
  }, /insufficient funds and has paused purchases/);

  // Advance time across 3 days with no tribute / no bailout
  // Day 1
  now += 24 * GAME_HOUR_MS;
  tickMerchantAgentsDay(now, db);
  assert.equal(getMerchant(merchantId, db)?.daysBroke, 1);
  assert.equal(getMerchant(merchantId, db)?.status, 'broke_buying_paused');

  // Day 2
  now += 24 * GAME_HOUR_MS;
  tickMerchantAgentsDay(now, db);
  assert.equal(getMerchant(merchantId, db)?.daysBroke, 2);
  assert.equal(getMerchant(merchantId, db)?.status, 'broke_buying_paused');

  // Day 3: Reaches closure limit (closureDays = 3)
  now += 24 * GAME_HOUR_MS;
  const closureResult = tickMerchantAgentsDay(now, db);
  assert.ok(closureResult.closed.includes(merchantId));

  const closedMerchant = getMerchant(merchantId, db);
  assert.ok(closedMerchant);
  assert.equal(closedMerchant.status, 'closed', 'Merchant must be closed after 3 days broke');
});

test('HTTP API: GET /api/economy/merchants/:merchantId/mind returns latestThought, actions, purse, and open status', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  // Tick the merchant so that thought and actions are recorded in merchant_agent_mind
  await tickMerchantAgent({
    merchantId: 'sindr_shards',
    now: 12 * GAME_HOUR_MS,
    decider: new RuleDecider(),
    db,
  });

  const server = await startTestServer();

  try {
    const res = await fetch(`${server.baseUrl}/api/economy/merchants/sindr_shards/mind`);
    assert.equal(res.status, 200);

    const data = (await res.json()) as {
      merchantId: string;
      latestThought: string;
      actions: Array<{ action: unknown; reasoning?: string }>;
      purse: number;
      open: boolean;
      status: string;
    };

    assert.equal(data.merchantId, 'sindr_shards');
    assert.ok(typeof data.latestThought === 'string' && data.latestThought.length > 0);
    assert.ok(Array.isArray(data.actions));
    assert.ok(typeof data.purse === 'number');
    assert.equal(typeof data.open, 'boolean');
    assert.equal(data.status, 'open');

    // Non-existent merchant returns 404
    const notFoundRes = await fetch(`${server.baseUrl}/api/economy/merchants/ghost_merchant/mind`);
    assert.equal(notFoundRes.status, 404);
  } finally {
    await server.close();
  }
});

test("Shop Ownership: broke merchant closes, goes on sale, is bought, restocked, sells at owner's price, and owner withdraws profit while conserving world supply", async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  ensureSindrMerchants(db, 0);

  const merchantId = 'sindr_shards';
  let now = 100000;

  // 1. Drain merchant purse below 1,000 CHROMA by forcing large buys
  const merchant = getMerchant(merchantId, db);
  assert.ok(merchant);
  merchant.balance = 500;
  merchant.status = 'broke_buying_paused';
  saveMerchant(merchant, db);

  // 3 days pass while broke -> shop closes
  now += 24 * GAME_HOUR_MS;
  tickMerchantAgentsDay(now, db); // day 1 broke
  now += 24 * GAME_HOUR_MS;
  tickMerchantAgentsDay(now, db); // day 2 broke
  now += 24 * GAME_HOUR_MS;
  const closeResult = tickMerchantAgentsDay(now, db); // day 3 broke -> closed
  assert.ok(closeResult.closed.includes(merchantId));

  const closedMerchant = getMerchant(merchantId, db);
  assert.ok(closedMerchant);
  assert.equal(closedMerchant.status, 'closed');

  // Check shop is listed for sale
  const shopsForSale = getShopsForSale(now, db);
  assert.ok(shopsForSale.some((s) => s.merchantId === merchantId));
  const shopItem = shopsForSale.find((s) => s.merchantId === merchantId)!;
  assert.equal(shopItem.salePrice, SHOPS_CONFIG.salePrice);

  // 2. Fund Alice and Alice buys the shop
  const alice = 'player_alice';
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: alice,
      amount: 5000,
      reason: 'boss_reward',
      refId: 'test_seed',
      timestamp: now,
    },
    db,
  );
  assert.equal(getAccountBalance(alice, db), 5000);

  const buyResult = buyShop({ merchantId, buyerAccountId: alice, now }, db);
  assert.equal(buyResult.success, true);
  assert.equal(buyResult.ownership.ownerId, alice);
  assert.equal(buyResult.merchant.status, 'open');
  assert.equal(getAccountBalance(alice, db), 3000); // 5000 - 2000

  // Verify world supply after shop purchase
  assert.equal(verifyWorldSupply(db), true);

  // Verify ownership record in DB
  const activeOwnership = getActiveShopOwnership(merchantId, db);
  assert.ok(activeOwnership);
  assert.equal(activeOwnership.ownerId, alice);

  // 3. Alice restocks the shop with 40 shards at zero tax
  const stockBefore = getMerchant(merchantId, db)!.inventory['shard']!.stock;
  const stockRes = stockShop(
    {
      merchantId,
      ownerAccountId: alice,
      itemType: 'shard',
      quantity: 40,
      now,
    },
    db,
  );
  assert.equal(stockRes.success, true);
  assert.equal(stockRes.newStock, stockBefore + 40);
  assert.equal(verifyWorldSupply(db), true);

  // 4. Alice sets price multiplier to 1.5
  const priceRes = setShopPrices(
    {
      merchantId,
      ownerAccountId: alice,
      multipliers: { shard: 1.5 },
      now,
    },
    db,
  );
  assert.equal(priceRes.success, true);
  assert.equal(priceRes.multipliers['shard'], 1.5);

  // 5. Customer Bob buys 2 shards from the shop at owner's price
  const bob = 'player_bob';
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: bob,
      amount: 1000,
      reason: 'boss_reward',
      refId: 'test_seed_bob',
      timestamp: now,
    },
    db,
  );

  const quote = quoteMerchantTrade(
    {
      merchantId,
      itemType: 'shard',
      action: 'buy',
      quantity: 2,
      buyerAccountId: bob,
      now,
    },
    db,
  );
  assert.equal(quote.canExecute, true);
  // Verify owner multiplier step in quote
  const ownerStep = quote.steps.find((s) => s.rule === 'owner_multiplier');
  assert.ok(ownerStep, 'Quote must include owner_multiplier step');
  assert.equal(ownerStep.words, 'The owner sets this price.');

  const merchantPurseBefore = getMerchant(merchantId, db)!.balance;
  const tradeRes = buyFromMerchant(
    {
      merchantId,
      buyerAccountId: bob,
      itemType: 'shard',
      quantity: 2,
      now,
    },
    db,
  );
  assert.ok(tradeRes.totalPrice > 0);

  const merchantPurseAfter = getMerchant(merchantId, db)!.balance;
  // Merchant gained totalPrice - tax
  assert.equal(
    merchantPurseAfter,
    merchantPurseBefore + tradeRes.totalPrice - tradeRes.taxAmount,
  );
  assert.equal(verifyWorldSupply(db), true);

  // Verify customer sale was recorded in shop_sales
  const salesHistory = getShopSales(merchantId, 5, db);
  assert.ok(salesHistory.some((s) => s.itemType === 'shard' && s.buyerId === bob));

  // 6. Alice withdraws profit from shop purse
  const profitToWithdraw = merchantPurseAfter;
  const aliceBalanceBefore = getAccountBalance(alice, db);
  const withdrawRes = withdrawShopProfit(
    {
      merchantId,
      ownerAccountId: alice,
      amount: profitToWithdraw,
      now,
    },
    db,
  );
  assert.equal(withdrawRes.success, true);
  assert.equal(withdrawRes.amount, profitToWithdraw);
  assert.equal(withdrawRes.remainingPurse, 0);
  assert.equal(
    getAccountBalance(alice, db),
    aliceBalanceBefore + profitToWithdraw,
  );

  // World supply invariant strictly preserved
  assert.equal(verifyWorldSupply(db), true);
});

test('Shop Ownership: unpaid upkeep for 7 days returns shop to sale', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  ensureSindrMerchants(db, 0);

  const merchantId = 'sindr_supplies';
  let now = 100000;

  // Close merchant
  const m = getMerchant(merchantId, db)!;
  m.status = 'closed';
  saveMerchant(m, db);

  // Alice buys shop
  const alice = 'player_alice';
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: alice,
      amount: 2000,
      reason: 'boss_reward',
      timestamp: now,
    },
    db,
  );
  buyShop({ merchantId, buyerAccountId: alice, now }, db);

  // Set Alice balance to 0 so upkeep cannot be paid
  const currentAliceBalance = getAccountBalance(alice, db);
  if (currentAliceBalance > 0) {
    recordTransaction(
      {
        from: alice,
        to: TREASURY_ACCOUNT_ID,
        amount: currentAliceBalance,
        reason: 'edict_fine',
        timestamp: now,
      },
      db,
    );
  }
  assert.equal(getAccountBalance(alice, db), 0);

  // Day 1 to 6: upkeep fails, unpaid days increment, shop still owned
  for (let day = 1; day <= 6; day++) {
    now += 24 * GAME_HOUR_MS;
    const res = tickShopDay({ merchantId, now }, db);
    assert.equal(res.forfeited, false);
    assert.equal(res.unpaidUpkeepDays, day);
    assert.ok(getActiveShopOwnership(merchantId, db));
  }

  // Day 7: reached 7 unpaid days -> forfeited!
  now += 24 * GAME_HOUR_MS;
  const day7Res = tickShopDay({ merchantId, now }, db);
  assert.equal(day7Res.forfeited, true);
  assert.equal(day7Res.unpaidUpkeepDays, 7);

  // Ownership record is no longer active
  assert.equal(getActiveShopOwnership(merchantId, db), null);

  // Merchant status is closed and shop is back on sale
  const shopAfter = getMerchant(merchantId, db)!;
  assert.equal(shopAfter.status, 'closed');
  const forSale = getShopsForSale(now, db);
  assert.ok(forSale.some((s) => s.merchantId === merchantId));

  // World supply preserved
  assert.equal(verifyWorldSupply(db), true);
});

test('Shop Ownership: flagged player, player with bounty, and player with max shops cannot buy', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  ensureSindrMerchants(db, 0);

  const merchantId = 'sindr_arms';
  const now = 100000;

  // Close merchant
  const m = getMerchant(merchantId, db)!;
  m.status = 'closed';
  saveMerchant(m, db);

  const criminal = 'player_criminal';
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: criminal,
      amount: 10000,
      reason: 'boss_reward',
      timestamp: now,
    },
    db,
  );

  // 1. Red flag test
  addRedFlag(criminal, 'Caught picking pockets', db, now);
  assert.throws(
    () => buyShop({ merchantId, buyerAccountId: criminal, now }, db),
    /red flag/i,
  );

  // 2. Bounty test (after flag expires, give active bounty)
  const outlaw = 'player_outlaw';
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: outlaw,
      amount: 10000,
      reason: 'boss_reward',
      timestamp: now,
    },
    db,
  );
  createBounty(
    {
      targetAccountId: outlaw,
      rewardChroma: 500,
      reason: 'Grand larceny on the High Bridge',
      issuerId: TREASURY_ACCOUNT_ID,
    },
    db,
  );
  assert.throws(
    () => buyShop({ merchantId, buyerAccountId: outlaw, now }, db),
    /bounty/i,
  );

  // 3. Second shop purchase test
  const honestPlayer = 'player_honest';
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: honestPlayer,
      amount: 10000,
      reason: 'boss_reward',
      timestamp: now,
    },
    db,
  );

  // First purchase succeeds
  buyShop({ merchantId, buyerAccountId: honestPlayer, now }, db);

  // Prepare second shop for sale
  const merchantId2 = 'sindr_supplies';
  const m2 = getMerchant(merchantId2, db)!;
  m2.status = 'closed';
  saveMerchant(m2, db);

  // Second purchase by same player is refused
  assert.throws(
    () => buyShop({ merchantId: merchantId2, buyerAccountId: honestPlayer, now }, db),
    /at most 1 shop/i,
  );
});

test('Shop Ownership: unsold shop gets a new NPC after 3 days with bailout grant', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  ensureSindrMerchants(db, 0);

  const merchantId = 'sindr_shards';
  let now = 100000;

  // Merchant closes
  const m = getMerchant(merchantId, db)!;
  m.status = 'closed';
  m.daysBroke = 3;
  saveMerchant(m, db);

  // Day 1 on sale
  now += 24 * GAME_HOUR_MS;
  const d1 = tickShopDay({ merchantId, now }, db);
  assert.equal(d1.bailoutReopened, false);
  assert.equal(getMerchant(merchantId, db)!.status, 'closed');

  // Day 2 on sale
  now += 24 * GAME_HOUR_MS;
  const d2 = tickShopDay({ merchantId, now }, db);
  assert.equal(d2.bailoutReopened, false);
  assert.equal(getMerchant(merchantId, db)!.status, 'closed');

  // Day 3 on sale -> expires unsold! New NPC merchant arrives with bailout grant
  now += 24 * GAME_HOUR_MS;
  const d3 = tickShopDay({ merchantId, now }, db);
  assert.equal(d3.bailoutReopened, true);

  const reopenedMerchant = getMerchant(merchantId, db)!;
  assert.equal(reopenedMerchant.status, 'open');
  assert.equal(reopenedMerchant.daysBroke, 0);
  assert.ok(reopenedMerchant.balance >= MERCHANT_CONFIG.bailoutGrant);

  // World supply preserved
  assert.equal(verifyWorldSupply(db), true);
});

test('Shop Ownership: player-owned shop keeps voiced shopkeeper but takes no agent decisions', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  ensureSindrMerchants(db, 0);

  const merchantId = 'sindr_shards';
  const now = 12 * GAME_HOUR_MS;

  // Setup player ownership
  const owner = 'player_owner';
  insertShopOwnership(
    {
      merchantId,
      ownerId: owner,
      action: 'purchase',
      priceMultipliers: { shard: 1.2 },
      active: true,
      timestamp: now,
    },
    db,
  );

  const initialBalance = getMerchant(merchantId, db)!.balance;

  // Tick the merchant agent loop
  const tickRes = await tickMerchantAgent({
    merchantId,
    now,
    decider: new RuleDecider(),
    db,
  });

  // Decisions are skipped under ownership
  assert.equal(tickRes.actionsApplied.length, 0);
  assert.equal(tickRes.actionsDropped.length, 0);
  assert.match(tickRes.thought, /under the direction of the shop owner/i);
  // Purse balance unchanged by agent loop
  assert.equal(getMerchant(merchantId, db)!.balance, initialBalance);
});

test('HTTP API: shop ownership endpoints handle for-sale listing, purchase, pricing, stocking, and profit withdrawal end-to-end', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  const merchantId = 'sindr_shards';
  const m = getMerchant(merchantId, db)!;
  m.status = 'closed';
  saveMerchant(m, db);

  const alice = 'valid_alice_owner';
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: alice,
      amount: 6000,
      reason: 'boss_reward',
      timestamp: Date.now(),
    },
    db,
  );

  setTokenVerifier(async (token) => {
    if (token === 'valid_alice_owner') return { userId: 'valid_alice_owner' };
    throw new Error('Invalid token');
  });

  const server = await startTestServer();

  try {
    // 1. GET /api/economy/shops/for-sale
    const forSaleRes = await fetch(`${server.baseUrl}/api/economy/shops/for-sale`);
    assert.equal(forSaleRes.status, 200);
    const forSaleData = (await forSaleRes.json()) as { shops: Array<{ merchantId: string; salePrice: number }> };
    assert.ok(forSaleData.shops.some((s) => s.merchantId === merchantId));

    // 2. Unauthorized buy attempt returns 401
    const unauthBuy = await fetch(`${server.baseUrl}/api/economy/shops/${merchantId}/buy`, {
      method: 'POST',
    });
    assert.equal(unauthBuy.status, 401);

    // 3. Authorized buy attempt succeeds
    const buyRes = await fetch(`${server.baseUrl}/api/economy/shops/${merchantId}/buy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice}`,
      },
    });
    assert.equal(buyRes.status, 200);
    const buyData = (await buyRes.json()) as { success: boolean; ownership: { ownerId: string } };
    assert.equal(buyData.success, true);
    assert.equal(buyData.ownership.ownerId, alice);

    // 4. POST prices
    const pricesRes = await fetch(`${server.baseUrl}/api/economy/shops/${merchantId}/prices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice}`,
      },
      body: JSON.stringify({
        multipliers: { shard: 1.4, material: 0.9 },
      }),
    });
    assert.equal(pricesRes.status, 200);
    const pricesData = (await pricesRes.json()) as { success: boolean; multipliers: Record<string, number> };
    assert.equal(pricesData.multipliers['shard'], 1.4);
    assert.equal(pricesData.multipliers['material'], 0.9);

    // Invalid multiplier outside [0.6, 2.5] returns 400
    const invalidPriceRes = await fetch(`${server.baseUrl}/api/economy/shops/${merchantId}/prices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice}`,
      },
      body: JSON.stringify({
        multipliers: { shard: 3.0 },
      }),
    });
    assert.equal(invalidPriceRes.status, 400);

    // 5. POST stock
    const stockRes = await fetch(`${server.baseUrl}/api/economy/shops/${merchantId}/stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice}`,
      },
      body: JSON.stringify({
        itemType: 'shard',
        quantity: 20,
      }),
    });
    assert.equal(stockRes.status, 200);
    const stockData = (await stockRes.json()) as { success: boolean; newStock: number };
    assert.ok(stockData.newStock >= 20);

    // 6. Fund merchant and test POST withdraw
    const merch = getMerchant(merchantId, db)!;
    merch.balance = 500;
    saveMerchant(merch, db);

    const withdrawRes = await fetch(`${server.baseUrl}/api/economy/shops/${merchantId}/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice}`,
      },
      body: JSON.stringify({
        amount: 250,
      }),
    });
    assert.equal(withdrawRes.status, 200);
    const withdrawData = (await withdrawRes.json()) as { success: boolean; amount: number; remainingPurse: number };
    assert.equal(withdrawData.success, true);
    assert.equal(withdrawData.amount, 250);
    assert.equal(withdrawData.remainingPurse, 250);
  } finally {
    await server.close();
  }
});


