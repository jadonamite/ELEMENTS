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

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const KILL_ZOOM = 0.62;
const KILL_CLOSE_UP_SECONDS = 0.7;
const fightProfile = {
  distance: tuning.distance, pitch: tuning.initialPitch, shoulder: tuning.shoulder,
  targetHeight: tuning.targetHeight, fov: tuning.fov,
};
const killProfile = { ...fightProfile, distance: tuning.distance * KILL_ZOOM };
const profileFields = ['distance', 'pitch', 'shoulder', 'targetHeight', 'fov'] as const;

/** Low walking and small fights rise into crowd framing through one profile blend. */
export class ShoulderCamera {
  yaw = 0;
  pitch = tuning.initialPitch;
  /** 1 for a small fight, 0 for walking. */
  fight = 0;
  /** Active lock-on target in world space. */
  lockTarget: Vector3 | null = null;
  /** Trauma level for camera shake, 0 to 1. */
  trauma = 0;
  /** Three or more nearby attackers need the high, wide profile. */
  crowd = false;
  private shakeTimer = 0;
  private closeUp = 0;
  private readonly framing = { ...tuning.world };
  private initialized = false;
  private distance = 0;
  private readonly anchor = new Vector3();
  /** Point the camera orbits, at the hero's shoulder height. */
  get target(): Vector3 { return this.anchor; }
  private readonly look = new Vector3();
  private readonly pivot = new Vector3();
  private readonly right = new Vector3();
  private readonly back = new Vector3();
  private readonly tempDir = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  private readonly probe = new RAPIER.Ball(tuning.collisionRadius);

  /** The round arena keeps the camera inside its wall; an open zone has no such limit. */
  constructor(readonly camera: PerspectiveCamera, private readonly world: RAPIER.World, private readonly bounded = true) {}

  /** Impulses camera trauma on heavy impact or receiving damage. */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Holds close framing even when the last foe drops and the stance ends. */
  killCloseUp(seconds = KILL_CLOSE_UP_SECONDS): void {
    this.closeUp = Math.max(this.closeUp, seconds);
  }

  orbit(dx: number, dy: number): void {
    this.yaw = Math.atan2(Math.sin(this.yaw - dx * tuning.mouseSensitivity),
      Math.cos(this.yaw - dx * tuning.mouseSensitivity));
    this.pitch = clamp(this.pitch + dy * tuning.mouseSensitivity, tuning.minPitch, tuning.maxPitch);
  }

  update(heroPosition: Vector3, delta: number, reducedMotion = false): void {
    const wasInitialized = this.initialized;
    const closeUp = this.closeUp > 0 && !reducedMotion;
    this.closeUp = reducedMotion ? 0 : Math.max(0, this.closeUp - delta);
    const stance = clamp(this.fight, 0, 1);
    const profile = closeUp ? killProfile : this.crowd ? tuning.crowd : null;
    const blend = 1 - Math.exp(-(closeUp ? 9 : 1 / tuning.blendSeconds) * delta);
    for (const field of profileFields) {
      const goal = profile ? profile[field] : lerp(tuning.world[field], fightProfile[field], stance);
      this.framing[field] = this.initialized ? lerp(this.framing[field], goal, blend) : goal;
    }
    this.initialized = true;
    const { fov, distance: targetDistance, shoulder, targetHeight } = this.framing;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    if (this.lockTarget) {
      const dx = this.lockTarget.x - heroPosition.x;
      const dz = this.lockTarget.z - heroPosition.z;
      const hDist = Math.hypot(dx, dz);
      const targetYaw = Math.atan2(-dx, -dz);
      const diffYaw = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      this.yaw += diffYaw * (1 - Math.exp(-6 * delta));

      const eyeY = heroPosition.y + targetHeight;
      const targetY = this.lockTarget.y + 1.2;
      const targetPitch = clamp(-Math.atan2(targetY - eyeY, Math.max(1.5, hDist)), tuning.minPitch, tuning.maxPitch);
      this.pitch += (targetPitch - this.pitch) * (1 - Math.exp(-6 * delta));
    }

    let shakeYaw = 0;
    let shakePitch = 0;
    if (this.trauma > 0 && !reducedMotion) {
      this.shakeTimer += delta * 24;
      const intensity = this.trauma * this.trauma;
      shakeYaw = Math.sin(this.shakeTimer * 1.3) * intensity * 0.035;
      shakePitch = Math.cos(this.shakeTimer * 1.7) * intensity * 0.025;
      this.trauma = Math.max(0, this.trauma - delta * 2.2);
    }

    const pitch = clamp(this.framing.pitch + this.pitch - tuning.initialPitch + shakePitch,
      tuning.minPitch, tuning.maxPitch);
    const yaw = this.yaw + shakeYaw;
    const radius = cameraCollisionRadius(this.camera);
    this.probe.radius = radius;
    const limit = balance.arena.size / 2 - radius - tuning.collisionPadding;

    const reach = Math.hypot(heroPosition.x, heroPosition.z);
    const pull = this.bounded && reach > limit ? limit / reach : 1;
    this.anchor.set(
      heroPosition.x * pull,
      Math.max(radius + tuning.collisionPadding, heroPosition.y + Math.min(tuning.world.targetHeight, targetHeight)),
      heroPosition.z * pull,
    );

    // Sweep upward from the low anchor so crowd framing cannot start inside an eave.
    const rise = Math.max(0, heroPosition.y + targetHeight - this.anchor.y);
    if (rise > 0) {
      this.tempDir.set(0, 1, 0);
      this.anchor.y += this.clearDistance(this.anchor, this.tempDir, rise);
    }
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    // Sweep the whole near-plane sphere sideways, including thin stall posts.
    let lateralOffset = this.clearDistance(this.anchor, this.right, shoulder);
    if (shoulder > 1e-3 && lateralOffset < shoulder * 0.5) {
      this.tempDir.copy(this.right).negate();
      const leftClear = this.clearDistance(this.anchor, this.tempDir, shoulder);
      if (leftClear >= shoulder * 0.8) lateralOffset = -leftClear;
    }

    this.pivot.copy(this.anchor).addScaledVector(this.right, lateralOffset);

    // Direction backward from pivot along view pitch and yaw
    const cos = Math.cos(pitch);
    this.back.set(
      Math.sin(yaw) * cos,
      Math.sin(pitch),
      Math.cos(yaw) * cos,
    );

    const maxSafeDist = this.clearDistance(this.pivot, this.back, targetDistance);

    // Never smooth inward or interpolate positions across a corner.
    this.distance = !wasInitialized || maxSafeDist < this.distance || reducedMotion ? maxSafeDist
      : this.distance + (maxSafeDist - this.distance) * (1 - Math.exp(-tuning.recoveryRate * delta));

    this.camera.position.copy(this.pivot)
      .addScaledVector(this.back, this.distance);
    const finalPitch = pitch;
    const finalCos = Math.cos(finalPitch);
    this.look.set(-Math.sin(yaw) * finalCos, -Math.sin(finalPitch), -Math.cos(yaw) * finalCos);
    this.camera.lookAt(this.look.add(this.camera.position));
  }

  private clearDistance(origin: Vector3, direction: Vector3, distance: number): number {
    if (distance <= 0) return 0;
    const radius = this.probe.radius;
    this.ray.origin = origin;
    this.ray.dir = direction;
    const rayHit = this.world.castRay(this.ray, distance + radius + tuning.collisionPadding,
      true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    let safe = rayHit ? Math.min(distance, Math.max(0,
      rayHit.timeOfImpact - radius - tuning.collisionPadding)) : distance;
    const shapeHit = this.world.castShape(origin, identity, direction, this.probe,
      0, safe, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    if (shapeHit) safe = Math.max(0, Math.min(safe, shapeHit.time_of_impact - tuning.collisionPadding));
    return safe;
  }
}
