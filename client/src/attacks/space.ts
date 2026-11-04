import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';

const identity = { x: 0, y: 0, z: 0, w: 1 };
const dir = new Vector3();
const lineFrom = new Vector3(), lineTo = new Vector3();

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

  /**
   * The furthest point from→to a ball of `radius` reaches before the world stops it: `to` itself
   * when the way is clear. Things placed away from their caster land here, never behind a wall.
   */
  reachable(from: Vector3, to: Vector3, radius = 0.1, out = new Vector3()): Vector3 {
    const hit = this.obstruction(from, to, radius);
    if (hit === null) return out.copy(to);
    return out.copy(to).sub(from).normalize().multiplyScalar(hit).add(from);
  }

  /**
   * Where a body can stand on the way out from `feet` along `angle` (radians, 0 = +z), at most `distance` away:
   * short of any wall or cliff, on the same level as `feet`. Anyone placed near the hero is placed here.
   */
  standOff(feet: Vector3, angle: number, distance: number, out = new Vector3()): Vector3 {
    const sx = Math.sin(angle), sz = Math.cos(angle);
    lineFrom.set(feet.x, feet.y + 1, feet.z);
    lineTo.set(feet.x + sx * distance, feet.y + 1, feet.z + sz * distance);
    const hit = this.obstruction(lineFrom, lineTo, 0.4);
    const back = hit === null ? distance : Math.max(0, hit - 0.8);
    return out.set(feet.x + sx * back, feet.y, feet.z + sz * back);
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

const stepFrom = new Vector3();
const stepTo = new Vector3();

/**
 * Moves a loose piece (chip, spark, droplet, dust) one step. Sideways motion asks the world first, and a
 * piece that would go into a wall, pillar or raised TERRA wall bounces back off it instead.
 */
export function carry(space: Pick<CombatSpace, 'obstruction'> | undefined, position: Vector3, velocity: Vector3, dt: number, size: number): void {
  stepFrom.copy(position).setY(Math.max(position.y, size + 0.05));
  stepTo.set(stepFrom.x + velocity.x * dt, stepFrom.y, stepFrom.z + velocity.z * dt);
  if (space?.obstruction(stepFrom, stepTo, size) != null) {
    velocity.x *= -0.4;
    velocity.z *= -0.4;
    position.y += velocity.y * dt;
    return;
  }
  position.addScaledVector(velocity, dt);
}
