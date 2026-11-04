import type { DungeonDef } from './config.js';
import { hashSeed, seededRng, shuffled } from './rng.js';

export interface RunPlan {
  seed: number;
  /** Room ids in the order the party meets them: the entry, the shuffled fight rooms, the boss. */
  order: string[];
}

/**
 * Picks this run's rooms: the entry first, `roomsPerRun` fight rooms drawn from the dungeon's
 * hand-built set in a shuffled order, and the boss room last. A party never gets the same
 * order twice in a row: if the draw matches `previous`, it draws again from the next seed.
 */
export function planRun(dungeon: DungeonDef, seed: number, previous?: readonly string[]): RunPlan {
  const fights = Object.entries(dungeon.rooms).filter(([, r]) => r.kind === 'fight').map(([id]) => id).sort();
  const boss = Object.entries(dungeon.rooms).find(([, r]) => r.kind === 'boss')?.[0];
  if (!boss) throw new Error('A dungeon needs a boss room');
  const count = Math.min(dungeon.roomsPerRun, fights.length);
  for (let attempt = 0; attempt < 32; attempt++) {
    const s = attempt === 0 ? seed >>> 0 : hashSeed(`${seed}:${attempt}`);
    const middle = shuffled(fights, seededRng(s)).slice(0, count);
    const order = [dungeon.entry, ...middle, boss];
    if (!previous || order.join('|') !== previous.join('|') || fights.length < 2) return { seed: s, order };
  }
  throw new Error('Could not find a new room order');
}
