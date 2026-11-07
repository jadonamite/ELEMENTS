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
export const SINDR_SPAWN = { x: 8, z: 0, facing: Math.PI / 2 };

/** Sindr's market stalls, by merchant. The square is centred at x 125. */
export const SINDR_STALLS: Place[] = [
  { id: 'sindr_shards', x: 113, z: -8 },
  { id: 'sindr_supplies', x: 137, z: -8 },
  { id: 'sindr_arms', x: 113, z: 8 },
];

/**
 * Sindr's two counting houses, at the doors of the strongrooms on the Rise. The server checks a
 * player's position against these, so they must be the doors the town builds, not a placeholder;
 * `client/tests/places.test.mjs` fails when they drift apart from `sindr-anchors.json`.
 */
export const SINDR_COUNTING_HOUSES: Place[] = [
  { id: 'ch_ignis_sindr_upper', x: 130.3, z: -43 },
  { id: 'ch_ignis_sindr_lower', x: 119.7, z: -43 },
];

/** Sindr's notice board, at the anchor the town builds it on: where the watch posts red flags and bounties. */
export const SINDR_NOTICE_BOARD: Place = { id: 'notice_board', x: 117, z: -13.5 };

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

/** Sindr town collision boxes for stalls, well, and key obstacles to prevent bodies standing inside them. */
export const SINDR_COLLISION_BOXES: CollisionBox[] = [
  // Stalls: 4.8m wide (hx 2.4), 3m deep (hz 1.5), plus clearance for awnings and crates
  { id: 'stall_shards', x: 113, z: -8, hx: 2.6, hz: 1.8 },
  { id: 'stall_supplies', x: 137, z: -8, hx: 2.6, hz: 1.8 },
  { id: 'stall_arms', x: 113, z: 8, hx: 2.6, hz: 1.8 },
  // Slag well at centre of market square: 7.2m x 7.2m (hx 3.6, hz 3.6)
  { id: 'slag_well', x: 125, z: 0, hx: 3.8, hz: 3.8 },
  // Ginkgo trees at square corners
  { id: 'ginkgo_nw', x: 106.5, z: -12.5, hx: 1.4, hz: 1.4 },
  { id: 'ginkgo_se', x: 143.5, z: 12.5, hx: 1.4, hz: 1.4 },
  { id: 'ginkgo_sw', x: 106.5, z: 12.6, hx: 1.4, hz: 1.4 },
  // Alley cache behind west square
  { id: 'alley_cache', x: 109, z: -14.5, hx: 1.2, hz: 1.2 },
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
