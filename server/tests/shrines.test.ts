import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { FIRST_SHRINE, regionFor, SHRINES, shrineById, TREASURY_ACCOUNT_ID } from '@elements/shared';
import { migrateDatabase, setDatabase } from '../src/db.js';
import { addItems, recordTransaction } from '../src/economy/index.js';
import { networkPosition, SPAWN_REGION } from '../src/net/coordinates.js';
import { litShrinesOf, reachShrine, resumeOf, travelCheck } from '../src/net/shrines.js';
import { ZoneWorld } from '../src/net/world.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  return db;
}

const who = (accountId: string) => ({ accountId, role: 'Shaper' as const, element: 'IGNIS' as const });
const pinewatch = SHRINES.find(s => s.name === 'Pinewatch Shrine')!;
const embers = shrineById(FIRST_SHRINE)!;

test('reaching a shrine lights it once, outside a fight, and the books remember it', () => {
  const db = freshDb();
  const lit = litShrinesOf('acc_light', db);
  assert.deepEqual([...lit], [FIRST_SHRINE]);
  assert.equal(reachShrine('acc_light', lit, pinewatch.x, pinewatch.z, true, 1, db), null, 'not mid-fight');
  assert.equal(reachShrine('acc_light', lit, pinewatch.x, pinewatch.z, false, 1, db)?.id, pinewatch.id);
  assert.equal(reachShrine('acc_light', lit, pinewatch.x, pinewatch.z, false, 2, db), null, 'already lit');
  assert.ok(litShrinesOf('acc_light', db).has(pinewatch.id));
  assert.equal(litShrinesOf('guest:x', db).size, 1, 'guests keep nothing');
});

test('after a restart a returning player resumes at the shrine they lit last', () => {
  const db = freshDb();
  reachShrine('acc_resume', new Set([FIRST_SHRINE]), pinewatch.x, pinewatch.z, false, 5, db);
  const resume = resumeOf('acc_resume', db)!;
  assert.equal(resume.zone, regionFor({ x: pinewatch.wake.x, y: pinewatch.y, z: pinewatch.wake.z }).id);
  assert.equal(resumeOf('acc_never_lit', db), undefined, 'nothing lit: the first shrine region');
});

test('a fallen player wakes at the nearest lit shrine: here when it is in this region, by a move when it is not', () => {
  freshDb();
  const world = new ZoneWorld(SPAWN_REGION);
  const p = world.join('A', who('acc_wake'), 0);
  // Fell near the first shrine with only it lit: stands up at its wake spot in this region.
  p.hp = 0; p.downFor = 0.01;
  const here = world.step(0.05, 1).find(e => e.type === 'revived' || e.type === 'wake_away');
  assert.equal(here?.type, 'revived');
  const spot = networkPosition(SPAWN_REGION, { x: embers.wake.x, y: embers.y, z: embers.wake.z });
  assert.ok(Math.hypot(p.x - spot.x, p.z - spot.z) < 0.01);

  // Fell next to Pinewatch with it lit: Pinewatch is another region, so the room is asked to move them there.
  p.lit.add(pinewatch.id);
  const near = networkPosition(SPAWN_REGION, { x: pinewatch.x, y: pinewatch.y, z: pinewatch.z });
  p.x = near.x; p.z = near.z;
  p.hp = 0; p.downFor = 0.01;
  const away = world.step(0.05, 2).find(e => e.type === 'revived' || e.type === 'wake_away');
  assert.deepEqual(away, { type: 'wake_away', to: 'A', shrine: pinewatch.id });
});

test('travel needs a lit shrine underfoot, a lit target, and no fight, bounty, shards or full purse', () => {
  const db = freshDb();
  const lit = new Set([FIRST_SHRINE, pinewatch.id]);
  assert.equal(travelCheck('acc_t', lit, embers.x + 50, embers.z, pinewatch.id, false, db).ok, false, 'away from a shrine');
  assert.equal(travelCheck('acc_t', new Set([FIRST_SHRINE]), embers.x, embers.z, pinewatch.id, false, db).ok, false, 'unlit target');
  assert.equal(travelCheck('acc_t', lit, embers.x, embers.z, pinewatch.id, true, db).ok, false, 'mid-fight');
  assert.equal(travelCheck('acc_t', lit, embers.x, embers.z, pinewatch.id, false, db).ok, true);
  addItems({ accountId: 'acc_t', from: 'world', stacks: [{ itemId: 'shard_ignis', quantity: 1 }], reason: 'grant' }, db);
  assert.equal(travelCheck('acc_t', lit, embers.x, embers.z, pinewatch.id, false, db).ok, false, 'shards go by road');
  recordTransaction({ from: TREASURY_ACCOUNT_ID, to: 'acc_c', amount: 500, reason: 'grant' }, db);
  assert.equal(travelCheck('acc_c', lit, embers.x, embers.z, pinewatch.id, false, db).ok, false, 'bank the coin first');
  assert.equal(travelCheck('guest:g', lit, embers.x, embers.z, pinewatch.id, false, db).ok, false);
});
