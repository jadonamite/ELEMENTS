import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { CombatSpace } from '../src/attacks/space.ts';
import { WalkMap } from '../src/life/walk-map.ts';
import { WorldBuilder } from '../src/world/builder.ts';
import { heightAt, sampleField } from '../src/world/landscape.ts';
import { WALKABLE, PEAKS, buildSindr } from '../src/world/sindr.ts';
import { PLACE_REACH } from '../../shared/src/net/places.ts';
import { SINDR_ANCHORS } from '../../shared/src/world/ignis/sindr.ts';

test('both Sindr counting-house doors are reachable on the physics-backed walk map', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.05, 2000).setTranslation(0, -0.05, 0));

    const builder = new WorldBuilder();
    const townAreas = buildSindr(builder);
    const walkable = WALKABLE.with(townAreas);
    const field = sampleField(340, -10, 1020, 500, 3, (x, z) => heightAt(x, z, walkable, PEAKS));
    world.createCollider(RAPIER.ColliderDesc.heightfield(field.nz, field.nx, field.heights,
      { x: field.width, y: 1, z: field.depth }).setTranslation(field.cx, 0, field.cz));

    for (const c of builder.colliders) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
        .setTranslation(c.x, c.y, c.z)
        .setRotation(c.q ?? { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }));
    }
    world.step();

    const marketSeed = new Vector3(125, 0, 3);
    const map = WalkMap.now(new CombatSpace(world), [marketSeed, new Vector3(80, 0, 0)],
      { x0: -10, x1: 240, z0: -200, z1: 60 });
    assert.ok(map.size > 0, 'market seed is present in the physics-backed walk map');
    const marketCell = map.nearest(marketSeed, 1.5);
    assert.notEqual(marketCell, null, 'walk map contains a cell beside the market seed');
    assert.ok(Math.hypot(map.x[marketCell] - marketSeed.x, map.z[marketCell] - marketSeed.z) <= 1.5,
      'route begins in the market, not at a distant fallback seed');

    for (const anchor of SINDR_ANCHORS.filter(a => a.kind === 'counting_house')) {
      assert.ok(anchor.door, `${anchor.id} has a door coordinate`);
      const outward = new Vector3(Math.sin(anchor.yaw), 0, Math.cos(anchor.yaw));
      const approach = new Vector3(anchor.door.x, anchor.y, anchor.door.z).addScaledVector(outward, 1.5);
      const route = map.route(marketSeed, approach);
      assert.ok(route.length > 0, `${anchor.id} has a collision-clear route from the market`);
      const end = route.at(-1);
      assert.ok(Math.hypot(end.x - anchor.door.x, end.z - anchor.door.z) <= PLACE_REACH,
        `${anchor.id} route ends within ${PLACE_REACH} m of its service door`);
      assert.ok(Math.abs(end.y - anchor.y) <= 1,
        `${anchor.id} route ends on the door's level (route y=${end.y}, door y=${anchor.y})`);
    }
  } finally {
    world.free();
  }
});
