import { IGNIS } from './coordinates.js';
import { minePointAt } from './mine-road.js';

/**
 * Rock-house sites, in nation-global metres. This module holds no ground of its own: it is the leaf that the
 * ground field (`rock-bank.ts`), the settlements (`settlements.ts`) and the contract (`rock-houses.ts`) all read,
 * so nobody has to import the ground to know where a house stands.
 *
 * Conventions, one set for both groups:
 * - `x`/`z` is the centre of the ground-floor footprint.
 * - `yaw` is Three's `rotation.y`: local +z (the door side) points to `(sin yaw, cos yaw)`, local +x to
 *   `(cos yaw, -sin yaw)`. `siteToWorld` is the only place that turns a site.
 * - `sill` is the door sill / ground-floor level, metres ASL; `landing` is the lane or shoulder at the foot.
 */

export type RockGroupId = 'cinderpit' | 'mine-hamlet';
export interface RockHouseSite {
  id: string;
  group: RockGroupId;
  x: number; z: number;
  yaw: number;
  w: number; d: number;
  variant: 0 | 1 | 2 | 3 | 4 | 5;
  door: number;
  sill: number;
  landing: number;
  access: 'steps' | 'ramp';
}
export interface RockHouseGroup {
  id: RockGroupId; name: string;
  x: number; z: number;
  reach: number;
  lane: readonly { x: number; z: number }[];
}

/** The six footprints from the old module, unchanged: frontage (w), depth (d), and how the door lands. */
const VARIANTS: readonly { w: number; d: number; access: 'steps' | 'ramp' }[] = [
  { w: 7.2, d: 7.0, access: 'steps' }, // Miner Cottage
  { w: 8.6, d: 8.0, access: 'ramp' }, // Overseer Lodge
  { w: 10.2, d: 7.6, access: 'steps' }, // Smelter / Forge House
  { w: 6.8, d: 8.4, access: 'steps' }, // Terrace Cliff Dwelling
  { w: 9.0, d: 7.2, access: 'ramp' }, // Storekeeper / Assay House
  { w: 7.8, d: 8.8, access: 'steps' }, // Timber Watch House
];

const CINDERPIT = { x: 10500, z: 7000, pad: 740 } as const;
/** The rim lane and the house fronts sit this far below the pad sill: 2 steps, or a one-metre ramp. */
const RIM_LANE = 739.7;

/** `siteToWorld` for a site, with the one rotation convention. */
export function siteToWorld(site: Pick<RockHouseSite, 'x' | 'z' | 'yaw'>, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  return { x: site.x + lx * c + lz * s, z: site.z - lx * s + lz * c };
}
/** The inverse of `siteToWorld`: nation-global (x, z) to the site's local frame. */
export function worldToSite(site: Pick<RockHouseSite, 'x' | 'z' | 'yaw'>, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw), dx = x - site.x, dz = z - site.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** The mine-road tangent at a station, as a unit vector along increasing s. */
export function mineTangent(s: number): { x: number; z: number } {
  const a = minePointAt(s - 0.5), b = minePointAt(s + 0.5);
  const run = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / run, z: (b.z - a.z) / run };
}

/**
 * The hamlet: 4 houses a side, fronts 11 m from the road centre (2 m behind the 9 m flat edge). The sill stands
 * 0.3 m above the road so the door has a threshold; the access foot lands on the shoulder at road height.
 */
const HAMLET_STATIONS = [560, 620, 680, 740] as const;
export const HAMLET_FRONT = 11;
function hamletSites(): RockHouseSite[] {
  const sites: RockHouseSite[] = [];
  for (let i = 0; i < 8; i++) {
    const station = HAMLET_STATIONS[i % 4]!;
    const variant = (i % 6) as RockHouseSite['variant'];
    const { w, d, access } = VARIANTS[variant]!;
    const p = minePointAt(station), t = mineTangent(station);
    // Left normal of the drive: (+tz, -tx). Sites 0-3 stand left, 4-7 right.
    const side = i < 4 ? 1 : -1;
    const nx = t.z * side, nz = -t.x * side;
    const offset = HAMLET_FRONT + d / 2;
    sites.push({
      id: `ignis:rockhouse:mine-hamlet:${i}`, group: 'mine-hamlet',
      x: p.x + nx * offset, z: p.z + nz * offset,
      // The front (local +z) looks back at the road: local +z maps to (-nx, -nz).
      yaw: Math.atan2(-nx, -nz),
      w, d, variant, door: 0,
      sill: p.y + 0.3, landing: p.y, access,
    });
  }
  return sites;
}

/** Rim angles, south-west round to the south-east, where the Cinderpit pad falls away. */
const RIM_ANGLES = [170, 192.857, 215.714, 238.571, 261.429, 284.286, 307.143, 330] as const;
/**
 * Rear-wall radius per rim angle, measured from the ground: each puts the rear edge 4.6-6 m below the 740 m pad,
 * so the foundation storey is keyed 2-8 m down the slope. `checkRockHouseSite` proves it against the shipped ground.
 */
const RIM_REAR = [230, 222, 217, 216, 216, 218, 221, 223] as const;

function rimSites(): RockHouseSite[] {
  return RIM_ANGLES.map((deg, i) => {
    const variant = (i % 6) as RockHouseSite['variant'];
    const { w, d, access } = VARIANTS[variant]!;
    const a = deg * Math.PI / 180, rear = RIM_REAR[i]!, centre = rear - d / 2;
    return {
      id: `ignis:rockhouse:cinderpit:${i}`, group: 'cinderpit',
      x: CINDERPIT.x + Math.cos(a) * centre, z: CINDERPIT.z + Math.sin(a) * centre,
      // The front looks inward at the precinct centre: local +z maps to (-cos, -sin).
      yaw: Math.atan2(-Math.cos(a), -Math.sin(a)),
      w, d, variant, door: 0,
      sill: CINDERPIT.pad, landing: RIM_LANE, access,
    };
  });
}

export const ROCK_HOUSE_SITES: readonly RockHouseSite[] = [...rimSites(), ...hamletSites()];

/** Front-wall radius at any rim angle: linear between the surveyed sites, held flat past the ends. */
export function cinderpitFrontRadius(deg: number): number {
  let d = ((deg % 360) + 360) % 360;
  const first = RIM_ANGLES[0]!, last = RIM_ANGLES[RIM_ANGLES.length - 1]!;
  if (d <= first) return frontAt(0);
  if (d >= last) return frontAt(RIM_ANGLES.length - 1);
  for (let i = 1; i < RIM_ANGLES.length; i++) {
    const b = RIM_ANGLES[i]!;
    if (d <= b) {
      const a = RIM_ANGLES[i - 1]!, t = (d - a) / (b - a);
      return frontAt(i - 1) + (frontAt(i) - frontAt(i - 1)) * t;
    }
  }
  return frontAt(RIM_ANGLES.length - 1);
}
function frontAt(i: number): number {
  const site = ROCK_HOUSE_SITES[i]!;
  return Math.hypot(site.x - CINDERPIT.x, site.z - CINDERPIT.z) - site.d / 2;
}
export const CINDERPIT_CENTRE = CINDERPIT;
export const CINDERPIT_LANE_HEIGHT = RIM_LANE;

/** The rim lane: an arc 7 m inside the fronts, then a spoke from its east end to the precinct's lane end. */
function rimLane(): { x: number; z: number }[] {
  const points: { x: number; z: number }[] = [];
  for (let deg = RIM_ANGLES[0]!; deg <= RIM_ANGLES[RIM_ANGLES.length - 1]!; deg += 2) {
    const radius = cinderpitFrontRadius(deg) - 7, a = deg * Math.PI / 180;
    points.push({ x: CINDERPIT.x + Math.cos(a) * radius, z: CINDERPIT.z + Math.sin(a) * radius });
  }
  // The lane end of the precinct's central lane is local (0, -80); the spoke is straight from the arc's east end.
  points.push({ x: CINDERPIT.x, z: CINDERPIT.z - 80 });
  return points;
}

function groupReach(centre: { x: number; z: number }, probes: readonly { x: number; z: number }[]): number {
  let reach = 0;
  for (const p of probes) reach = Math.max(reach, Math.hypot(p.x - centre.x, p.z - centre.z));
  return Math.ceil(reach + 2);
}

const rimProbes = ROCK_HOUSE_SITES.filter(s => s.group === 'cinderpit').map(s => ({ x: s.x, z: s.z }));
const cinderpitReach = groupReach(CINDERPIT, rimProbes) + 8;

const hamlet = ROCK_HOUSE_SITES.filter(s => s.group === 'mine-hamlet');
const hamletCentre = {
  x: hamlet.reduce((sum, s) => sum + s.x, 0) / hamlet.length,
  z: hamlet.reduce((sum, s) => sum + s.z, 0) / hamlet.length,
};
function hamletProbes(): { x: number; z: number }[] {
  const probes = hamlet.map(s => ({ x: s.x, z: s.z }));
  // The bank itself: 75 m either side of the road through the full length, tapers included.
  for (let s = 460; s <= 850; s += 30) {
    const p = minePointAt(s), t = mineTangent(s), nx = t.z, nz = -t.x;
    probes.push({ x: p.x + nx * 75, z: p.z + nz * 75 }, { x: p.x - nx * 75, z: p.z - nz * 75 });
  }
  return probes;
}

export const ROCK_HOUSE_GROUPS: readonly RockHouseGroup[] = [
  { id: 'cinderpit', name: 'Cinderpit rim', x: CINDERPIT.x, z: CINDERPIT.z, reach: cinderpitReach, lane: rimLane() },
  { id: 'mine-hamlet', name: 'Mine road hamlet', x: hamletCentre.x, z: hamletCentre.z, reach: groupReach(hamletCentre, hamletProbes()), lane: [] },
];

/** 256 m cell keys ('ix:iz') a group covers; same form as settlementCells. */
export function rockGroupCells(group: RockHouseGroup): readonly string[] {
  const keys: string[] = [], reach = group.reach;
  for (let x = Math.floor((group.x - reach) / IGNIS.cellSize); x <= Math.floor((group.x + reach) / IGNIS.cellSize); x++) {
    for (let z = Math.floor((group.z - reach) / IGNIS.cellSize); z <= Math.floor((group.z + reach) / IGNIS.cellSize); z++) keys.push(`${x}:${z}`);
  }
  return keys;
}

/** The Cinderpit precinct's content reach: derived from its rim houses, never typed. */
export const CINDERPIT_CONTENT_REACH = cinderpitReach;
