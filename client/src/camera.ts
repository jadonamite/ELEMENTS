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

/** Fight-view distance scale for a killing blow, and how long the close-up holds. */
const KILL_ZOOM = 0.62;
const KILL_CLOSE_UP_SECONDS = 0.7;
/** Fight-view distance scale with three or more foes close. */
const CROWD_ZOOM = 1.4;

/**
 * Two views blended by the stance: a high, angled world view for walking the
 * world, and the close over-the-shoulder view for fights.
 */
export class ShoulderCamera {
  yaw = 0;
  pitch = tuning.initialPitch;
  /** 1 for the fight view, 0 for the world view; the camera eases toward it. */
  fight = 0;
  /** Active lock-on target in world space. */
  lockTarget: Vector3 | null = null;
  /** Trauma level for camera shake, 0 to 1. */
  trauma = 0;
  /** True while three or more foes are on the hero: the fight view pulls out wide. */
  crowd = false;
  private shakeTimer = 0;
  private closeUp = 0;
  private zoom = 1;
  private blend = 0;
  private distance = 0;
  private readonly anchor = new Vector3();
  /** Point the camera orbits, at the hero's shoulder height. */
  get target(): Vector3 { return this.anchor; }
  private readonly direction = new Vector3();
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

  /** A killing blow: the fight view leans in close for a moment, then eases back. */
  killCloseUp(seconds = KILL_CLOSE_UP_SECONDS): void {
    this.closeUp = Math.max(this.closeUp, seconds);
  }

  orbit(dx: number, dy: number): void {
    this.yaw = Math.atan2(Math.sin(this.yaw - dx * tuning.mouseSensitivity),
      Math.cos(this.yaw - dx * tuning.mouseSensitivity));
    this.pitch = clamp(this.pitch + dy * tuning.mouseSensitivity, tuning.minPitch, tuning.maxPitch);
  }

  update(heroPosition: Vector3, delta: number, reducedMotion = false): void {
    if (this.lockTarget) {
      const dx = this.lockTarget.x - heroPosition.x;
      const dz = this.lockTarget.z - heroPosition.z;
      const hDist = Math.hypot(dx, dz);
      const targetYaw = Math.atan2(-dx, -dz);
      const diffYaw = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      this.yaw += diffYaw * (1 - Math.exp(-6 * delta));

      const eyeY = heroPosition.y + lerp(tuning.world.targetHeight, tuning.targetHeight, this.blend);
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

    // A fixed-length eased change between the two views.
    const step = delta / tuning.blendSeconds;
    this.blend = reducedMotion ? this.fight
      : this.fight > this.blend ? Math.min(this.fight, this.blend + step) : Math.max(this.fight, this.blend - step);
    const world = tuning.world;
    const t = this.blend * this.blend * (3 - 2 * this.blend);
    const fov = lerp(world.fov, tuning.fov, t);
    if (Math.abs(this.camera.fov - fov) > 1e-3) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // Fight framing: close on a kill, wide in a crowd. Reduced motion skips the close-up.
    this.closeUp = Math.max(0, this.closeUp - delta);
    const framing = this.closeUp > 0 && !reducedMotion ? KILL_ZOOM : this.crowd ? CROWD_ZOOM : 1;
    this.zoom += (framing - this.zoom) * (1 - Math.exp(-(framing < this.zoom ? 9 : 3) * delta));
    const targetDistance = lerp(world.distance, tuning.distance * this.zoom, t);
    const shoulder = lerp(world.shoulder, tuning.shoulder, t);
    // The world view keeps its high angle but the mouse can still tilt it to look up at the skyline.
    const worldPitch = clamp(world.pitch + (this.pitch - tuning.initialPitch) * 0.8, 0.2, 1.1);
    const pitch = clamp(lerp(worldPitch, this.pitch, t) + shakePitch, tuning.minPitch, tuning.maxPitch);
    const yaw = this.yaw + shakeYaw;
    const radius = cameraCollisionRadius(this.camera);
    this.probe.radius = radius;
    const limit = balance.arena.size / 2 - radius - tuning.collisionPadding;

    const reach = Math.hypot(heroPosition.x, heroPosition.z);
    const pull = this.bounded && reach > limit ? limit / reach : 1;
    const targetHeight = lerp(world.targetHeight, tuning.targetHeight, t);
    this.anchor.set(
      heroPosition.x * pull,
      Math.max(radius + tuning.collisionPadding, heroPosition.y + targetHeight),
      heroPosition.z * pull,
    );

    // Lateral direction perpendicular to yaw
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    // When near side walls, adjust shoulder offset so the pivot does not penetrate.
    let lateralOffset = shoulder;
    if (shoulder > 1e-3) {
      this.ray.origin = this.anchor;
      this.ray.dir = this.right;
      const hitRight = this.world.castRay(this.ray, shoulder + radius + tuning.collisionPadding, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
      if (hitRight) {
        const rightClear = Math.max(0, hitRight.timeOfImpact - radius - tuning.collisionPadding);
        if (rightClear < shoulder * 0.5) {
          // Check left shoulder if right is tight
          this.tempDir.set(-this.right.x, 0, -this.right.z);
          this.ray.dir = this.tempDir;
          const hitLeft = this.world.castRay(this.ray, shoulder + radius + tuning.collisionPadding, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
          const leftClear = hitLeft ? Math.max(0, hitLeft.timeOfImpact - radius - tuning.collisionPadding) : shoulder;
          lateralOffset = leftClear >= shoulder * 0.8 ? -shoulder : rightClear;
        } else {
          lateralOffset = Math.min(shoulder, rightClear);
        }
      }
    }

    this.pivot.copy(this.anchor).addScaledVector(this.right, lateralOffset);

    // Direction backward from pivot along view pitch and yaw
    const cos = Math.cos(pitch);
    this.back.set(
      Math.sin(yaw) * cos,
      Math.sin(pitch),
      Math.cos(yaw) * cos,
    );

    // Find safe backward distance from pivot
    this.ray.origin = this.pivot;
    this.ray.dir = this.back;
    const hitRay = this.world.castRay(this.ray, targetDistance + radius + tuning.collisionPadding, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    let maxSafeDist = hitRay
      ? Math.max(0, hitRay.timeOfImpact - radius - tuning.collisionPadding)
      : targetDistance;

    const hitShape = this.world.castShape(this.pivot, identity, this.back, this.probe,
      0, maxSafeDist, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    if (hitShape && hitShape.time_of_impact > 1e-4) {
      maxSafeDist = Math.max(0, Math.min(maxSafeDist, hitShape.time_of_impact - tuning.collisionPadding));
    }

    // Never smooth inward or interpolate positions across a corner.
    this.distance = maxSafeDist < this.distance || reducedMotion ? maxSafeDist
      : this.distance + (maxSafeDist - this.distance) * (1 - Math.exp(-tuning.recoveryRate * delta));

    // In close fight quarters against a wall, gently elevate to preserve over-the-shoulder view
    let elevate = 0;
    let extraPitch = 0;
    if (t > 0.1 && this.distance < 1.4) {
      const tight = clamp((1.4 - this.distance) / 1.4, 0, 1);
      const desiredElevate = tight * 0.35 * t;
      this.tempDir.set(0, 1, 0);
      this.ray.origin = this.pivot;
      this.ray.dir = this.tempDir;
      const hitUp = this.world.castRay(this.ray, desiredElevate + radius + tuning.collisionPadding, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
      elevate = hitUp ? Math.max(0, hitUp.timeOfImpact - radius - tuning.collisionPadding) : desiredElevate;
      extraPitch = tight * 0.12 * t;
    }

    this.camera.position.copy(this.pivot)
      .addScaledVector(this.back, this.distance);
    this.camera.position.y += elevate;

    this.direction.copy(this.camera.position).sub(this.anchor);
    if (this.direction.lengthSq() > 1e-6) this.direction.normalize();

    const finalPitch = clamp(pitch + extraPitch, tuning.minPitch, tuning.maxPitch);
    const finalCos = Math.cos(finalPitch);
    this.look.set(-Math.sin(yaw) * finalCos, -Math.sin(finalPitch), -Math.cos(yaw) * finalCos);
    this.camera.lookAt(this.look.add(this.camera.position));
  }
}
