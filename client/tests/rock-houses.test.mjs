import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { LEGACY_SINDR_ORIGIN as ORIGIN } from '../../shared/dist/world/ignis/coordinates.js';
import { groundHeight } from '../../shared/dist/world/ignis/ground.js';
import {
  ROCK_HOUSE_GROUPS,
  ROCK_HOUSE_SITES,
  rockGroupCells,
  siteToWorld,
} from '../../shared/dist/world/ignis/rock-houses.js';
import { SETTLEMENT_PRECINCTS, settlementCells } from '../../shared/dist/world/ignis/settlements.js';
import { WorldBuilder, seeded } from '../src/world/builder.js';
import { buildRockGroupLOD, rockHouse } from '../src/world/rock-houses.js';
import { SettlementStream } from '../src/world/settlements.js';

test('Fault 1: for each site, footprint corners from siteToWorld match builder.world() after b.at(...)', () => {
  for (const site of ROCK_HOUSE_SITES) {
    const b = new WorldBuilder();
    b.at(site.x, site.z, site.yaw, site.sill);

    const halfW = site.w / 2;
    const halfD = site.d / 2;
    const corners = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ];

    for (const [lx, lz] of corners) {
      const worldPos = siteToWorld(site, lx, lz);
      const builderPos = b.world(lx, 0, lz);

      assert.ok(
        Math.abs(worldPos.x - builderPos.x) < 1e-4,
        `Site ${site.id} corner (${lx}, ${lz}) X: expected ${worldPos.x}, got ${builderPos.x}`,
      );
      assert.ok(
        Math.abs(worldPos.z - builderPos.z) < 1e-4,
        `Site ${site.id} corner (${lx}, ${lz}) Z: expected ${worldPos.z}, got ${builderPos.z}`,
      );
      assert.ok(
        Math.abs(site.sill - builderPos.y) < 1e-4,
        `Site ${site.id} corner Y: expected ${site.sill}, got ${builderPos.y}`,
      );
    }
  }
});

test('Fault 6: no floating foundation - transformed merged geometry bottom <= ground - 0.2 and top reaches sill', () => {
  for (const site of ROCK_HOUSE_SITES) {
    const b = new WorldBuilder();
    rockHouse(b, site, 0, seeded(12345), groundHeight, { x: 0, y: 0, z: 0 });
    const group = b.build(() => new MeshBasicMaterial());

    const foundationMesh = group.children.find(c => c.name === 'basalt_rock_face');
    assert.ok(foundationMesh, `Site ${site.id} must produce a basalt_rock_face mesh`);

    const geom = foundationMesh.geometry;
    const pos = geom.getAttribute('position');
    assert.ok(pos && pos.count > 0, `Site ${site.id} foundation must have vertices`);

    const halfW = site.w / 2;
    const halfD = site.d / 2;
    const corners = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ];

    for (const [lx, lz] of corners) {
      const cornerWorld = siteToWorld(site, lx, lz);
      const cornerGround = groundHeight(cornerWorld.x, cornerWorld.z);

      let minY = Infinity;
      let maxY = -Infinity;
      let foundNear = 0;

      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);

        const distXZ = Math.hypot(vx - cornerWorld.x, vz - cornerWorld.z);
        if (distXZ <= 0.8) {
          foundNear++;
          if (vy < minY) minY = vy;
          if (vy > maxY) maxY = vy;
        }
      }

      assert.ok(foundNear > 0, `Site ${site.id} must have foundation vertices near corner (${cornerWorld.x}, ${cornerWorld.z})`);
      assert.ok(
        minY <= cornerGround - 0.2 + 1e-4,
        `Site ${site.id} corner (${lx}, ${lz}) bottom ${minY.toFixed(3)} must be <= ground - 0.2 (${(cornerGround - 0.2).toFixed(3)})`,
      );
      assert.ok(
        maxY >= site.sill - 1e-4,
        `Site ${site.id} corner (${lx}, ${lz}) top ${maxY.toFixed(3)} must reach sill (${site.sill.toFixed(3)})`,
      );
    }
  }
});

test('Detail 1 is far version with about a fifth of the triangles of detail 0', () => {
  for (const site of ROCK_HOUSE_SITES) {
    const b0 = new WorldBuilder();
    const b1 = new WorldBuilder();
    rockHouse(b0, site, 0, seeded(42), groundHeight, { x: 0, y: 0, z: 0 });
    rockHouse(b1, site, 1, seeded(42), groundHeight, { x: 0, y: 0, z: 0 });

    const g0 = b0.build(() => new MeshBasicMaterial());
    const g1 = b1.build(() => new MeshBasicMaterial());

    let tris0 = 0;
    for (const child of g0.children) {
      const count = child.geometry.attributes.position.count;
      tris0 += child.geometry.index ? child.geometry.index.count / 3 : count / 3;
    }
    let tris1 = 0;
    for (const child of g1.children) {
      const count = child.geometry.attributes.position.count;
      tris1 += child.geometry.index ? child.geometry.index.count / 3 : count / 3;
    }

    assert.ok(tris0 > 0);
    assert.ok(tris1 > 0);
    assert.ok(
      tris1 <= tris0 * 0.35,
      `Site ${site.id} detail 1 triangles (${tris1}) should be reduced vs detail 0 (${tris0})`,
    );
  }
});

test('Exactly one LOD level visible at 20, 150, 170 and 400 m from each group centre', () => {
  for (const group of ROCK_HOUSE_GROUPS) {
    const { lod } = buildRockGroupLOD(group, false, () => new MeshBasicMaterial(), groundHeight, ORIGIN);
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);

    const testDistances = [20, 150, 170, 400];
    for (const dist of testDistances) {
      camera.position.set(lod.position.x + dist, lod.position.y, lod.position.z);
      camera.updateMatrixWorld(true);
      lod.updateMatrixWorld(true);
      lod.update(camera);

      const visibleLevels = lod.levels.filter(l => l.object.visible);
      assert.equal(
        visibleLevels.length,
        1,
        `Group ${group.id} at ${dist}m must have exactly 1 visible LOD level, got ${visibleLevels.length}`,
      );

      if (dist < 160) {
        assert.equal(lod.levels[0].object.visible, true, `Group ${group.id} at ${dist}m must show detail 0`);
        assert.equal(lod.levels[1].object.visible, false);
      } else {
        assert.equal(lod.levels[0].object.visible, false);
        assert.equal(lod.levels[1].object.visible, true, `Group ${group.id} at ${dist}m must show detail 1`);
      }
    }

    // Low quality switch threshold test (110m)
    const { lod: lowLod } = buildRockGroupLOD(group, true, () => new MeshBasicMaterial(), groundHeight, ORIGIN);
    for (const dist of testDistances) {
      camera.position.set(lowLod.position.x + dist, lowLod.position.y, lowLod.position.z);
      camera.updateMatrixWorld(true);
      lowLod.updateMatrixWorld(true);
      lowLod.update(camera);

      const visibleLevels = lowLod.levels.filter(l => l.object.visible);
      assert.equal(
        visibleLevels.length,
        1,
        `Group ${group.id} (low) at ${dist}m must have exactly 1 visible level, got ${visibleLevels.length}`,
      );

      if (dist < 110) {
        assert.equal(lowLod.levels[0].object.visible, true);
        assert.equal(lowLod.levels[1].object.visible, false);
      } else {
        assert.equal(lowLod.levels[0].object.visible, false);
        assert.equal(lowLod.levels[1].object.visible, true);
      }
    }
  }
});

test('SettlementStream: loading and unloading Cinderpit and Mine Hamlet leaves no colliders behind', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const stream = new SettlementStream(
    world,
    () => new MeshBasicMaterial(),
    false,
    { add: () => {}, remove: () => {} },
  );

  assert.equal(world.colliders.len(), 0);

  // 1. Load Cinderpit
  const cinderpitPrecinct = SETTLEMENT_PRECINCTS.find(p => p.id === 'ignis:settlement:cinderpit');
  assert.ok(cinderpitPrecinct);
  const cinderpitCells = settlementCells(cinderpitPrecinct);
  const cinderpitCellMap = new Map(cinderpitCells.map(k => [k, true]));

  stream.update(cinderpitCellMap);
  assert.ok(stream.places.includes('ignis:settlement:cinderpit'));
  const cinderpitColliders = world.colliders.len();
  assert.ok(cinderpitColliders > 0, 'Cinderpit must register colliders');

  // Unload Cinderpit
  stream.update(new Map());
  assert.equal(stream.places.length, 0);
  assert.equal(world.colliders.len(), 0, 'Unloading Cinderpit must leave zero colliders in physics world');

  // 2. Load Mine Hamlet
  const hamletGroup = ROCK_HOUSE_GROUPS.find(g => g.id === 'mine-hamlet');
  assert.ok(hamletGroup);
  const hamletCells = rockGroupCells(hamletGroup);
  const hamletCellMap = new Map(hamletCells.map(k => [k, true]));

  stream.update(hamletCellMap);
  assert.ok(stream.places.includes('mine-hamlet'));
  const hamletColliders = world.colliders.len();
  assert.ok(hamletColliders > 0, 'Mine hamlet must register colliders');

  // Unload Mine Hamlet
  stream.update(new Map());
  assert.equal(stream.places.length, 0);
  assert.equal(world.colliders.len(), 0, 'Unloading Mine Hamlet must leave zero colliders in physics world');

  stream.dispose();
  world.free();
});
