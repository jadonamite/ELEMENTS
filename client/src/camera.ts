import RAPIER from '@dimforge/rapier3d-compat';
import { PerspectiveCamera, Vector3 } from 'three';
import balance from '../../shared/balance.json';

const tuning = balance.camera;
const identity = { x: 0, y: 0, z: 0, w: 1 };
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function cameraCollisionRadius(camera: PerspectiveCamera): number {
  const halfHeight = camera.near * Math.tan(camera.fov * Math.PI / 360);
  // A sphere about the eye encloses all four near-plane corners at any orbit angle.
  return Math.max(tuning.collisionRadius,
    Math.hypot(camera.near, halfHeight, halfHeight * camera.aspect)) + tuning.collisionPadding;
}

export class ShoulderCamera {
  yaw = 0;
  pitch = tuning.initialPitch;
  private distance = 0;
  private readonly anchor = new Vector3();
  /** Point the camera orbits, at the hero's shoulder height. */
  get target(): Vector3 { return this.anchor; }
  private readonly direction = new Vector3();
  private readonly look = new Vector3();
  private readonly probe = new RAPIER.Ball(tuning.collisionRadius);

  constructor(readonly camera: PerspectiveCamera, private readonly world: RAPIER.World) {}

  orbit(dx: number, dy: number): void {
    this.yaw = Math.atan2(Math.sin(this.yaw - dx * tuning.mouseSensitivity),
      Math.cos(this.yaw - dx * tuning.mouseSensitivity));
    this.pitch = clamp(this.pitch + dy * tuning.mouseSensitivity, tuning.minPitch, tuning.maxPitch);
  }

  update(heroPosition: Vector3, delta: number, reducedMotion = false): void {
    const radius = cameraCollisionRadius(this.camera);
    this.probe.radius = radius;
    const limit = balance.arena.size / 2 - radius - tuning.collisionPadding;
    // The hero can stand closer to a wall than a wide near plane can. Start the
    // sweep from safe interior space so a penetrating origin cannot miss a wall.
    const reach = Math.hypot(heroPosition.x, heroPosition.z);
    const pull = reach > limit ? limit / reach : 1;
    this.anchor.set(heroPosition.x * pull,
      Math.max(radius + tuning.collisionPadding, heroPosition.y + tuning.targetHeight),
      heroPosition.z * pull);
    const cos = Math.cos(this.pitch);
    this.direction.set(
      Math.sin(this.yaw) * cos * tuning.distance + Math.cos(this.yaw) * tuning.shoulder,
      Math.sin(this.pitch) * tuning.distance,
      Math.cos(this.yaw) * cos * tuning.distance - Math.sin(this.yaw) * tuning.shoulder,
    );
    const desiredDistance = this.direction.length();
    this.direction.normalize();
    const hit = this.world.castShape(this.anchor, identity, this.direction, this.probe,
      0, desiredDistance, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    const safeDistance = hit ? Math.max(0, hit.time_of_impact - tuning.collisionPadding) : desiredDistance;
    // Never smooth inward or interpolate positions across a corner.
    this.distance = safeDistance < this.distance || reducedMotion ? safeDistance
      : this.distance + (safeDistance - this.distance) * (1 - Math.exp(-tuning.recoveryRate * delta));
    this.camera.position.copy(this.anchor).addScaledVector(this.direction, this.distance);
    this.look.set(-Math.sin(this.yaw) * cos, -Math.sin(this.pitch), -Math.cos(this.yaw) * cos);
    this.camera.lookAt(this.look.add(this.camera.position));
  }
}
