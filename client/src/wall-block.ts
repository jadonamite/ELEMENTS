import { Vector3 } from 'three';

/** A standing TERRA wall: a box turned about the vertical axis by `facing`. */
export interface StoneWall {
  center: Vector3;
  size: Vector3;
  facing: number;
  expiresAt: number;
}

const UP = new Vector3(0, 1, 0);
const a = new Vector3();
const b = new Vector3();

/** Moves a world point into the wall's own frame, where the box is axis-aligned. */
function toLocal(p: Vector3, wall: StoneWall, out: Vector3): Vector3 {
  return out.subVectors(p, wall.center).applyAxisAngle(UP, -wall.facing);
}

/** True when the segment from `from` to `to` passes through the wall, grown by `pad` on every side. */
export function segmentHitsWall(from: Vector3, to: Vector3, wall: StoneWall, pad = 0.2): boolean {
  toLocal(from, wall, a);
  toLocal(to, wall, b);
  const span = { t0: 0, t1: 1 };
  return clip(a.x, b.x - a.x, wall.size.x / 2 + pad, span)
    && clip(a.y, b.y - a.y, wall.size.y / 2 + pad, span)
    && clip(a.z, b.z - a.z, wall.size.z / 2 + pad, span);
}

/** Narrows the segment's [t0, t1] to the part inside one pair of box faces. */
function clip(start: number, step: number, half: number, span: { t0: number; t1: number }): boolean {
  if (Math.abs(step) < 1e-9) return start >= -half && start <= half;
  let near = (-half - start) / step;
  let far = (half - start) / step;
  if (near > far) [near, far] = [far, near];
  span.t0 = Math.max(span.t0, near);
  span.t1 = Math.min(span.t1, far);
  return span.t0 <= span.t1;
}

/** True when any standing wall lies between the two points. */
export function anyWallBetween(walls: readonly StoneWall[], now: number, from: Vector3, to: Vector3, pad = 0.2): boolean {
  return walls.some(w => now <= w.expiresAt && segmentHitsWall(from, to, w, pad));
}
