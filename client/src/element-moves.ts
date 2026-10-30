/**
 * What each element's bending moves do to a villain they hit, beyond damage:
 * pulls, slows, pushes, holds and launches. Numbers come from balance.json.
 */

import { Vector3 } from 'three';
import balance from '../../shared/balance.json';
import type { Element } from '../../shared/src/index.js';

export interface Affliction {
  slowScale?: number;
  slowSeconds?: number;
  stunSeconds?: number;
  shove?: Vector3;
  launch?: boolean;
  parried?: boolean;
}

type Spec = Record<string, number | string | boolean | undefined>;
const elements = balance.combat.elements as unknown as Record<Element, Record<string, Spec>>;

/** How wide in front of the hero a bending move reaches, in radians either side. */
export function bendArc(move: string): number {
  if (move === 'ultimate') return Math.PI;
  if (move === 'ground_pound') return 1.6;
  if (move === 'bend_palm' || move === 'shard_spark') return 0.6;
  return 1.2;
}

/** The effect a bending move has on a villain it hit, or null for plain damage. */
export function afflictionFor(element: Element, move: string, hero: Vector3, target: Vector3, strength = 1): Affliction | null {
  const spec = elements[element]?.[move];
  if (!spec) return null;
  const away = new Vector3().subVectors(target, hero).setY(0);
  if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
  away.normalize();
  const n = (key: string): number => Number(spec[key] ?? 0) * strength;
  switch (`${element}:${move}`) {
    case 'AQUES:bend_palm': return { shove: away.clone().multiplyScalar(-n('pull') * 3) };
    case 'AQUES:bend_sweep': return { slowScale: 1 - Number(spec.slow), slowSeconds: n('slowSeconds'), shove: away.clone().multiplyScalar(3) };
    case 'AQUES:ground_pound': return { slowScale: 1 - Number(spec.slow), slowSeconds: n('slowSeconds'), stunSeconds: 0.4 * strength };
    case 'AQUES:ultimate': return { shove: away.clone().multiplyScalar(6).setY(2.5), launch: true };
    case 'TERRA:bend_palm': return { stunSeconds: 0.35 * strength };
    case 'TERRA:bend_sweep': return { stunSeconds: 0.6 * strength, shove: new Vector3(0, 2.5, 0), launch: true };
    case 'TERRA:ground_pound': return { shove: away.clone().multiplyScalar(5) };
    case 'TERRA:dash_strike': return { shove: away.clone().multiplyScalar(8).setY(2), launch: true };
    case 'TERRA:ultimate': return { stunSeconds: n('stunSeconds'), shove: new Vector3(0, 3, 0), launch: true };
    case 'AURA:bend_sweep': return { shove: away.clone().multiplyScalar(n('push') * 2.2) };
    case 'AURA:uppercut': return { shove: new Vector3(0, 6, 0), launch: true };
    case 'AURA:ground_pound': return { stunSeconds: n('overSeconds') };
    case 'AURA:ultimate': return { shove: away.clone().multiplyScalar(7).setY(1.5), launch: true };
    default: return null;
  }
}

/** Clips each element's bending moves play; anything missing uses the move's own clip. */
export const ELEMENT_CLIPS: Record<Element, Partial<Record<string, string>>> = {
  IGNIS: { ultimate: 'ground_pound' },
  AQUES: { bend_palm: 'cast_shoot', bend_sweep: 'bare_heavy_1', uppercut: 'punch_uppercut', dash_strike: 'cast', ultimate: 'throw' },
  TERRA: { bend_palm: 'throw', uppercut: 'punch_uppercut', dash_strike: 'dash_strike', ultimate: 'ground_pound' },
  AURA: { bend_palm: 'cast_shoot', bend_sweep: 'kick_spin', ground_pound: 'kick_sweep', dash_strike: 'dodge', ultimate: 'cast' },
};
