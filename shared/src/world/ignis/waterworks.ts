import { IGNIS, type Point3 } from './coordinates.js';
import { datum, nationalWaterAt, PUBLIC_WATERWAYS, segmentSample } from './canals.js';
export * from './canals.js';
import { ROUTE_BRIDGES } from './routes.js';

export interface PublicCrossing { id: string; from: Point3; to: Point3; clear: number; river: boolean }

const globalPoint = (x: number, z: number, y: number): Point3 => ({ x: x + datum.x, z: z + datum.z, y });
export const PUBLIC_CROSSINGS: readonly PublicCrossing[] = [
  { id: 'B2', from: globalPoint(600, 307, 380), to: globalPoint(600, 330, 380), clear: 6, river: false },
  { id: 'B4', from: globalPoint(635, 470, 374.6), to: globalPoint(665, 470, 374.6), clear: 6, river: false },
  ...ROUTE_BRIDGES,
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
