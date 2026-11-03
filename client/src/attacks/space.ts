import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';

const identity = { x: 0, y: 0, z: 0, w: 1 };
const dir = new Vector3();

/**
 * The one place attacks ask the world what is in their way. Every fixed collider counts:
 * arena walls, pillars, terrain and any TERRA wall standing at the moment. Bodies are not fixed,
 * so characters never block each other here.
 */
export class CombatSpace {
  private readonly probes = new Map<number, RAPIER.Ball>();

  constructor(private readonly world: RAPIER.World) {}

  /** Distance along from→to at which a ball of `radius` first touches the world, or null if the way is clear. */
  obstruction(from: Vector3, to: Vector3, radius = 0.1): number | null {
    dir.subVectors(to, from);
    const length = dir.length();
    if (length < 1e-4) return null;
    dir.divideScalar(length);
    const hit = this.world.castShape(from, identity, dir, this.probe(radius), 0, length, true,
      RAPIER.QueryFilterFlags.ONLY_FIXED);
    return hit ? hit.time_of_impact : null;
  }

  /** True when nothing fixed stands between the two points. */
  clear(from: Vector3, to: Vector3, radius = 0.1): boolean {
    return this.obstruction(from, to, radius) === null;
  }

  private probe(radius: number): RAPIER.Ball {
    let ball = this.probes.get(radius);
    if (!ball) { ball = new RAPIER.Ball(radius); this.probes.set(radius, ball); }
    return ball;
  }
}

/** A body's chest, where strikes travel to and from. */
export function chest(feet: Vector3, out = new Vector3()): Vector3 {
  return out.copy(feet).setY(feet.y + 1.15);
}
