import { baseGround, riverAt } from './base-ground.js';
import type { Point3 } from './coordinates.js';
import { mineAt, MINE_ROAD, type RoadPoint } from './mine-road.js';
import { ROUTE_LINES } from './route-lines.js';
import { ROUTE_PLANS } from './route-plans.js';

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
/** Widest cut or fill bank either side of a road. Deep cuts spread over this instead of standing as walls. */
const BANK_REACH = 90;
/** Deepest cut or fill. Where the land is steeper than the grade allows, the road runs steeper instead of standing on a causeway. */
const MAX_EARTHWORK = 12;
/** Metres of bank per metre of cut or fill. */
const BANK_RUN = 1.6;

/** A road within this distance of the river's centre line is on its bridge. The water is 9 m to each side. */
const DECK_REACH = 15;
const DECK_CLEARANCE = 6;

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
  const mine = mineAt(x, z), river = riverAt(x, z);
  // Over the river the road rides a bridge deck, DECK_CLEARANCE above the water.
  const land = river.distance < DECK_REACH ? Math.max(baseGround(x, z).height, river.water + DECK_CLEARANCE) : baseGround(x, z).height;
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

/** The surveyed line gives the alignment only. Heights come from the land, see `drape`. */
function route(id: string, line: readonly (readonly [number, number])[], source: NationalRoute['source'], kind: NationalRoute['kind']): NationalRoute {
  // Even stations along the line, so grading and easing treat every piece alike.
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  const count = Math.max(1, Math.ceil(total / 8)), step = total / count, s = total;
  const points: RoadPoint[] = [{ x: line[0]![0], z: line[0]![1], y: 0, s: 0 }];
  let walked = 0, index = 1;
  for (let k = 1; k < count; k++) {
    const target = k * step;
    for (;;) {
      const a = line[index - 1]!, b = line[index]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (walked + length >= target || index === line.length - 1) {
        const t = length ? Math.min(1, (target - walked) / length) : 0;
        points.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, y: 0, s: target });
        break;
      }
      walked += length; index++;
    }
  }
  const end = line[line.length - 1]!;
  points.push({ x: end[0], z: end[1], y: 0, s: total });
  const maxGrade = kind === 'cart' ? 0.08 : 0.18;
  drape(points, maxGrade * 0.95, true);
  const road: NationalRoute = { id, kind, width: kind === 'cart' ? 5.5 : 2, shoulder: kind === 'cart' ? 18 : 8, maxGrade, points, length: s, source };
  laid.push(road);
  return road;
}

/**
 * Town approaches stop outside the existing city circulation.
 * The developed mine road remains the sole owner of its corridor and turning-yard approach.
 */
export const NATIONAL_ROUTES: readonly NationalRoute[] = [
  { id: 'mine', kind: 'cart', width: 5.5, shoulder: 14, maxGrade: 0.08,
    points: MINE_ROAD, length: MINE_ROAD[MINE_ROAD.length - 1]!.s, source: 'existing' },
  ...ROUTE_PLANS.map(plan => route(plan.id, ROUTE_LINES[plan.id] ?? plan.waypoints, plan.source, plan.kind)),
];

export interface RouteBridge { id: string; from: Point3; to: Point3; clear: number; river: true }
/** One deck for every place a cart road crosses the river, from bank to bank at the road's own heights. */
export const ROUTE_BRIDGES: readonly RouteBridge[] = NATIONAL_ROUTES.flatMap(road => {
  if (road.id === 'mine' || road.kind !== 'cart') return [];
  const bridges: RouteBridge[] = [];
  let from: RoadPoint | null = null;
  for (let i = 0; i < road.points.length; i++) {
    const p = road.points[i]!, over = riverAt(p.x, p.z).distance < DECK_REACH;
    if (over && !from) from = road.points[Math.max(0, i - 1)]!;
    if (!over && from) {
      bridges.push({ id: `bridge:${road.id}:${bridges.length}`, from: { x: from.x, y: from.y, z: from.z }, to: { x: p.x, y: p.y, z: p.z }, clear: road.width, river: true });
      from = null;
    }
  }
  return bridges;
});

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
