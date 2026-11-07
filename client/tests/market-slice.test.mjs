import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import balance from '../../shared/balance.json' with { type: 'json' };
import { MARKET_SLICE as M, MARKET_RACE, waterAt } from '../../shared/src/world/ignis/market-slice.ts';
import { validateWater } from '../../shared/src/world/ignis/validate.ts';
import { SINDR_ANCHORS } from '../../shared/src/world/ignis/sindr.ts';
import { SINDR_COLLISION_BOXES, SINDR_HIDEOUT, isColliding } from '../../shared/src/net/places.ts';
import { townWorld } from './town-world.mjs';

// The market slice as built: the collision and walk map the game reads, checked against the approved layout.

const inSlice = (p, pad = 0) => p.x >= M.bounds.x0 - pad && p.x <= M.bounds.x1 + pad && p.z >= M.bounds.z0 - pad && p.z <= M.bounds.z1 + pad;
const street = new Vector3(125, 0, 2);
const v = (p) => new Vector3(p.x, p.y, p.z);
/** True when the route's last point is within `reach` of `to` on its level. */
const arrives = (route, to, reach = 1.6) => route.length > 0 && Math.hypot(route.at(-1).x - to.x, route.at(-1).z - to.z) <= reach && Math.abs(route.at(-1).y - to.y) < 1;

let town;
test.before(async () => { town = await townWorld(); });
test.after(() => town.world.free());

test('the water is fresh, flows downhill from its source, and is open only inside the canal', () => {
  assert.deepEqual(validateWater([MARKET_RACE]), []);
  const under = waterAt(125, -12);
  assert.ok(under, 'water under the bridge');
  assert.equal(under.source, 'north_feeder_via_sluice');
  assert.ok(Math.abs(under.depth - 1.5) < 1e-6, 'design depth 1.5 m under B1');
  // As painted: the water a little over a metre below the street, seen over the rail.
  assert.ok(under.surface < M.street.y - 1 && under.surface > M.street.y - 2, `surface ${under.surface} below the street`);
  assert.equal(waterAt(125, -5), null, 'the towpath is dry');
  assert.equal(waterAt(125, -19), null, 'the bridge landing is dry');
  assert.equal(waterAt(150, -12), null, 'past the culvert is dry');
  assert.ok(waterAt(86, -12).surface > waterAt(144, -12).surface, 'the surface falls downstream');
});

test('nothing solid fills the water: no floor at the surface, the bed is the only floor in the channel', () => {
  for (const [x, z] of [[100, -12], [125, -12], [140, -14], [125, -8]]) {
    const w = waterAt(x, z);
    const floor = town.space.floor(x, w.surface + 0.5, z, 10);
    if (x === 125) {
      // Under the deck: cast from just under the deck.
      const under = town.space.floor(x, M.bridge.deck - 0.8, z, 10);
      assert.ok(under !== null && Math.abs(under - w.bed) < 0.35, `bed under the bridge at ${z}: ${under}`);
      continue;
    }
    assert.ok(floor !== null && Math.abs(floor - w.bed) < 0.35, `floor at (${x}, ${z}) is the bed ${w.bed.toFixed(2)}, got ${floor}`);
  }
  // The deck holds the hero over the water.
  const deck = town.space.floor(125, 2, -12, 5);
  assert.ok(deck !== null && Math.abs(deck - M.bridge.deck) < 0.05, `deck at ${deck}`);
});

test('nobody is routed through the water', () => {
  const { map } = town;
  for (let i = 0; i < map.size; i++) {
    const w = waterAt(map.x[i], map.z[i]);
    if (w) assert.ok(map.y[i] >= w.surface - 0.3, `walk cell in the water at ${map.x[i]}, ${map.y[i]}, ${map.z[i]}`);
  }
});

test('all four exits lead out of the slice along collision-backed routes', () => {
  // E3 leaves the upper walk down its stair to the back lane behind Cinder Row.
  const beyond = { E1: [-3, 0, 0], E2: [3, 0, 0], E3: [-10, M.street.y - M.terrace.y, 0], E4: [0, 0, 3] };
  for (const e of M.exits) {
    const [dx, dy, dz] = beyond[e.id];
    const out = new Vector3(e.x + dx, e.y + dy, e.z + dz);
    const route = town.map.route(street, out);
    assert.ok(arrives(route, out, 2), `${e.id} reachable from the street (route ends ${route.at(-1)?.toArray().map((n) => n.toFixed(1))})`);
  }
});

test('B1 carries walkers from the street over the water and up the stair to the upper walk', () => {
  const walk = new Vector3(125, M.terrace.y, (M.upperWalk.z0 + M.upperWalk.z1) / 2);
  const route = town.map.route(street, walk);
  assert.ok(arrives(route, walk), 'street to upper walk');
  const path = [street, ...route];
  let crossed = false;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    for (let t = 0; t <= 1; t += 0.05) {
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
      if (waterAt(x, z)) {
        crossed = true;
        assert.ok(x > M.bridge.x0 - 0.1 && x < M.bridge.x1 + 0.1 && Math.abs(y - M.bridge.deck) < 0.3, `over the water only on the deck (${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)})`);
      }
    }
  }
  assert.ok(crossed, 'the way north crosses the canal');
});

test('every approved post is staffed by a built post of its kind, standing clear on walkable ground', () => {
  const posts = town.builder.posts;
  const reach = { household: 2.6, keeper: 3, smith: 1.5, crew: 0.1, guard: 0.1, porter: 0.1, sentry: 0.1 };
  for (const p of M.posts) {
    const near = posts.filter((q) => q.kind === p.role && Math.abs(q.y - p.y) < 0.6).map((q) => Math.hypot(q.x - p.x, q.z - p.z));
    assert.ok(near.length && Math.min(...near) <= reach[p.role], `${p.id} (${p.role}) has a post within ${reach[p.role]} m (nearest ${Math.min(...near).toFixed(2)})`);
  }
  const { radius } = balance.controller;
  for (const q of posts.filter((p) => inSlice(p))) {
    const at = new Vector3(q.x, q.y + 1, q.z);
    assert.ok(town.space.clear(at, at.clone().setX(q.x + 0.01), radius), `${q.kind} post at ${q.x.toFixed(1)}, ${q.y}, ${q.z.toFixed(1)} stands clear`);
    const under = town.space.floor(q.x, q.y + 0.5, q.z, 1);
    assert.ok(under !== null && Math.abs(under - q.y) < 0.3, `${q.kind} post at ${q.x.toFixed(1)}, ${q.y}, ${q.z.toFixed(1)} stands on a floor (${under})`);
    // Keepers stand behind their counters and smiths at their anvils; everyone else is reached from the street.
    if (q.kind === 'keeper' || q.kind === 'smith') continue;
    const cell = town.map.nearest(v(q), 1.6);
    assert.ok(cell !== null && Math.abs(town.map.y[cell] - q.y) < 0.6, `${q.kind} post at ${q.x.toFixed(1)}, ${q.z.toFixed(1)} is on the walk map`);
    const route = town.map.route(street, v(q));
    assert.ok(arrives(route, v(q), 1.8), `${q.kind} post at ${q.x.toFixed(1)}, ${q.y}, ${q.z.toFixed(1)} is reachable from the street`);
  }
});

test('the 8 m fight centre is clear from end to end', () => {
  const { radius } = balance.controller;
  for (let z = M.street.fight.z0 + radius; z <= M.street.fight.z1 - radius; z += 1) {
    const a = new Vector3(M.street.x0, 1, z), b = new Vector3(M.street.x1, 1, z);
    assert.ok(town.space.clear(a, b, radius), `nothing stands in the fight centre at z ${z}`);
  }
});

test('services: every stall, the service counter and the forge anvil are reached from every exit', () => {
  const stalls = SINDR_ANCHORS.filter((a) => a.kind === 'stall' && inSlice(a));
  assert.equal(stalls.length, 3, 'the three merchants trade on the market street');
  const targets = [
    ...stalls.map((a) => ({ id: a.id, at: new Vector3(a.x + Math.sin(a.yaw) * 2.6, 0, a.z + Math.cos(a.yaw) * 2.6) })),
    ...M.posts.filter((p) => p.id === 'service' || p.id === 'anvil').map((p) => ({ id: p.id, at: new Vector3(p.x, p.y, p.z - 1.6) })),
  ];
  for (const e of M.exits) {
    for (const t of targets) {
      const route = town.map.route(v(e), t.at);
      assert.ok(arrives(route, t.at, 1.6), `${t.id} reachable from ${e.id}`);
    }
  }
  const forge = SINDR_ANCHORS.find((a) => a.id === 'great_forge');
  const e4 = M.exits.find((e) => e.id === 'E4');
  assert.ok(arrives(town.map.route(v(e4), new Vector3(forge.x + 8, forge.y, forge.z - 6)), new Vector3(forge.x + 8, forge.y, forge.z - 6), 2.5), 'the Great Forge from E4');
});

test('with one exit blocked, the street still empties by the others', async () => {
  // A wall across the street at E1.
  const block = { x: M.street.x0 + 1.5, y: 2, z: 3, hx: 0.5, hy: 2, hz: 12, yaw: 0 };
  const blocked = await townWorld([block]);
  try {
    for (const id of ['E2', 'E3', 'E4']) {
      const e = M.exits.find((k) => k.id === id);
      assert.ok(arrives(blocked.map.route(street, v(e)), v(e), 2), `${id} still open`);
    }
    // The street west of the market is still reached, the long way: over the terrace (E3) or round the back (E4).
    const west = new Vector3(70, 0, 0), route = blocked.map.route(street, west);
    assert.ok(arrives(route, west, 2), 'Cinder Row west is still reached');
    assert.ok(route.some((p) => p.z < M.canal.z0 || p.z > M.shells.find((k) => k.face === 'north').z1 - 1), 'the way west goes round the block');
  } finally {
    blocked.world.free();
  }
});

test('the server places nobody in the canal, in a shop or across the water, and the gang hides in the market alley', () => {
  for (const [x, z] of [[125, -12], [100, -25], [91, 10], [110, 20]]) assert.ok(isColliding(x, z), `(${x}, ${z}) is off limits`);
  for (const [x, z] of [[125, 0], [100, -5.5], [125, 30]]) assert.ok(!isColliding(x, z), `(${x}, ${z}) is open street`);
  assert.ok(!isColliding(SINDR_HIDEOUT.x, SINDR_HIDEOUT.z), 'the hideout is open ground');
  const cell = town.map.nearest(new Vector3(SINDR_HIDEOUT.x, 0, SINDR_HIDEOUT.z), 1.6);
  assert.notEqual(cell, null, 'the hideout is on the walk map');
  assert.ok(SINDR_COLLISION_BOXES.length > 0);
});
