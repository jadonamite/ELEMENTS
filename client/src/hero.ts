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
  type Material,
  type SkinnedMesh,
} from 'three';
import balance from '../../shared/balance.json';
import { bodyKit, markRest, parseOutfit, type OutfitId } from './body.js';
import { getDefaultCharacterConfig, getStoredCharacter, type CharacterConfig } from './creator/creator-types.js';
import type { Loaders } from './assets/loaders.js';
import { AnimationPlayer } from './anim/index.js';
import { StrikeLimbs, type StrikeLimb } from './anim/strike-limb.js';
import { STAFF_WEAPON, SWORD_WEAPON, heroWeaponFor, type WeaponSlotData } from './weapon.js';
import { fitBaldric, removeBaldric } from './baldric.js';
import { AIR_CLIPS } from './anim/airborne.js';
import { fitTorso } from './torso-fit.js';
import { carrySockets, gripAligned, hitSegment, palmSocket, snapToSocket } from './weapon-mount.js';
import { fetchWornArmour } from './economy/api.js';
import { getStoredAuthToken, hasGameServer } from './auth/server-api.js';

/** A fist is the middle of the hand, halfway from the wrist to the middle knuckle. */
export type Limb = 'hand_r' | 'hand_l' | 'foot_r' | 'foot_l' | 'knee_r' | 'knee_l' | 'fist_r' | 'fist_l';

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
  /** Whether the hero has a weapon at all: blade, sheath and strap show only while carrying. */
  readonly carrying: boolean;
  setCarrying(carrying: boolean): void;
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
  /** Rebuilds the body for a new look (the creator saved one), keeping the worn outfit. */
  redress(config: CharacterConfig): Promise<void>;
}

/** The clips with the run keeping only part of its hip bounce, measured up from its lowest (planted) point. The pack's own clips are left as loaded. */
/** The clip under another name, or itself when there is none. */
function renamed(clip: AnimationClip, name: string | undefined): AnimationClip {
  if (!name) return clip;
  const copy = clip.clone();
  copy.name = name;
  return copy;
}

function calmRunBounce(clips: AnimationClip[]): AnimationClip[] {
  return clips.map((clip) => {
    if (clip.name !== 'run') return clip;
    const calm = clip.clone();
    const track = calm.tracks.find(t => t.name === 'pelvis.position');
    if (track) calmBounce(track.values);
    return calm;
  });
}

function calmBounce(values: Float32Array | number[]): void {
  // The rig's root is turned to Z-up, so height is the third component.
  let lowest = Infinity;
  for (let i = 2; i < values.length; i += 3) lowest = Math.min(lowest, values[i]!);
  for (let i = 2; i < values.length; i += 3) values[i] = lowest + (values[i]! - lowest) * balance.controller.runBounceKeep;
}

/**
 * Loads the hero character, dresses it, attaches the sword to the right hand
 * and sets up the animation player.
 */
export async function loadHero(loaders: Loaders, initialOutfit?: OutfitId): Promise<HeroInstance> {
  // The body is the player's own creation; hero.glb now only supplies animation clips.
  const heroGltf = await loaders.model('/assets/characters/hero.glb');
  let config = getStoredCharacter() ?? getDefaultCharacterConfig('male');
  const kit = bodyKit(loaders, 'close');

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
  /** Middle knuckles, for the fists; a rig without fingers falls back to the wrist. */
  let knuckleR = heroModel.getObjectByName('middle_02_r') as Bone | undefined;
  let knuckleL = heroModel.getObjectByName('middle_02_l') as Bone | undefined;
  const knuckleAt = new Vector3();
  let swordMesh: Object3D = (await loaders.model(weaponSlot.assetPath)).scene.clone(true);
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
  let torso = fitTorso(heroModel);
  if (!torso) throw new Error('Hero rig has no torso to carry a weapon on.');
  let mounts = carrySockets(heroModel, torso);
  let activeCarry = mounts.back;
  let scabbard: Object3D | null = null;

  const loadCarry = async (slot: WeaponSlotData): Promise<void> => {
    scabbard?.removeFromParent();
    scabbard = null;
    activeCarry = slot.carry?.mount === 'hip' ? mounts.hip : mounts.back;
    if (slot.carry) {
      scabbard = gripAligned((await loaders.model(slot.carry.assetPath)).scene.clone(true));
      scabbard.traverse(node => { if ((node as Mesh).isMesh) { (node as Mesh).castShadow = true; (node as Mesh).receiveShadow = true; } });
      snapToSocket(scabbard, activeCarry);
    }
  };
  await loadCarry(weaponSlot);

  // The strap is cut to the worn body and skinned to its bones, so it is rebuilt with the body and the sheath.
  let baldric: SkinnedMesh | null = null;
  const refitBaldric = (): void => {
    removeBaldric(baldric);
    baldric = null;
    let leather: Material | undefined;
    scabbard?.traverse(node => { const mesh = node as Mesh; if (mesh.isMesh && !leather) leather = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material; });
    if (leather && torso) baldric = fitBaldric(torso, leather.clone());
    showCarry();
  };

  // A hero who has not been given a weapon yet carries no blade, sheath or strap.
  let carrying = true;
  const showCarry = (): void => {
    holder.visible = carrying;
    if (scabbard) scabbard.visible = carrying;
    if (baldric) baldric.visible = carrying;
  };

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
      loaders.model(slot.assetPath),
      slot.carry ? loaders.model(slot.carry.assetPath) : Promise.resolve(null),
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
    refitBaldric();
  };

  const getLimbWorldPosition = (limb: Limb, out: Vector3): Vector3 => {
    if (limb === 'fist_r' || limb === 'fist_l') {
      const wrist = limb === 'fist_r' ? handBone : handL;
      const knuckle = limb === 'fist_r' ? knuckleR : knuckleL;
      if (!wrist) return out.copy(heroModel.position);
      heroModel.updateMatrixWorld(true);
      wrist.getWorldPosition(out);
      return knuckle ? out.lerp(knuckle.getWorldPosition(knuckleAt), 0.5) : out;
    }
    const bones = { hand_r: handBone, hand_l: handL, foot_r: footR, foot_l: footL, knee_r: kneeR, knee_l: kneeL };
    const bone = bones[limb];
    if (!bone) return out.copy(heroModel.position);
    heroModel.updateMatrixWorld(true);
    return bone.getWorldPosition(out);
  };

  // Build animation clips, including bare hands combos & bending moves
  const combatClips = markRest(await loaders.model('/assets/characters/combat.glb'));
  const heroClips = calmRunBounce(markRest(heroGltf));
  // Locomotion is the retargeted Mixamo pack: idle, weapon-drawn idle, walk, strafe and turn in place, jump.
  const locomotionClips = markRest(await loaders.model('/assets/characters/locomotion.glb'));
  // The mannequin's own relaxed idle and walk are replaced by the pack. Its three jump clips are the airborne
  // phases (anim/airborne.ts): take-off, the fall held for as long as it lasts, and the touchdown.
  const REPLACED = new Set(['idle_relaxed', 'walk', 'jump']);
  const PHASES: Record<string, string> = { jump_start: AIR_CLIPS.rise, jump_land: AIR_CLIPS.land };
  const bodyClips = heroClips.filter(clip => !REPLACED.has(clip.name)).map(clip => renamed(clip, PHASES[clip.name]));
  const fall = heroClips.find(clip => clip.name === 'jump');
  if (fall) bodyClips.push(renamed(fall, AIR_CLIPS.fall));
  // Getting up off the ground, after a hard landing.
  const standing = markRest(await loaders.model('/assets/characters/mixamo.glb')).find(clip => clip.name === 'standing');
  if (standing) bodyClips.push(renamed(standing, AIR_CLIPS.getUp));

  // Unarmed fighting uses real punch and knee clips; the bare moves map onto them by name.
  const unarmed = [
    ...markRest(await loaders.model('/assets/characters/unarmed_a.glb')),
    ...markRest(await loaders.model('/assets/characters/unarmed_b.glb')),
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
  const kickClips = markRest(await loaders.model('/assets/characters/kicks.glb'));
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
  refitBaldric();

  /** Rebuilds the body for a look and outfit, keeping the rig's place, animation player and weapon. */
  const dress = async (nextConfig: CharacterConfig, newOutfitId: OutfitId): Promise<void> => {
    config = nextConfig;
    currentOutfit = newOutfitId;

    if (holder.parent) holder.parent.remove(holder);
    removeBaldric(baldric);
    baldric = null;
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
    knuckleR = heroModel.getObjectByName('middle_02_r') as Bone | undefined;
    knuckleL = heroModel.getObjectByName('middle_02_l') as Bone | undefined;
    palm = palmSocket(heroModel);
    torso = fitTorso(heroModel);
    if (!torso) throw new Error('Hero rig has no torso to carry a weapon on.');
    mounts = carrySockets(heroModel, torso);
    activeCarry = weaponSlot.carry?.mount === 'hip' ? mounts.hip : mounts.back;
    if (scabbard) snapToSocket(scabbard, activeCarry);
    arm(isArmedState);

    const newFittedClips = await kit.fitClips(config.sex, rawAnimationClips, 'hero', newOutfitId, config.person);
    anim.rebind(heroModel, newFittedClips);
    strikeLimbs = new StrikeLimbs(heroModel, newFittedClips, balance.combat.activeWindow as [number, number], balance.controller.modelForwardYaw);
    refitBaldric();
  };
  const switchOutfit = async (newOutfitId: OutfitId): Promise<void> => {
    if (newOutfitId !== currentOutfit) await dress(config, newOutfitId);
  };
  const redress = async (nextConfig: CharacterConfig): Promise<void> => {
    if (JSON.stringify(nextConfig) !== JSON.stringify(config)) await dress(nextConfig, currentOutfit);
  };

  return {
    model: heroModel,
    get character(): CharacterConfig { return config; },
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
    get carrying(): boolean { return carrying; },
    setCarrying: (next: boolean): void => { carrying = next; showCarry(); },
    poseDraw,
    equipWeapon,
    getLimbWorldPosition,
    strikeLimbOf: (clip: string) => strikeLimbs.of(clip),
    setElemental,
    get elemental(): boolean { return elemental; },
    get outfit(): OutfitId { return currentOutfit; },
    switchOutfit,
    redress,
  };
}
