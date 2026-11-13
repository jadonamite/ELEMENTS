import { SETTLEMENT_PRECINCTS } from './settlements.js';

export type Waypoint = readonly [x: number, z: number];
export interface RoutePlan { id: string; kind: 'cart' | 'foot'; source: 'atlas' | 'derived'; waypoints: readonly Waypoint[] }
const arrival = (name: string): Waypoint => {
  const p = SETTLEMENT_PRECINCTS.find(place => place.name === name)!;
  return [p.x, p.z];
};
const plan = (id: string, waypoints: readonly Waypoint[], source: RoutePlan['source'] = 'atlas', kind: RoutePlan['kind'] = 'cart'): RoutePlan =>
  ({ id, kind, source, waypoints });

/**
 * Where each road has to pass, from the atlas. The line between waypoints is surveyed on the land by
 * `tools/survey-routes.mjs` (bends and switchbacks that hold the grade) and stored in `route-lines.ts`.
 * Order matters: a branch is listed after the road it leaves.
 */
export const ROUTE_PLANS: readonly RoutePlan[] = [
  plan('fort', [arrival('East Border Fort'), [3500, 9600], [4500, 9300], [5500, 9000], [6800, 9000]]),
  plan('lake', [[6800, 9000], [6400, 7000], [6400, 5000], [7400, 4200], [7520, 3500], [7800, 3420], [8200, 3420], [8480, 3600], arrival('Crown Lake')]),
  plan('forest', [[6400, 7000], [5200, 6300], arrival('Pinewatch')]),
  plan('port', [[7100, 9000], [8600, 10500], [9630, 11330], [9770, 11530], [10000, 11700], [12000, 13500], [13800, 14750], arrival('Salt Quay')]),
  plan('terrace-arrival', [[8600, 10500], arrival('Terrace village')], 'derived'),
  plan('ash', [[6800, 9000], [6500, 11000], [7200, 13000], arrival('March station'), [10000, 17000]]),
  plan('north', [arrival('Crown Lake'), [9200, 2500], [9500, 1000]]),
  plan('barrens', [[10500, 7200], [11000, 8500], [11300, 10000], [12400, 10600]]),
  // Summit access is a foot trail from the mine yard; no cart road is claimed to the crater.
  plan('volcano-approach', [arrival('Cinderpit'), [10500, 6940], [11600, 5500], [12800, 4600], [12150, 3750], [12120, 3895]], 'derived', 'foot'),
];
