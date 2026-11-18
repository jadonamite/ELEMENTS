import { Group, LOD, type Camera, type Material } from 'three';
import { LEGACY_SINDR_ORIGIN as ORIGIN, type Point3 } from '../../../shared/src/world/ignis/coordinates.js';
import { groundHeight } from '../../../shared/src/world/ignis/ground.js';
import {
  ROCK_HOUSE_GROUPS,
  ROCK_HOUSE_RULES,
  ROCK_HOUSE_SITES,
  siteToWorld,
  type RockHouseGroup,
  type RockHouseSite,
} from '../../../shared/src/world/ignis/rock-houses.js';
import { WorldBuilder, seeded, type Bucket } from './builder.js';
import { roof } from './roofs.js';
import { townHouse } from './style-kit.js';

export {
  ROCK_HOUSE_GROUPS,
  ROCK_HOUSE_RULES,
  ROCK_HOUSE_SITES,
  siteToWorld,
  type RockHouseGroup,
  type RockHouseSite,
};

/**
 * Checks whether a given world coordinate (x, z) is clear of rock house footprints with margin.
 */
export function rockHouseClear(x: number, z: number, margin = 2): boolean {
  for (const site of ROCK_HOUSE_SITES) {
    const cos = Math.cos(site.yaw);
    const sin = Math.sin(site.yaw);
    const dx = x - site.x;
    const dz = z - site.z;
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    if (Math.abs(lx) <= site.w / 2 + margin && Math.abs(lz) <= site.d / 2 + margin) {
      return false;
    }
  }
  return true;
}

/**
 * Procedural rock house recipe: cliff-founded, two storeys, battered basalt foundation,
 * steps or ramp to landing, retaining wall where ground rises behind.
 */
export function rockHouse(
  b: WorldBuilder,
  site: RockHouseSite,
  detail: 0 | 1,
  rand: () => number = seeded(site.x + site.z + site.sill),
  groundAt: (x: number, z: number) => number = groundHeight,
  origin: Point3 = { x: 0, y: 0, z: 0 },
): void {
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;

  const halfW = site.w / 2;
  const halfD = site.d / 2;

  // Sample ground across footprint to find lowest and highest ground
  let minGround = Infinity;
  let maxGround = -Infinity;
  let maxRearGround = -Infinity;

  for (let lx = -halfW; lx <= halfW; lx += 1) {
    for (let lz = -halfD; lz <= halfD; lz += 1) {
      const p = siteToWorld(site, lx, lz);
      const gh = groundAt(p.x, p.z);
      if (gh < minGround) minGround = gh;
      if (gh > maxGround) maxGround = gh;
      if (lz <= -halfD + 0.5 && gh > maxRearGround) maxRearGround = gh;
    }
  }
  for (const lx of [-halfW, halfW]) {
    for (const lz of [-halfD, halfD]) {
      const p = siteToWorld(site, lx, lz);
      const gh = groundAt(p.x, p.z);
      if (gh < minGround) minGround = gh;
      if (gh > maxGround) maxGround = gh;
      if (lz <= -halfD + 0.5 && gh > maxRearGround) maxRearGround = gh;
    }
  }

  const bottomGround = minGround - 0.2;
  const plinthH = Math.max(0.2, site.sill - bottomGround);
  const { w, d } = site;
  const frontZ = d / 2;
  const backZ = -d / 2;

  b.at(site.x - ox, site.z - oz, site.yaw, site.sill - oy);

  if (detail === 0) {
    // Detail 0: Full architectural detail, quoins, steps/ramp with colliders, treads, lights, posts

    // 1. Foundation: battered basalt base down to (lowest ground - 0.2 m)
    b.box('basalt_rock_face', 0, -plinthH / 2, 0, w + 0.5, plinthH, d + 0.5);
    b.solid(0, -plinthH / 2, 0, w + 0.5, plinthH, d + 0.5);

    // Stepped foundation footing courses at the bottom
    b.box('basalt_rock_face', 0, -plinthH + 0.22, 0, w + 0.8, 0.45, d + 0.8);
    b.box('basalt_rock_face', 0, -plinthH + 0.6, 0, w + 0.65, 0.35, d + 0.65);

    // Keyed rock quoins on the four corners of the foundation
    for (const qx of [-w / 2 - 0.2, w / 2 + 0.2]) {
      for (const qz of [-d / 2 - 0.2, d / 2 + 0.2]) {
        b.box('ashlar_stone_blocks', qx, -plinthH * 0.5, qz, 0.45, plinthH * 0.9, 0.45);
      }
    }

    // Retaining wall where the ground rises behind
    if (maxRearGround > site.sill) {
      const retainH = Math.min(ROCK_HOUSE_RULES.maxBuried, maxRearGround - site.sill + 0.3);
      b.box('ashlar_stone_blocks', 0, retainH / 2, backZ - 0.25, w + 0.8, retainH, 0.5);
      b.solid(0, retainH / 2, backZ - 0.25, w + 0.8, retainH, 0.5);
    }

    // 2. House: townHouse for the 2 floors, common rank, balcony on variant 3
    townHouse(
      b,
      {
        x: site.x - ox,
        z: site.z - oz,
        y: site.sill - oy,
        yaw: site.yaw,
        w: site.w,
        d: site.d,
        floors: 2,
        rank: 'common',
        door: site.door,
        balcony: site.variant === 3,
        footing: 0,
        weeds: true,
        lantern: true,
      },
      rand,
    );

    // Re-anchor frame after townHouse resets it
    b.at(site.x - ox, site.z - oz, site.yaw, site.sill - oy);

    // 3. Chimneys: two chimneys on variant 1, one on other variants
    const P = 0.45, G = 3.1, U = 2.4;
    const top = P + G + U;
    const ch = 4.2;
    const chim1X = w / 2 - 0.9;
    const chim2X = -(w / 2 - 0.9);
    const chimneysToBuild = site.variant === 1 ? [chim1X, chim2X] : [site.variant % 2 === 0 ? chim1X : chim2X];

    for (const cx of chimneysToBuild) {
      b.box('ashlar_stone_blocks', cx, top + ch / 2 - 0.5, backZ + 0.9, 1.0, ch, 1.0);
      b.box('basalt_rock_face', cx, top + ch - 0.4, backZ + 0.9, 1.2, 0.2, 1.2);
      b.cylinder('terracotta', cx, top + ch - 0.05, backZ + 0.9, 0.18, 0.22, 0.5, 8);
      b.chimneys.push(b.world(cx, top + ch + 0.2, backZ + 0.9));
    }

    // 4. Access: steps or ramp from sill down to landing
    const drop = Math.max(0.05, site.sill - site.landing);
    if (site.access === 'steps') {
      const stepRise = ROCK_HOUSE_RULES.stepRise;
      const numSteps = Math.max(1, Math.min(ROCK_HOUSE_RULES.maxSteps, Math.round(drop / stepRise)));
      const actualRiser = drop / numSteps;
      const stepTread = 0.32;
      const stepW = 1.8;
      const run = numSteps * stepTread;

      for (let i = 0; i < numSteps; i++) {
        const stepZ = frontZ + (i + 0.5) * stepTread;
        const stepTop = -(i + 1) * actualRiser;
        b.box('worn_flagstones', site.door, stepTop + 0.05, stepZ, stepW, 0.1, stepTread);
        // Step nosing
        b.box('ashlar_stone_blocks', site.door, stepTop + 0.02, stepZ + stepTread / 2 + 0.02, stepW + 0.04, 0.06, 0.06);
        b.solid(site.door, stepTop + 0.05, stepZ, stepW, 0.1, stepTread);
      }

      // Cheek walls flanking steps
      const leftX = site.door - stepW / 2 - 0.125;
      const rightX = site.door + stepW / 2 + 0.125;
      b.box('ashlar_stone_blocks', leftX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
      b.box('ashlar_stone_blocks', rightX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
      b.solid(leftX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
      b.solid(rightX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);

      // Newel stones at the foot
      b.box('basalt_rock_face', leftX, -drop + 0.35, frontZ + run - 0.1, 0.32, 0.7, 0.32);
      b.box('basalt_rock_face', rightX, -drop + 0.35, frontZ + run - 0.1, 0.32, 0.7, 0.32);
      b.solid(leftX, -drop + 0.35, frontZ + run - 0.1, 0.32, 0.7, 0.32);
      b.solid(rightX, -drop + 0.35, frontZ + run - 0.1, 0.32, 0.7, 0.32);
    } else {
      // Ramp: grade <= 25%
      const run = Math.max(1.6, drop / 0.22);
      const rampW = 1.8;
      const pitch = Math.atan2(drop, run);

      b.box('packed_dirt_road', site.door, -drop / 2, frontZ + run / 2, rampW, 0.1, Math.hypot(drop, run), { x: -pitch });
      b.solidTilted(site.door, -drop / 2, frontZ + run / 2, rampW, 0.1, run, -pitch);

      // Cheek walls flanking ramp
      const leftX = site.door - rampW / 2 - 0.125;
      const rightX = site.door + rampW / 2 + 0.125;
      b.box('ashlar_stone_blocks', leftX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
      b.box('ashlar_stone_blocks', rightX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
      b.solid(leftX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
      b.solid(rightX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
    }
  } else {
    // Detail 1: Far version, same outline with no small parts (no quoins, step nosings, window frames or joists),
    // about a fifth of the triangles. Only detail 0 adds colliders, treads, posts and lights.

    // 1. Foundation: single battered basalt plinth
    b.box('basalt_rock_face', 0, -plinthH / 2, 0, w + 0.5, plinthH, d + 0.5);

    // Retaining wall if ground rises behind
    if (maxRearGround > site.sill) {
      const retainH = Math.min(ROCK_HOUSE_RULES.maxBuried, maxRearGround - site.sill + 0.3);
      b.box('ashlar_stone_blocks', 0, retainH / 2, backZ - 0.25, w + 0.8, retainH, 0.5);
    }

    // 2. Simplified building envelope
    const P = 0.45, G = 3.1, U = 2.4;
    // Ground floor plinth & walls
    b.box('basalt_rock_face', 0, P / 2, 0, w + 0.24, P, d + 0.24);
    b.box('ashlar_stone_blocks', 0, P + G / 2, -0.12, w - 0.1, G, d - 0.24);
    b.box('charred_timber_beams', site.door, P + 1.05, frontZ - 0.36, 1.1, 2.1, 0.08);

    let top = P + G;
    if (site.variant === 3) {
      // Balcony slab
      b.box('charred_timber_beams', 0, top + 0.03, frontZ + 0.45, w + 0.1, 0.08, 0.95);
    } else {
      // Pent roof slab
      b.box('roof_tile_charcoal', 0, top + 0.2, frontZ + 0.45, w + 0.3, 0.09, 1.3, { x: 0.38 });
    }

    // Upper floor walls
    b.box('ash_plaster', 0, top + U / 2, -0.2, w - 0.2, U, d - 0.4);
    top += U;

    // Roof: simplified far roof (two slope slabs, ridge beam, gable fills)
    const pitch = 0.5;
    const overhang = site.variant === 3 ? 1.2 : 0.9;
    const totalD = d + overhang * 2;
    const totalW = w + overhang * 2;
    const halfTotD = totalD / 2;
    const rise = Math.tan(pitch) * halfTotD;
    const slopeLen = Math.hypot(halfTotD, rise);
    const thickness = 0.16;

    // South slope slab (+z)
    const angleS = Math.atan2(rise, halfTotD);
    const cyS = top + rise / 2;
    const czS = halfTotD / 2;
    b.box('roof_tile_charcoal', 0, cyS, czS, totalW, thickness, slopeLen + 0.1, { x: -angleS });

    // North slope slab (-z)
    const cyN = top + rise / 2;
    const czN = -halfTotD / 2;
    b.box('roof_tile_charcoal', 0, cyN, czN, totalW, thickness, slopeLen + 0.1, { x: angleS });

    // Ridge cap
    b.box('roof_tile_charcoal', 0, top + rise + 0.08, 0, totalW + 0.2, 0.2, 0.35);

    // Gable fills (east and west)
    b.box('ash_plaster', -w / 2 + 0.1, top + rise * 0.38, 0, 0.2, rise * 0.75, d * 0.8);
    b.box('ash_plaster', w / 2 - 0.1, top + rise * 0.38, 0, 0.2, rise * 0.75, d * 0.8);

    // Simplified chimney(s)
    const ch = 4.2;
    const chim1X = w / 2 - 0.9;
    const chim2X = -(w / 2 - 0.9);
    const chimneysToBuild = site.variant === 1 ? [chim1X, chim2X] : [site.variant % 2 === 0 ? chim1X : chim2X];
    for (const cx of chimneysToBuild) {
      b.box('ashlar_stone_blocks', cx, top + ch / 2 - 0.5, backZ + 0.9, 1.0, ch, 1.0);
      b.box('basalt_rock_face', cx, top + ch - 0.4, backZ + 0.9, 1.2, 0.2, 1.2);
    }

    // 3. Simplified access
    const drop = Math.max(0.05, site.sill - site.landing);
    if (site.access === 'steps') {
      const stepRise = ROCK_HOUSE_RULES.stepRise;
      const numSteps = Math.max(1, Math.min(ROCK_HOUSE_RULES.maxSteps, Math.round(drop / stepRise)));
      const run = numSteps * 0.32;
      const stepW = 1.8;
      b.box('worn_flagstones', site.door, -drop / 2, frontZ + run / 2, stepW, drop, run);
      const leftX = site.door - stepW / 2 - 0.125;
      const rightX = site.door + stepW / 2 + 0.125;
      b.box('ashlar_stone_blocks', leftX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
      b.box('ashlar_stone_blocks', rightX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
    } else {
      const run = Math.max(1.6, drop / 0.22);
      const rampW = 1.8;
      const pitch = Math.atan2(drop, run);
      b.box('packed_dirt_road', site.door, -drop / 2, frontZ + run / 2, rampW, 0.1, Math.hypot(drop, run), { x: -pitch });
      const leftX = site.door - rampW / 2 - 0.125;
      const rightX = site.door + rampW / 2 + 0.125;
      b.box('ashlar_stone_blocks', leftX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
      b.box('ashlar_stone_blocks', rightX, -drop / 2 + 0.2, frontZ + run / 2, 0.25, drop + 0.4, run);
    }
  }

  b.at(0, 0, 0);
}

/**
 * Builds each rock house in a group with its own THREE.LOD positioned at its own footprint centre,
 * so distance is measured per house rather than to the group centre.
 * Detail 1 begins at 160 m (110 m when low).
 */
export function buildRockGroupLOD(
  group: RockHouseGroup,
  low: boolean,
  material: (bucket: Bucket) => Material,
  groundAt: (x: number, z: number) => number = groundHeight,
  origin: Point3 = ORIGIN,
): { lod: Group; lods: LOD[]; builder0: WorldBuilder; builder1: WorldBuilder } {
  const sites = ROCK_HOUSE_SITES.filter(s => s.group === group.id);
  const builder0 = new WorldBuilder({ low });
  const builder1 = new WorldBuilder({ low });

  const container = new Group();
  container.name = `rockhouses:${group.id}`;
  const lods: LOD[] = [];

  const switchDistance = low ? 110 : 160;

  for (const site of sites) {
    const rand0 = seeded(site.x + site.z + site.sill);
    const rand1 = seeded(site.x + site.z + site.sill);

    // Group-wide builders collect physics colliders, emitters, and treads
    rockHouse(builder0, site, 0, rand0, groundAt, origin);
    rockHouse(builder1, site, 1, rand1, groundAt, origin);

    // Each house gets its own builder output for each LOD level
    const houseBuilder0 = new WorldBuilder({ low });
    const houseBuilder1 = new WorldBuilder({ low });
    rockHouse(houseBuilder0, site, 0, rand0, groundAt, origin);
    rockHouse(houseBuilder1, site, 1, rand1, groundAt, origin);

    const mesh0 = houseBuilder0.build(material);
    const mesh1 = houseBuilder1.build(material);

    const hx = site.x - origin.x;
    const hy = site.sill - origin.y;
    const hz = site.z - origin.z;

    const houseLod = new LOD();
    houseLod.name = `lod:${site.id}`;
    houseLod.position.set(hx, hy, hz);

    mesh0.position.set(-hx, -hy, -hz);
    mesh1.position.set(-hx, -hy, -hz);

    houseLod.addLevel(mesh0, 0);
    houseLod.addLevel(mesh1, switchDistance);

    lods.push(houseLod);
    container.add(houseLod);
  }

  (container as unknown as { update: (cam: Camera) => void }).update = (cam: Camera): void => {
    for (const l of lods) l.update(cam);
  };

  return { lod: container, lods, builder0, builder1 };
}
