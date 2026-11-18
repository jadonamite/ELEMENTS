import { mix, smooth } from './land-form.js';
import { mineAt, minePointAt } from './mine-road.js';
import { CINDERPIT_CENTRE, CINDERPIT_LANE_HEIGHT, cinderpitFrontRadius, ROCK_HOUSE_SITES, worldToSite } from './rock-sites.js';

/**
 * The shared ground of the rock houses, applied by `baseGround` in the same step as `settlementGround`, so the
 * server's physics, the client's mesh and the placement checks all stand on one surface.
 *
 * 1. The mine-road rock bank: flat at road height within 9 m, up to +7 m behind the houses, then back to the
 *    natural valley over 40 m. It tapers to nothing over 60 m at either end of the stretch.
 * 2. The Cinderpit rim bench: the lane and the fronts of the rim houses are held at lane level while the natural
 *    rim falls away, so every door lands on the lane and the rear foundations key into the slope.
 */

/** Full-height stretch of the bank and its end tapers, in mine-road stations. */
export const ROCK_BANK = {
  s0: 520, s1: 790, taper: 60,
  flat: 9, crest: 7, riseStart: 9, riseEnd: 33, fadeEnd: 73, reach: 73,
} as const;

/** How much of the bank stands at a station: 1 over the stretch, 0 beyond both 60 m tapers. */
function bankAmount(s: number): number {
  return smooth(ROCK_BANK.s0 - ROCK_BANK.taper, ROCK_BANK.s0, s) * (1 - smooth(ROCK_BANK.s1, ROCK_BANK.s1 + ROCK_BANK.taper, s));
}

/**
 * The bank's target height at a lateral distance: the road shoulder at the flat edge, the crest behind the houses,
 * then down to the natural valley it came from. Both joins are smoothstep ends, so the surface has no kink where
 * the flat shoulder meets the bank or where the crest starts to fall back.
 */
export function rockBankTarget(distance: number, roadHeight: number, natural: number): number {
  if (distance <= ROCK_BANK.riseStart) return roadHeight;
  if (distance < ROCK_BANK.riseEnd) return roadHeight + ROCK_BANK.crest * smooth(ROCK_BANK.riseStart, ROCK_BANK.riseEnd, distance);
  return mix(roadHeight + ROCK_BANK.crest, natural, smooth(ROCK_BANK.riseEnd, ROCK_BANK.fadeEnd, distance));
}

const CINDERPIT_RIM_IN = 178, CINDERPIT_RIM_OUT = 186, CINDERPIT_RIM_FALL = 4, CINDERPIT_RIM_ARC = 12;

/** How much the Cinderpit rim bench holds at an angle and radius: 1 on the lane and the house fronts. */
function cinderpitBench(x: number, z: number): number {
  const dx = x - CINDERPIT_CENTRE.x, dz = z - CINDERPIT_CENTRE.z, r = Math.hypot(dx, dz);
  if (r > 260) return 0;
  const deg = ((Math.atan2(dz, dx) * 180 / Math.PI) + 360) % 360;
  const angular = smooth(170 - CINDERPIT_RIM_ARC, 170, deg) * (1 - smooth(330, 330 + CINDERPIT_RIM_ARC, deg));
  if (angular <= 0) return 0;
  const front = cinderpitFrontRadius(deg);
  const radial = smooth(CINDERPIT_RIM_IN, CINDERPIT_RIM_OUT, r) * (1 - smooth(front + 0.5, front + 0.5 + CINDERPIT_RIM_FALL, r));
  return angular * radial;
}

/** The road at the last station the bank stretch needs; the bounding box that keeps the lookup off most samples. */
const bankBox = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let s = ROCK_BANK.s0 - ROCK_BANK.taper; s <= ROCK_BANK.s1 + ROCK_BANK.taper; s += 10) {
    const a = minePointAt(Math.max(0, s - 0.5)), b = minePointAt(s + 0.5);
    const run = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / run, nz = (b.x - a.x) / run;
    for (const side of [-1, 1]) {
      const x = a.x + nx * side * 80, z = a.z + nz * side * 80;
      minX = Math.min(minX, x, a.x); maxX = Math.max(maxX, x, a.x);
      minZ = Math.min(minZ, z, a.z); maxZ = Math.max(maxZ, z, a.z);
    }
  }
  return { minX: minX - 2, maxX: maxX + 2, minZ: minZ - 2, maxZ: maxZ + 2 };
})();

/**
 * Shape natural ground `height` at (x, z) into the rock-house ground: the mine-road bank and the Cinderpit rim
 * bench. Returns the input unchanged away from both, so it costs a few comparisons for most of the nation.
 */
export function rockHouseGround(x: number, z: number, height: number): number {
  let h = height;
  if (x >= bankBox.minX && x <= bankBox.maxX && z >= bankBox.minZ && z <= bankBox.maxZ) {
    const road = mineAt(x, z);
    if (road.distance < ROCK_BANK.reach) {
      const amount = bankAmount(road.s);
      if (amount > 0) h = mix(h, rockBankTarget(road.distance, road.height, h), amount);
    }
  }
  const bench = cinderpitBench(x, z);
  if (bench > 0) h = mix(h, CINDERPIT_LANE_HEIGHT, bench);
  return h;
}

/**
 * The one clearance test for trees, ground cover and anything else that keeps out of settlements: away from every
 * rock-house footprint by `margin` metres, and off the mine-road bank. Places that already exclude a settlement
 * precinct by `radius`/`contentReach` still need this, because both groups stand outside those circles.
 */
export function rockHouseClear(x: number, z: number, margin = 0): boolean {
  for (const site of ROCK_HOUSE_SITES) {
    const local = worldToSite(site, x, z);
    if (Math.abs(local.x) <= site.w / 2 + margin + 1e-9 && Math.abs(local.z) <= site.d / 2 + margin + 1e-9) return false;
  }
  if (x >= bankBox.minX && x <= bankBox.maxX && z >= bankBox.minZ && z <= bankBox.maxZ) {
    const road = mineAt(x, z);
    if (road.s >= ROCK_BANK.s0 - ROCK_BANK.taper && road.s <= ROCK_BANK.s1 + ROCK_BANK.taper
      && road.distance < ROCK_BANK.reach + margin) return false;
  }
  return true;
}
