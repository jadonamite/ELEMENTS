import type RAPIER from '@dimforge/rapier3d-compat';
import {
  type AnimationClip,
  Group,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import balance from '../../../shared/balance.json';
import { AnimationPlayer } from '../anim/index.js';
import { HeroController, type MoveInput } from '../controller.js';

const houndTuning = balance.monsters.emberHound;

export type HoundState =
  | 'idle'
  | 'wander'
  | 'notice'
  | 'stalk'
  | 'charge'
  | 'bite'
  | 'recoil'
  | 'death';

export interface HoundPose {
  position: { x: number; y: number; z: number };
  facing: number;
  napePosition: { x: number; y: number; z: number };
}

export interface HoundDamageResult {
  damage: number;
  isWeakSpot: boolean;
  stagger: boolean;
  staggerDuration: number;
}

export interface HoundDrop {
  id: string;
  name: string;
  count: number;
}

export interface HoundQuarry {
  position: Vector3;
  alive: boolean;
  takeHit?: (damage: number, origin: Vector3) => void;
}

export interface HoundTemplate {
  model: Group;
  clips: AnimationClip[];
}

/**
 * Pure function: calculates damage against an ember hound.
 * A hit whose point lands within 0.35 m of the nape bone, or from behind within 60 degrees
 * of the hound's back, does 2x damage and staggers it.
 * Hounds take 0.5x from IGNIS fire and 1.5x from AQUES water.
 */
export function houndDamage(
  base: number,
  hitPoint: { x: number; y: number; z: number },
  houndPose: HoundPose,
  options?: { element?: string | undefined }
): HoundDamageResult {
  const radius = houndTuning.weakSpotRadius ?? 0.35;
  const dxNape = hitPoint.x - houndPose.napePosition.x;
  const dyNape = hitPoint.y - houndPose.napePosition.y;
  const dzNape = hitPoint.z - houndPose.napePosition.z;
  const distToNape = Math.hypot(dxNape, dyNape, dzNape);
  const isNapeHit = distToNape <= radius;

  // Behind hit check: within 60 degrees of the hound's back direction (+Z forward, back is +PI)
  const dxBack = hitPoint.x - houndPose.position.x;
  const dzBack = hitPoint.z - houndPose.position.z;
  const hitHeading = Math.atan2(dxBack, dzBack);
  const backHeading = houndPose.facing + Math.PI;
  const angleDiff = Math.abs(Math.atan2(Math.sin(hitHeading - backHeading), Math.cos(hitHeading - backHeading)));
  const maxBackAngle = ((houndTuning.weakSpotAngleDeg ?? 60) * Math.PI) / 180;
  const isBackHit = angleDiff <= maxBackAngle;

  const isWeakSpot = isNapeHit || isBackHit;
  let mult = isWeakSpot ? (houndTuning.weakSpotMultiplier ?? 2.0) : 1.0;

  if (options?.element === 'IGNIS' || options?.element === 'fire') {
    mult *= (houndTuning.fireResistance ?? 0.5);
  } else if (options?.element === 'AQUES' || options?.element === 'water') {
    mult *= (houndTuning.waterVulnerability ?? 1.5);
  }

  const damage = Math.round(base * mult);
  const stagger = isWeakSpot;
  const staggerDuration = isWeakSpot
    ? (houndTuning.weakSpotStaggerDuration ?? 1.5)
    : (houndTuning.staggerDuration ?? 0.8);

  return { damage, isWeakSpot, stagger, staggerDuration };
}

/**
 * Pure function: rolls drops upon an ember hound's death.
 */
export function rollHoundDrops(rand: () => number = Math.random): HoundDrop[] {
  const drops: HoundDrop[] = [];
  for (const dropDef of houndTuning.drops) {
    if (rand() <= dropDef.chance) {
      const min = dropDef.min ?? 1;
      const max = dropDef.max ?? 1;
      const count = min + Math.floor(rand() * (max - min + 1));
      drops.push({
        id: dropDef.id,
        name: dropDef.name,
        count,
      });
    }
  }
  return drops;
}

/**
 * Loads the rigged Ember Hound GLB template.
 */
export async function loadHoundTemplate(
  loader = new GLTFLoader(),
  renderer?: import('three').WebGLRenderer,
  ktx2TranscoderPath = '/assets/env/ignis/basis/'
): Promise<HoundTemplate> {
  loader.setMeshoptDecoder(MeshoptDecoder);

  if (typeof window !== 'undefined' && renderer) {
    try {
      const ktx2Loader = new KTX2Loader();
      ktx2Loader.setTranscoderPath(ktx2TranscoderPath);
      ktx2Loader.detectSupport(renderer);
      loader.setKTX2Loader(ktx2Loader);
    } catch {
      // Fallback if KTX2 transcoder fails or support detection isn't initialized yet
    }
  }

  const gltf = await loader.loadAsync('/assets/monsters/ember_hound.glb');
  return {
    model: gltf.scene,
    clips: gltf.animations,
  };
}

export class EmberHound {
  readonly model: Group;
  readonly anim: AnimationPlayer;
  readonly controller: HeroController;
  readonly materials: MeshStandardMaterial[] = [];
  private napeBone: Object3D | null = null;

  health = houndTuning.health;
  maxHealth = houndTuning.health;
  state: HoundState = 'idle';
  private timer = 0;
  private stateDuration = 0;
  private cooldown = 0;
  private flankOffsetAngle = 0;
  private dropsAwarded: HoundDrop[] | null = null;
  private attackHit = false;

  constructor(
    template: HoundTemplate,
    world: RAPIER.World,
    spawn = { x: 0, z: 0 },
    bounded = true
  ) {
    this.model = cloneSkinned(template.model) as Group;
    this.model.scale.setScalar(0.48);

    this.model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const srcMat = mesh.material as MeshStandardMaterial;
      if (srcMat) {
        const mat = srcMat.clone();
        mesh.material = mat;
        this.materials.push(mat);
      }
    });

    this.model.traverse((obj) => {
      if (obj.name === 'Neck2' || obj.name === 'Neck3') {
        this.napeBone = obj;
      }
    });

    this.anim = new AnimationPlayer(this.model, template.clips, { defaultFadeDuration: 0.2 });
    this.controller = new HeroController(
      world,
      spawn,
      { walkSpeed: houndTuning.speeds.walk, runSpeed: houndTuning.speeds.run },
      bounded
    );
    this.controller.facing = Math.atan2(-spawn.x, -spawn.z);
    this.anim.play('idle', 0.1);
  }

  get alive(): boolean {
    return this.state !== 'death';
  }

  get drops(): HoundDrop[] | null {
    return this.dropsAwarded;
  }

  get position(): Vector3 {
    return this.controller.position;
  }

  get facing(): number {
    return this.controller.facing;
  }

  set facing(yaw: number) {
    this.controller.facing = yaw;
  }

  get napePosition(): Vector3 {
    if (this.napeBone) {
      const v = new Vector3();
      this.napeBone.getWorldPosition(v);
      return v;
    }
    const forward = new Vector3(Math.sin(this.controller.facing), 0, Math.cos(this.controller.facing));
    return new Vector3()
      .copy(this.controller.position)
      .addScaledVector(forward, 0.4)
      .setY(this.controller.position.y + 0.95);
  }

  getPose(): HoundPose {
    const nape = this.napePosition;
    return {
      position: { x: this.controller.position.x, y: this.controller.position.y, z: this.controller.position.z },
      facing: this.controller.facing,
      napePosition: { x: nape.x, y: nape.y, z: nape.z },
    };
  }

  setFlankAngle(rad: number): void {
    this.flankOffsetAngle = rad;
  }

  /**
   * Applies damage to this hound.
   * If point lands on the nape or from behind, deals 2x damage and staggers.
   */
  hit(amount: number, hitPoint: Vector3, origin: Vector3, element?: string): HoundDamageResult {
    if (!this.alive) {
      return { damage: 0, isWeakSpot: false, stagger: false, staggerDuration: 0 };
    }

    const result = houndDamage(amount, hitPoint, this.getPose(), { element });
    this.health = Math.max(0, this.health - result.damage);

    // Hit flash on materials
    for (const mat of this.materials) {
      if (mat.emissive) {
        mat.emissive.setHex(result.isWeakSpot ? 0xffea00 : 0xff3300);
      }
    }
    setTimeout(() => {
      for (const mat of this.materials) {
        if (mat.emissive) {
          mat.emissive.setHex(0x000000);
        }
      }
    }, 120);

    if (this.health <= 0) {
      this.die();
    } else if (result.stagger || this.state === 'charge' || this.state === 'bite') {
      this.state = 'recoil';
      this.timer = 0;
      this.stateDuration = result.staggerDuration;
      this.anim.play('hit', 0.1);
    }

    return result;
  }

  die(customDrops?: HoundDrop[]): void {
    this.state = 'death';
    this.timer = 0;
    this.anim.play('death', 0.15, false);
    this.dropsAwarded = customDrops ?? rollHoundDrops();
  }

  triggerNotice(): void {
    if (this.state === 'idle' || this.state === 'wander') {
      this.state = 'notice';
      this.timer = 0;
      this.stateDuration = 1.3;
      this.anim.play('notice', 0.2);
    }
  }

  triggerCharge(): boolean {
    if (this.state === 'stalk' && this.cooldown <= 0) {
      this.state = 'charge';
      this.timer = 0;
      this.stateDuration = houndTuning.chargeDistance / houndTuning.speeds.charge;
      this.anim.play('run', 0.15);
      return true;
    }
    return false;
  }

  /**
   * Updates state, animation, and physics navigation.
   */
  update(dt: number, quarry: HoundQuarry): void {
    this.timer += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (!this.alive) {
      this.anim.update(dt);
      return;
    }

    const toQuarry = new Vector3().subVectors(quarry.position, this.controller.position);
    const distToQuarry = toQuarry.length();
    toQuarry.y = 0;

    let moveInput: MoveInput = { forward: 0, right: 0, running: false };
    let moveYaw = this.controller.facing;
    let lungeSpeed = 0;

    switch (this.state) {
      case 'idle':
      case 'wander': {
        if (quarry.alive && distToQuarry <= houndTuning.noticeRange) {
          this.triggerNotice();
        } else {
          this.anim.play('idle', 0.2);
        }
        break;
      }

      case 'notice': {
        if (distToQuarry > 0.001) {
          this.controller.facing = Math.atan2(toQuarry.x, toQuarry.z);
        }
        if (this.timer >= this.stateDuration) {
          this.state = 'stalk';
          this.timer = 0;
          this.anim.play('walk', 0.2);
        }
        break;
      }

      case 'stalk': {
        this.anim.play('walk', 0.2);
        if (!quarry.alive) {
          this.state = 'idle';
          break;
        }

        const targetHeading = Math.atan2(toQuarry.x, toQuarry.z) + Math.PI + this.flankOffsetAngle;
        const targetRadius = (houndTuning.stalkDistanceMin + houndTuning.stalkDistanceMax) * 0.5;
        const desiredX = quarry.position.x + Math.sin(targetHeading) * targetRadius;
        const desiredZ = quarry.position.z + Math.cos(targetHeading) * targetRadius;

        const moveVec = new Vector3(desiredX - this.controller.position.x, 0, desiredZ - this.controller.position.z);
        const moveDist = moveVec.length();

        if (moveDist > 0.4) {
          moveVec.normalize();
          moveYaw = Math.atan2(moveVec.x, moveVec.z);
          this.controller.facing = moveYaw;
          moveInput = { forward: 1, right: 0, running: false };
        } else {
          this.controller.facing = Math.atan2(toQuarry.x, toQuarry.z);
        }
        break;
      }

      case 'charge': {
        this.anim.play('run', 0.1);
        this.controller.facing = Math.atan2(toQuarry.x, toQuarry.z);

        if (distToQuarry <= houndTuning.biteRange) {
          this.state = 'bite';
          this.timer = 0;
          this.attackHit = false;
          this.stateDuration = houndTuning.attackDuration;
          this.anim.play('attack', 0.1);
        } else if (this.timer >= this.stateDuration) {
          // Reached max charge distance without reaching quarry
          this.state = 'stalk';
          this.cooldown = houndTuning.chargeCooldown;
        } else {
          // Direct fast lunge along facing
          lungeSpeed = houndTuning.speeds.charge;
        }
        break;
      }

      case 'bite': {
        this.controller.facing = Math.atan2(toQuarry.x, toQuarry.z);
        if (!this.attackHit && this.timer >= this.stateDuration * houndTuning.attackHitFraction) {
          this.attackHit = true;
          if (distToQuarry <= houndTuning.biteRange + 0.4 && quarry.alive) {
            quarry.takeHit?.(houndTuning.biteDamage, this.controller.position);
          }
        }
        if (this.timer >= this.stateDuration) {
          this.state = 'stalk';
          this.cooldown = houndTuning.chargeCooldown;
        }
        break;
      }

      case 'recoil': {
        if (this.timer >= this.stateDuration) {
          this.state = 'stalk';
          this.cooldown = 0.5;
        }
        break;
      }
    }

    this.controller.step(moveInput, moveYaw, lungeSpeed);
    this.anim.update(dt);
    this.model.position.copy(this.controller.position);
    this.model.rotation.y = this.controller.facing;
  }
}

/**
 * Coordinates a hunting pack of 3 Ember Hounds.
 * One charges frontally while the other two flank and charge from the sides or back.
 */
export class HoundPack {
  readonly hounds: EmberHound[] = [];
  private chargeIndex = 0;
  private packTimer = 0;

  constructor(
    template: HoundTemplate,
    world: RAPIER.World,
    packCenter = { x: 0, z: 0 },
    bounded = true
  ) {
    const flankRad = ((houndTuning.flankAngleDeg ?? 65) * Math.PI) / 180;
    const offsets = [
      { x: 0, z: 0, angle: 0 },                   // Lead / Front
      { x: -3, z: -2, angle: -flankRad },         // Left Flanker
      { x: 3, z: -2, angle: flankRad },          // Right Flanker
    ];

    for (let i = 0; i < houndTuning.packSize; i++) {
      const off = offsets[i] ?? { x: 0, z: 0, angle: 0 };
      const hound = new EmberHound(
        template,
        world,
        { x: packCenter.x + off.x, z: packCenter.z + off.z },
        bounded
      );
      hound.setFlankAngle(off.angle);
      this.hounds.push(hound);
    }
  }

  get alive(): boolean {
    return this.hounds.some((h) => h.alive);
  }

  update(dt: number, quarry: HoundQuarry): void {
    this.packTimer += dt;

    // Check if any hound noticed the quarry; alert the entire pack
    const anyNoticing = this.hounds.some(
      (h) => h.state === 'notice' || h.state === 'stalk' || h.state === 'charge' || h.state === 'bite'
    );

    if (anyNoticing) {
      for (const h of this.hounds) {
        if (h.state === 'idle' || h.state === 'wander') {
          h.triggerNotice();
        }
      }
    }

    // Pack coordination: manage turns to charge
    const anyChargingOrBiting = this.hounds.some((h) => h.state === 'charge' || h.state === 'bite');
    if (!anyChargingOrBiting && quarry.alive) {
      const stalkingHounds = this.hounds.filter((h) => h.state === 'stalk');
      if (stalkingHounds.length > 0) {
        const candidate = this.hounds[this.chargeIndex % this.hounds.length];
        if (candidate && candidate.alive && candidate.triggerCharge()) {
          this.chargeIndex++;
        } else {
          for (let i = 0; i < this.hounds.length; i++) {
            const h = this.hounds[i];
            if (h && h.alive && h.triggerCharge()) {
              this.chargeIndex = i + 1;
              break;
            }
          }
        }
      }
    }

    for (const hound of this.hounds) {
      hound.update(dt, quarry);
    }
  }
}
