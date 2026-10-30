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
} from '@elements/shared';
import { migrateDatabase, setDatabase } from '../src/db.js';
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
  quoteMerchantTrade,
  buyFromMerchant,
  sellToMerchant,
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
