import { IGNIS } from './coordinates.js';
import { mineValleyAt, VALLEY_REACH } from './mine-road.js';

export const LAND_POLYGON: readonly (readonly [number, number])[] = [
  [2000, 8000], [3000, 4000], [6000, 800], [11000, 0], [14000, 2000], [15500, 6000],
  [16000, 10000], [15500, 14000], [11000, 18000], [7000, 17000], [4000, 14000], [2000, 11000],
];
export const RIVER = [[8000, 2000, 1100], [8100, 3000, 920], [8000, 3500, 820], [8000, 4500, 820],
  [7700, 5000, 710], [7400, 6000, 600], [7200, 7500, 470], [7000, 9000, 378],
  [8100, 10200, 330], [9000, 11000, 240], [10600, 12000, 170], [12000, 13000, 95],
  [13400, 14000, 35], [14350, 15000, 0]] as const;
export const VOLCANO = { x: 12000, z: 4000, height: 1850 } as const;
export const LAKE = { x: 8000, z: 4000, rx: 420, rz: 500, height: 820 } as const;
export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
function segment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  return Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
}
/** Smooth value noise in 0..1; `scale` is the feature size in metres. */
export function landNoise(x: number, z: number, scale: number): number {
  const fx = x / scale, fz = z / scale, ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz, sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const hash = (a: number, b: number): number => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const top = hash(ix, iz) + (hash(ix + 1, iz) - hash(ix, iz)) * sx;
  const bottom = hash(ix, iz + 1) + (hash(ix + 1, iz + 1) - hash(ix, iz + 1)) * sx;
  return top + (bottom - top) * sz;
}

/** Positive inside, zero on the boundary, negative outside. */
export function landDistance(x: number, z: number): number {
  let inside = false, d2 = Infinity;
  for (let i = 0, j = LAND_POLYGON.length - 1; i < LAND_POLYGON.length; j = i++) {
    const a = LAND_POLYGON[j]!, b = LAND_POLYGON[i]!;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    const t = segment(x, z, a[0], a[1], b[0], b[1]);
    d2 = Math.min(d2, (x - a[0] - (b[0] - a[0]) * t) ** 2 + (z - a[1] - (b[1] - a[1]) * t) ** 2);
  }
  return Math.sqrt(d2) * (inside ? 1 : -1);
}
/** Only the eastern and southeastern polygon edges meet the sea. Other edges meet adjacent highlands. */
export function oceanBoundary(x: number, z: number): boolean {
  let best = Infinity, edge = -1;
  for (let i = 0; i < LAND_POLYGON.length; i++) {
    const a = LAND_POLYGON[i]!, b = LAND_POLYGON[(i + 1) % LAND_POLYGON.length]!;
    const t = segment(x, z, a[0], a[1], b[0], b[1]);
    const d = (x - a[0] - (b[0] - a[0]) * t) ** 2 + (z - a[1] - (b[1] - a[1]) * t) ** 2;
    if (d < best) { best = d; edge = i; }
  }
  return edge >= 4 && edge <= 7;
}
export function landCell(ix: number, iz: number, size: number = IGNIS.cellSize): boolean {
  const x = (ix + 0.5) * size, z = (iz + 0.5) * size;
  return landDistance(x, z) >= -size * Math.SQRT1_2;
}
export function riverAt(x: number, z: number): { distance: number; water: number } {
  let d2 = Infinity, water = 0;
  for (let i = 1; i < RIVER.length; i++) {
    const a = RIVER[i - 1]!, b = RIVER[i]!, t = segment(x, z, a[0], a[1], b[0], b[1]);
    const d = (x - a[0] - (b[0] - a[0]) * t) ** 2 + (z - a[1] - (b[1] - a[1]) * t) ** 2;
    if (d < d2) { d2 = d; water = mix(a[2], b[2], t); }
  }
  return { distance: Math.sqrt(d2), water };
}
/** Height of one terrace step in metres. */
export const TERRACE_STEP = 3;
/** How much of a spot is terraced farmland, 0..1; its edge wanders so the fields do not end on a ruled circle. */
export function terraceAt(x: number, z: number): number {
  if (Math.abs(x - 9100) > 1400 || Math.abs(z - 10900) > 1400) return 0;
  const wx = x + (landNoise(x, z, 700) - 0.5) * 440, wz = z + (landNoise(x + 913, z - 377, 700) - 0.5) * 440;
  return 1 - smooth(800, 1100, Math.hypot(wx - 9100, wz - 10900));
}
/** A slope cut into level fields: flat for three quarters of each step, then a bank up to the next. */
export const terraced = (h: number): number => {
  const steps = h / TERRACE_STEP, whole = Math.floor(steps);
  return (whole + smooth(0.75, 1, steps - whole)) * TERRACE_STEP;
};
/** How far the river valley reaches either side of the water. */
const DRAIN_REACH = 1000;
export interface BaseGround { height: number; inland: boolean; river: number }
/** The two surveyed pads: the built town and the mine yard. Every other settlement takes its floor from the land. */
const PADS = [
  { x: 7000, z: 9000, height: 380, radius: 220, shoulder: 1200 },
  { x: 10500, z: 7000, height: 740, radius: 180, shoulder: 220 },
] as const;
/** Broad authored relief. Detail is in metres and never defines a town boundary. */
function relief(x: number, z: number): number {
  const north = Math.max(0, Math.min(1, (10000 - z) / 8000));
  let h = 340 + north * 620 - Math.max(0, z - 10000) * 0.044;
  h += 65 * Math.sin(x / 1400 + z / 2300) + 42 * Math.cos(z / 800 - x / 1800);
  // Small landforms: knolls and hollows with no repeat, instead of ruled ripples.
  h += (landNoise(x, z, 520) - 0.5) * 16 + (landNoise(x + 311, z - 173, 170) - 0.5) * 7 + (landNoise(x - 97, z + 41, 48) - 0.5) * 2;
  const old = Math.hypot(x - 5600, z - 2500);
  h = Math.max(h, 1320 - old * 0.3);
  const r = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  let cone = 1850 - r * 0.58;
  const crater = Math.hypot(x - 12120, z - 4000);
  if (crater < 85) cone = mix(1700, cone, smooth(25, 85, crater));
  h = Math.max(h, cone);
  // The river drains the land: within a kilometre the relief eases down (or up) to the water, so the river
  // runs in a broad valley instead of a slot canyon or on a dyke.
  const drain = riverAt(x, z);
  if (drain.distance < DRAIN_REACH) h = mix(drain.water + 0.5 + drain.distance * 0.02, h, smooth(60, DRAIN_REACH, drain.distance));
  // Western, northern and southern boundaries rise above their approaches.
  if (x < 6500 || z < 1400 || z > 15500) {
    const d = Math.abs(landDistance(x, z));
    h += 170 * (1 - smooth(0, 150, d));
  }
  return h;
}
/**
 * The land before anything is built on it except the two surveyed pads: relief, coast, terraces, mine valley,
 * lake and river. `dry` is how far a spot is from open water, 0 in the lake or river bed and 1 clear of both.
 */
export function shapedLand(x: number, z: number): BaseGround & { dry: number } {
  const land = x >= 6000 && x <= 8500 && z >= 7500 && z <= 10000 ? 2000 : landDistance(x, z);
  if (land < 0) return { height: oceanBoundary(x, z) ? -12 * smooth(0, 100, -land) : relief(x, z), inland: false, river: Infinity, dry: 0 };
  let h = relief(x, z);
  // Ocean-facing edges taper to a beach; the other boundaries are mountain ridges.
  if (x > 11000 && z > 1800) h *= smooth(0, 1500, land);
  // Farmed hillsides are cut into level fields before pads, rivers and roads shape them.
  const fields = terraceAt(x, z);
  if (fields > 0) h = mix(h, terraced(h), fields);
  for (const pad of PADS) {
    const d = Math.hypot(x - pad.x, z - pad.z);
    if (d < pad.radius + pad.shoulder) h = mix(pad.height, h, smooth(pad.radius, pad.radius + pad.shoulder, d));
  }
  // The spring shelf is an altitude control independent of settlement pads.
  h = mix(1100, h, smooth(60, 250, Math.hypot(x - 8000, z - 2000)));
  const valley = mineValleyAt(x, z);
  if (valley.distance < VALLEY_REACH) h = mix(valley.height, h, smooth(80, VALLEY_REACH, valley.distance));
  const lakeR = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  if (lakeR < 2.2) h = mix(818.5, h, smooth(1, 2.2, lakeR));
  const river = riverAt(x, z);
  if (lakeR > 1 && river.distance < 90) {
    const bed = river.distance < 9 ? river.water - 1.5 : river.water + 0.5;
    h = mix(bed, h, smooth(9, 90, river.distance));
  }
  return { height: h, inland: true, river: river.distance, dry: smooth(1, 1.05, lakeR) * smooth(9, 30, river.distance) };
}
