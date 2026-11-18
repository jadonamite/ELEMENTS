import { MARKET_SLICE } from '../world/ignis/market-slice.js';
import { SINDR_ANCHORS, SINDR_MANIFEST } from '../world/ignis/sindr.js';
import { LEGACY_SINDR_ORIGIN } from '../world/ignis/coordinates.js';
import { SETTLEMENT_PRECINCTS } from '../world/ignis/settlements.js';

/**
 * Places in a zone that the server checks a player's position against, in the zone's own
 * metres. The browser uses the same lists to show its hints.
 */

export interface Place {
  id: string;
  x: number;
  z: number;
}

/** Where a player starts and wakes in Sindr: the shrine's east mouth, facing the road, clear of the brazier. */
export const SINDR_SPAWN = SINDR_MANIFEST.spawn;

/** Merchant IDs and positions come from the same anchors that build their stalls. */
export const SINDR_STALLS: Place[] = SINDR_ANCHORS.filter(a => a.merchant).map(a => ({ id: a.merchant!, x: a.x, z: a.z }));

/** Economic account IDs stay fixed; service reach is measured from the drawn entrance. */
export const SINDR_COUNTING_HOUSES: Place[] = SINDR_ANCHORS.filter(a => a.kind === 'counting_house').map(a => {
  if (!a.institution || !a.door) throw new Error(`Counting house ${a.id} needs an institution and entrance`);
  return { id: a.institution, x: a.door.x, z: a.door.z };
});

/** Sindr's notice board, from the anchor the town builds it on: where the watch posts red flags and bounties. */
const board = SINDR_ANCHORS.find(a => a.kind === 'notice_board');
if (!board) throw new Error('Sindr needs a notice board anchor');
export const SINDR_NOTICE_BOARD: Place = { id: board.id, x: board.x, z: board.z };

/** Where Sindr's robber gang goes to ground: the hideout anchor, for the browser's gang and the server's alike. */
const hideout = SINDR_ANCHORS.find(a => a.kind === 'hideout');
if (!hideout) throw new Error('Sindr needs a hideout anchor');
export const SINDR_HIDEOUT = { x: hideout.x, z: hideout.z, name: hideout.name };

/** How close a player stands to a stall, counting house or notice board to use it, metres. */
export const PLACE_REACH = 3.6;
/** Extra room the server allows for a position report a moment old, metres. */
export const PLACE_SLACK = 1.5;
/** How close two players stand to trade hand to hand, metres. */
export const TRADE_REACH = 4;

/**
 * A shrine: a brazier you light by reaching it. You wake at the nearest one you have lit, and travel
 * between lit ones. Positions are nation-global metres; `wake` is where a body stands up, facing the way out.
 */
export interface Shrine extends Place {
  kind: 'shrine';
  name: string;
  /** Floor height, nation-global metres: picks the region's altitude band. */
  y: number;
  wake: { x: number; z: number; facing: number };
  /** The settlement precinct it belongs to; none for the Shrine of Embers. */
  precinct?: string;
}

/** Sindr's Shrine of Embers is lit for everyone: where every rising begins. */
export const FIRST_SHRINE = 'shrine_of_embers';

/** Metres from a shrine's centre at which reaching it lights it. */
export const SHRINE_REACH = 6;

/**
 * Where a settlement's shrine stands, metres from its precinct centre: east of the lane's south end, beside the
 * repair room's approach and clear of the houses. A body wakes on the lane side, facing north up the lane.
 */
export const SETTLEMENT_SHRINE = { x: 13, z: -60 } as const;
const WAKE_STEP = 5;

export const SHRINES: readonly Shrine[] = [
  {
    id: FIRST_SHRINE, kind: 'shrine', name: 'Shrine of Embers',
    x: LEGACY_SINDR_ORIGIN.x, y: LEGACY_SINDR_ORIGIN.y, z: LEGACY_SINDR_ORIGIN.z,
    wake: { x: LEGACY_SINDR_ORIGIN.x + SINDR_SPAWN.x, z: LEGACY_SINDR_ORIGIN.z + SINDR_SPAWN.z, facing: SINDR_SPAWN.facing },
  },
  ...SETTLEMENT_PRECINCTS.map((p): Shrine => ({
    id: `shrine_${p.id.split(':').pop()!.replaceAll('-', '_')}`, kind: 'shrine', name: `${p.name} Shrine`, precinct: p.id,
    x: p.x + SETTLEMENT_SHRINE.x, y: p.height, z: p.z + SETTLEMENT_SHRINE.z,
    wake: { x: p.x + SETTLEMENT_SHRINE.x - WAKE_STEP, z: p.z + SETTLEMENT_SHRINE.z, facing: 0 },
  })),
];

export const shrineById = (id: string): Shrine | undefined => SHRINES.find(s => s.id === id);
export const shrineOfPrecinct = (precinctId: string): Shrine | undefined => SHRINES.find(s => s.precinct === precinctId);

/** The shrines a player has lit, always with the first one, in list order. */
export function litShrines(lit: Iterable<string>): Shrine[] {
  const ids = new Set(lit);
  ids.add(FIRST_SHRINE);
  return SHRINES.filter(s => ids.has(s.id));
}

/** The unlit shrine a player at global (x, z) is close enough to light, if any. */
export function shrineToLight(lit: Iterable<string>, x: number, z: number): Shrine | null {
  const ids = new Set(lit);
  return SHRINES.find(s => !ids.has(s.id) && s.id !== FIRST_SHRINE && Math.hypot(s.x - x, s.z - z) <= SHRINE_REACH) ?? null;
}

/** The lit shrine a player at global (x, z) stands at, if any (for travel). */
export function shrineAt(lit: Iterable<string>, x: number, z: number, slack = PLACE_SLACK): Shrine | null {
  return litShrines(lit).find(s => Math.hypot(s.x - x, s.z - z) <= SHRINE_REACH + slack) ?? null;
}

/**
 * Where a fallen player wakes: the lit shrine nearest where they fell. Never farther from the fall than the
 * nearest lit shrine, so dying is never a quicker road than walking.
 */
export function wakeShrine(lit: Iterable<string>, fellX: number, fellZ: number): Shrine {
  let best = shrineById(FIRST_SHRINE)!, bestD = Infinity;
  for (const s of litShrines(lit)) {
    const d = Math.hypot(s.x - fellX, s.z - fellZ);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

/** Why a player cannot travel from a shrine now, or null when they can. */
export function travelRefusal(state: { inFight: boolean; bounty: boolean; shards: number; coin: number }, coinAllowance: number): string | null {
  if (state.inFight) return 'Not while you are fighting';
  if (state.bounty) return 'The shrines will not carry someone the watch is hunting';
  if (state.shards > 0) return 'Shards travel by road: bank them or carry them';
  if (state.coin > coinAllowance) return `Bank your coin first (up to ${coinAllowance} travels with you)`;
  return null;
}

/**
 * Whether a player at nation-global (x, z) may travel to `to`: they stand at a lit shrine, the target is lit and
 * another, and `travelRefusal` allows it. The one check for the server and the browser played offline.
 */
export function shrineTravel(
  lit: Iterable<string>, x: number, z: number, to: string,
  state: { inFight: boolean; bounty: boolean; shards: number; coin: number }, coinAllowance: number,
): { ok: true; from: Shrine; shrine: Shrine } | { ok: false; error: string } {
  const ids = new Set(lit);
  ids.add(FIRST_SHRINE);
  const from = shrineAt(ids, x, z);
  if (!from) return { ok: false, error: 'Stand at a lit shrine to travel' };
  const shrine = shrineById(to);
  if (!shrine || !ids.has(to)) return { ok: false, error: 'You have not lit that shrine' };
  if (shrine.id === from.id) return { ok: false, error: 'You are already here' };
  const error = travelRefusal(state, coinAllowance);
  return error ? { ok: false, error } : { ok: true, from, shrine };
}

export const placesFor = (zone: string): { stalls: Place[]; countingHouses: Place[]; noticeBoard: Place | null } =>
  zone === 'sindr'
    ? { stalls: SINDR_STALLS, countingHouses: SINDR_COUNTING_HOUSES, noticeBoard: SINDR_NOTICE_BOARD }
    : { stalls: [], countingHouses: [], noticeBoard: null };

/** True when (x, z) is within reach of the place, with the server's slack. */
export const atPlace = (place: Place, x: number, z: number, slack = PLACE_SLACK): boolean =>
  Math.hypot(place.x - x, place.z - z) <= PLACE_REACH + slack;

export type StreetKind = 'alley' | 'open_street' | 'road_out_of_town';

/** What kind of street a spot in Sindr is, as robbers judge it. */
export function sindrStreet(x: number, z: number): StreetKind {
  if (x > 220) return 'road_out_of_town';
  if (x >= 70 && x <= 160 && Math.abs(z) > 7) return 'alley';
  return 'open_street';
}

/** Where Sindr's small watch of the Lord's Sentries stand, from the market's posts. */
export const SINDR_SENTRY_POSTS: Place[] = MARKET_SLICE.posts.filter(p => p.role === 'sentry').map(p => ({ id: p.id, x: p.x, z: p.z }));

/** Metres from (x, z) to the nearest Sentry post in Sindr. */
export const sindrSentryDistance = (x: number, z: number): number =>
  Math.min(...SINDR_SENTRY_POSTS.map(p => Math.hypot(p.x - x, p.z - z)));

export interface CollisionBox {
  id: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
}

const box = (id: string, r: { x0: number; x1: number; z0: number; z1: number }): CollisionBox =>
  ({ id, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, hx: (r.x1 - r.x0) / 2, hz: (r.z1 - r.z0) / 2 });

/**
 * Ground in Sindr's market where nobody can be placed, for the server, which has no town collision of its own:
 * every stall (from the anchors the town builds them on), the shells along the street, and the canal with the
 * raised terrace behind it (one band, so a body placed from the street never lands across the water).
 */
export const SINDR_COLLISION_BOXES: CollisionBox[] = [
  ...SINDR_ANCHORS.filter(a => a.kind === 'stall' && a.y === 0).map(a => ({ id: a.id, x: a.x, z: a.z, hx: 2.8, hz: 2.0 })),
  ...MARKET_SLICE.shells.filter(s => s.face === 'north').map(s => box(s.id, s)),
  box('canal_and_terrace', { x0: MARKET_SLICE.canal.x0, x1: MARKET_SLICE.canal.x1, z0: MARKET_SLICE.terrace.z0, z1: MARKET_SLICE.canal.z1 }),
];

/** True if (x, z) falls inside any collision box (with character radius padding). */
export function isColliding(x: number, z: number, radius = 0.5, boxes: readonly CollisionBox[] = SINDR_COLLISION_BOXES): boolean {
  for (const b of boxes) {
    if (Math.abs(x - b.x) < b.hx + radius && Math.abs(z - b.z) < b.hz + radius) {
      return true;
    }
  }
  return false;
}

/** Shifts a placement (x, z) so it stands clear of any collision box. */
export function standClear(x: number, z: number, radius = 0.5, boxes: readonly CollisionBox[] = SINDR_COLLISION_BOXES): { x: number; z: number } {
  let cx = x, cz = z;
  for (const b of boxes) {
    const ox = b.hx + radius - Math.abs(cx - b.x);
    const oz = b.hz + radius - Math.abs(cz - b.z);
    if (ox > 0 && oz > 0) {
      if (ox < oz) {
        cx = cx >= b.x ? b.x + b.hx + radius + 0.05 : b.x - b.hx - radius - 0.05;
      } else {
        cz = cz >= b.z ? b.z + b.hz + radius + 0.05 : b.z - b.hz - radius - 0.05;
      }
    }
  }
  return { x: cx, z: cz };
}

/** Places a body at `distance` along `angle` from `feet`, stopping short if a collision box is in the way. */
export function standOff(feet: { x: number; z: number }, angle: number, distance: number, radius = 0.5, boxes: readonly CollisionBox[] = SINDR_COLLISION_BOXES): { x: number; z: number } {
  const sx = Math.sin(angle), sz = Math.cos(angle);
  const steps = 10;
  for (let s = steps; s >= 1; s--) {
    const d = (distance * s) / steps;
    const tx = feet.x + sx * d;
    const tz = feet.z + sz * d;
    if (!isColliding(tx, tz, radius, boxes)) {
      return { x: tx, z: tz };
    }
  }
  return standClear(feet.x, feet.z, radius, boxes);
}
