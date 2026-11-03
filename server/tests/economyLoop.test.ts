import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, setDatabase } from '../src/db.js';
import { RuleDecider, createLootPile, getMerchant, startEconomyLoop, verifyWorldSupply } from '../src/economy/index.js';

test('Economy loop: starting the server opens the Sindr market and runs a first merchant tick', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  const lines: string[] = [];
  const loop = startEconomyLoop({ db, decider: new RuleDecider(), now: () => 10 * 60 * 60 * 1000, log: (l) => lines.push(l) });
  await new Promise((r) => setTimeout(r, 50));
  loop.stop();
  for (const id of ['sindr_shards', 'sindr_supplies', 'sindr_arms']) assert.ok(getMerchant(id, db), `${id} exists`);
  assert.ok(lines.some((l) => l.startsWith('merchants ticked: 3')), lines.join('\n'));
  assert.equal(verifyWorldSupply(db), true);
});

test('Economy loop: an expired pile is swept back to the treasury', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  createLootPile({ x: 0, z: 0, zone: 'sindr', contents: { chroma: 30, shards: {}, materials: {} }, source: 'villain', now: 0 }, db);
  let t = 0;
  const lines: string[] = [];
  const loop = startEconomyLoop({ db, decider: new RuleDecider(), now: () => t, log: (l) => lines.push(l) });
  t = 16 * 60 * 1000;
  // Run one sweep directly through the same function the loop schedules.
  const { sweepExpiredPiles } = await import('../src/economy/index.js');
  const res = sweepExpiredPiles(t, db);
  loop.stop();
  assert.equal(res.reclaimedChroma, 30);
  assert.equal(verifyWorldSupply(db), true);
});
