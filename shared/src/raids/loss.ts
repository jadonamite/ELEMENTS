import type { Bag, LossConfig } from './config.js';
import { shuffled, type Rng } from './rng.js';

export interface GearPiece {
  id: string;
  kind: string;
  /** 0 is new, 1 is broken; only the Dim repair it. */
  wear: number;
}

export interface Carried {
  chroma: number;
  items: Bag;
  gear: GearPiece[];
}

export interface LossResult {
  lostChroma: number;
  lostItems: Bag;
  kept: Carried;
}

/**
 * Losing a raid (LORE 11, 14): a quarter of the CHROMA and of the materials carried, rounded down,
 * and heavy wear on every piece of gear worn. Which units go is a seeded draw over every unit
 * carried, so a player with one rare and three common pieces can lose either.
 * Gear is worn, not taken.
 */
export function applyRaidLoss(carried: Carried, rules: LossConfig, rng: Rng): LossResult {
  const share = Math.min(1, Math.max(0, rules.carriedShare));
  const lostChroma = Math.floor(Math.max(0, carried.chroma) * share);
  const all: string[] = [];
  for (const [k, q] of Object.entries(carried.items).sort(([a], [b]) => a.localeCompare(b))) {
    for (let i = 0; i < q; i++) all.push(k);
  }
  const toLose = Math.floor(all.length * share);
  const lostItems: Bag = {};
  const keptItems: Bag = { ...carried.items };
  for (const k of shuffled(all, rng).slice(0, toLose)) {
    lostItems[k] = (lostItems[k] ?? 0) + 1;
    keptItems[k] = keptItems[k]! - 1;
    if (keptItems[k] === 0) delete keptItems[k];
  }
  return {
    lostChroma,
    lostItems,
    kept: {
      chroma: carried.chroma - lostChroma,
      items: keptItems,
      gear: carried.gear.map((g) => ({ ...g, wear: Math.min(1, g.wear + rules.gearWear) })),
    },
  };
}
