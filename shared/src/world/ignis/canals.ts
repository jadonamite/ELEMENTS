import { LEGACY_SINDR_ORIGIN } from './coordinates.js';
import { MARKET_RACE, MARKET_SLICE } from './market-slice.js';

export interface WaterworkPoint { x: number; z: number; surface: number; bed: number; bank: number }
export interface PublicWaterway { id: string; width: number; points: readonly WaterworkPoint[] }

// Preserve the built market's registration, including its twenty-metre atlas offset.
export const datum = { x: LEGACY_SINDR_ORIGIN.x - 325, z: LEGACY_SINDR_ORIGIN.z - 330 };
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
  // The overflow steps down with the district over three low weirs and ends where it meets the river.
  { id: 'sindr-lower-overflow', width: 11.5, points: [
    market(680), city(680, 360, 374.6), city(678, 366, 373.4), city(670, 420, 373.2),
    city(666, 426, 372), city(650, 500, 371.8), city(650, 506, 370.6), city(663, 556, 370.2),
  ] },
];

/** How far from a channel's edge the ground steps to its bank height. */
const BANK_EASE = 45;
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
 * The district beside a channel steps down with its water: level quay for 4 m from the edge, then the land eases
 * to its own height over BANK_EASE. Part of the base ground, so roads are laid on the stepped district.
 */
export function canalDistrict(x: number, z: number, height: number): number {
  let nearest = Infinity, target = height;
  for (const channel of PUBLIC_WATERWAYS) for (let i = 1; i < channel.points.length; i++) {
    const a = channel.points[i - 1]!, b = channel.points[i]!, p = segmentSample(x, z, a, b);
    const edge = p.distance - channel.width / 2;
    if (edge > BANK_EASE || edge >= nearest) continue;
    nearest = edge; target = a.bank + (b.bank - a.bank) * p.t;
  }
  if (nearest === Infinity) return height;
  const ease = Math.max(0, Math.min(1, (BANK_EASE - nearest) / (BANK_EASE - 4)));
  return height + (target - height) * ease * ease * (3 - 2 * ease);
}
