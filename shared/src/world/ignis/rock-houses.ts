import { groundHeight } from './ground.js';
import { mineAt } from './mine-road.js';
import { ROCK_HOUSE_GROUPS, ROCK_HOUSE_SITES, rockGroupCells, siteToWorld, worldToSite } from './rock-sites.js';
import type { RockGroupId, RockHouseGroup, RockHouseSite } from './rock-sites.js';
import { rockHouseClear } from './rock-bank.js';

export type { RockGroupId, RockHouseGroup, RockHouseSite };
export { ROCK_HOUSE_SITES, ROCK_HOUSE_GROUPS, siteToWorld, worldToSite, rockGroupCells, rockHouseClear };

/** The one set of placement rules for both groups. */
export const ROCK_HOUSE_RULES: { maxFoundation: 8; maxBuried: 3.4; stepRise: 0.16; maxSteps: 6; maxRampGrade: 0.25 } =
  { maxFoundation: 8, maxBuried: 3.4, stepRise: 0.16, maxSteps: 6, maxRampGrade: 0.25 };

const SAMPLES_ROAD_CLEAR = 6;

/** Every number and every sampled height must be finite; NaN must never reach a transform. */
const finiteSite = (site: RockHouseSite): string | null => {
  for (const key of ['x', 'z', 'yaw', 'w', 'd', 'door', 'sill', 'landing'] as const) {
    if (!Number.isFinite(site[key])) return `non-finite ${key}`;
  }
  if (site.w <= 0 || site.d <= 0) return 'non-positive footprint';
  return null;
};

/** The horizontal run of the door access, or why the sill cannot reach the landing. */
function accessRun(site: RockHouseSite): { run: number } | { reason: string } {
  const drop = site.sill - site.landing;
  if (drop < 0) return { reason: 'door below the landing' };
  if (site.access === 'steps') {
    const steps = Math.ceil(drop / ROCK_HOUSE_RULES.stepRise - 1e-9);
    if (steps > ROCK_HOUSE_RULES.maxSteps) return { reason: `sill needs ${steps} steps` };
    return { run: Math.max(0.3, steps * 0.3) };
  }
  if (drop / ROCK_HOUSE_RULES.maxRampGrade > 60) return { reason: 'ramp longer than its approach' };
  return { run: Math.max(1, drop / ROCK_HOUSE_RULES.maxRampGrade) };
}

/** Whether two footprints, each widened by a metre, overlap: separating-axis test on both houses' axes. */
function overlaps(a: RockHouseSite, b: RockHouseSite): boolean {
  const axes: [number, number][] = [];
  for (const site of [a, b]) {
    const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
    axes.push([c, -s], [s, c]);
  }
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [ax, az] of axes) {
    const half = (site: RockHouseSite): number => {
      const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
      return Math.abs(ax * c - az * s) * (site.w / 2 + 1) + Math.abs(ax * s + az * c) * (site.d / 2 + 1);
    };
    if (Math.abs(dx * ax + dz * az) > half(a) + half(b)) return false;
  }
  return true;
}

/**
 * Every placement rule for one site. Returns the first failure, with a "non-finite ..." reason whenever an input
 * or a sampled height is not a number. `groundAt` defaults to the national field both the server and client use.
 */
export function checkRockHouseSite(site: RockHouseSite, groundAt: (x: number, z: number) => number = groundHeight):
  { ok: true } | { ok: false; reason: string } {
  const bad = finiteSite(site);
  if (bad) return { ok: false, reason: bad };
  const access = accessRun(site);
  if ('reason' in access) return { ok: false, reason: access.reason };
  const run = access.run;

  // The footprint on a 1 m grid through both corners, then the door threshold and the access foot.
  const nx = Math.max(1, Math.ceil(site.w)), nz = Math.max(1, Math.ceil(site.d));
  let min = Infinity, max = -Infinity, nearRoad = false;
  const samples: { x: number; z: number }[] = [];
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const p = siteToWorld(site, -site.w / 2 + (i * site.w) / nx, -site.d / 2 + (j * site.d) / nz);
      samples.push(p);
      const h = groundAt(p.x, p.z);
      if (!Number.isFinite(h)) return { ok: false, reason: 'non-finite ground under the footprint' };
      min = Math.min(min, h); max = Math.max(max, h);
      if (mineAt(p.x, p.z).distance < SAMPLES_ROAD_CLEAR) nearRoad = true;
    }
  }
  if (nearRoad) return { ok: false, reason: 'footprint within 6 m of the mine road' };

  const threshold = siteToWorld(site, site.door, site.d / 2);
  const thresholdGround = groundAt(threshold.x, threshold.z);
  if (!Number.isFinite(thresholdGround)) return { ok: false, reason: 'non-finite ground at the door' };
  const foot = siteToWorld(site, site.door, site.d / 2 + run);
  const footGround = groundAt(foot.x, foot.z);
  if (!Number.isFinite(footGround)) return { ok: false, reason: 'non-finite ground at the access foot' };

  // Nothing floats: the foundation is drawn to this lowest point.
  if (site.sill - min > ROCK_HOUSE_RULES.maxFoundation) {
    return { ok: false, reason: `foundation ${(site.sill - min).toFixed(2)} m below the sill` };
  }
  // Nothing is buried past the stone ground storey.
  if (max - site.sill > ROCK_HOUSE_RULES.maxBuried) {
    return { ok: false, reason: `rear ground ${(max - site.sill).toFixed(2)} m above the sill` };
  }
  // The door lands: its threshold is never buried, and the foot of the access meets the lane or shoulder.
  if (thresholdGround > site.sill + 1e-9) return { ok: false, reason: 'door threshold above the sill' };
  if (Math.abs(footGround - site.landing) > 0.15) {
    return { ok: false, reason: `landing ${site.landing.toFixed(2)} does not meet the ground at the access foot (${footGround.toFixed(2)})` };
  }
  for (const other of ROCK_HOUSE_SITES) {
    if (other.id !== site.id && overlaps(site, other)) return { ok: false, reason: `overlaps ${other.id}` };
  }
  return { ok: true };
}
