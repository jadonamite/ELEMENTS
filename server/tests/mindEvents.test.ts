import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { GAME_HOUR_MS, TREASURY_ACCOUNT_ID } from '@elements/shared';
import { migrateDatabase, setDatabase } from '../src/db.js';
import {
  addItems,
  buyFromMerchant,
  buyShop,
  createAgentRuntime,
  createLootPile,
  getLatestAgentPlan,
  getMerchant,
  recordTransaction,
  resetHeardPrices,
  saveMerchant,
  sellToMerchant,
  setShopPrices,
  startEconomyLoop,
  tickMerchantAgentsDay,
} from '../src/economy/index.js';
import { ensureSindrMerchants } from '../src/economy/agents/agentLoop.js';
import { ServerRobberGang } from '../src/net/outlaws.js';
import { ZoneWorld } from '../src/net/world.js';
import { ZoneEconomy } from '../src/net/zone-economy.js';
import { fakeRouter } from './helpers/fakeProviders.js';

// Each source of a significant event, driven through the code the game runs, to a keeper re-planned in an
// event flush: the event marks the keeper dirty, the next loop step sends one batched call with the event in it,
// and the keeper's new plan is saved.

const DAY = 24 * GAME_HOUR_MS;
const D0 = 20_000 * DAY;

async function town() {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);
  resetHeardPrices();
  let t = D0 + 9 * GAME_HOUR_MS;
  const fake = fakeRouter({ now: () => t });
  const runtime = createAgentRuntime({ router: fake.router });
  const lines: string[] = [];
  const loop = startEconomyLoop({ db, runtime, now: () => t, log: (l) => lines.push(l), checkEveryMs: 1e9 });
  await loop.step(); // the morning plans
  const planned = fake.calls.length;
  return {
    db,
    runtime,
    calls: fake.calls,
    lines,
    now: () => t,
    /** Lets a minute pass and runs a loop step: the flush. Returns the event calls it made. */
    async flush() {
      t += 60_000;
      const before = fake.calls.length;
      await loop.step();
      return fake.calls.slice(Math.max(before, planned)).filter((c) => c.intent === 'event');
    },
    events: (id: string) => runtime.queue.getRecentEvents(id),
    done() {
      loop.stop();
      runtime.detach();
    },
  };
}

const fund = (db: DatabaseSync, account: string, amount: number, now: number) =>
  recordTransaction({ from: TREASURY_ACCOUNT_ID, to: account, amount, reason: 'boss_reward', refId: `seed:${account}`, timestamp: now }, db);

test('Robbers striking near a stall: the keepers within reach are re-planned with the robbery in mind', async () => {
  const s = await town();
  try {
    const world = new ZoneWorld('sindr', () => 0.5);
    const victim = world.join('V', { accountId: 'acct_victim', role: 'Shaper', element: 'IGNIS' }, 0);
    victim.x = 92;
    victim.z = 6;
    new ServerRobberGang().spawnAmbush(victim, world);

    assert.ok(s.events('sindr_shards').some((e) => e.type === 'robbery' && e.tier === 'significant'), 'the shard stall saw it');
    assert.ok(s.runtime.queue.isAgentDirty('sindr', 'sindr_shards'));
    assert.ok(!s.events('sindr_bright').some((e) => e.type === 'robbery'), 'the guild shop up the Rise did not');

    const flushed = await s.flush();
    assert.equal(flushed.length, 1, 'one batched call for the place');
    const asked = JSON.parse(flushed[0]!.user) as { keepers: Array<{ id: string; events: string[] }> };
    const shards = asked.keepers.find((k) => k.id === 'sindr_shards');
    assert.ok(shards?.events.some((e) => e.includes('Robbers attacked a traveller')), 'the robbery is in the prompt');
    assert.ok(!flushed[0]!.user.includes('acct_victim'), 'the victim is never named');
    assert.equal(getLatestAgentPlan('sindr_shards', s.db)?.createdAt, s.now());
    assert.ok(!s.runtime.queue.isAgentDirty('sindr', 'sindr_shards'));
  } finally {
    s.done();
  }
});

test("Theft near a stall: someone picking up a fallen traveller's goods wakes the keepers nearby", async () => {
  const s = await town();
  try {
    const world = new ZoneWorld('sindr', () => 0.5);
    const econ = new ZoneEconomy(world, s.db, () => s.now(), () => 0.99);
    const pile = createLootPile({ x: 137, z: 5, zone: 'sindr', contents: { chroma: 0, shards: { IGNIS: 2 }, materials: {} }, source: 'player_death', now: s.now() }, s.db);
    econ.refresh();
    const thief = world.join('T', { accountId: 'acct_thief', role: 'Shaper', element: 'IGNIS' }, 0);
    thief.x = 137;
    thief.z = 5;
    const out = econ.claim('T', { pile: pile.id });
    assert.equal((out[0]!.body as { ok: boolean }).ok, true, 'the pile was taken');
    assert.ok(s.events('sindr_arms').some((e) => e.type === 'theft'), 'the arms stall saw it');

    const flushed = await s.flush();
    assert.equal(flushed.length, 1);
    assert.ok(flushed[0]!.user.includes("carried off a fallen traveller's goods"));
    assert.ok(!flushed[0]!.user.includes('acct_thief'));
    econ.dispose();
  } finally {
    s.done();
  }
});

test('A purse near the broke line: the sale that crosses it marks the keeper, the next one does not again', async () => {
  const s = await town();
  try {
    const m = getMerchant('sindr_whetstone', s.db)!;
    m.balance = 1550;
    saveMerchant(m, s.db);
    addItems({ accountId: 'acct_seller', from: 'world', stacks: [{ itemId: 'item', quantity: 2 }], reason: 'grant', now: s.now() }, s.db);
    sellToMerchant({ merchantId: 'sindr_whetstone', sellerAccountId: 'acct_seller', itemType: 'item', quantity: 1, now: s.now() }, s.db);
    const low = s.events('sindr_whetstone').filter((e) => e.type === 'purse_low');
    assert.equal(low.length, 1);
    assert.match(low[0]!.description, /near the broke line of 1000/);
    assert.ok(s.events('sindr_whetstone').some((e) => e.type === 'purchase' && e.tier === 'ordinary'), 'the sale itself is ordinary');

    const flushed = await s.flush();
    assert.equal(flushed.length, 1);
    assert.ok(flushed[0]!.user.includes('near the broke line'));

    sellToMerchant({ merchantId: 'sindr_whetstone', sellerAccountId: 'acct_seller', itemType: 'item', quantity: 1, now: s.now() }, s.db);
    assert.ok(!s.events('sindr_whetstone').some((e) => e.type === 'purse_low'), 'already below: no second warning');
  } finally {
    s.done();
  }
});

test('A colour flood past its threshold: the keeper and every rival who stocks shards hear of it', async () => {
  const s = await town();
  try {
    addItems({ accountId: 'acct_seller', from: 'world', stacks: [{ itemId: 'shard_aques', quantity: 12 }], reason: 'grant', now: s.now() }, s.db);
    for (let i = 0; i < 9; i++) sellToMerchant({ merchantId: 'sindr_shards', sellerAccountId: 'acct_seller', itemType: 'shard_aques', quantity: 1, now: s.now() + i }, s.db);
    assert.ok(!s.events('sindr_shards').some((e) => e.type === 'flood'), 'nine is under the threshold');
    sellToMerchant({ merchantId: 'sindr_shards', sellerAccountId: 'acct_seller', itemType: 'shard_aques', quantity: 1, now: s.now() + 10 }, s.db);
    for (const id of ['sindr_shards', 'sindr_crimson', 'sindr_scales', 'sindr_bright']) {
      assert.ok(s.events(id).some((e) => e.type === 'flood' && e.description.startsWith('Azure shards are flooding in')), `${id} heard of the Azure flood`);
    }
    assert.ok(!s.events('sindr_potter').some((e) => e.type === 'flood'), 'a potter does not care about shards');

    const flushed = await s.flush();
    assert.equal(flushed.length, 1, 'four keepers, one call');
    const ids = (JSON.parse(flushed[0]!.user) as { keepers: Array<{ id: string }> }).keepers.map((k) => k.id).sort();
    assert.deepEqual(ids, ['sindr_bright', 'sindr_crimson', 'sindr_scales', 'sindr_shards']);
  } finally {
    s.done();
  }
});

test("A rival's price change: a demand swing at one stall, and an owner's new prices, reach the rivals", async () => {
  const s = await town();
  try {
    fund(s.db, 'acct_buyer', 50_000, s.now());
    buyFromMerchant({ merchantId: 'sindr_supplies', buyerAccountId: 'acct_buyer', itemType: 'potion', quantity: 1, now: s.now() }, s.db);
    for (let i = 0; i < 6 && !s.events('sindr_potter').some((e) => e.type === 'rival_price'); i++) {
      buyFromMerchant({ merchantId: 'sindr_supplies', buyerAccountId: 'acct_buyer', itemType: 'potion', quantity: 8, now: s.now() + 1 + i }, s.db);
    }
    const heard = s.events('sindr_potter').find((e) => e.type === 'rival_price');
    assert.ok(heard, 'the potter heard the supplies stall moved its potion price');
    assert.match(heard!.description, /^Sindr Potions and Supplies raised its potions price from \d+ to \d+\.$/);
    assert.ok(s.events('sindr_cork').some((e) => e.type === 'rival_price'), 'so did the tonic seller');
    assert.ok(!s.events('sindr_arms').some((e) => e.type === 'rival_price'), 'the arms stall sells no potions');
    const flushed = await s.flush();
    assert.equal(flushed.length, 1);
    assert.ok(flushed[0]!.user.includes('raised its potions price'));

    // An owner of a shop sets its prices: rivals who stock the same goods hear it.
    const merchantId = 'sindr_scales';
    const m = getMerchant(merchantId, s.db)!;
    m.balance = 500;
    m.status = 'broke_buying_paused';
    saveMerchant(m, s.db);
    let t = s.now();
    for (let d = 0; d < 3; d++) tickMerchantAgentsDay((t += DAY), s.db);
    fund(s.db, 'acct_owner', 5000, t);
    buyShop({ merchantId, buyerAccountId: 'acct_owner', now: t }, s.db);
    setShopPrices({ merchantId, ownerAccountId: 'acct_owner', multipliers: { shard: 0.7 }, now: t }, s.db);
    for (const id of ['sindr_shards', 'sindr_crimson', 'sindr_bright']) {
      assert.ok(s.events(id).some((e) => e.type === 'rival_price' && e.description === 'Salt-Scale Counter now asks 70% of the usual price for Crimson shards.'), `${id} heard`);
    }
  } finally {
    s.done();
  }
});

test('Ordinary events wake nobody: a single sale waits for the next phase plan, then is cleared', async () => {
  const s = await town();
  try {
    fund(s.db, 'acct_buyer', 1000, s.now());
    buyFromMerchant({ merchantId: 'sindr_loom', buyerAccountId: 'acct_buyer', itemType: 'material', quantity: 1, now: s.now() }, s.db);
    assert.ok(s.events('sindr_loom').some((e) => e.tier === 'ordinary'));
    assert.ok(!s.runtime.queue.isAgentDirty('sindr', 'sindr_loom'));
    assert.equal((await s.flush()).length, 0, 'no flush for an ordinary sale');
    assert.equal(s.runtime.queue.eventLines('sindr_loom').length, 1, 'still waiting for the next plan');
  } finally {
    s.done();
  }
});
