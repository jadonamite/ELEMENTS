import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import balance from '../../shared/balance.json' with { type: 'json' };
import { SINDR_ANCHORS } from '../../shared/src/world/ignis/sindr.ts';
import { placesFor, PLACE_REACH } from '../../shared/src/net/places.ts';
import { SINDR_TOWNSFOLK } from '../src/life/townsfolk.ts';
import { townWorld } from './town-world.mjs';

// A shop is three pieces of data: an anchor in the town naming the merchant, the merchant's purse and stock in
// balance.json, and the keeper in the people list. These tests fail when one of the three is missing, so a new
// shop cannot open silent or unstaffed.

const merchants = balance.economy.merchants.sindr;
const shops = placesFor('sindr').stalls;
const street = new Vector3(125, 0, 2);

let town;
test.before(async () => { town = await townWorld(); });
test.after(() => town.world.free());

test('Sindr has fifteen shops, each with stock and exactly one keeper', () => {
  assert.equal(shops.length, 15);
  for (const shop of shops) {
    assert.ok(merchants.some((m) => m.id === shop.id), `${shop.id} has a purse and stock in balance.json`);
    const keepers = SINDR_TOWNSFOLK.filter((p) => p.keeps === shop.id);
    assert.equal(keepers.length, 1, `${shop.id} has one keeper (found ${keepers.map((k) => k.name).join(', ') || 'none'})`);
  }
  for (const m of merchants) assert.ok(shops.some((s) => s.id === m.id), `${m.id} trades at a counter in the town`);
  for (const p of SINDR_TOWNSFOLK.filter((k) => k.keeps)) assert.ok(shops.some((s) => s.id === p.keeps), `${p.name} keeps a shop that exists`);
});

test('every keeper stands at a counter post the town builds', () => {
  const posts = town.builder.posts.filter((p) => p.kind === 'keeper' || p.kind === 'smith');
  for (const a of SINDR_ANCHORS.filter((k) => k.merchant)) {
    const keeper = SINDR_TOWNSFOLK.find((p) => p.keeps === a.merchant);
    const at = keeper.schedule.work;
    const post = posts.find((p) => Math.hypot(p.x - at.x, p.z - at.z) < 0.6 && Math.abs(p.y - at.y) < 0.6);
    assert.ok(post, `${keeper.name} at ${a.id} (${at.x}, ${at.y}, ${at.z}) stands at a built post`);
  }
});

test('every shop can be walked to from the street and served within reach', () => {
  for (const a of SINDR_ANCHORS.filter((k) => k.merchant)) {
    // The customer's side: in front of the counter, the way the keeper faces; the walk map is a 1.5 m grid.
    let best = Infinity;
    for (const d of [1, 1.5, 2, 2.5, 3]) {
      const route = town.map.route(street, new Vector3(a.x + Math.sin(a.yaw) * d, a.y, a.z + Math.cos(a.yaw) * d));
      if (route.length === 0) continue;
      const end = route.at(-1);
      if (Math.abs(end.y - a.y) < 1.2) best = Math.min(best, Math.hypot(end.x - a.x, end.z - a.z));
    }
    assert.ok(best <= PLACE_REACH, `${a.id}: the nearest walkable spot on its level is ${best.toFixed(1)} m from the counter`);
  }
});
