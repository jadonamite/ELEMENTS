/**
 * Hero loading and setup: loads the hero GLB model at 1 unit = 1 metre, dresses it
 * in worn iron, attaches a sword to the right hand bone so it moves with the swing,
 * enables shadows, and initializes the animation player.
 */

import {
  type AnimationClip,
  AnimationUtils,
  Group,
  Matrix4,
  Quaternion,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  type Bone,
} from 'three';
import balance from '../../shared/balance.json';
import { BodyKit, parseOutfit, type OutfitId } from './body.js';
import { getDefaultCharacterConfig, getStoredCharacter, type CharacterConfig } from './creator/creator-types.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { AnimationPlayer } from './anim/index.js';
import { StrikeLimbs, type StrikeLimb } from './anim/strike-limb.js';
import { STAFF_WEAPON, SWORD_WEAPON, heroWeaponFor, type WeaponSlotData } from './weapon.js';
import { carrySockets, gripAligned, hitSegment, palmSocket, snapToSocket } from './weapon-mount.js';
import { fetchWornArmour } from './economy/api.js';
import { getStoredAuthToken, hasGameServer } from './auth/server-api.js';

export type Limb = 'hand_r' | 'hand_l' | 'foot_r' | 'foot_l' | 'knee_r' | 'knee_l';

export interface HeroInstance {
  /** Root 3D container added to the scene. */
  model: Group;
  /** Who the player is: sex, body and sheet person. */
  character: CharacterConfig;
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
  /** Move along the scabbard axis, then return to the palm, without moving the shell. */
  poseDraw(fraction: number): void;
  /** Equips a weapon via data-driven slot parameters. */
  equipWeapon(slot: WeaponSlotData): Promise<void>;
  /** Gets world position of specified limb bone for contact checks. */
  getLimbWorldPosition(limb: Limb, out: Vector3): Vector3;
  /** The hand or foot a clip strikes with, read from the clip itself. */
  strikeLimbOf(clip: string): StrikeLimb | null;
  /** Ignites or extinguishes elemental bending mode (Lit vs Unlit). */
  setElemental(lit: boolean, element?: string): void;
  readonly elemental: boolean;
  /** Current outfit drawn by the body model. */
  readonly outfit: OutfitId;
  /** Switches the outfit model without page reload, keeping animation state and weapons. */
  switchOutfit(outfitId: OutfitId): Promise<void>;
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
 * Loads the hero character, dresses it, attaches the sword to the right hand
 * and sets up the animation player.
 */
export async function loadHero(loader = new GLTFLoader(), initialOutfit?: OutfitId): Promise<HeroInstance> {
  loader.setMeshoptDecoder(MeshoptDecoder);
  // The body is the player's own creation; hero.glb now only supplies animation clips.
  const heroGltf = await loader.loadAsync('/assets/characters/hero.glb');
  const config = getStoredCharacter() ?? getDefaultCharacterConfig('male');
  const kit = new BodyKit(loader);

  let currentOutfit: OutfitId = initialOutfit ?? 'rags';
  if (!initialOutfit && hasGameServer() && getStoredAuthToken()) {
    try {
      const worn = await fetchWornArmour();
      currentOutfit = parseOutfit(worn.outfit);
    } catch {
      currentOutfit = 'rags';
    }
  }

  const heroModel = await kit.build(config, 'hero', undefined, currentOutfit);

  let weaponSlot: WeaponSlotData = SWORD_WEAPON;
  const initialHand = heroModel.getObjectByName('hand_r') as Bone | undefined;
  if (!initialHand) throw new Error('Hand bone hand_r not found in hero rig.');
  let handBone: Bone = initialHand;
  let handL = heroModel.getObjectByName('hand_l') as Bone | undefined;
  if (!handL) throw new Error('Left hand bone (hand_l) not found in hero rig.');
  let footR = heroModel.getObjectByName('foot_r') as Bone | undefined;
  if (!footR) throw new Error('Right foot bone (foot_r) not found in hero rig.');
  let footL = heroModel.getObjectByName('foot_l') as Bone | undefined;
  if (!footL) throw new Error('Left foot bone (foot_l) not found in hero rig.');
  let kneeR = heroModel.getObjectByName('calf_r') as Bone | undefined;
  if (!kneeR) throw new Error('Right calf bone (calf_r) not found in hero rig.');
  let kneeL = heroModel.getObjectByName('calf_l') as Bone | undefined;
  if (!kneeL) throw new Error('Left calf bone (calf_l) not found in hero rig.');
  let swordMesh: Object3D = (await loader.loadAsync(weaponSlot.assetPath)).scene.clone(true);
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
  let elementalNation = 'IGNIS';
  const setElemental = (lit: boolean, element: string = 'IGNIS'): void => {
    elemental = lit;
    elementalNation = element;
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

  const holder = gripAligned(swordMesh);
  const bladeBase = new Vector3();
  const bladeTip = new Vector3();
  hitSegment(holder, bladeBase, bladeTip);
  let palm = palmSocket(heroModel);
  let mounts = carrySockets(heroModel);
  let activeCarry = mounts.back;
  let scabbard: Object3D | null = null;

  const loadCarry = async (slot: WeaponSlotData): Promise<void> => {
    scabbard?.removeFromParent();
    scabbard = null;
    activeCarry = slot.carry?.mount === 'hip' ? mounts.hip : mounts.back;
    if (slot.carry) {
      scabbard = gripAligned((await loader.loadAsync(slot.carry.assetPath)).scene.clone(true));
      scabbard.traverse(node => { if ((node as Mesh).isMesh) { (node as Mesh).castShadow = true; (node as Mesh).receiveShadow = true; } });
      snapToSocket(scabbard, activeCarry);
    }
  };
  await loadCarry(weaponSlot);

  let isArmedState = false;
  const arm = (armed: boolean): void => {
    isArmedState = armed;
    if (scabbard) snapToSocket(scabbard, activeCarry);
    snapToSocket(holder, armed ? palm : activeCarry);
  };

  const poseDraw = (fraction: number): void => {
    const t = Math.max(0, Math.min(1, fraction));
    if (t === 0 || t === 1) { arm(t === 1); return; }
    if (scabbard) snapToSocket(scabbard, activeCarry);
    heroModel.updateMatrixWorld(true);
    const from = new Matrix4().compose(activeCarry.getWorldPosition(new Vector3()), activeCarry.getWorldQuaternion(new Quaternion()).normalize(), new Vector3(1, 1, 1));
    const travel = bladeTip.distanceTo(bladeBase);
    const extract = Math.min(1, t / 0.7);
    from.multiply(new Matrix4().makeTranslation(0, -travel * extract, 0));
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
    from.decompose(position, rotation, scale);
    const blend = Math.max(0, (t - 0.7) / 0.3);
    position.lerp(palm.getWorldPosition(new Vector3()), blend);
    rotation.slerp(palm.getWorldQuaternion(new Quaternion()).normalize(), blend);
    heroModel.add(holder);
    holder.matrix.copy(heroModel.matrixWorld).invert().multiply(new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)));
    holder.matrix.decompose(holder.position, holder.quaternion, holder.scale);
    holder.matrixAutoUpdate = false;
    holder.updateMatrixWorld(true);
  };

  let equipRequest = 0;
  const equipWeapon = async (slot: WeaponSlotData): Promise<void> => {
    const request = ++equipRequest;
    const [weapon, carry] = await Promise.all([
      loader.loadAsync(slot.assetPath),
      slot.carry ? loader.loadAsync(slot.carry.assetPath) : Promise.resolve(null),
    ]);
    if (request !== equipRequest) return;
    const aligned = gripAligned(weapon.scene.clone(true));
    holder.clear();
    swordMesh = aligned.children[0]!;
    holder.add(swordMesh);
    scabbard?.removeFromParent();
    weaponSlot = slot;
    activeCarry = slot.carry?.mount === 'hip' ? mounts.hip : mounts.back;
    scabbard = carry ? gripAligned(carry.scene.clone(true)) : null;
    if (scabbard) {
      scabbard.traverse(node => { if ((node as Mesh).isMesh) { (node as Mesh).castShadow = true; (node as Mesh).receiveShadow = true; } });
      snapToSocket(scabbard, activeCarry);
    }
    collectMaterials(swordMesh);
    hitSegment(holder, bladeBase, bladeTip);
    setElemental(elemental, elementalNation);
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
  // Locomotion is the retargeted Mixamo pack: idle, walk, strafe and turn in place, jump.
  const locomotionClips = (await loader.loadAsync('/assets/characters/locomotion.glb')).animations;
  // The mannequin's own relaxed idle, walk and jump are replaced by the pack; its start/land jump clips are unused.
  const REPLACED = new Set(['idle_relaxed', 'walk', 'jump', 'jump_start', 'jump_land']);
  const bodyClips = heroGltf.animations.filter(clip => !REPLACED.has(clip.name));

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

  const rawAnimationClips: readonly AnimationClip[] = [
    ...bodyClips,
    ...locomotionClips,
    ...combatClips,
    ...subclips,
  ];

  const allClips = await kit.fitClips(config.sex, rawAnimationClips, 'hero', currentOutfit, config.person);
  const anim = new AnimationPlayer(heroModel, allClips, {
    defaultFadeDuration: 0.25,
    plantFeet: true,
  });
  let strikeLimbs = new StrikeLimbs(heroModel, allClips, balance.combat.activeWindow as [number, number],
    balance.controller.modelForwardYaw);
  anim.play('idle_relaxed');
  arm(false);

  const switchOutfit = async (newOutfitId: OutfitId): Promise<void> => {
    if (newOutfitId === currentOutfit) return;
    currentOutfit = newOutfitId;

    if (holder.parent) holder.parent.remove(holder);
    mounts.back.removeFromParent();
    mounts.hip.removeFromParent();

    const nextBody = await kit.build(config, 'hero', undefined, newOutfitId);

    while (heroModel.children.length > 0) {
      heroModel.remove(heroModel.children[0]!);
    }
    while (nextBody.children.length > 0) {
      heroModel.add(nextBody.children[0]!);
    }
    heroModel.scale.copy(nextBody.scale);

    const nextHand = heroModel.getObjectByName('hand_r') as Bone | undefined;
    if (nextHand) handBone = nextHand;
    const nextHandL = heroModel.getObjectByName('hand_l') as Bone | undefined;
    if (nextHandL) handL = nextHandL;
    const nextFootR = heroModel.getObjectByName('foot_r') as Bone | undefined;
    if (nextFootR) footR = nextFootR;
    const nextFootL = heroModel.getObjectByName('foot_l') as Bone | undefined;
    if (nextFootL) footL = nextFootL;
    const nextKneeR = heroModel.getObjectByName('calf_r') as Bone | undefined;
    if (nextKneeR) kneeR = nextKneeR;
    const nextKneeL = heroModel.getObjectByName('calf_l') as Bone | undefined;
    if (nextKneeL) kneeL = nextKneeL;
    palm = palmSocket(heroModel);
    mounts = carrySockets(heroModel);
    activeCarry = weaponSlot.carry?.mount === 'hip' ? mounts.hip : mounts.back;
    if (scabbard) snapToSocket(scabbard, activeCarry);
    arm(isArmedState);

    const newFittedClips = await kit.fitClips(config.sex, rawAnimationClips, 'hero', newOutfitId, config.person);
    anim.rebind(heroModel, newFittedClips);
    strikeLimbs = new StrikeLimbs(heroModel, newFittedClips, balance.combat.activeWindow as [number, number], balance.controller.modelForwardYaw);
  };

  return {
    model: heroModel,
    character: config,
    anim,
    sword: holder,
    get weaponSlot(): WeaponSlotData { return weaponSlot; },
    get handBone(): Bone { return handBone!; },
    get handL(): Bone { return handL!; },
    get footR(): Bone { return footR!; },
    get footL(): Bone { return footL!; },
    get kneeR(): Bone { return kneeR!; },
    get kneeL(): Bone { return kneeL!; },
    bladeBase,
    bladeTip,
    get backSocket(): Object3D { return activeCarry; },
    arm,
    poseDraw,
    equipWeapon,
    getLimbWorldPosition,
    strikeLimbOf: (clip: string) => strikeLimbs.of(clip),
    setElemental,
    get elemental(): boolean { return elemental; },
    get outfit(): OutfitId { return currentOutfit; },
    switchOutfit,
  };
}
