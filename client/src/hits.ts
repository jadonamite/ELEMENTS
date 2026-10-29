/** A point in metres, plain so the server can reuse the same geometry. */
export interface Point { x: number; y: number; z: number }

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y + a.z * b.z;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** Shortest distance between segments p1-q1 and p2-q2. */
export function segmentDistance(p1: Point, q1: Point, p2: Point, q2: Point): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) return Math.sqrt(dot(r, r));
  if (a <= 1e-9) t = clamp01(f / e);
  else {
    const c = dot(d1, r);
    if (e <= 1e-9) s = clamp01(-c / a);
    else {
      const b = dot(d1, d2), denom = a * e - b * b;
      s = denom > 1e-9 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const closest1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const closest2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  const gap = sub(closest1, closest2);
  return Math.sqrt(dot(gap, gap));
}

/** Does the blade segment touch an upright capsule standing on `feet`? */
export function bladeTouches(base: Point, tip: Point, feet: Point, height: number, radius: number): boolean {
  const bottom = { x: feet.x, y: feet.y + radius, z: feet.z };
  const top = { x: feet.x, y: feet.y + height - radius, z: feet.z };
  return segmentDistance(base, tip, bottom, top) <= radius;
}

/** Is `target` inside a cone of half-angle `halfAngle` around `facing` (yaw, +Z forward)? */
export function inFront(from: Point, facing: number, target: Point, halfAngle: number): boolean {
  const angle = Math.atan2(target.x - from.x, target.z - from.z);
  return Math.abs(Math.atan2(Math.sin(angle - facing), Math.cos(angle - facing))) <= halfAngle;
}
