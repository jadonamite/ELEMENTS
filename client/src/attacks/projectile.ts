import { Vector3 } from 'three';
import type { Element } from '../../../shared/src/index.js';
import { segmentDistance } from '../hits.js';
import type { CombatSpace } from './space.js';

/** A thrown attack. The picture on screen follows `position` and ends when `done` is set. */
export interface Projectile {
  readonly id: number;
  readonly side: 'hero' | 'villain';
  readonly element: Element;
  /** The rules move it carries (hero), or the caster's damage (villain). */
  readonly move: string;
  readonly damage: number;
  readonly radius: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
  /** Where it was thrown from; the rules measure reach from here. */
  readonly origin: Vector3;
  /** Game time of the throw, and the bending strength it carried. */
  readonly swingAt: number;
  readonly scale: number;
  readonly chained: boolean;
  readonly lit: boolean;
  /** Seconds left before it falls apart in the air. */
  life: number;
  done: boolean;
  /** Where it ended, and why. */
  end?: { at: Vector3; reason: 'world' | 'body' | 'spent' };
  /** Bodies it already hit, so a piercing shot never hits the same one twice. */
  readonly struck: Set<unknown>;
}

export interface Body { feet: Vector3; height: number; radius: number }

let nextId = 1;
const from = new Vector3();
const bottom = new Vector3();
const top = new Vector3();

export interface Throw {
  side: Projectile['side']; element: Element; move: string; damage: number;
  origin: Vector3; direction: Vector3; speed: number; radius: number; range: number;
  swingAt?: number; scale?: number; chained?: boolean; lit?: boolean;
}

export function launch(t: Throw): Projectile {
  const { side, element, move, damage, radius, speed, range } = t;
  return {
    id: nextId++, side, element, move, damage, radius,
    position: t.origin.clone(), origin: t.origin.clone(),
    velocity: t.direction.clone().normalize().multiplyScalar(speed),
    swingAt: t.swingAt ?? 0, scale: t.scale ?? 1, chained: t.chained ?? false, lit: t.lit ?? false,
    life: range / speed, done: false, struck: new Set(),
  };
}

/**
 * Moves the projectile one step and returns the first body it touched on the way, if any.
 * The world is asked first, so nothing behind a wall can be reached.
 */
export function advance<T>(p: Projectile, dt: number, space: CombatSpace, targets: ReadonlyArray<{ key: T; body: Body }>): { key: T } | null {
  if (p.done) return null;
  from.copy(p.position);
  const step = p.velocity.length() * dt;
  p.position.addScaledVector(p.velocity, dt);
  p.life -= dt;

  const blockedAt = space.obstruction(from, p.position, p.radius);
  const reach = blockedAt ?? step;

  let best: { key: T } | null = null;
  let bestT = Infinity;
  for (const { key, body } of targets) {
    if (p.struck.has(key)) continue;
    bottom.copy(body.feet).setY(body.feet.y + body.radius);
    top.copy(body.feet).setY(body.feet.y + body.height - body.radius);
    if (segmentDistance(from, p.position, bottom, top) > body.radius + p.radius) continue;
    // How far along this step the body sits; only bodies before the wall count.
    const along = Math.max(0, ((body.feet.x - from.x) * p.velocity.x + (body.feet.z - from.z) * p.velocity.z)
      / Math.max(Math.hypot(p.velocity.x, p.velocity.z), 1e-6) - body.radius);
    if (along <= reach + p.radius && along < bestT) { best = { key }; bestT = along; }
  }

  if (best !== null) {
    p.struck.add(best.key);
    p.done = true;
    p.position.copy(from).addScaledVector(p.velocity, Math.min(bestT, step) / Math.max(step, 1e-6) * dt);
    p.end = { at: p.position.clone(), reason: 'body' };
    return best;
  }
  if (blockedAt !== null) {
    p.done = true;
    p.position.copy(from).addScaledVector(p.velocity, blockedAt / Math.max(step, 1e-6) * dt);
    p.end = { at: p.position.clone(), reason: 'world' };
    return null;
  }
  if (p.life <= 0 || p.position.y <= 0.05) {
    p.done = true;
    p.end = { at: p.position.clone(), reason: 'spent' };
  }
  return null;
}
