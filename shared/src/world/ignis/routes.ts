import { MINE_ROAD, type RoadPoint } from './mine-road.js';
import { SETTLEMENT_PRECINCTS } from './settlements.js';

export interface NationalRoute {
  id: string;
  kind: 'cart' | 'foot';
  width: number;
  shoulder: number;
  maxGrade: number;
  points: readonly RoadPoint[];
  length: number;
  /** Atlas alignment or an explicitly derived dry arrival/approach. */
  source: 'atlas' | 'derived' | 'existing';
}
export interface RouteGap {
  id: string;
  from: readonly [number, number];
  to: readonly [number, number];
  reason: string;
}
type Control = readonly [x: number, z: number, height: number];
const arrival = (name: string): Control => {
  const p = SETTLEMENT_PRECINCTS.find(place => place.name === name)!;
  return [p.x, p.z, p.height];
};

/** Piecewise surveyed profiles, sampled in global metres without relief/noise dependence. */
function route(id: string, controls: readonly Control[], source: NationalRoute['source'] = 'atlas', kind: NationalRoute['kind'] = 'cart'): NationalRoute {
  const points: RoadPoint[] = [];
  let s = 0;
  for (let i = 0; i < controls.length; i++) {
    const b = controls[i]!;
    if (i === 0) { points.push({ x: b[0], z: b[1], y: b[2], s: 0 }); continue; }
    const a = controls[i - 1]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / 8));
    for (let j = 1; j <= count; j++) {
      const t = j / count;
      points.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t,
        y: a[2] + (b[2] - a[2]) * t, s: s + length * t });
    }
    s += length;
  }
  return { id, kind, width: kind === 'cart' ? 5.5 : 2, shoulder: kind === 'cart' ? 18 : 8,
    maxGrade: kind === 'cart' ? 0.08 : 0.18, points, length: s, source };
}

/**
 * Town approaches stop outside the existing city circulation. Water pins are not road endpoints.
 * The developed mine road remains the sole owner of its corridor and turning-yard approach.
 */
export const NATIONAL_ROUTES: readonly NationalRoute[] = [
  { id: 'mine', kind: 'cart', width: 5.5, shoulder: 14, maxGrade: 0.08,
    points: MINE_ROAD, length: MINE_ROAD[MINE_ROAD.length - 1]!.s, source: 'existing' },
  route('fort', [arrival('East Border Fort'), [3500, 9600, 290], [4500, 9300, 320], [5500, 9000, 350], [6800, 9000, 380]]),
  route('lake', [[6800, 9000, 380], [6400, 7000, 540], [6400, 5000, 700], [7400, 4200, 820],
    [7500, 4000, 820], [7520, 3500, 835], [7800, 3420, 860], [8200, 3420, 870], [8480, 3600, 845], arrival('Crown Lake')]),
  route('forest', [[6400, 7000, 540], [5200, 6300, 620], arrival('Pinewatch')]),
  route('port-upper', [[7100, 9000, 380], [8600, 10500, 300], [9630, 11330, 225]]),
  route('terrace-arrival', [[8600, 10500, 300], arrival('Terrace village')], 'derived'),
  route('port-lower', [[9770, 11530, 210], [10000, 11700, 195], [12000, 13500, 90], [13800, 14750, 20], arrival('Salt Quay')]),
  route('ash', [[6800, 9000, 380], [6500, 11000, 330], [7200, 13000, 270], arrival('March station'), [10000, 17000, 180]]),
  // The atlas starts at the lake pin. Use the already-authored dry eastern hamlet instead.
  route('north', [arrival('Crown Lake'), [8560, 3350, 860], [9200, 2500, 940], [9500, 1000, 1050]]),
  route('barrens', [[10500, 7200, 740], [11000, 8500, 640], [11300, 10000, 530], [12400, 10600, 460]]),
  // The massif approach is derived from the mine/Barrens junction, outside the river catchment.
  // Steeper summit access is a foot route; it does not claim a cart road to the crater.
  route('volcano-approach', [arrival('Cinderpit'), [10500, 6940, 740], [11100, 6200, 900], [11600, 5500, 1040], [12300, 5200, 1170],
    [12800, 4600, 1300], [12600, 3900, 1430], [11900, 3600, 1560], [11700, 4100, 1650], [12150, 3750, 1700]], 'derived', 'foot'),
];

/** These require authored bridge/landing geometry and collision before continuous travel is claimed. */
export const NATIONAL_ROUTE_GAPS: readonly RouteGap[] = [
  { id: 'sindr-west-east', from: [6800, 9000], to: [7100, 9000],
    reason: 'Existing Sindr circulation owns the central river crossing; national ribbons do not replace it.' },
];

export function routePointAt(route: NationalRoute, station: number): RoadPoint {
  const s = Math.max(0, Math.min(route.length, station));
  let lo = 0, hi = route.points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (route.points[mid]!.s < s) lo = mid; else hi = mid; }
  const a = route.points[lo]!, b = route.points[hi]!, t = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, s };
}

export interface NationalRoadSample {
  route: NationalRoute;
  distance: number;
  height: number;
  station: number;
}
const binSize = 128;
const bins = new Map<string, { route: NationalRoute; index: number }[]>();
for (const road of NATIONAL_ROUTES) {
  if (road.id === 'mine') continue;
  const reach = road.width / 2 + road.shoulder;
  for (let index = 1; index < road.points.length; index++) {
    const a = road.points[index - 1]!, b = road.points[index]!;
    for (let x = Math.floor((Math.min(a.x, b.x) - reach) / binSize); x <= Math.floor((Math.max(a.x, b.x) + reach) / binSize); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - reach) / binSize); z <= Math.floor((Math.max(a.z, b.z) + reach) / binSize); z++) {
        const key = `${x}:${z}`, entries = bins.get(key), entry = { route: road, index };
        if (entries) entries.push(entry); else bins.set(key, [entry]);
      }
    }
  }
}

/** Mine is excluded: retain the existing mineAt/valley priority in ground.ts. */
export function nationalRoadAt(x: number, z: number): NationalRoadSample | null {
  let best: NationalRoadSample | null = null;
  for (const entry of bins.get(`${Math.floor(x / binSize)}:${Math.floor(z / binSize)}`) ?? []) {
    const a = entry.route.points[entry.index - 1]!, b = entry.route.points[entry.index]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (distance > entry.route.width / 2 + entry.route.shoulder || (best && distance >= best.distance)) continue;
    best = { route: entry.route, distance, height: a.y + (b.y - a.y) * t, station: a.s + (b.s - a.s) * t };
  }
  return best;
}

/** Apply after drainage/precincts, before the unchanged mine corridor. Never fills water. */
export function nationalRoadGround(x: number, z: number, height: number, water: number | null): number {
  if (water !== null) return height;
  const road = nationalRoadAt(x, z);
  if (!road) return height;
  const t = Math.max(0, Math.min(1, (road.distance - road.route.width / 2) / road.route.shoulder));
  return road.height + (height - road.height) * t * t * (3 - 2 * t);
}
