import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import balance from '../../shared/balance.json';

const tuning = balance.controller;
export interface MoveInput { forward: number; right: number; running: boolean }
export type Locomotion = 'idle' | 'walk' | 'run';

export function movementVelocity(input: MoveInput, yaw: number): Vector3 {
  const direction = new Vector3(
    input.right * Math.cos(yaw) - input.forward * Math.sin(yaw),
    0,
    -input.right * Math.sin(yaw) - input.forward * Math.cos(yaw),
  );
  if (direction.lengthSq() > 1) direction.normalize();
  return direction.multiplyScalar(input.running ? tuning.runSpeed : tuning.walkSpeed);
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
  private readonly character: RAPIER.KinematicCharacterController;
  facing = Math.PI;
  speed = 0;
  private verticalVelocity = 0;

  constructor(private readonly world: RAPIER.World) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(0, tuning.height / 2 + tuning.skin, 0));
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(tuning.height / 2 - tuning.radius, tuning.radius), this.body,
    );
    this.character = world.createCharacterController(tuning.skin);
    this.character.setSlideEnabled(true);
    this.character.setApplyImpulsesToDynamicBodies(false);
    world.step();
    this.sync();
  }

  step(input: MoveInput, yaw: number): void {
    const dt = tuning.fixedStep;
    const velocity = movementVelocity(input, yaw);
    if (velocity.lengthSq() > 0) {
      this.facing = turnToward(this.facing, Math.atan2(velocity.x, velocity.z), dt);
    }
    velocity.multiplyScalar(dt);
    const previous = this.body.translation();
    const floorCenter = tuning.height / 2 + tuning.skin;
    this.verticalVelocity -= tuning.gravity * dt;
    velocity.y = Math.max(floorCenter - previous.y, this.verticalVelocity * dt);
    this.character.computeColliderMovement(this.collider, velocity);
    const movement = this.character.computedMovement();
    if (this.character.computedGrounded()) this.verticalVelocity = 0;
    // Keep the flat arena's floor and bounds invariant even when the solver's
    // contact tolerances accumulate during prolonged corner pressure.
    const limit = balance.arena.size / 2 - tuning.radius - tuning.skin;
    const next = {
      x: previous.x + movement.x,
      y: Math.max(floorCenter, previous.y + movement.y),
      z: previous.z + movement.z,
    };
    const reach = Math.hypot(next.x, next.z);
    if (reach > limit) { next.x *= limit / reach; next.z *= limit / reach; }
    if (next.y === floorCenter) this.verticalVelocity = 0;
    this.speed = Math.hypot(next.x - previous.x, next.z - previous.z) / dt;
    this.body.setNextKinematicTranslation(next);
    this.world.step();
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
  advance(delta: number, step: () => void): void {
    this.accumulated += Math.max(0, Math.min(delta, tuning.maxFrameDelta));
    while (this.accumulated + Number.EPSILON >= tuning.fixedStep) {
      step();
      this.accumulated -= tuning.fixedStep;
    }
  }
  reset(): void { this.accumulated = 0; }
}
