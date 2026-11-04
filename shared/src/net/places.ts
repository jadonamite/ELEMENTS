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

/** Sindr's two counting houses. Placeholder spots off the market until the buildings stand. */
export const SINDR_COUNTING_HOUSES: Place[] = [
  { id: 'ch_ignis_sindr_upper', x: 125, z: -14 },
  { id: 'ch_ignis_sindr_lower', x: 60, z: 6 },
];

/** How close a player stands to a stall or counting house to use it, metres. */
export const PLACE_REACH = 3.6;
/** Extra room the server allows for a position report a moment old, metres. */
export const PLACE_SLACK = 1.5;
/** How close two players stand to trade hand to hand, metres. */
export const TRADE_REACH = 4;

export const placesFor = (zone: string): { stalls: Place[]; countingHouses: Place[] } =>
  zone === 'sindr' ? { stalls: SINDR_STALLS, countingHouses: SINDR_COUNTING_HOUSES } : { stalls: [], countingHouses: [] };

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
