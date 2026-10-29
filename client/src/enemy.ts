import type RAPIER from '@dimforge/rapier3d-compat';
import { type AnimationClip, Color, type Group, type Mesh, MeshStandardMaterial, type Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import balance from '../../shared/balance.json';
import type { Health } from '../../shared/src/index.js';
import { AnimationPlayer } from './anim/index.js';
import { HeroController } from './controller.js';
import { inFront } from './hits.js';

const tuning = balance.enemy;
const { height, radius } = balance.controller;

type EnemyState = 'spawn' | 'chase' | 'circle' | 'attack' | 'stagger' | 'dead';

/** Shared model and clips; each enemy clones the rig and binds its own mixer. */
export interface EnemyTemplate { model: Group; clips: AnimationClip[] }

/** Husks share the hero's rig, dressed in charred black ash and scorched hide with smoldering ember seams. */
export async function loadEnemyTemplate(loader = new GLTFLoader()): Promise<EnemyTemplate> {
  const [body, moves] = await Promise.all([
    loader.loadAsync('/assets/characters/hero.glb'),
    loader.loadAsync('/assets/characters/enemy.glb'),
  ]);
  const ash = new MeshStandardMaterial({
    color: new Color(0x1c1815),
    roughness: 0.92,
    metalness: 0.1,
    emissive: new Color(0x300800),
    emissiveIntensity: 0.7,
  });
  const hide = new MeshStandardMaterial({
    color: new Color(0x0e0c0a),
    roughness: 0.96,
    metalness: 0.05,
    emissive: new Color(0x180300),
    emissiveIntensity: 0.5,
  });
  body.scene.traverse((node) => {
    if (!(node as Mesh).isMesh) return;
    const mesh = node as Mesh;
    const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? '';
    mesh.material = name.includes('Joints') ? hide : ash;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  // Hit and death come from the hero's own clips; everything else is the husk set.
  const reactions = body.animations.filter(c => c.name === 'hit' || c.name === 'death');
  return { model: body.scene, clips: [...moves.animations, ...reactions] };
}

/** What an enemy needs to know about the hero each step. */
export interface Quarry { position: Vector3; alive: boolean }

export class Enemy {
  readonly model: Object3D;
  readonly anim: AnimationPlayer;
  readonly controller: HeroController;
  health: Health;
  state: EnemyState = 'spawn';
  /** The last hero swing that struck this enemy, so one swing lands once. */
  lastSwing = -1;
  /** Seconds left on the white hit flash. */
  flash = 0;
  private timer = 0;
  private length = 0;
  private struck = false;
  private cooldown = 0;
  private orbit = Math.random() < 0.5 ? 1 : -1;
  private readonly materials: MeshStandardMaterial[] = [];

  constructor(template: EnemyTemplate, world: RAPIER.World, spawn: { x: number; z: number }, maxHealth: number) {
    this.model = cloneSkinned(template.model);
    // Each enemy owns its materials so a hit flash stays on the enemy that was hit.
    this.model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const material = (mesh.material as MeshStandardMaterial).clone();
      mesh.material = material;
      this.materials.push(material);
    });
    this.anim = new AnimationPlayer(this.model, template.clips, { defaultFadeDuration: 0.2 });
    this.controller = new HeroController(world, spawn, tuning);
    this.health = { current: maxHealth, maximum: maxHealth };
    this.controller.facing = Math.atan2(-spawn.x, -spawn.z);
    this.once('spawn', 1);
  }

  get alive(): boolean { return this.state !== 'dead'; }
  /** Spawning husks are still climbing out and can't be hit yet. */
  get hittable(): boolean { return this.state !== 'dead' && this.state !== 'spawn'; }
  get attacking(): boolean { return this.state === 'attack'; }
  /** Seconds since death, for sinking and removal. */
  get deadFor(): number { return this.state === 'dead' ? this.timer : 0; }

  /**
   * One physics step. `mayAttack` is the director's permission, so only one
   * husk swings at a time. Returns true on the step its attack lands on the hero.
   */
  step(quarry: Quarry, mayAttack: boolean): boolean {
    const dt = balance.controller.fixedStep;
    this.timer += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const here = this.controller.position;
    const toHero = new Vector3().subVectors(quarry.position, here).setY(0);
    const distance = toHero.length();
    const towardHero = Math.atan2(toHero.x, toHero.z);
    let move = { forward: 0, right: 0, running: false };
    let yaw = 0;
    let lunge = 0;
    let landed = false;

    switch (this.state) {
      case 'spawn':
      case 'stagger':
        if (this.timer >= this.length) this.state = 'chase';
        break;
      case 'chase':
      case 'circle': {
        if (!quarry.alive) break;
        const close = distance <= tuning.attackRange;
        if (close && mayAttack && this.cooldown === 0) {
          this.state = 'attack';
          this.struck = false;
          this.once('attack', tuning.attackSpeed);
          break;
        }
        // Waiting husks hold a ring around the hero instead of crowding in.
        this.state = distance <= tuning.circleRadius && !mayAttack ? 'circle' : 'chase';
        // movementVelocity walks toward -yaw's forward, so yaw is the bearing turned around.
        yaw = Math.atan2(-toHero.x, -toHero.z);
        if (this.state === 'circle') {
          move = { forward: distance < tuning.circleRadius - 0.6 ? -0.5 : 0, right: this.orbit * tuning.circleSpeed, running: false };
        } else if (!close) {
          move = { forward: 1, right: 0, running: distance > tuning.circleRadius + 1.5 };
        }
        break;
      }
      case 'attack': {
        const progress = this.timer / this.length;
        // Track the hero while winding up, then commit to the swing.
        if (progress < tuning.attackTrackFraction) {
          this.controller.facing = towardHero;
          // Close the gap to sword range, never into the hero's body.
          if (distance > tuning.attackStandOff) lunge = tuning.attackLunge;
        }
        if (!this.struck && progress >= tuning.attackHitFraction) {
          this.struck = true;
          landed = quarry.alive && distance <= tuning.attackRange + radius &&
            inFront(here, this.controller.facing, quarry.position, tuning.attackAngle);
        }
        if (this.timer >= this.length) { this.state = 'chase'; this.cooldown = tuning.attackCooldown; }
        break;
      }
      case 'dead':
        return false;
    }
    this.controller.step(move, yaw, lunge);
    // Face the hero while circling rather than the strafe direction.
    if (this.state === 'circle') this.controller.facing = towardHero;
    return landed;
  }

  /** Take a hit already accepted by the rules. Returns true if it killed. */
  hurt(health: Health): boolean {
    this.health = health;
    this.flash = 0.12;
    if (health.current > 0) {
      this.state = 'stagger';
      this.once('hit', tuning.staggerSpeed);
      return false;
    }
    this.state = 'dead';
    this.timer = 0;
    this.anim.playOnce('death', 0.1);
    // The body stops blocking the hero as soon as it falls.
    this.controller.collider.setEnabled(false);
    return true;
  }

  /** Per drawn frame: animation, position between physics steps, flash and sinking. */
  draw(delta: number, alpha: number): void {
    const position = new Vector3().lerpVectors(this.controller.previous, this.controller.position, alpha);
    if (this.state === 'dead') {
      this.timer += delta;
      const sinking = this.timer - tuning.corpseSeconds;
      if (sinking > 0) position.y -= (sinking / tuning.sinkSeconds) * height * 0.6;
    } else if (this.state === 'chase' || this.state === 'circle') {
      const speed = this.controller.speed;
      const clip = speed < balance.controller.idleSpeedThreshold ? 'idle' : speed < tuning.runSpeed - 0.5 ? 'walk' : 'run';
      this.anim.play(clip, 0.25);
      if (clip !== 'idle') this.anim.setSpeed(clip, Math.max(0.5, speed / tuning.clipSpeeds[clip]));
    }
    this.model.position.copy(position);
    this.model.rotation.y = this.controller.facing;
    this.flash = Math.max(0, this.flash - delta);
    const isTelegraphing = this.state === 'attack' && this.timer < this.length * 0.55;
    for (const material of this.materials) {
      if (this.flash > 0) {
        material.emissive.setRGB(1, 1, 1);
        material.emissiveIntensity = (this.flash / 0.12) * 1.5;
      } else if (isTelegraphing) {
        material.emissive.setRGB(1.0, 0.2, 0.02);
        material.emissiveIntensity = 2.4;
      } else {
        material.emissive.setRGB(0.24, 0.05, 0.0);
        material.emissiveIntensity = 0.6;
      }
    }
    this.anim.update(delta);
  }

  get gone(): boolean { return this.state === 'dead' && this.timer > tuning.corpseSeconds + tuning.sinkSeconds; }

  dispose(): void {
    this.anim.dispose();
    this.controller.dispose();
    for (const material of this.materials) material.dispose();
    this.model.removeFromParent();
  }

  private once(clip: string, speed: number): void {
    this.timer = 0;
    this.length = this.anim.duration(clip) / speed;
    this.anim.playOnce(clip, 0.12);
    this.anim.setSpeed(clip, speed);
  }

  /** The capsule the hero's blade is tested against. */
  get body(): { feet: Vector3; height: number; radius: number } {
    return { feet: this.controller.position, height, radius: radius + 0.08 };
  }
}
