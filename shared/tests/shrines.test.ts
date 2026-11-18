import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_SHRINE, SHRINE_REACH, SHRINES, litShrines, shrineAt, shrineById, shrineToLight, travelRefusal, wakeShrine } from '../src/net/places.js';
import { SETTLEMENT_PRECINCTS } from '../src/world/ignis/settlements.js';
import { IGNIS } from '../src/world/ignis/coordinates.js';

test('every settlement has a shrine, ids are unique, all inside the nation', () => {
  assert.equal(SHRINES.length, SETTLEMENT_PRECINCTS.length + 1);
  assert.equal(new Set(SHRINES.map(s => s.id)).size, SHRINES.length);
  for (const s of SHRINES) {
    assert.ok(s.x > 0 && s.x < IGNIS.width && s.z > 0 && s.z < IGNIS.depth, s.id);
    assert.ok(Math.hypot(s.wake.x - s.x, s.wake.z - s.z) > 2, `${s.id} wakes clear of the brazier`);
  }
});

test('a settlement shrine stands on its precinct floor, clear of the houses', () => {
  for (const p of SETTLEMENT_PRECINCTS) {
    const s = SHRINES.find(x => x.name === `${p.name} Shrine`)!;
    assert.ok(Math.hypot(s.x - p.x, s.z - p.z) < p.radius, `${s.id} on the floor`);
    for (const h of p.houses) {
      const hx = p.x + h.x, hz = p.z + h.z;
      assert.ok(Math.abs(s.x - hx) > h.w / 2 + 4 || Math.abs(s.z - hz) > h.d / 2 + 4, `${s.id} clear of a house`);
    }
  }
});

test('the first shrine is always lit; reaching another lights it', () => {
  assert.deepEqual(litShrines([]).map(s => s.id), [FIRST_SHRINE]);
  const pinewatch = SHRINES.find(s => s.name === 'Pinewatch Shrine')!;
  assert.equal(shrineToLight([], pinewatch.x + SHRINE_REACH - 1, pinewatch.z)?.id, pinewatch.id);
  assert.equal(shrineToLight([], pinewatch.x + SHRINE_REACH + 1, pinewatch.z), null);
  assert.equal(shrineToLight([pinewatch.id], pinewatch.x, pinewatch.z), null);
});

test('a fallen player wakes at the lit shrine nearest the fall, never an unlit one', () => {
  const first = shrineById(FIRST_SHRINE)!;
  const quay = SHRINES.find(s => s.name === 'Salt Quay Shrine')!;
  assert.equal(wakeShrine([], quay.x, quay.z).id, FIRST_SHRINE);
  assert.equal(wakeShrine([quay.id], quay.x + 50, quay.z).id, quay.id);
  assert.equal(wakeShrine([quay.id], first.x + 10, first.z).id, FIRST_SHRINE);
});

test('travel starts only at a lit shrine and refuses fights, bounties, shards and a full purse', () => {
  const first = shrineById(FIRST_SHRINE)!;
  assert.equal(shrineAt([], first.x, first.z)?.id, FIRST_SHRINE);
  assert.equal(shrineAt([], first.x + 40, first.z), null);
  const calm = { inFight: false, bounty: false, shards: 0, coin: 10 };
  assert.equal(travelRefusal(calm, 25), null);
  assert.ok(travelRefusal({ ...calm, inFight: true }, 25));
  assert.ok(travelRefusal({ ...calm, bounty: true }, 25));
  assert.ok(travelRefusal({ ...calm, shards: 1 }, 25));
  assert.ok(travelRefusal({ ...calm, coin: 26 }, 25));
});
