import { shapedLand } from './land-form.js';
import { SETTLEMENT_PRECINCTS } from './settlements.js';

/** A wild place with a floor: a disc, or a strip when it has a second end. Positions are nation metres. */
export interface WildPlace {
  id: 'barrens' | 'gorge' | 'hollow';
  x: number; z: number; x2: number; z2: number;
  radius: number; shoulder: number; height: number;
}
function distance(p: { x: number; z: number; x2: number; z2: number }, x: number, z: number): number {
  const dx = p.x2 - p.x, dz = p.z2 - p.z, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / l2)) : 0;
  return Math.hypot(x - p.x - dx * t, z - p.z - dz * t);
}
/** `sink` puts the floor below the land (a hollow); otherwise it is the average land under the place. */
function place(id: WildPlace['id'], x: number, z: number, radius: number, x2 = x, z2 = z, sink = 0, level?: number): WildPlace {
  let sum = 0, lean = 0;
  const ring = (r: number, use: (h: number) => void): void => {
    for (let i = 0; i < 12; i++) for (const [cx, cz] of [[x, z], [x2, z2]] as const) use(shapedLand(cx + Math.cos(i * Math.PI / 6) * r, cz + Math.sin(i * Math.PI / 6) * r).height);
  };
  ring(radius * 0.6, h => { sum += h; });
  const height = level ?? Math.round(sum / 24) - sink;
  ring(radius, h => { lean = Math.max(lean, Math.abs(h - height)); });
  return { id, x, z, x2, z2, radius, height, shoulder: Math.min(300, Math.max(50, lean * 3)) };
}
/**
 * The Slag Barrens stand at the end of the Barrens road, the gorge is the last straight of the fort road, and the
 * outlaw hollow lies beside the Barrens road at its southern bend.
 */
export const WILD_PLACES: readonly WildPlace[] = [
  place('barrens', 12520, 10600, 165),
  // The gorge is level with the fort yard it opens into.
  place('gorge', 2330, 9000, 26, 2556, 9000, 0, SETTLEMENT_PRECINCTS.find(p => p.industry === 'fort')!.height),
  place('hollow', 11400, 9930, 42, 11400, 9930, 7),
];
export const wildPlace = (id: WildPlace['id']): WildPlace => WILD_PLACES.find(p => p.id === id)!;

/** Wild places keep level floors, eased into the land round them. */
export function wildGround(x: number, z: number, height: number): number {
  for (const p of WILD_PLACES) {
    if (Math.abs(x - (p.x + p.x2) / 2) > 700 || Math.abs(z - (p.z + p.z2) / 2) > 700) continue;
    const d = distance(p, x, z);
    if (d >= p.radius + p.shoulder) continue;
    const t = Math.max(0, Math.min(1, (d - p.radius) / p.shoulder));
    height = p.height + (height - p.height) * t * t * (3 - 2 * t);
  }
  return height;
}
