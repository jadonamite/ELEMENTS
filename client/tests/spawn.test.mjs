import assert from 'node:assert/strict';
import test from 'node:test';
import balance from '../../shared/balance.json' with { type: 'json' };
import { WorldBuilder } from '../src/world/builder.ts';
import { buildSindr, SPAWN, WALKABLE } from '../src/world/sindr.ts';

/** Distance in the ground plane from (x, z) to a collider's footprint, honouring its yaw. */
function footprintDistance(c, x, z) {
  const dx = x - c.x, dz = z - c.z;
  const cos = Math.cos(-c.yaw), sin = Math.sin(-c.yaw);
  const lx = dx * cos + dz * sin, lz = -dx * sin + dz * cos;
  return Math.hypot(Math.max(Math.abs(lx) - c.hx, 0), Math.max(Math.abs(lz) - c.hz, 0));
}

/** True when the segment a-b passes through a flame: a billboard 1 x 1.6 scaled, standing on the fire's point. */
function throughFlame(f, a, b) {
  const half = 0.5 * f.scale + 0.2, top = f.position.y + 1.6 * f.scale;
  for (let i = 0; i <= 200; i++) {
    const t = i / 200, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    if (y >= f.position.y && y <= top && Math.hypot(x - f.position.x, z - f.position.z) <= half) return true;
  }
  return false;
}

test('the Sindr spawn stands on open ground, clear of solids, with no fire between the camera and the hero', () => {
  const b = new WorldBuilder();
  buildSindr(b);
  const { radius, height } = balance.controller;
  assert.ok(WALKABLE.distance(SPAWN.x, SPAWN.z) < 0, 'spawn is on walkable ground');
  for (const c of b.colliders) {
    if (c.y - c.hy > height || c.y + c.hy < 0.1) continue; // floors and roofs are not in the way
    assert.ok(footprintDistance(c, SPAWN.x, SPAWN.z) > radius + 0.8, `hero clear of collider at ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`);
  }

  // The walking view the game starts in: behind the hero, opposite the way they face, high and angled down.
  const w = balance.camera.world;
  const back = w.distance * Math.cos(w.pitch);
  const cam = { x: SPAWN.x - Math.sin(SPAWN.facing) * back, y: w.targetHeight + w.distance * Math.sin(w.pitch), z: SPAWN.z - Math.cos(SPAWN.facing) * back };
  for (const f of b.fires) {
    for (const y of [0.2, 0.9, 1.7]) {
      assert.ok(!throughFlame(f, cam, { x: SPAWN.x, y, z: SPAWN.z }), `no flame at ${f.position.x.toFixed(1)}, ${f.position.z.toFixed(1)} between camera and hero`);
    }
    assert.ok(Math.hypot(f.position.x - SPAWN.x, f.position.z - SPAWN.z) > 0.5 * f.scale + radius + 1, `hero clear of fire at ${f.position.x.toFixed(1)}, ${f.position.z.toFixed(1)}`);
  }
});
