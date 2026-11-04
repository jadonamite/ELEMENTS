import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { setupApi } from '../src/api.js';
import { setTokenVerifier } from '../src/auth.js';
import { createOrGetAccount, migrateDatabase, setDatabase } from '../src/db.js';
import {
  addItems,
  createLootPile,
  getAccountBalance,
  getSatchel,
  grantPlayerStartingPurse,
  listLootPiles,
  quoteMerchantTrade,
} from '../src/economy/index.js';
import { ensureSindrMerchants } from '../src/economy/agents/agentLoop.js';
import { reportKill } from '../src/net/kill-hook.js';
import { PURSE_LOCK_SECONDS } from '../src/net/money.js';
import { closeZone, enterRoom, leaveRoom, openZone, resetPresence } from '../src/net/presence.js';
import { ZoneWorld, type Identity } from '../src/net/world.js';
import { ZoneEconomy, type EconEvent } from '../src/net/zone-economy.js';
import { SINDR_STALLS } from '../../shared/src/net/index.js';

const T0 = Date.now();

function setup() {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);
  let now = T0;
  const world = new ZoneWorld('sindr', () => 0.5);
  const econ = new ZoneEconomy(world, db, () => now, () => 0.99);
  const rising = (accountId: string, element: string) => {
    createOrGetAccount(accountId, db);
    db.prepare('INSERT INTO risings (account_id, role, element, created_at) VALUES (?, ?, ?, ?)').run(accountId, 'Shaper', element, 0);
  };
  const join = (id: string, who: Identity, x: number, z: number) => {
    const p = world.join(id, who, 0);
    p.x = x;
    p.z = z;
    return p;
  };
  return { db, world, econ, rising, join, advance: (ms: number) => { now += ms; } };
}

const ofType = (events: EconEvent[], type: string) => events.filter((e) => e.type === type);

test('Online money: a signed-in kill drops a pile for everyone in the room; a guest kill drops nothing', () => {
  const { world, econ } = setup();
  const kill = (killer: string) => reportKill({
    zone: 'sindr', worldId: world.id, enemyId: 'villain_2', kind: 'armed', x: 140, z: 9, killerAccountId: killer, damageBy: {}, at: 1,
  });
  kill('guest:abc');
  assert.equal(econ.drain().length, 0);
  kill('acct_a');
  const out = econ.drain();
  assert.equal(ofType(out, 'loot_new').length, 1);
  assert.equal(out[0]!.to, undefined, 'sent to the whole room');
  // A kill in another room of the same zone is not this room's.
  reportKill({ zone: 'sindr', worldId: 'world-elsewhere', enemyId: 'x', kind: 'armed', x: 0, z: 0, killerAccountId: 'acct_a', damageBy: {}, at: 1 });
  assert.equal(econ.drain().length, 0);
  econ.dispose();
});

test('Online money: a pile is claimed from where the room has the player, never where the message says', () => {
  const { db, econ, join } = setup();
  const pile = createLootPile({ x: 100, z: 0, zone: 'sindr', contents: { chroma: 40, shards: { IGNIS: 1 }, materials: {} }, source: 'villain' }, db);
  econ.refresh();
  const a = join('A', { accountId: 'acct_a', role: 'Shaper', element: 'IGNIS' }, 120, 0);
  join('G', { accountId: 'guest:g', role: 'Shaper', element: 'IGNIS' }, 100, 0);

  // Far away, but the message claims to stand on the pile.
  const far = econ.claim('A', { pile: pile.id, x: 100, z: 0 });
  assert.equal((far[0]!.body as { ok: boolean }).ok, false);
  assert.equal(getAccountBalance('acct_a', db), 0);

  // A guest standing on it keeps nothing.
  assert.equal((econ.claim('G', { pile: pile.id })[0]!.body as { ok: boolean }).ok, false);

  a.x = 100.5;
  const near = econ.claim('A', { pile: pile.id });
  assert.equal((near[0]!.body as { ok: boolean }).ok, true);
  assert.equal(ofType(near, 'loot_gone').length, 1, 'everyone sees it vanish');
  assert.equal(getAccountBalance('acct_a', db), 40);
  assert.equal(Object.values(getSatchel('acct_a', db)).reduce((a, b) => a + b, 0), 1, 'the one shard');
  assert.equal(listLootPiles({ zone: 'sindr', now: T0 }, db).length, 0);
  econ.dispose();
});

test('Online money: a stall trade needs the player at the stall, and the outsider price comes from their rising', () => {
  const { db, econ, rising, join } = setup();
  rising('acct_terra', 'TERRA');
  grantPlayerStartingPurse('acct_terra', db);
  const stall = SINDR_STALLS.find((s) => s.id === 'sindr_shards')!;
  const p = join('T', { accountId: 'acct_terra', role: 'Shaper', element: 'TERRA' }, stall.x + 30, stall.z);

  const away = econ.shop('T', { req: 1, action: 'buy', merchant: 'sindr_shards', item: 'shard', qty: 1 });
  assert.equal((away[0]!.body as { error: string }).error, 'Stand at the stall to trade');
  assert.equal(getAccountBalance('acct_terra', db), 100);

  p.x = stall.x;
  const outsiderPrice = quoteMerchantTrade({ merchantId: 'sindr_shards', itemType: 'shard', action: 'buy', quantity: 1, isOutsider: true }, db).totalPrice;
  const homePrice = quoteMerchantTrade({ merchantId: 'sindr_shards', itemType: 'shard', action: 'buy', quantity: 1 }, db).totalPrice;
  assert.ok(outsiderPrice > homePrice);
  // The message says "not an outsider"; the room ignores it.
  const bought = econ.shop('T', { req: 2, action: 'buy', merchant: 'sindr_shards', item: 'shard', qty: 1, outsider: false, isOutsider: false });
  assert.equal((bought[0]!.body as { ok: boolean }).ok, true);
  assert.equal(getAccountBalance('acct_terra', db), 100 - outsiderPrice);
  econ.dispose();
});

test('Online money: a player who falls drops what they carry where the room has them', () => {
  const { db, world, econ, join } = setup();
  addItems({ accountId: 'acct_a', from: 'test', stacks: [{ itemId: 'material_linen', quantity: 4 }], reason: 'loot' }, db);
  const p = join('A', { accountId: 'acct_a', role: 'Shaper', element: 'IGNIS' }, 128, 4);
  p.hp = 1;
  let fell = false;
  for (let t = 0; t < 20 && !fell; t += 0.05) {
    for (const e of world.step(0.05, t)) {
      if (e.type !== 'fell') continue;
      fell = true;
      const out = econ.death(e.to);
      const pile = (ofType(out, 'loot_new')[0]!.body as { pile: { x: number; z: number } }).pile;
      assert.ok(Math.hypot(pile.x - p.x, pile.z - p.z) < 0.01, 'at the room position');
    }
  }
  assert.ok(fell, 'the hound felled the player');
  assert.equal(getSatchel('acct_a', db).material_linen ?? 0, 0);
  econ.dispose();
});

test('Online money: a hand-to-hand trade swaps at once, never with the locked starting purse or from afar', () => {
  const { db, econ, join, advance } = setup();
  grantPlayerStartingPurse('acct_a', db);
  addItems({ accountId: 'acct_b', from: 'test', stacks: [{ itemId: 'material_linen', quantity: 3 }], reason: 'loot' }, db);
  join('A', { accountId: 'acct_a', role: 'Shaper', element: 'IGNIS' }, 100, 0);
  const b = join('B', { accountId: 'acct_b', role: 'Shaper', element: 'IGNIS' }, 120, 0);

  // Within the first hour the starting purse can't change hands.
  const locked = econ.offer('A', { with: 'B', chroma: 50 });
  assert.match(String((locked[0]!.body as { error?: string }).error), /Not enough coin you may trade/);

  advance((PURSE_LOCK_SECONDS + 60) * 1000);
  econ.offer('A', { with: 'B', chroma: 50 });
  econ.offer('B', { with: 'A', items: { material_linen: 3 } });
  econ.accept('A');
  const apart = econ.accept('B');
  assert.match(String((apart[0]!.body as { error?: string }).error), /Stand together/);
  assert.equal(getAccountBalance('acct_a', db), 100);

  b.x = 101;
  econ.accept('A');
  econ.accept('B');
  assert.equal(getAccountBalance('acct_a', db), 50);
  const got = getAccountBalance('acct_b', db);
  assert.ok(got > 0 && got <= 50, `B got 50 less the trade tax: ${got}`);
  assert.equal(getSatchel('acct_a', db).material_linen, 3);
  assert.equal(getSatchel('acct_b', db).material_linen ?? 0, 0);
  econ.dispose();
});

test('Online money: while in a room, the HTTP money door is shut; outside it, it opens again', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);
  resetPresence();
  setTokenVerifier(async (token) => {
    if (token === 'alice') return { userId: 'acct_alice' };
    throw new Error('Invalid token');
  });
  grantPlayerStartingPurse('acct_alice', db);
  const pile = createLootPile({ x: 10, z: 0, zone: 'sindr', contents: { chroma: 30, shards: {}, materials: {} }, source: 'villain' }, db);
  const app = express();
  setupApi(app);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer alice' }, body: JSON.stringify(body),
  });
  try {
    openZone('sindr');
    enterRoom('acct_alice');
    assert.equal((await post(`/api/economy/loot/${pile.id}/claim`, { x: 10, z: 0 })).status, 409);
    assert.equal((await post('/api/economy/merchants/buy', { merchantId: 'sindr_shards', itemType: 'shard', quantity: 1 })).status, 409);
    assert.equal((await post('/api/economy/death', { x: 0, z: 0, zone: 'sindr' })).status, 409);
    assert.equal((await post('/api/economy/counting-house/deposit', { amount: 10, countingHouseId: 'x' })).status, 409);
    assert.equal(getAccountBalance('acct_alice', db), 100);
    leaveRoom('acct_alice');
    // Out of the room, but the zone is online: its kills belong to the room.
    assert.equal((await post('/api/economy/loot/fight', { kind: 'robber', x: 0, z: 0, zone: 'sindr' })).status, 409);
    closeZone('sindr');
    // Offline play opens the door again.
    assert.equal((await post(`/api/economy/loot/${pile.id}/claim`, { x: 10, z: 0 })).status, 200);
    assert.equal(getAccountBalance('acct_alice', db), 130);
    // The one-sided "pay anyone" route and the bounty claim route are gone.
    assert.equal((await post('/api/economy/trade', { sellerId: 'x', amount: 10 })).status, 404);
    assert.equal((await post('/api/economy/bounties/claim', { bountyId: 'x' })).status, 404);
  } finally {
    resetPresence();
    setTokenVerifier(null);
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('Online money: a player who falls carrying nothing leaves nothing on the ground', () => {
  const { db, econ, join } = setup();
  join('A', { accountId: 'acct_empty', role: 'Shaper', element: 'IGNIS' }, 128, 4);
  assert.deepEqual(econ.death('A'), []);
  assert.equal(listLootPiles({ zone: 'sindr', now: Date.now() }, db).length, 0);
  econ.dispose();
});
