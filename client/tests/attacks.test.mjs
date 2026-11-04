import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { CombatSpace } from '../src/attacks/space.ts';
import { advance, launch } from '../src/attacks/projectile.ts';

await RAPIER.init();

function worldWithWall(facing) {
  const world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
  // A TERRA wall 3 m long, 2.2 m high, 0.7 m thick, standing 3 m ahead and turned like the game turns it.
  world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 1.1, 0.35).setTranslation(0, 1.1, 3)
    .setRotation({ x: 0, y: Math.sin(facing / 2), z: 0, w: Math.cos(facing / 2) }));
  world.step();
  return world;
}
const body = (x, z) => ({ feet: new Vector3(x, 0, z), height: 1.8, radius: 0.38 });
const shot = (dir = new Vector3(0, 0, 1)) => launch({ side: 'villain', element: 'IGNIS', move: 'cast', damage: 14,
  origin: new Vector3(0, 1.15, 0), direction: dir, speed: 14, radius: 0.3, range: 14 });
function fly(p, space, targets) {
  for (let i = 0; i < 200 && !p.done; i++) { const hit = advance(p, 1 / 60, space, targets); if (hit) return hit.key; }
  return null;
}

test('a shot at someone behind a wall stops on the wall and hits nobody', () => {
  const space = new CombatSpace(worldWithWall(0));
  const p = shot();
  assert.equal(fly(p, space, [{ key: 'hero', body: body(0, 6) }]), null);
  assert.equal(p.end?.reason, 'world');
  assert.ok(Math.abs(p.end.at.z - 2.35) < 0.2, `ended at z ${p.end.at.z}`);
});

test('a wall turned to any angle still stops the shot', () => {
  for (const facing of [0.4, Math.PI / 4, 1.2]) {
    const space = new CombatSpace(worldWithWall(facing));
    const p = shot();
    assert.equal(fly(p, space, [{ key: 'hero', body: body(0, 6) }]), null, `facing ${facing}`);
    assert.equal(p.end?.reason, 'world');
  }
});

test('a shot past the end of the wall reaches the body', () => {
  const space = new CombatSpace(worldWithWall(0));
  const p = shot(new Vector3(6, 0, 6));
  assert.equal(fly(p, space, [{ key: 'hero', body: body(6, 6) }]), "hero");
});

test('a body in front of the wall is hit before the wall', () => {
  const space = new CombatSpace(worldWithWall(0));
  const p = shot();
  assert.equal(fly(p, space, [{ key: 'near', body: body(0, 1.6) }, { key: 'far', body: body(0, 6) }]), 'near');
});

test('the line between two bodies is blocked by the wall and clear around it', () => {
  const space = new CombatSpace(worldWithWall(Math.PI / 2));
  // Turned a quarter, the wall runs along z from 1.5 to 4.5 at x = 0.
  assert.equal(space.clear(new Vector3(-2, 1.15, 3), new Vector3(2, 1.15, 3)), false);
  assert.equal(space.clear(new Vector3(-2, 1.15, 6), new Vector3(2, 1.15, 6)), true);
});
