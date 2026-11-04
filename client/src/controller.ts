import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import balance from '../../shared/balance.json';

const tuning = balance.controller;
export interface MoveInput { forward: number; right: number; running: boolean }
export type Locomotion = 'idle' | 'walk' | 'run';

export interface Speeds { walkSpeed: number; runSpeed: number }

export function movementVelocity(input: MoveInput, yaw: number, speeds: Speeds = tuning): Vector3 {
  const direction = new Vector3(
    input.right * Math.cos(yaw) - input.forward * Math.sin(yaw),
    0,
    -input.right * Math.sin(yaw) - input.forward * Math.cos(yaw),
  );
  if (direction.lengthSq() > 1) direction.normalize();
  return direction.multiplyScalar(input.running ? speeds.runSpeed : speeds.walkSpeed);
}

export function locomotionForSpeed(speed: number): Locomotion {
  return speed < tuning.idleSpeedThreshold ? 'idle' : speed < tuning.runSpeedThreshold ? 'walk' : 'run';
}

export function turnToward(current: number, target: number, delta: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * (1 - Math.exp(-tuning.turnRate * delta));
}

export class HeroController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly position = new Vector3();
  /** Position before the latest physics step, for smooth drawing between steps. */
  readonly previous = new Vector3();
  private readonly character: RAPIER.KinematicCharacterController;
  facing = Math.PI;
  speed = 0;
  private verticalVelocity = 0;

  /** Enemies pass their own spawn point and speeds; the hero starts at the centre. Open zones pass bounded = false. */
  constructor(private readonly world: RAPIER.World, spawn: { x: number; z: number; y?: number } = { x: 0, z: 0 },
    private readonly speeds: Speeds = tuning, private readonly bounded = true) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(spawn.x, (spawn.y ?? 0) + tuning.height / 2 + tuning.skin, spawn.z));
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(tuning.height / 2 - tuning.radius, tuning.radius), this.body,
    );
    this.character = world.createCharacterController(tuning.skin);
    this.character.setSlideEnabled(true);
    this.character.setApplyImpulsesToDynamicBodies(false);
    if (!bounded) {
      // Open zones have stairs, lanes and terraces: stay on the ground going down, climb lanes, not cliffs.
      const walk = balance.world.walk;
      const rad = Math.PI / 180;
      this.character.enableSnapToGround(walk.snapToGround);
      this.character.setMaxSlopeClimbAngle(walk.maxSlopeClimbDeg * rad);
      this.character.setMinSlopeSlideAngle(walk.minSlopeSlideDeg * rad);
      this.character.enableAutostep(walk.autostepHeight, walk.autostepMinWidth, false);
    }
    world.propagateModifiedBodyPositionsToColliders();
    this.sync();
    this.previous.copy(this.position);
  }

  /**
   * Moves the body for one physics tick; a lunge (m/s) carries it along its facing instead of the input.
   * The world itself is stepped once per tick by whoever runs the tick, after every body has moved.
   */
  step(input: MoveInput, yaw: number, lunge = 0, speedMultiplier = 1.0, impulse?: Vector3): void {
    const dt = tuning.fixedStep;
    const effectiveSpeeds = speedMultiplier === 1.0
      ? this.speeds
      : { walkSpeed: this.speeds.walkSpeed * speedMultiplier, runSpeed: this.speeds.runSpeed * speedMultiplier };
    const velocity = lunge > 0
      ? new Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(lunge)
      : movementVelocity(input, yaw, effectiveSpeeds);
    if (impulse) {
      velocity.add(new Vector3(impulse.x, 0, impulse.z));
    }
    if (lunge === 0 && velocity.lengthSq() > 0 && !impulse) {
      this.facing = turnToward(this.facing, Math.atan2(velocity.x, velocity.z), dt);
    }
    velocity.multiplyScalar(dt);
    const previous = this.body.translation();
    const floorCenter = tuning.height / 2 + tuning.skin;
    // A launched body follows its own airborne velocity, falling as well as rising.
    if (impulse && impulse.y !== 0) {
      this.verticalVelocity = impulse.y;
    }
    this.verticalVelocity -= tuning.gravity * dt;
    // The flat arena clamps to its floor; open zones stand on the land and its colliders.
    velocity.y = this.bounded ? Math.max(floorCenter - previous.y, this.verticalVelocity * dt) : this.verticalVelocity * dt;
    this.character.computeColliderMovement(this.collider, velocity);
    const movement = this.character.computedMovement();
    if (this.character.computedGrounded()) this.verticalVelocity = 0;
    // Keep the flat arena's floor and bounds invariant even when the solver's
    // contact tolerances accumulate during prolonged corner pressure.
    const limit = balance.arena.size / 2 - tuning.radius - tuning.skin;
    const next = {
      x: previous.x + movement.x,
      y: this.bounded ? Math.max(floorCenter, previous.y + movement.y) : previous.y + movement.y,
      z: previous.z + movement.z,
    };
    const reach = Math.hypot(next.x, next.z);
    if (this.bounded && reach > limit) { next.x *= limit / reach; next.z *= limit / reach; }
    if (this.bounded && next.y === floorCenter) this.verticalVelocity = 0;
    this.speed = Math.hypot(next.x - previous.x, next.z - previous.z) / dt;
    this.body.setNextKinematicTranslation(next);
    this.previous.copy(this.position);
    this.position.set(next.x, next.y - tuning.height / 2 - tuning.skin, next.z);
  }

  /**
   * Puts the body at a spot at once (spawn, respawn, a room change). y is the feet's height, like position.y;
   * the body itself is held by its centre, half a height above.
   */
  place(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y: y + tuning.height / 2 + tuning.skin, z }, true);
    this.world.propagateModifiedBodyPositionsToColliders();
    this.verticalVelocity = 0;
    this.sync();
    this.previous.copy(this.position);
  }

  /** Moves the body by (dx, dz) at once through the same collision checks as walking: walls and ground stop it. */
  shift(dx: number, dz: number): void {
    const from = this.body.translation();
    this.character.computeColliderMovement(this.collider, { x: dx, y: 0, z: dz });
    const m = this.character.computedMovement();
    this.body.setTranslation({ x: from.x + m.x, y: from.y + m.y, z: from.z + m.z }, true);
    // The collider follows now, so a second move before the next step starts from here.
    this.world.propagateModifiedBodyPositionsToColliders();
    this.previous.copy(this.position);
    this.sync();
  }

  private sync(): void {
    const position = this.body.translation();
    this.position.set(position.x, position.y - tuning.height / 2 - tuning.skin, position.z);
  }

  dispose(): void {
    this.world.removeCharacterController(this.character);
    this.world.removeRigidBody(this.body);
  }
}

/** Consume elapsed time at the same physics rate on fast and slow displays. */
export class FixedStepper {
  private accumulated = 0;
  /** Runs whole steps and returns how far (0 to 1) time sits into the next one. */
  advance(delta: number, step: () => void): number {
    this.accumulated += Math.max(0, Math.min(delta, tuning.maxFrameDelta));
    while (this.accumulated + Number.EPSILON >= tuning.fixedStep) {
      step();
      this.accumulated -= tuning.fixedStep;
    }
    return Math.max(0, Math.min(1, this.accumulated / tuning.fixedStep));
  }
  reset(): void { this.accumulated = 0; }
}
