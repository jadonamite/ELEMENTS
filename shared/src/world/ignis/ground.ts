import { IGNIS } from './coordinates.js';
import { SETTLEMENTS, settlementGround } from './settlements.js';
export { SETTLEMENTS } from './settlements.js';
import { mineAt, mineValleyAt, VALLEY_REACH } from './mine-road.js';
import { nationalRoadGround } from './routes.js';
import { nationalWaterAt, nationalWaterworksGround } from './waterworks.js';
export { MINE_ROAD, MINE_LENGTH, MINE_MAX_GRADE, mineAt, minePointAt } from './mine-road.js';

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
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
function segment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  return Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
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
export function waterHeight(x: number, z: number): number | null {
  const publicWater = nationalWaterAt(x, z);
  if (publicWater) return publicWater.surface;
  if (((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2 <= 1) return LAKE.height;
  const river = riverAt(x, z);
  if (river.distance <= 9) return river.water;
  return landDistance(x, z) <= 0 && oceanBoundary(x, z) ? 0 : null;
}
/** Broad authored relief. Detail is in metres and never defines a town boundary. */
function relief(x: number, z: number): number {
  const north = Math.max(0, Math.min(1, (10000 - z) / 8000));
  let h = 340 + north * 620 - Math.max(0, z - 10000) * 0.044;
  h += 65 * Math.sin(x / 1400 + z / 2300) + 42 * Math.cos(z / 800 - x / 1800);
  h += 4 * Math.sin(x / 71) * Math.cos(z / 89) + 1.8 * Math.sin(x / 23 + z / 37);
  const old = Math.hypot(x - 5600, z - 2500);
  h = Math.max(h, 1320 - old * 0.3);
  const r = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  let cone = 1850 - r * 0.58;
  const crater = Math.hypot(x - 12120, z - 4000);
  if (crater < 85) cone = mix(1700, cone, smooth(25, 85, crater));
  h = Math.max(h, cone);
  // Western, northern and southern boundaries rise above their approaches.
  if (x < 6500 || z < 1400 || z > 15500) {
    const d = Math.abs(landDistance(x, z));
    h += 170 * (1 - smooth(0, 150, d));
  }
  return h;
}
export function groundHeight(x: number, z: number): number {
  const land = x >= 6000 && x <= 8500 && z >= 7500 && z <= 10000 ? 2000 : landDistance(x, z);
  if (land < 0) return oceanBoundary(x, z) ? -12 * smooth(0, 100, -land) : relief(x, z);
  let h = relief(x, z);
  // Ocean-facing edges taper to a beach; the other boundaries are mountain ridges.
  if (x > 11000 && z > 1800) h *= smooth(0, 1500, land);
  // Broad settlement pads ease into relief before drainage and road shaping.
  // Authored dry working precincts restore their surveyed floors after the valley cut.
  for (const pad of SETTLEMENTS) {
    const d = Math.hypot(x - pad.x, z - pad.z);
    const shoulder = pad.name === 'Sindr' ? 1200 : 220;
    if (d < pad.radius + shoulder) h = mix(pad.height, h, smooth(pad.radius, pad.radius + shoulder, d));
  }
  // The spring shelf is an altitude control independent of settlement pads.
  h = mix(1100, h, smooth(60, 250, Math.hypot(x - 8000, z - 2000)));
  const valley = mineValleyAt(x, z);
  if (valley.distance < VALLEY_REACH) h = mix(valley.height, h, smooth(80, VALLEY_REACH, valley.distance));
  const lakeR = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  if (lakeR < 1.3) h = mix(818.5, h, smooth(1, 1.3, lakeR));
  const river = riverAt(x, z);
  if (lakeR > 1 && river.distance < 90) {
    const bed = river.distance < 9 ? river.water - 1.5 : river.water + 0.5;
    h = mix(bed, h, smooth(9, 90, river.distance));
  }
  // Working floors stay dry without filling the lake, river bed or their immediate banks.
  const dry = smooth(1, 1.05, lakeR) * smooth(9, 30, river.distance);
  h = mix(h, settlementGround(x, z, h), dry);
  h = nationalRoadGround(x, z, h, waterHeight(x, z));
  // Cart corridors take priority on dry land. They do not cross this river.
  const road = mineAt(x, z);
  if (road.distance < 14) h = mix(road.height, h, smooth(6, 14, road.distance));
  h = nationalWaterworksGround(x, z, h);
  return h;
}
export type Biome = 'ash' | 'grass' | 'pine' | 'rock' | 'snow';
export interface GroundSample { height: number; water: number | null; biome: Biome; mask: readonly number[] }
export function groundAt(x: number, z: number): GroundSample {
  const height = groundHeight(x, z), water = waterHeight(x, z);
  const slope = Math.hypot(groundHeight(x + 2, z) - groundHeight(x - 2, z), groundHeight(x, z + 2) - groundHeight(x, z - 2)) / 4;
  const snow = smooth(1450, 1750, height), rock = smooth(0.45, 1.1, slope) * (1 - snow);
  const pine = (1 - smooth(6500, 9000, x)) * smooth(400, 600, height) * (1 - smooth(1000, 1250, height)) * (1 - snow - rock);
  const grass = (1 - snow - rock - pine) * (1 - smooth(9000, 11500, x)) * 0.7;
  const mask = [Math.max(0, 1 - snow - rock - pine - grass), grass, pine, rock, snow];
  const names: Biome[] = ['ash', 'grass', 'pine', 'rock', 'snow'];
  return { height, water, biome: names[mask.indexOf(Math.max(...mask))]!, mask };
}
