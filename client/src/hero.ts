/**
 * Hero loading and setup: loads the hero GLB model at 1 unit = 1 metre, dresses it
 * in worn iron, attaches a sword to the right hand bone so it moves with the swing,
 * enables shadows, and initializes the animation player.
 */

import {
  type AnimationClip,
  AnimationUtils,
  Box3,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Bone,
} from 'three';
import balance from '../../shared/balance.json';
import { BodyKit } from './body.js';
import { getDefaultCharacterConfig, getStoredCharacter } from './creator/creator-types.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { AnimationPlayer } from './anim/index.js';
import { StrikeLimbs, type StrikeLimb } from './anim/strike-limb.js';
import { STAFF_WEAPON, SWORD_WEAPON, heroWeaponFor, type WeaponSlotData } from './weapon.js';

export type Limb = 'hand_r' | 'hand_l' | 'foot_r' | 'foot_l' | 'knee_r' | 'knee_l';

export interface HeroInstance {
  /** Root 3D container added to the scene. */
  model: Group;
  /** Animation player controlling locomotion and combat clips. */
  anim: AnimationPlayer;
  /** Weapon mesh/group attached to the right hand or back. */
  sword: Object3D;
  /** Active weapon slot data definition. */
  weaponSlot: WeaponSlotData;
  /** Right hand bone instance the weapon is socketed to. */
  handBone: Bone;
  handL: Bone;
  footR: Bone;
  footL: Bone;
  /** Calf bones; their origin is the knee joint. */
  kneeR: Bone;
  kneeL: Bone;
  /** Blade ends in the weapon holder's space, for contact checks. */
  bladeBase: Vector3;
  bladeTip: Vector3;
  /** Where the weapon rides on the back; its world position is the hilt the hand reaches for. */
  backSocket: Object3D;
  /** Weapon in hand (true) or carried on the back (false). */
  arm(armed: boolean): void;
  /** Equips a weapon via data-driven slot parameters. */
  equipWeapon(slot: WeaponSlotData): Promise<void>;
  /** Gets world position of specified limb bone for contact checks. */
  getLimbWorldPosition(limb: Limb, out: Vector3): Vector3;
  /** The hand or foot a clip strikes with, read from the clip itself. */
  strikeLimbOf(clip: string): StrikeLimb | null;
  /** Ignites or extinguishes elemental bending mode (Lit vs Unlit). */
  setElemental(lit: boolean, element?: string): void;
  readonly elemental: boolean;
}

/** Keep only part of the run clip's hip bounce, measured up from its lowest (planted) point. */
function calmRunBounce(clips: AnimationClip[]): void {
  const track = clips.find(c => c.name === 'run')?.tracks.find(t => t.name === 'pelvis.position');
  if (!track) return;
  // The rig's root is turned to Z-up, so height is the third component.
  const values = track.values;
  let lowest = Infinity;
  for (let i = 2; i < values.length; i += 3) lowest = Math.min(lowest, values[i]!);
  for (let i = 2; i < values.length; i += 3) values[i] = lowest + (values[i]! - lowest) * balance.controller.runBounceKeep;
}

/**
 * Creates a procedural fallback sword mesh in case the GLB asset is unavailable.
 */
function createProceduralSword(): Group {
  const sword = new Group();
  sword.name = 'ProceduralSword';

  // Blade (silver metallic)
  const bladeGeo = new BoxGeometry(0.04, 0.75, 0.012);
  const bladeMat = new MeshStandardMaterial({
    color: 0xcccccc,
    metalness: 0.85,
    roughness: 0.25,
  });
  const blade = new Mesh(bladeGeo, bladeMat);
  blade.position.set(0, 0.42, 0);
  blade.castShadow = true;
  blade.receiveShadow = true;
  sword.add(blade);

  // Crossguard (dark gold)
  const guardGeo = new BoxGeometry(0.2, 0.024, 0.035);
  const guardMat = new MeshStandardMaterial({
    color: 0xcaa048,
    metalness: 0.75,
    roughness: 0.35,
  });
  const guard = new Mesh(guardGeo, guardMat);
  guard.position.set(0, 0.04, 0);
  guard.castShadow = true;
  guard.receiveShadow = true;
  sword.add(guard);

  // Grip (dark leather)
  const gripGeo = new CylinderGeometry(0.015, 0.015, 0.14, 8);
  const gripMat = new MeshStandardMaterial({
    color: 0x2e1a0e,
    roughness: 0.8,
    metalness: 0.1,
  });
  const grip = new Mesh(gripGeo, gripMat);
  grip.position.set(0, -0.04, 0);
  grip.castShadow = true;
  sword.add(grip);

  // Pommel
  const pommelGeo = new CylinderGeometry(0.022, 0.022, 0.02, 8);
  const pommel = new Mesh(pommelGeo, guardMat);
  pommel.position.set(0, -0.12, 0);
  pommel.castShadow = true;
  sword.add(pommel);

  return sword;
}

/**
 * Creates a procedural fallback staff mesh in case the GLB asset is unavailable.
 */
function createProceduralStaff(): Group {
  const staff = new Group();
  staff.name = 'Staff';

  const shaftGeo = new CylinderGeometry(0.015, 0.015, 1.44, 16);
  const woodMat = new MeshStandardMaterial({
    color: 0xded8ce,
    roughness: 0.65,
    metalness: 0.05,
  });
  const shaft = new Mesh(shaftGeo, woodMat);
  shaft.castShadow = true;
  staff.add(shaft);

  const gripGeo = new CylinderGeometry(0.0165, 0.0165, 0.54, 16);
  const leatherMat = new MeshStandardMaterial({
    color: 0x3d352e,
    roughness: 0.75,
    metalness: 0.1,
  });
  const grip = new Mesh(gripGeo, leatherMat);
  grip.castShadow = true;
  staff.add(grip);

  const capGeo = new CylinderGeometry(0.0165, 0.0165, 0.13, 16);
  const steelMat = new MeshStandardMaterial({
    color: 0xd8dde3,
    roughness: 0.35,
    metalness: 0.95,
  });
  const topCap = new Mesh(capGeo, steelMat);
  topCap.position.set(0, 0.785, 0);
  topCap.castShadow = true;
  staff.add(topCap);

  const bottomCap = new Mesh(capGeo, steelMat);
  bottomCap.position.set(0, -0.785, 0);
  bottomCap.castShadow = true;
  staff.add(bottomCap);

  return staff;
}

/**
 * Loads the hero character, dresses it, attaches the sword to the right hand
 * and sets up the animation player.
 */
export async function loadHero(loader = new GLTFLoader()): Promise<HeroInstance> {
  loader.setMeshoptDecoder(MeshoptDecoder);
  // The body is the player's own creation; hero.glb now only supplies animation clips.
  const heroGltf = await loader.loadAsync('/assets/characters/hero.glb');
  const config = getStoredCharacter() ?? getDefaultCharacterConfig('male');
  const kit = new BodyKit(loader);
  const heroModel = await kit.build(config, 'hero');

  let weaponSlot: WeaponSlotData = SWORD_WEAPON;
  const initialHand = heroModel.getObjectByName(weaponSlot.handBone) as Bone | undefined;
  if (!initialHand) throw new Error(`Hand bone ${weaponSlot.handBone} not found in hero rig.`);
  let handBone: Bone = initialHand;
  const handL = heroModel.getObjectByName('hand_l') as Bone | undefined;
  if (!handL) throw new Error('Left hand bone (hand_l) not found in hero rig.');
  const footR = heroModel.getObjectByName('foot_r') as Bone | undefined;
  if (!footR) throw new Error('Right foot bone (foot_r) not found in hero rig.');
  const footL = heroModel.getObjectByName('foot_l') as Bone | undefined;
  if (!footL) throw new Error('Left foot bone (foot_l) not found in hero rig.');
  const kneeR = heroModel.getObjectByName('calf_r') as Bone | undefined;
  if (!kneeR) throw new Error('Right calf bone (calf_r) not found in hero rig.');
  const kneeL = heroModel.getObjectByName('calf_l') as Bone | undefined;
  if (!kneeL) throw new Error('Left calf bone (calf_l) not found in hero rig.');
  let swordMesh: Object3D;
  try {
    const swordGltf = await loader.loadAsync(weaponSlot.assetPath);
    swordMesh = swordGltf.scene.getObjectByName(weaponSlot.meshName ?? 'Sword')?.clone() ??
      (weaponSlot.type === 'staff' ? createProceduralStaff() : createProceduralSword());
  } catch {
    swordMesh = weaponSlot.type === 'staff' ? createProceduralStaff() : createProceduralSword();
  }
  const swordMaterials: MeshStandardMaterial[] = [];
  const collectMaterials = (mesh: Object3D): void => {
    swordMaterials.length = 0;
    mesh.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const m = child as Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        if (Array.isArray(m.material)) {
          m.material = (m.material as MeshStandardMaterial[]).map(mat => mat.clone());
          swordMaterials.push(...(m.material as MeshStandardMaterial[]));
        } else if (m.material) {
          m.material = (m.material as MeshStandardMaterial).clone();
          swordMaterials.push(m.material as MeshStandardMaterial);
        }
      }
    });
  };
  collectMaterials(swordMesh);

  const ELEMENT_EMISSIVE: Record<string, { color: number; intensity: number }> = {
    IGNIS: { color: 0xff3700, intensity: 1.8 },
    AQUES: { color: 0x0088ff, intensity: 1.6 },
    TERRA: { color: 0xd89524, intensity: 1.5 },
    AURA: { color: 0xddeeff, intensity: 1.8 },
    HUSH: { color: 0x000000, intensity: 0.0 },
  };

  let elemental = false;
  const setElemental = (lit: boolean, element: string = 'IGNIS'): void => {
    elemental = lit;
    const spec = ELEMENT_EMISSIVE[element] ?? ELEMENT_EMISSIVE.IGNIS!;
    for (const mat of swordMaterials) {
      // Only the metallic blade carries the elemental glow; hilt, guard and leather stay grounded.
      const isBlade = mat.name.toLowerCase().includes('metal') || mat.name.toLowerCase().includes('blade');
      if (lit && isBlade && weaponSlot.type !== 'staff' && element !== 'HUSH') {
        mat.emissive.setHex(spec.color);
        mat.emissiveIntensity = spec.intensity;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
      mat.needsUpdate = true;
    }
  };

  const holder = new Group();
  holder.name = 'WeaponHolder';
  holder.add(swordMesh);

  const bladeBase = new Vector3();
  const bladeTip = new Vector3();

  const updateHitShape = (mesh: Object3D, shape: WeaponSlotData['hitShape']): void => {
    mesh.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(mesh);
    const height = bounds.max.y - bounds.min.y;
    bladeBase.set(0, bounds.min.y + height * shape.baseFraction, 0);
    bladeTip.set(0, bounds.min.y + height * shape.tipFraction, 0);
  };
  updateHitShape(swordMesh, weaponSlot.hitShape);

  holder.position.set(...weaponSlot.handOffset);
  holder.rotation.set(...weaponSlot.handRotation);
  holder.scale.setScalar(weaponSlot.handScale);
  handBone.add(holder);

  // Back carry setup
  const initialSpine = heroModel.getObjectByName(weaponSlot.sheatheBone);
  if (!initialSpine) throw new Error(`Sheathe bone ${weaponSlot.sheatheBone} not found in hero rig.`);
  let spine: Object3D = initialSpine;
  const backSocket = new Object3D();
  backSocket.name = 'WeaponBackSocket';
  spine.add(backSocket);

  const updateBackSocketTransform = (slot: WeaponSlotData): void => {
    heroModel.updateMatrixWorld(true);
    const toModel = new Matrix4().copy(heroModel.matrixWorld).invert().multiply(spine.matrixWorld);
    const sheatheDir = new Vector3(...slot.sheatheBladeDirection).normalize();
    const out = new Vector3(0, 0, -1);
    const side = new Vector3().crossVectors(sheatheDir, out).normalize();
    const sheathePos = new Vector3(...slot.sheathePosition);
    const backInModel = new Matrix4().compose(
      sheathePos,
      new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(side, sheatheDir, out)),
      new Vector3().setScalar(slot.sheatheScale),
    );
    toModel.invert().multiply(backInModel).decompose(backSocket.position, backSocket.quaternion, backSocket.scale);
  };
  updateBackSocketTransform(weaponSlot);

  let isArmedState = false;
  const arm = (armed: boolean): void => {
    isArmedState = armed;
    if (armed) {
      handBone.add(holder);
      holder.position.set(...weaponSlot.handOffset);
      holder.rotation.set(...weaponSlot.handRotation);
      holder.scale.setScalar(weaponSlot.handScale);
    } else {
      backSocket.add(holder);
      holder.position.set(0, 0, 0);
      holder.quaternion.identity();
      holder.scale.setScalar(1);
    }
  };

  const equipWeapon = async (slot: WeaponSlotData): Promise<void> => {
    weaponSlot = slot;
    const newHandBone = heroModel.getObjectByName(slot.handBone) as Bone | undefined;
    if (!newHandBone) throw new Error(`Hand bone ${slot.handBone} not found in hero rig.`);
    handBone = newHandBone;

    const newSpine = heroModel.getObjectByName(slot.sheatheBone);
    if (!newSpine) throw new Error(`Sheathe bone ${slot.sheatheBone} not found in hero rig.`);
    if (newSpine !== spine) {
      spine.remove(backSocket);
      spine = newSpine;
      spine.add(backSocket);
    }

    while (holder.children.length > 0) holder.remove(holder.children[0]!);
    try {
      const gltf = await loader.loadAsync(slot.assetPath);
      swordMesh = gltf.scene.getObjectByName(slot.meshName ?? 'Sword')?.clone() ??
        (slot.type === 'staff' ? createProceduralStaff() : createProceduralSword());
    } catch {
      swordMesh = slot.type === 'staff' ? createProceduralStaff() : createProceduralSword();
    }
    holder.add(swordMesh);
    collectMaterials(swordMesh);
    updateHitShape(swordMesh, slot.hitShape);
    updateBackSocketTransform(slot);
    arm(isArmedState);
  };

  const getLimbWorldPosition = (limb: Limb, out: Vector3): Vector3 => {
    const bones = { hand_r: handBone, hand_l: handL, foot_r: footR, foot_l: footL, knee_r: kneeR, knee_l: kneeL };
    const bone = bones[limb];
    if (!bone) return out.copy(heroModel.position);
    heroModel.updateMatrixWorld(true);
    return bone.getWorldPosition(out);
  };

  // Build animation clips, including bare hands combos & bending moves
  const combatClips = (await loader.loadAsync('/assets/characters/combat.glb')).animations;
  calmRunBounce(heroGltf.animations);

  // Unarmed fighting uses real punch and knee clips; the bare moves map onto them by name.
  const unarmed = [
    ...(await loader.loadAsync('/assets/characters/unarmed_a.glb')).animations,
    ...(await loader.loadAsync('/assets/characters/unarmed_b.glb')).animations,
  ];
  const rename: Record<string, string> = { punch_jab: 'bare_punch_1', punch_cross: 'bare_punch_2', knee: 'bare_kick', punch_hook: 'bare_heavy_1' };
  const subclips: AnimationClip[] = unarmed.map(clip => {
    const named = rename[clip.name];
    if (!named) return clip;
    const copy = clip.clone();
    copy.name = named;
    return copy;
  });

  // Legs style kicks (Mixamo, retargeted), trimmed so the strike falls cleanly inside the active window.
  const kickClips = (await loader.loadAsync('/assets/characters/kicks.glb')).animations;
  // Cuts start just before the foot leaves the floor and end once it is back down; the foot peaks near the middle.
  const kickCuts: Array<[string, string, number, number]> = [
    ['kick_front_double', 'leg_kick_1', 0.55, 1.25],
    ['kick_side', 'leg_kick_2', 0.45, 1.30],
    ['kick_mma', 'leg_kick_heavy', 0.30, 1.10],
  ];
  // Whole spinning and sweeping kicks carry AURA's gust and cyclone.
  for (const name of ['kick_spin', 'kick_sweep']) {
    const clip = kickClips.find(c => c.name === name);
    if (clip) subclips.push(clip);
  }
  for (const [source, name, from, to] of kickCuts) {
    const clip = kickClips.find(c => c.name === source);
    if (clip) subclips.push(AnimationUtils.subclip(clip, name, Math.round(from * 30), Math.round(to * 30), 30));
  }

  const allClips = await kit.fitClips(config.sex, [...heroGltf.animations, ...combatClips, ...subclips], 'hero');
  const anim = new AnimationPlayer(heroModel, allClips, {
    defaultFadeDuration: 0.25,
  });
  const strikeLimbs = new StrikeLimbs(heroModel, allClips, balance.combat.activeWindow as [number, number],
    balance.controller.modelForwardYaw);
  anim.play('idle_relaxed');
  arm(false);

  return {
    model: heroModel,
    anim,
    sword: holder,
    get weaponSlot(): WeaponSlotData { return weaponSlot; },
    get handBone(): Bone { return handBone!; },
    handL,
    footR,
    footL,
    kneeR,
    kneeL,
    bladeBase,
    bladeTip,
    backSocket,
    arm,
    equipWeapon,
    getLimbWorldPosition,
    strikeLimbOf: (clip: string) => strikeLimbs.of(clip),
    setElemental,
    get elemental(): boolean { return elemental; },
  };
}
