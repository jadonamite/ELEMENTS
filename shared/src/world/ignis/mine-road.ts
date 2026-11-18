/** Authored mine alignment in nation-global metres. Elevations are metres ASL. */
export interface RoadPoint { x: number; y: number; z: number; s: number }
const alignment: readonly (readonly [number, number])[] = [
  [7100, 9000], [7180, 9000], [7500, 8670], [7900, 8460],
  [8200, 8000], [8500, 8000], [8670, 7550], [8860, 7710], [9110, 7240], [9400, 7000],
  // The last loop swings wide of the mine yard, so the yard's bank never stands over the road, and comes in from the south.
  [9700, 6800], [10150, 6680], [10800, 6480], [11000, 7050], [10800, 7440], [10500, 7260], [10500, 7000],
];
const points: RoadPoint[] = [];
function append(x: number, z: number): void {
  const p = points[points.length - 1];
  points.push({ x, z, y: 0, s: p ? p.s + Math.hypot(x - p.x, z - p.z) : 0 });
}
// Round corners inside the surveyed corridor. Keep the two altitude controls as vertices.
append(...alignment[0]!);
for (let i = 1; i < alignment.length - 1; i++) {
  const a = alignment[i - 1]!, b = alignment[i]!, c = alignment[i + 1]!;
  const radius = b[0] === 8200 || b[0] === 9400 ? 0 : 18;
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ax = b[0] + (a[0] - b[0]) * radius / ab, az = b[1] + (a[1] - b[1]) * radius / ab;
  const cx = b[0] + (c[0] - b[0]) * radius / bc, cz = b[1] + (c[1] - b[1]) * radius / bc;
  const p = points[points.length - 1]!, n = Math.ceil(Math.hypot(ax - p.x, az - p.z) / 8);
  const px = p.x, pz = p.z;
  for (let k = 1; k <= n; k++) append(px + (ax - px) * k / n, pz + (az - pz) * k / n);
  if (radius) for (let k = 1; k <= 12; k++) {
    const t = k / 12, u = 1 - t;
    append(u * u * ax + 2 * u * t * b[0] + t * t * cx, u * u * az + 2 * u * t * b[1] + t * t * cz);
  }
}
const last = alignment[alignment.length - 1]!, prev = points[points.length - 1]!;
const n = Math.ceil(Math.hypot(last[0] - prev.x, last[1] - prev.z) / 8), px = prev.x, pz = prev.z;
for (let k = 1; k <= n; k++) append(px + (last[0] - px) * k / n, pz + (last[1] - pz) * k / n);
export const MINE_LENGTH = points[points.length - 1]!.s;
const station = (x: number, z: number): number => points.reduce((a, b) => Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a).s;
const profile = [[0, 380], [80, 380], [station(8200, 8000), 470], [station(9400, 7000), 600], [MINE_LENGTH - 200, 740], [MINE_LENGTH, 740]] as const;
export function mineHeight(s: number): number {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!, b = profile[i]!;
    if (s <= b[0]) return a[1] + (b[1] - a[1]) * Math.max(0, (s - a[0]) / (b[0] - a[0]));
  }
  return 740;
}
for (const p of points) p.y = mineHeight(p.s);
export const MINE_ROAD: readonly RoadPoint[] = points;
export const MINE_MAX_GRADE = Math.max(...profile.slice(1).map((b, i) => (b[1] - profile[i]![1]) / (b[0] - profile[i]![0])));
export function minePointAt(s: number): RoadPoint {
  s = Math.max(0, Math.min(MINE_LENGTH, s));
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid]!.s < s) lo = mid; else hi = mid; }
  const a = points[lo]!, b = points[hi]!, t = (s - a.s) / (b.s - a.s);
  return { x: a.x + (b.x - a.x) * t, y: mineHeight(s), z: a.z + (b.z - a.z) * t, s };
}

/**
 * Corridor lookup touches every segment within this reach, including both sides of every cell boundary. The reach
 * covers the rock bank, which stands up to 73 m off the centre line; the road carve only asks about 14 m.
 */
const CORRIDOR_REACH = 96;
const bins = new Map<string, number[]>();
for (let i = 1; i < points.length; i++) {
  const a = points[i - 1]!, b = points[i]!;
  for (let x = Math.floor((Math.min(a.x, b.x) - CORRIDOR_REACH) / 128); x <= Math.floor((Math.max(a.x, b.x) + CORRIDOR_REACH) / 128); x++) {
    for (let z = Math.floor((Math.min(a.z, b.z) - CORRIDOR_REACH) / 128); z <= Math.floor((Math.max(a.z, b.z) + CORRIDOR_REACH) / 128); z++) {
      const key = `${x}:${z}`, list = bins.get(key);
      if (list) list.push(i); else bins.set(key, [i]);
    }
  }
}
export interface RoadSample { distance: number; height: number; s: number }
export function mineAt(x: number, z: number): RoadSample {
  let distance = Infinity, s = 0;
  for (const i of bins.get(`${Math.floor(x / 128)}:${Math.floor(z / 128)}`) ?? []) {
    const a = points[i - 1]!, b = points[i]!, dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < distance) { distance = d; s = a.s + (b.s - a.s) * t; }
  }
  return { distance, height: mineHeight(s), s };
}

const broadPoints: RoadPoint[] = [];
for (let s = 0; s < MINE_LENGTH; s += 64) broadPoints.push(minePointAt(s));
broadPoints.push(minePointAt(MINE_LENGTH));
const broadBins = new Map<string, number[]>();
for (let i = 1; i < broadPoints.length; i++) {
  const a = broadPoints[i - 1]!, b = broadPoints[i]!;
  for (let x = Math.floor((Math.min(a.x, b.x) - 620) / 512); x <= Math.floor((Math.max(a.x, b.x) + 620) / 512); x++) {
    for (let z = Math.floor((Math.min(a.z, b.z) - 620) / 512); z <= Math.floor((Math.max(a.z, b.z) + 620) / 512); z++) {
      const key = `${x}:${z}`, list = broadBins.get(key); if (list) list.push(i); else broadBins.set(key, [i]);
    }
  }
}
/** How far the broad valley reaches either side of the road. The index margin (620 m) covers it. */
export const VALLEY_REACH = 600;
/**
 * The broad cut/fill valley. Its height is a weighted blend over every road section within reach, and each weight
 * fades to zero at the reach, so the height is continuous everywhere. Taking the single nearest section instead
 * jumps where a bend brings two legs of different height near each other, and the ground grows a ledge there.
 * `distance` is the distance to the nearest section (continuous too). The index is conservative, so no section with
 * any weight is ever left out.
 */
export function mineValleyAt(x: number, z: number): RoadSample {
  let d2 = Infinity, s = 0, weight = 0, sum = 0;
  for (const i of broadBins.get(`${Math.floor(x / 512)}:${Math.floor(z / 512)}`) ?? []) {
    const a = broadPoints[i - 1]!, b = broadPoints[i]!, dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2, along = a.s + (b.s - a.s) * t;
    if (d < d2) { d2 = d; s = along; }
    const r = Math.sqrt(d) / VALLEY_REACH;
    if (r < 1) { const w = (1 - r * r) ** 3 / (d + 400); weight += w; sum += w * mineHeight(along); }
  }
  return { distance: Math.sqrt(d2), height: weight > 0 ? sum / weight : mineHeight(s), s };
}
