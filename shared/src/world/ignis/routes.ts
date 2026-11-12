import { baseGround } from './base-ground.js';
import { mineAt, MINE_ROAD, type RoadPoint } from './mine-road.js';
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

/** Widest cut or fill bank either side of a road. Deep cuts spread over this instead of standing as walls. */
const BANK_REACH = 90;
/** Deepest cut or fill. Where the land is steeper than the grade allows, the road runs steeper instead of standing on a causeway. */
const MAX_EARTHWORK = 12;
/** Metres of bank per metre of cut or fill. */
const BANK_RUN = 1.6;

const laid: NationalRoute[] = [];
/**
 * The surface a new road meets at this point: a road already laid through it, else the mine road, else the land.
 * A branch therefore leaves its parent road at the parent's height.
 */
function bedAt(x: number, z: number): number {
  for (const road of laid) for (const p of road.points) if (Math.hypot(p.x - x, p.z - z) < 4.5) return p.y;
  return landAt(x, z);
}
/** The land a road is laid on, including the mine road where the two meet or cross. */
function landAt(x: number, z: number): number {
  const mine = mineAt(x, z), land = baseGround(x, z).height;
  if (mine.distance >= 14) return land;
  const t = Math.max(0, Math.min(1, (mine.distance - 6) / 8));
  return mine.height + (land - mine.height) * t * t * (3 - 2 * t);
}

/**
 * Lay a road on the land. Each point starts at the ground beneath it; the profile is then held to the route's
 * grade by cutting the crests and filling the dips equally, never deeper than MAX_EARTHWORK, pinned to the surface
 * it meets at both ends, and eased so it has no kinks. A foot trail simply follows the ground between its ends.
 */
function drape(points: RoadPoint[], maxGrade: number, graded: boolean): void {
  const n = points.length, first = points[0]!, last = points[n - 1]!;
  const land = points.map(p => landAt(p.x, p.z));
  for (let i = 0; i < n; i++) points[i]!.y = land[i]!;
  first.y = bedAt(first.x, first.z); last.y = bedAt(last.x, last.z);
  if (graded) {
    const cut = points.map(p => p.y), fill = points.map(p => p.y);
    for (let i = 1; i < n; i++) {
      const run = maxGrade * (points[i]!.s - points[i - 1]!.s);
      cut[i] = Math.min(cut[i]!, cut[i - 1]! + run); fill[i] = Math.max(fill[i]!, fill[i - 1]! - run);
    }
    for (let i = n - 2; i >= 0; i--) {
      const run = maxGrade * (points[i + 1]!.s - points[i]!.s);
      cut[i] = Math.min(cut[i]!, cut[i + 1]! + run); fill[i] = Math.max(fill[i]!, fill[i + 1]! - run);
    }
    const start = first.y, end = last.y;
    for (let i = 0; i < n; i++) {
      const p = points[i]!, fromStart = maxGrade * p.s, fromEnd = maxGrade * (last.s - p.s);
      const low = Math.max(start - fromStart, end - fromEnd), high = Math.min(start + fromStart, end + fromEnd);
      const y = low > high ? (low + high) / 2 : Math.max(low, Math.min(high, (cut[i]! + fill[i]!) / 2));
      p.y = Math.max(land[i]! - MAX_EARTHWORK, Math.min(land[i]! + MAX_EARTHWORK, y));
    }
    first.y = start; last.y = end;
  }
  for (let pass = 0; pass < 6; pass++) {
    let previous = first.y;
    for (let i = 1; i < n - 1; i++) {
      const y = points[i]!.y;
      points[i]!.y = (previous + 2 * y + points[i + 1]!.y) / 4;
      previous = y;
    }
  }
}

/** Control points give the alignment only. Heights come from the land, see `drape`. */
function route(id: string, controls: readonly Control[], source: NationalRoute['source'] = 'atlas', kind: NationalRoute['kind'] = 'cart'): NationalRoute {
  const points: RoadPoint[] = [];
  let s = 0;
  for (let i = 0; i < controls.length; i++) {
    const b = controls[i]!;
    if (i === 0) { points.push({ x: b[0], z: b[1], y: 0, s: 0 }); continue; }
    const a = controls[i - 1]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / 8));
    for (let j = 1; j <= count; j++) {
      const t = j / count;
      points.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, y: 0, s: s + length * t });
    }
    s += length;
  }
  const maxGrade = kind === 'cart' ? 0.08 : 0.18;
  drape(points, maxGrade * 0.95, kind === 'cart');
  const road: NationalRoute = { id, kind, width: kind === 'cart' ? 5.5 : 2, shoulder: kind === 'cart' ? 18 : 8, maxGrade, points, length: s, source };
  laid.push(road);
  return road;
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
  const reach = road.width / 2 + BANK_REACH;
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

function nearestRoad(x: number, z: number, bank: number | null): NationalRoadSample | null {
  let best: NationalRoadSample | null = null;
  for (const entry of bins.get(`${Math.floor(x / binSize)}:${Math.floor(z / binSize)}`) ?? []) {
    const a = entry.route.points[entry.index - 1]!, b = entry.route.points[entry.index]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (distance > entry.route.width / 2 + (bank ?? entry.route.shoulder) || (best && distance >= best.distance)) continue;
    best = { route: entry.route, distance, height: a.y + (b.y - a.y) * t, station: a.s + (b.s - a.s) * t };
  }
  return best;
}

/** The road whose surface or shoulder covers this point. Mine is excluded: ground.ts keeps mineAt/valley priority. */
export function nationalRoadAt(x: number, z: number): NationalRoadSample | null {
  return nearestRoad(x, z, null);
}

/**
 * Apply after drainage/precincts, before the unchanged mine corridor. Never fills water.
 * The bank is at least the shoulder and widens with the depth of the cut or fill, up to BANK_REACH.
 */
export function nationalRoadGround(x: number, z: number, height: number, water: number | null): number {
  if (water !== null) return height;
  const road = nearestRoad(x, z, BANK_REACH);
  if (!road) return height;
  const bank = Math.min(BANK_REACH, Math.max(road.route.shoulder, Math.abs(height - road.height) * BANK_RUN));
  const t = Math.max(0, Math.min(1, (road.distance - road.route.width / 2) / bank));
  return road.height + (height - road.height) * t * t * (3 - 2 * t);
}
