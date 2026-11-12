import { IGNIS, LEGACY_SINDR_ORIGIN, type Point3 } from './coordinates.js';
import { MARKET_RACE, MARKET_SLICE } from './market-slice.js';

export interface WaterworkPoint { x: number; z: number; surface: number; bed: number; bank: number }
export interface PublicWaterway { id: string; width: number; points: readonly WaterworkPoint[] }
export interface PublicCrossing { id: string; from: Point3; to: Point3; clear: number; river: boolean }

// Preserve the built market's registration, including its twenty-metre atlas offset.
const datum = { x: LEGACY_SINDR_ORIGIN.x - 325, z: LEGACY_SINDR_ORIGIN.z - 330 };
const city = (x: number, z: number, surface: number, bank = surface + 2): WaterworkPoint =>
  ({ x: x + datum.x, z: z + datum.z, surface, bed: surface - 1.5, bank });
const market = (x: number): WaterworkPoint => city(x, 318.75, 378.8 - (x - 410) / 90, 380);
const first = MARKET_RACE.samples[0]!, last = MARKET_RACE.samples[MARKET_RACE.samples.length - 1]!;
const join = (p: typeof first): WaterworkPoint => ({ x: p.x + LEGACY_SINDR_ORIGIN.x,
  z: p.z + LEGACY_SINDR_ORIGIN.z, surface: p.surface + LEGACY_SINDR_ORIGIN.y,
  bed: p.bed + LEGACY_SINDR_ORIGIN.y, bank: MARKET_SLICE.street.y + LEGACY_SINDR_ORIGIN.y });

/** Static public races and overflow falls. Lock transport is not implied by these channels. */
export const PUBLIC_WATERWAYS: readonly PublicWaterway[] = [
  { id: 'sindr-market-west', width: 11.5, points: [market(320), join(first)] },
  { id: 'sindr-market-east', width: 11.5, points: [join(last), market(600), market(680)] },
  { id: 'sindr-lower-overflow', width: 11.5, points: [
    market(680), city(680, 360, 374), city(678, 366, 362), city(670, 420, 362),
    city(666, 426, 351), city(650, 500, 351), city(650, 506, 340), city(665, 570, 340),
    city(665, 620, 340), city(692.7, 665, 340), city(700, 690, 340),
  ] },
];
const globalPoint = (x: number, z: number, y: number): Point3 => ({ x: x + datum.x, z: z + datum.z, y });
export const PUBLIC_CROSSINGS: readonly PublicCrossing[] = [
  { id: 'B2', from: globalPoint(600, 307, 380), to: globalPoint(600, 330, 380), clear: 6, river: false },
  { id: 'B4', from: globalPoint(635, 500, 353), to: globalPoint(665, 500, 353), clear: 6, river: false },
  { id: 'B5', from: globalPoint(675, 665, 345), to: globalPoint(711, 665, 345), clear: 8, river: false },
  { id: 'port-river-crossing', from: { x: 9630, z: 11330, y: 225 }, to: { x: 9770, z: 11530, y: 210 }, clear: 5.5, river: true },
];
export const NATIONAL_WATERWORKS = [
  ...PUBLIC_WATERWAYS.map(channel => ({ id: channel.id, kind: 'channel' as const, channel })),
  ...PUBLIC_CROSSINGS.map(crossing => ({ id: crossing.id, kind: 'crossing' as const, crossing })),
];
export type NationalWaterwork = typeof NATIONAL_WATERWORKS[number];

export function waterworkCells(work: NationalWaterwork): readonly string[] {
  const points = work.kind === 'channel' ? work.channel.points : [work.crossing.from, work.crossing.to];
  const reach = work.kind === 'channel' ? work.channel.width / 2 + 8 : work.crossing.clear / 2 + 4;
  const cells = new Set<string>();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    for (let x = Math.floor((Math.min(a.x, b.x) - reach) / IGNIS.cellSize); x <= Math.floor((Math.max(a.x, b.x) + reach) / IGNIS.cellSize); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - reach) / IGNIS.cellSize); z <= Math.floor((Math.max(a.z, b.z) + reach) / IGNIS.cellSize); z++) cells.add(`${x}:${z}`);
    }
  }
  return [...cells];
}

export function segmentSample(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
  const along = ((x - a.x) * dx + (z - a.z) * dz) / length;
  const t = Math.max(0, Math.min(1, along / length));
  return { t, along, length, distance: Math.hypot(x - a.x - dx * t, z - a.z - dz * t) };
}
export interface PublicWaterSample { reach: string; kind: 'fresh'; source: string; surface: number; bed: number; depth: number }
/** Nation-global coordinates and sea-level heights; bridges leave the water query intact. */
export function nationalWaterAt(x: number, z: number): PublicWaterSample | null {
  let best: PublicWaterSample | null = null, nearest = Infinity;
  for (const channel of PUBLIC_WATERWAYS) for (let i = 1; i < channel.points.length; i++) {
    const a = channel.points[i - 1]!, b = channel.points[i]!, p = segmentSample(x, z, a, b);
    if (p.distance > channel.width / 2 || p.distance >= nearest) continue;
    const surface = a.surface + (b.surface - a.surface) * p.t, bed = a.bed + (b.bed - a.bed) * p.t;
    nearest = p.distance;
    best = { reach: channel.id, kind: 'fresh', source: 'sindr_public_race', surface, bed, depth: surface - bed };
  }
  return best;
}

/**
 * Apply after relief/road shaping. Crossings cap terrain below their decks, never fill the river.
 * Where the national river owns the ground (`riverOwns`), the local race neither cuts a bed nor trims a bank.
 * `waterWeight` (0..1) is how much of the channel cut, bank trim and bridge cap a road corridor leaves to the water:
 * a road keeps its own surface, including where a deck lands on it or a race passes under it.
 */
export function nationalWaterworksGround(x: number, z: number, height: number, riverOwns = false, waterWeight = 1): number {
  const water = riverOwns ? null : nationalWaterAt(x, z);
  let result = water ? water.bed - 0.25 : height;
  let nearest = Infinity, bankTarget = height, bankBlend = 0;
  if (!water && !riverOwns) for (const channel of PUBLIC_WATERWAYS) for (let i = 1; i < channel.points.length; i++) {
    const a = channel.points[i - 1]!, b = channel.points[i]!, p = segmentSample(x, z, a, b), half = channel.width / 2;
    const edge = p.distance - half;
    if (edge > 6 || edge >= nearest) continue;
    nearest = edge;
    bankTarget = a.bank + (b.bank - a.bank) * p.t;
    bankBlend = Math.max(0, Math.min(1, (6 - edge) / 2));
  }
  if (!water) result += (bankTarget - result) * bankBlend;
  result = height + (result - height) * waterWeight;
  for (const crossing of PUBLIC_CROSSINGS) {
    const p = segmentSample(x, z, crossing.from, crossing.to);
    if (p.along < 0 || p.along > p.length || p.distance > crossing.clear / 2 + 0.8) continue;
    const deck = crossing.from.y + (crossing.to.y - crossing.from.y) * p.t;
    result += (Math.min(result, deck - 0.65) - result) * waterWeight;
  }
  return result;
}
