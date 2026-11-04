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
      const targetYaw = Math.atan2(-dx, -dz);
      const diff = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      this.yaw += diff * (1 - Math.exp(-6 * delta));
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
    const distance = lerp(world.distance, tuning.distance * this.zoom, t);
    const shoulder = lerp(world.shoulder, tuning.shoulder, t);
    // The world view keeps its high angle but the mouse can still tilt it to look up at the skyline.
    const worldPitch = clamp(world.pitch + (this.pitch - tuning.initialPitch) * 0.8, 0.2, 1.1);
    const pitch = clamp(lerp(worldPitch, this.pitch, t) + shakePitch, tuning.minPitch, tuning.maxPitch);
    const yaw = this.yaw + shakeYaw;
    const radius = cameraCollisionRadius(this.camera);
    this.probe.radius = radius;
    const limit = balance.arena.size / 2 - radius - tuning.collisionPadding;
    // The hero can stand closer to a wall than a wide near plane can. Start the
    // sweep from safe interior space so a penetrating origin cannot miss a wall.
    const reach = Math.hypot(heroPosition.x, heroPosition.z);
    const pull = this.bounded && reach > limit ? limit / reach : 1;
    this.anchor.set(heroPosition.x * pull,
      Math.max(radius + tuning.collisionPadding, heroPosition.y + lerp(world.targetHeight, tuning.targetHeight, t)),
      heroPosition.z * pull);
    const cos = Math.cos(pitch);
    this.direction.set(
      Math.sin(yaw) * cos * distance + Math.cos(yaw) * shoulder,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * cos * distance - Math.sin(yaw) * shoulder,
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
    this.look.set(-Math.sin(yaw) * cos, -Math.sin(pitch), -Math.cos(yaw) * cos);
    this.camera.lookAt(this.look.add(this.camera.position));
  }
}
