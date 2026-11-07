import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { PLACE_REACH } from '../../shared/src/net/places.ts';
import { SINDR_ANCHORS } from '../../shared/src/world/ignis/sindr.ts';
import { townWorld } from './town-world.mjs';

test('both Sindr counting-house doors are reachable on the physics-backed walk map', async () => {
  const { world, map } = await townWorld();
  try {
    const marketSeed = new Vector3(125, 0, 3);
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
