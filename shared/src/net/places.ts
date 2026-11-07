import { MARKET_SLICE } from '../world/ignis/market-slice.js';
import { SINDR_ANCHORS, SINDR_MANIFEST } from '../world/ignis/sindr.js';

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

/** Sentries stand by Sindr's shrine, west of x 48. */
export const sindrSentryDistance = (x: number): number => (x < 48 ? 12 : 60);

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
