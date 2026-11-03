import type RAPIER from '@dimforge/rapier3d-compat';
import {
  type AnimationClip,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Vector3,
} from 'three';
import { BodyKit } from './body.js';
import { rollRandomCharacter, sanitizeCharacterConfig } from './creator/creator-types.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import balance from '../../shared/balance.json';
import type { Health } from '../../shared/src/index.js';
import { AnimationPlayer } from './anim/index.js';
import { HeroController } from './controller.js';
import { inFront } from './hits.js';
import { SWORD_WEAPON } from './weapon.js';

const tuning = balance.enemy;
/** Gravity multiplier while launched, so bodies arc up and drop instead of drifting. */
const AIR_GRAVITY = 2.4;
/** The flying-death clip has its own 0.87 s flight; played faster it lands with the physics. */
const FLIGHT_CLIP_SPEED = 1.8;
const { height, radius } = balance.controller;

type EnemyState = 'spawn' | 'chase' | 'circle' | 'attack' | 'cast' | 'stagger' | 'standing' | 'dead';

/**
 * How a villain fights. Brawlers use fists, the armed carry a sword or club, benders throw
 * fire from range. Husks are the shambling dead, kept for later in the game and not in waves.
 */
export type VillainKind = 'brawler' | 'armed' | 'bender' | 'husk';
type KindTuning = {
  attacks: string[]; attackDamage: number; attackRange: number; attackSpeed: number;
  attackHitFraction: number; attackCooldown: number; walkSpeed: number; runSpeed: number;
  clipSpeeds: { walk: number; run: number }; weapons?: string[];
  element?: string; cast?: string; castSpeed?: number; castHitFraction?: number; castRange?: number;
  castMin?: number; castDamage?: number; castCooldown?: number; boltSpeed?: number;
  keepDistance?: number;
};
const KINDS = tuning.kinds as Record<VillainKind, KindTuning>;

/** A fireball a bender has just thrown, for the fight to draw. */
export interface VillainCast { origin: Vector3; facing: number; element: string; damage: number; speed: number; range: number }

/** Shared model and clips; each enemy clones the rig and binds its own mixer. */
const VILLAIN_VARIANTS = 6;
export interface EnemyTemplate {
  variants: Array<{ model: Group; clips: AnimationClip[] }>;
  weapons: Record<string, Object3D>;
}

/** The husk set from enemy.glb, renamed so it never collides with the human clips. */
function huskClips(clips: AnimationClip[]): AnimationClip[] {
  return clips.map((clip) => {
    const copy = clip.clone();
    copy.name = `husk_${clip.name}`;
    return copy;
  });
}

/** A short wooden club with an iron band, in metres, for villains without a blade. */
function createClub(): Object3D {
  const group = new Group();
  const wood = new MeshStandardMaterial({ color: 0x3b2a1d, roughness: 0.9 });
  const iron = new MeshStandardMaterial({ color: 0x4a4744, roughness: 0.55, metalness: 0.7 });
  const shaft = new Mesh(new CylinderGeometry(0.045, 0.022, 0.72, 8), wood);
  shaft.position.y = 0.36;
  const band = new Mesh(new CylinderGeometry(0.05, 0.05, 0.06, 8), iron);
  band.position.y = 0.58;
  for (const mesh of [shaft, band]) { mesh.castShadow = true; group.add(mesh); }
  return group;
}

/** Villains are built from the creator's male and female bodies, each a rolled look in worn rags. */
export async function loadEnemyTemplate(loader = new GLTFLoader()): Promise<EnemyTemplate> {
  const [body, huskSet, mixamo, combat, unarmedA, unarmedB, sword] = await Promise.all([
    loader.loadAsync('/assets/characters/hero.glb'),
    loader.loadAsync('/assets/characters/enemy.glb'),
    loader.loadAsync('/assets/characters/mixamo.glb').catch(() => null),
    loader.loadAsync('/assets/characters/combat.glb'),
    loader.loadAsync('/assets/characters/unarmed_a.glb'),
    loader.loadAsync('/assets/characters/unarmed_b.glb'),
    loader.loadAsync(SWORD_WEAPON.assetPath).catch(() => null),
  ]);
  // Walking, hits and death come from the hero's own clips; mixamo adds flying death and standing recovery.
  const own = body.animations.filter(c => ['idle', 'walk', 'run', 'hit', 'death', 'cast'].includes(c.name));
  const clips = [
    ...own, ...combat.animations, ...unarmedA.animations, ...unarmedB.animations,
    ...huskClips(huskSet.animations), ...(mixamo?.animations ?? []),
  ];

  const kit = new BodyKit(loader);
  const variants: EnemyTemplate['variants'] = [];
  for (let i = 0; i < VILLAIN_VARIANTS; i++) {
    const config = rollRandomCharacter();
    if (i < 2) config.sex = i === 0 ? 'male' : 'female';
    if (config.hairStyleId === 'beard' && config.sex === 'female') config.hairStyleId = 'none';
    variants.push({
      model: await kit.build(sanitizeCharacterConfig(config), 'villain'),
      clips: await kit.fitClips(config.sex, clips, 'villain'),
    });
  }
  const swordMesh = sword?.scene.getObjectByName(SWORD_WEAPON.meshName ?? 'Sword') ?? null;
  const weapons: Record<string, Object3D> = { club: createClub() };
  if (swordMesh) weapons.sword = swordMesh;
  return { variants, weapons };
}

/** What an enemy needs to know about the hero each step. */
export interface Quarry { position: Vector3; alive: boolean }

export class Enemy {
  readonly model: Object3D;
  readonly anim: AnimationPlayer;
  readonly controller: HeroController;
  readonly kind: VillainKind;
  /** Primary element of this enemy for combat and counters. */
  get element(): string { return this.fit.element ?? 'IGNIS'; }
  health: Health;
  /** Damage of the strike that just landed, melee or thrown. */
  attackDamage = 0;
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
  private readonly knockbackVelocity = new Vector3();
  private isAirborne = false;
  private isKnockedDown = false;
  private readonly fit: KindTuning;
  private castCooldown = 0;
  private thrown: VillainCast | null = null;
  private slowScale = 1;
  private slowLeft = 0;

  constructor(template: EnemyTemplate, world: RAPIER.World, spawn: { x: number; z: number }, maxHealth: number, kind: VillainKind = 'brawler') {
    const variant = template.variants[Math.floor(Math.random() * template.variants.length)]!;
    this.kind = kind;
    this.fit = KINDS[kind];
    this.model = cloneSkinned(variant.model);
    // Each enemy owns its materials so a hit flash stays on the enemy that was hit.
    this.model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as MeshStandardMaterial;
      const material = source.clone();
      // clone() drops the skin shader hook, so carry it over.
      material.onBeforeCompile = source.onBeforeCompile;
      material.customProgramCacheKey = source.customProgramCacheKey;
      // Glow follows the cloth and skin texture, so a lit villain keeps its detail.
      material.emissiveMap = material.map;
      mesh.material = material;
      this.materials.push(material);
    });
    this.anim = new AnimationPlayer(this.model, variant.clips, { defaultFadeDuration: 0.2 });
    this.controller = new HeroController(world, spawn, { ...tuning, walkSpeed: this.fit.walkSpeed, runSpeed: this.fit.runSpeed });
    this.health = { current: maxHealth, maximum: maxHealth };
    this.controller.facing = Math.atan2(-spawn.x, -spawn.z);
    this.arm(template);
    // Husks climb out of the ground; people walk in ready.
    if (kind === 'husk') this.once('husk_spawn', 1);
    else { this.once('idle', 1); this.length = 0.5; }
  }

  /** Puts the villain's weapon in its right hand, using the hero's sword grip. */
  private arm(template: EnemyTemplate): void {
    const choices = (this.fit.weapons ?? []).filter(w => template.weapons[w]);
    if (!choices.length) return;
    const pick = choices[Math.floor(Math.random() * choices.length)]!;
    const hand = this.model.getObjectByName(SWORD_WEAPON.handBone);
    if (!hand) return;
    const holder = new Group();
    holder.position.set(...SWORD_WEAPON.handOffset);
    holder.rotation.set(...SWORD_WEAPON.handRotation);
    const weapon = template.weapons[pick]!.clone();
    if (pick === 'sword') holder.scale.setScalar(SWORD_WEAPON.handScale);
    weapon.traverse(n => { if ((n as Mesh).isMesh) (n as Mesh).castShadow = true; });
    holder.add(weapon);
    hand.add(holder);
  }

  /**
   * Effects from the hero's moves: a slow (the strongest one wins while two overlap), a stun or
   * parry that cancels any wind-up and holds a stagger, and a shove added to the knockback.
   */
  afflict(effect: { slowScale?: number; slowSeconds?: number; stunSeconds?: number; shove?: Vector3; launch?: boolean; parried?: boolean }): void {
    if (!this.alive) return;
    if (effect.slowScale !== undefined && effect.slowSeconds) {
      if (this.slowLeft <= 0 || effect.slowScale < this.slowScale) this.slowScale = effect.slowScale;
      this.slowLeft = Math.max(this.slowLeft, effect.slowSeconds);
    }
    if (effect.shove) {
      this.knockbackVelocity.add(effect.shove);
      if (effect.launch) { this.isAirborne = true; this.isKnockedDown = true; }
    }
    const stun = effect.stunSeconds ?? (effect.parried ? 0.8 : 0);
    if (stun > 0) {
      // A parry or stun cancels the swing or cast before it lands; the cooldown is left as it was.
      this.struck = true;
      this.state = 'stagger';
      const clip = stun >= 0.6 && this.anim.hasClip('stagger_big') ? 'stagger_big' : this.anim.hasClip('hit_react') ? 'hit_react' : 'hit';
      this.anim.playOnce(clip, 0.1);
      this.timer = 0;
      this.length = stun;
    }
  }

  /** The fireball thrown this step, if any; the fight draws it once. */
  takeCast(): VillainCast | null {
    const cast = this.thrown;
    this.thrown = null;
    return cast;
  }

  get alive(): boolean { return this.state !== 'dead'; }
  /** Spawning villains (husks still climbing out) can't be hit yet. */
  get hittable(): boolean { return this.state !== 'dead' && this.state !== 'spawn'; }
  get attacking(): boolean { return this.state === 'attack' || this.state === 'cast'; }
  /** Seconds since death, for sinking and removal. */
  get deadFor(): number { return this.state === 'dead' ? this.timer : 0; }

  /**
   * One physics step. `mayAttack` is the director's permission, so only one
   * villain swings or casts at a time. Returns true on the step its melee swing lands; casts are taken with takeCast().
   */
  step(quarry: Quarry, mayAttack: boolean): boolean {
    const dt = balance.controller.fixedStep;
    this.timer += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.castCooldown = Math.max(0, this.castCooldown - dt);
    this.slowLeft = Math.max(0, this.slowLeft - dt);
    const here = this.controller.position;
    const toHero = new Vector3().subVectors(quarry.position, here).setY(0);
    const distance = toHero.length();
    const towardHero = Math.atan2(toHero.x, toHero.z);
    let move = { forward: 0, right: 0, running: false };
    let yaw = 0;
    let lunge = 0;
    let landed = false;

    // Apply knockback / flying physics impulse
    let impulse: Vector3 | undefined = undefined;
    if (this.knockbackVelocity.lengthSq() > 0.01) {
      impulse = this.knockbackVelocity.clone();

      // Vertical gravity when airborne
      if (this.isAirborne) {
        this.knockbackVelocity.y -= balance.controller.gravity * AIR_GRAVITY * dt;
        if (here.y <= height / 2 + 0.05 && this.knockbackVelocity.y < 0) {
          this.knockbackVelocity.y = 0;
          this.isAirborne = false;
          // If the enemy survived being launched airborne, recover with the standing get-up animation
          if (this.alive && this.isKnockedDown && this.anim.hasClip('standing')) {
            this.isKnockedDown = false;
            this.state = 'standing';
            this.timer = 0;
            const standSpeed = 1.75;
            this.length = this.anim.duration('standing') / standSpeed;
            this.anim.playOnce('standing', 0.12);
            this.anim.setSpeed('standing', standSpeed);
          }
        }
      }

      // Horizontal friction decay
      const friction = this.isAirborne ? 0.95 : 0.80;
      const decay = Math.pow(friction, dt * 60);
      this.knockbackVelocity.x *= decay;
      this.knockbackVelocity.z *= decay;
    }

    switch (this.state) {
      case 'spawn':
      case 'stagger':
      case 'standing':
        if (this.timer >= this.length) this.state = 'chase';
        break;
      case 'chase':
      case 'circle': {
        if (!quarry.alive) break;
        const fit = this.fit;
        const close = distance <= fit.attackRange;
        if (close && mayAttack && this.cooldown === 0) {
          this.state = 'attack';
          this.struck = false;
          this.attackDamage = fit.attackDamage;
          this.once(fit.attacks[Math.floor(Math.random() * fit.attacks.length)]!, fit.attackSpeed);
          break;
        }
        // Benders throw from range when it's their turn.
        const castable = fit.cast !== undefined && distance >= (fit.castMin ?? 0) && distance <= (fit.castRange ?? 0);
        if (castable && mayAttack && this.castCooldown === 0) {
          this.state = 'cast';
          this.struck = false;
          this.controller.facing = towardHero;
          this.once(fit.cast!, fit.castSpeed ?? 1);
          break;
        }
        // Waiting villains hold a ring around the hero instead of crowding in; benders hold further out.
        const circleAt = fit.keepDistance ?? tuning.circleRadius;
        this.state = fit.keepDistance !== undefined
          ? (distance <= circleAt + 1 ? 'circle' : 'chase')
          : (distance <= circleAt && !mayAttack ? 'circle' : 'chase');
        // movementVelocity walks toward -yaw's forward, so yaw is the bearing turned around.
        yaw = Math.atan2(-toHero.x, -toHero.z);
        if (this.state === 'circle') {
          move = { forward: distance < circleAt - 0.6 ? -0.5 : 0, right: this.orbit * tuning.circleSpeed, running: false };
        } else if (!close) {
          move = { forward: 1, right: 0, running: distance > circleAt + 1.5 };
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
        if (!this.struck && progress >= this.fit.attackHitFraction) {
          this.struck = true;
          landed = quarry.alive && distance <= this.fit.attackRange + radius &&
            inFront(here, this.controller.facing, quarry.position, tuning.attackAngle);
        }
        if (this.timer >= this.length) { this.state = 'chase'; this.cooldown = this.fit.attackCooldown; }
        break;
      }
      case 'cast': {
        const fit = this.fit;
        const progress = this.timer / this.length;
        if (progress < (fit.castHitFraction ?? 0.5)) this.controller.facing = towardHero;
        else if (!this.struck) {
          this.struck = true;
          // The fight flies it as a real projectile; moving off its line dodges it, a wall stops it.
          this.thrown = { origin: here.clone(), facing: this.controller.facing, element: fit.element ?? 'IGNIS',
            damage: fit.castDamage ?? 14, speed: fit.boltSpeed ?? 14, range: (fit.castRange ?? 12) + 2 };
        }
        if (this.timer >= this.length) { this.state = 'chase'; this.castCooldown = fit.castCooldown ?? 3; this.cooldown = fit.attackCooldown; }
        break;
      }
      case 'dead':
        if (impulse) {
          this.controller.step({ forward: 0, right: 0, running: false }, 0, 0, 1.0, impulse);
        }
        return false;
    }
    this.controller.step(move, yaw, lunge, this.slowLeft > 0 ? this.slowScale : 1.0, impulse);
    // Face the hero while circling rather than the strafe direction.
    if (this.state === 'circle') this.controller.facing = towardHero;
    return landed;
  }

  /**
   * Take a hit already accepted by the rules.
   * Plays stagger or flying knockback depending on attack weight. Returns true if it killed.
   */
  hurt(health: Health, moveId = 'light_1', attackerPos?: Vector3, isLit = false): boolean {
    const here = this.controller.position;
    const dir = new Vector3();
    if (attackerPos) {
      dir.subVectors(here, attackerPos).setY(0);
      if (dir.lengthSq() < 1e-4) {
        dir.set(-Math.sin(this.controller.facing), 0, -Math.cos(this.controller.facing));
      } else {
        dir.normalize();
      }
    } else {
      dir.set(-Math.sin(this.controller.facing), 0, -Math.cos(this.controller.facing));
    }

    // Determine impact intensity based on move weight
    const isUppercut = moveId === 'uppercut';
    const isGroundPound = moveId === 'ground_pound';
    const isDash = moveId === 'dash_strike' || moveId === 'dash';
    const isHeavy = moveId.startsWith('heavy') || moveId === 'light_3' || isUppercut || isGroundPound || isDash;

    let hSpeed = 3.2;
    let vSpeed = 0;
    let isFlying = false;
    const hasFlyingDeath = this.anim.hasClip('death_flying');
    const hasHitReact = this.anim.hasClip('hit_react');
    let clip = hasHitReact ? 'hit_react' : 'hit';
    let animSpeed = 1.35;

    if (isUppercut) {
      // Uppercut: launches the villain flying straight up into the air
      hSpeed = isLit ? 4.5 : 3.0;
      vSpeed = isLit ? 5.5 : 4.5;
      isFlying = true;
      clip = hasFlyingDeath ? 'death_flying' : 'stagger_big';
      animSpeed = hasFlyingDeath ? FLIGHT_CLIP_SPEED : 1.0;
    } else if (isGroundPound) {
      // Ground slam: blasts the villain flying backward and upward
      hSpeed = isLit ? 9.0 : 7.0;
      vSpeed = isLit ? 4.0 : 3.0;
      isFlying = true;
      clip = hasFlyingDeath ? 'death_flying' : 'stagger_big';
      animSpeed = hasFlyingDeath ? FLIGHT_CLIP_SPEED : 1.0;
    } else if (isDash) {
      // Dash strike: sends the villain flying backward
      hSpeed = isLit ? 11.0 : 8.5;
      vSpeed = isLit ? 3.5 : 2.0;
      isFlying = true;
      clip = hasFlyingDeath ? 'death_flying' : 'stagger_big';
      animSpeed = hasFlyingDeath ? FLIGHT_CLIP_SPEED : 1.1;
    } else if (isHeavy) {
      // Heavy attack: big knockback stagger reeling backward
      hSpeed = isLit ? 7.5 : 5.5;
      vSpeed = isLit ? 2.0 : 0.8;
      isFlying = isLit;
      clip = isLit && hasFlyingDeath ? 'death_flying' : 'stagger_big';
      animSpeed = clip === 'death_flying' ? FLIGHT_CLIP_SPEED : 1.15;
    } else {
      // Light attack: crisp responsive stagger flinch
      hSpeed = isLit ? 4.0 : 2.8;
      vSpeed = 0;
      clip = hasHitReact ? 'hit_react' : 'hit';
      animSpeed = 1.4;
    }

    if (health.current <= 0) {
      // Fatal blow: heavy attacks or abilities launch corpse flying
      if (isHeavy || isFlying) {
        hSpeed *= 1.25;
        vSpeed = Math.max(vSpeed, 2.5);
        isFlying = true;
      }
    }

    this.knockbackVelocity.set(dir.x * hSpeed, vSpeed, dir.z * hSpeed);
    this.isAirborne = isFlying || vSpeed > 0;
    this.isKnockedDown = isFlying;

    // Face the attacker on impact
    if (attackerPos) {
      const toAttacker = new Vector3().subVectors(attackerPos, here).setY(0);
      if (toAttacker.lengthSq() > 1e-4) {
        this.controller.facing = Math.atan2(toAttacker.x, toAttacker.z);
      }
    }

    this.health = health;
    this.flash = 0.08;

    if (health.current > 0) {
      this.state = 'stagger';
      this.once(clip, animSpeed);
      return false;
    }

    this.state = 'dead';
    this.timer = 0;
    const deathClip = hasFlyingDeath && (isHeavy || isFlying || Math.random() < 0.65)
      ? 'death_flying'
      : 'death';
    this.anim.playOnce(deathClip, 0.12);
    if (deathClip === 'death_flying') this.anim.setSpeed(deathClip, FLIGHT_CLIP_SPEED);
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
      const gait = speed < balance.controller.idleSpeedThreshold ? 'idle' : speed < this.fit.runSpeed - 0.5 ? 'walk' : 'run';
      const clip = this.kind === 'husk' ? `husk_${gait}` : gait;
      this.anim.play(clip, 0.25);
      if (gait !== 'idle') this.anim.setSpeed(clip, Math.max(0.5, speed / this.fit.clipSpeeds[gait]));
    }
    this.model.position.copy(position);
    this.model.rotation.y = this.controller.facing;
    this.flash = Math.max(0, this.flash - delta);
    const isTelegraphing = (this.state === 'attack' || this.state === 'cast') && this.timer < this.length * 0.55;
    // People give a faint warning; husks and benders gathering fire glow hotter.
    const warmth = this.kind === 'husk' || this.state === 'cast' ? 0.7 : 0.22;

    for (const material of this.materials) {
      if (this.flash > 0) {
        material.emissive.setRGB(1.0, 0.9, 0.8);
        material.emissiveIntensity = (this.flash / 0.08) * 1.2;
      } else if (isTelegraphing) {
        // A pulsing ember warmth over the whole body warns of the swing.
        const pulse = 1.0 + Math.sin(this.timer * 20) * 0.25;
        material.emissive.setRGB(1.0, 0.25, 0.02);
        material.emissiveIntensity = warmth * pulse;
      } else {
        // Complete silence/darkness at rest: no glow
        material.emissive.setRGB(0, 0, 0);
        material.emissiveIntensity = 0;
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
