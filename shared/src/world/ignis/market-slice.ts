import data from './market-slice.json' with { type: 'json' };
import type { WaterReach } from './validate.js';

/** An axis-aligned rectangle on the ground, town metres. */
export interface SliceRect { x0: number; x1: number; z0: number; z1: number }
export type SliceRank = 'common' | 'merchant' | 'guild' | 'noble';
export type SlicePostRole = 'household' | 'keeper' | 'smith' | 'crew' | 'guard' | 'porter' | 'sentry';

export interface SliceShell extends SliceRect {
  id: string; y: number; face: 'north' | 'south'; rank: SliceRank;
  /** A walk-in front room: a service counter, or an open forge with its anvil. */
  service?: { x: number }; forge?: { x: number };
}
export interface SlicePoint { id: string; x: number; y: number; z: number }
export interface SlicePost extends SlicePoint { role: SlicePostRole }

const P = data.placement;
const rect = (r: SliceRect): SliceRect => ({ x0: r.x0 + P.x, x1: r.x1 + P.x, z0: r.z0 + P.z, z1: r.z1 + P.z });
const point = <T extends { x: number; y: number; z: number }>(p: T): T => ({ ...p, x: p.x + P.x, y: p.y + P.y, z: p.z + P.z });

/**
 * The market slice in the town's own metres: the approved city layout moved by its placement. Everything that
 * builds, staffs, routes or checks the slice reads it from here.
 */
export const MARKET_SLICE = {
  bounds: rect(data.bounds),
  street: { ...rect(data.street), y: data.street.y + P.y, fight: { z0: data.street.fight.z0 + P.z, z1: data.street.fight.z1 + P.z },
    stalls: { z0: data.street.stalls.z0 + P.z, z1: data.street.stalls.z1 + P.z } },
  canal: { ...rect(data.canal), id: data.canal.id, source: data.canal.source, kind: data.canal.kind as 'fresh' },
  bridge: { ...rect(data.bridge), id: data.bridge.id, deck: data.bridge.deck + P.y },
  terrace: { ...rect(data.terrace), y: data.terrace.y + P.y },
  landing: { ...rect(data.landing), y: data.landing.y + P.y },
  stair: rect(data.stair),
  upperWalk: rect(data.upperWalk),
  shells: data.shells.map((s): SliceShell => ({
    ...rect(s), id: s.id, y: s.y + P.y, face: s.face as 'north' | 'south', rank: s.rank as SliceRank,
    ...('service' in s && s.service ? { service: { x: s.service.x + P.x } } : {}),
    ...('forge' in s && s.forge ? { forge: { x: s.forge.x + P.x } } : {}),
  })),
  exits: data.exits.map((e): SlicePoint => point(e)),
  posts: data.posts.map((p): SlicePost => point({ ...p, role: p.role as SlicePostRole })),
};

/** The canal's water as a reach: surface and bed along its centre line, in flow order (west to east). */
export const MARKET_RACE: WaterReach = {
  id: data.canal.id, source: data.canal.source, kind: 'fresh',
  samples: data.water.map((w) => ({ x: w.x + P.x, z: (data.canal.z0 + data.canal.z1) / 2 + P.z, surface: w.surface + P.y, bed: w.bed + P.y })),
};

export interface WaterHere { reach: string; kind: WaterReach['kind']; source: string; surface: number; bed: number; depth: number }

/**
 * The open water at (x, z), or null on dry ground: the one answer for drawing the surface, keeping walkers out
 * of the channel and letting water bending draw from it. Ground under the bridge deck is still water; a bank is not.
 */
export function waterAt(x: number, z: number): WaterHere | null {
  const c = MARKET_SLICE.canal;
  if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return null;
  const s = MARKET_RACE.samples;
  let i = 0;
  while (i < s.length - 2 && x > s[i + 1]!.x) i++;
  const a = s[i]!, b = s[i + 1]!, t = Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
  const surface = a.surface + (b.surface - a.surface) * t, bed = a.bed + (b.bed - a.bed) * t;
  return { reach: MARKET_RACE.id, kind: MARKET_RACE.kind, source: MARKET_RACE.source, surface, bed, depth: surface - bed };
}
