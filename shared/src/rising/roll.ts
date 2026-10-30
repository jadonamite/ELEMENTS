import type { Element } from '../combat/types.js';
import type { RisingResult } from './types.js';

export const HUSH_CHANCE = 0.15;
export const SHAPER_CHANCE = 0.85;
export const NATION_CHANCE = 0.2125;
export const VAKNA_CAP = 0.005;

export const NATIONS = ['IGNIS', 'AQUES', 'TERRA', 'AURA'] as const;

/**
 * Pure rising roll.
 * Determines whether an account awakens Lit (Shaper of IGNIS, AQUES, TERRA, or AURA)
 * or Dim (Hush). Lit is 85% with an even nation split (21.25% each), Dim is 15%.
 */
export function roll(
  rand: () => number = Math.random,
  _population?: unknown,
): RisingResult {
  const r = rand();
  if (r < HUSH_CHANCE) {
    return { role: 'Hush' };
  }
  const shaperRoll = (r - HUSH_CHANCE) / SHAPER_CHANCE;
  const index = Math.min(3, Math.max(0, Math.floor(shaperRoll * 4)));
  const element: Element = NATIONS[index] ?? 'IGNIS';
  return { role: 'Shaper', element };
}

/**
 * Checks if another Hush can awaken as a Vakna without exceeding the 0.5% cap
 * of the total world population.
 */
export function canAwaken(vaknaCount: number, population: number): boolean {
  if (population <= 0 || vaknaCount < 0) {
    return false;
  }
  return (vaknaCount + 1) / population <= VAKNA_CAP;
}
