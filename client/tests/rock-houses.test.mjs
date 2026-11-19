import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { LEGACY_SINDR_ORIGIN as ORIGIN } from '../../shared/dist/world/ignis/coordinates.js';
import { groundHeight } from '../../shared/dist/world/ignis/ground.js';
import {
  ROCK_HOUSE_GROUPS,
  ROCK_HOUSE_SITES,
  checkRockHouseSite,
  rockGroupCells,
  siteToWorld,
  worldToSite,
} from '../../shared/dist/world/ignis/rock-houses.js';
import { SETTLEMENT_PRECINCTS, settlementCells } from '../../shared/dist/world/ignis/settlements.js';
import { WorldBuilder, seeded } from '../src/world/builder.js';
import { buildRockGroupLOD, rockHouse } from '../src/world/rock-houses.js';
import { SettlementStream } from '../src/world/settlements.js';

test('Every ROCK_HOUSE_SITES entry passes checkRockHouseSite', () => {
  assert.ok(ROCK_HOUSE_SITES.length > 0, 'ROCK_HOUSE_SITES must not be empty');
  for (const site of ROCK_HOUSE_SITES) {
    const result = checkRockHouseSite(site, groundHeight);
    assert.equal(
      result.ok,
      true,
      `Site ${site.id} must pass checkRockHouseSite, failed with: ${result.ok ? '' : result.reason}`,
    );
  }
});

test('rockHouse refuses to build an invalid site', () => {
  const invalidSite = {
    ...ROCK_HOUSE_SITES[0],
    id: 'invalid:floating',
    sill: 999,
  };
  const b = new WorldBuilder();
  assert.throws(
    () => rockHouse(b, invalidSite, 0, seeded(1), groundHeight),
    /Cannot build invalid rock house site/,
  );
});

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

test('Fault 4: siteToWorld and worldToSite round-trip across angles and offsets', () => {
  const testAngles = [0, 0.48, Math.PI / 4, Math.PI / 2, 2.356, Math.PI, -Math.PI / 3, -2.66];
  const testPoints = [
    { lx: 0, lz: 0 },
    { lx: 3.5, lz: 4.0 },
    { lx: -4.2, lz: 2.1 },
    { lx: 10.5, lz: -7.8 },
  ];

  for (const yaw of testAngles) {
    const site = { x: 8000, z: 7500, yaw };
    for (const p of testPoints) {
      const world = siteToWorld(site, p.lx, p.lz);
      const local = worldToSite(site, world.x, world.z);

      assert.ok(
        Math.abs(local.x - p.lx) < 1e-6,
        `lx round-trip at yaw ${yaw}: expected ${p.lx}, got ${local.x}`,
      );
      assert.ok(
        Math.abs(local.z - p.lz) < 1e-6,
        `lz round-trip at yaw ${yaw}: expected ${p.lz}, got ${local.z}`,
      );
    }
  }

  // Also test all actual ROCK_HOUSE_SITES
  for (const site of ROCK_HOUSE_SITES) {
    const worldCenter = siteToWorld(site, 0, 0);
    const localCenter = worldToSite(site, worldCenter.x, worldCenter.z);
    assert.ok(Math.abs(localCenter.x) < 1e-6);
    assert.ok(Math.abs(localCenter.z) < 1e-6);

    const worldFront = siteToWorld(site, site.door, site.d / 2);
    const localFront = worldToSite(site, worldFront.x, worldFront.z);
    assert.ok(Math.abs(localFront.x - site.door) < 1e-6);
    assert.ok(Math.abs(localFront.z - site.d / 2) < 1e-6);
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

test('Fault 2: top tread height equals sill and x equals door x in transformed geometry', () => {
  for (const site of ROCK_HOUSE_SITES) {
    if (site.access !== 'steps') continue;
    const b = new WorldBuilder();
    rockHouse(b, site, 0, seeded(42), groundHeight, { x: 0, y: 0, z: 0 });
    const group = b.build(() => new MeshBasicMaterial());

    const stepsMesh = group.children.find(c => c.name === 'worn_flagstones');
    assert.ok(stepsMesh, `Site ${site.id} must produce a worn_flagstones mesh for steps`);

    const pos = stepsMesh.geometry.getAttribute('position');
    assert.ok(pos && pos.count > 0, `Site ${site.id} steps mesh must have vertices`);

    // In site local frame: door is at x = site.door, top step is at z = site.d / 2 + stepTread / 2
    const stepTread = 0.32;
    const topStepCenterLocal = { lx: site.door, lz: site.d / 2 + stepTread / 2 };
    const expectedWorld = siteToWorld(site, topStepCenterLocal.lx, topStepCenterLocal.lz);

    let maxTreadY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i);
      if (vy > maxTreadY) maxTreadY = vy;
    }

    // Top tread height must equal site.sill
    assert.ok(
      Math.abs(maxTreadY - site.sill) < 1e-3,
      `Site ${site.id} top tread height (${maxTreadY.toFixed(3)}) must equal sill (${site.sill.toFixed(3)})`,
    );

    // Collect all vertices on the top tread surface (within 1mm of maxTreadY)
    const topTreadVertices = [];
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      if (Math.abs(vy - maxTreadY) < 1e-3) {
        topTreadVertices.push({ x: vx, y: vy, z: vz });
      }
    }

    assert.ok(topTreadVertices.length >= 4, `Site ${site.id} must have top tread face vertices`);

    const avgX = topTreadVertices.reduce((sum, v) => sum + v.x, 0) / topTreadVertices.length;
    const avgZ = topTreadVertices.reduce((sum, v) => sum + v.z, 0) / topTreadVertices.length;

    assert.ok(
      Math.abs(avgX - expectedWorld.x) < 1e-3,
      `Site ${site.id} top tread world X (${avgX.toFixed(3)}) must match door X (${expectedWorld.x.toFixed(3)})`,
    );
    assert.ok(
      Math.abs(avgZ - expectedWorld.z) < 1e-3,
      `Site ${site.id} top tread world Z (${avgZ.toFixed(3)}) must match expected Z (${expectedWorld.z.toFixed(3)})`,
    );
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

test('LOD: BatchedMesh visibility and draw-call count with houses near, far, and mixed', () => {
  for (const group of ROCK_HOUSE_GROUPS) {
    const { lod } = buildRockGroupLOD(group, false, () => new MeshBasicMaterial(), groundHeight, ORIGIN);
    const sites = ROCK_HOUSE_SITES.filter(s => s.group === group.id);
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);

    // 1. Camera at each house's door: exactly one level is visible for that house (detail 0)
    // and for every house in the group.
    for (const site of sites) {
      const doorWorld = siteToWorld(site, site.door, site.d / 2 + 1);
      const camX = doorWorld.x - ORIGIN.x;
      const camY = site.sill - ORIGIN.y + 1.6;
      const camZ = doorWorld.z - ORIGIN.z;

      camera.position.set(camX, camY, camZ);
      camera.updateMatrixWorld(true);
      lod.updateMatrixWorld(true);
      lod.update(camera);

      // This house must show detail 0
      assert.equal(lod.houseLevel(site.id), 0, `House ${site.id} at door must show detail 0`);
      assert.equal(lod.isLevelVisible(site.id, 0), true);
      assert.equal(lod.isLevelVisible(site.id, 1), false);

      // Every house must have exactly one level visible based on its distance
      for (const otherSite of sites) {
        const dist = camera.position.distanceTo(
          new Vector3(otherSite.x - ORIGIN.x, otherSite.sill - ORIGIN.y, otherSite.z - ORIGIN.z),
        );
        const expectedLevel = dist >= 160 ? 1 : 0;
        assert.equal(lod.houseLevel(otherSite.id), expectedLevel);
        assert.equal(lod.isLevelVisible(otherSite.id, expectedLevel), true);
        assert.equal(lod.isLevelVisible(otherSite.id, 1 - expectedLevel), false);
      }
    }

    // 2. Reverse: camera with group centre far away (500 m)
    const groupCamX = group.x - ORIGIN.x + 500;
    const groupCamY = groundHeight(group.x, group.z) - ORIGIN.y + 1.6;
    const groupCamZ = group.z - ORIGIN.z;

    camera.position.set(groupCamX, groupCamY, groupCamZ);
    camera.updateMatrixWorld(true);
    lod.updateMatrixWorld(true);
    lod.update(camera);

    for (const site of sites) {
      assert.equal(lod.houseLevel(site.id), 1, `House ${site.id} far away must show detail 1`);
      assert.equal(lod.isLevelVisible(site.id, 0), false);
      assert.equal(lod.isLevelVisible(site.id, 1), true);
    }

    // 3. Draw-call count: the draw-call count is the same with all houses near, all far, and a mix
    // Near: camera near site 0
    camera.position.set(sites[0].x - ORIGIN.x, sites[0].sill - ORIGIN.y + 1.6, sites[0].z - ORIGIN.z);
    camera.updateMatrixWorld(true);
    lod.update(camera);
    const drawCallsNear = lod.drawCalls;

    // Far: camera 500 m away
    camera.position.set(groupCamX, groupCamY, groupCamZ);
    camera.updateMatrixWorld(true);
    lod.update(camera);
    const drawCallsFar = lod.drawCalls;

    // Mix: camera at door of site 0 where in Cinderpit some houses are near and others are > 160 m
    const doorWorld0 = siteToWorld(sites[0], sites[0].door, sites[0].d / 2 + 1);
    camera.position.set(doorWorld0.x - ORIGIN.x, sites[0].sill - ORIGIN.y + 1.6, doorWorld0.z - ORIGIN.z);
    camera.updateMatrixWorld(true);
    lod.update(camera);
    const drawCallsMix = lod.drawCalls;

    assert.equal(drawCallsNear, drawCallsFar, 'Draw calls must be identical near and far');
    assert.equal(drawCallsNear, drawCallsMix, 'Draw calls must be identical near and mix');
    assert.equal(drawCallsNear, lod.batches.length, 'Draw calls must equal batch count');

    // 4. Low quality switch distance: 110 m
    const { lod: lowLod } = buildRockGroupLOD(group, true, () => new MeshBasicMaterial(), groundHeight, ORIGIN);
    for (const site of sites) {
      // 100 m (< 110 m): detail 0
      camera.position.set(site.x - ORIGIN.x + 100, site.sill - ORIGIN.y, site.z - ORIGIN.z);
      camera.updateMatrixWorld(true);
      lowLod.update(camera);
      assert.equal(lowLod.houseLevel(site.id), 0);

      // 120 m (>= 110 m): detail 1
      camera.position.set(site.x - ORIGIN.x + 120, site.sill - ORIGIN.y, site.z - ORIGIN.z);
      camera.updateMatrixWorld(true);
      lowLod.update(camera);
      assert.equal(lowLod.houseLevel(site.id), 1);
    }
    assert.equal(lowLod.drawCalls, lowLod.batches.length);
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
