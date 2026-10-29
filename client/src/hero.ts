/**
 * Hero loading and setup: loads the hero GLB model at 1 unit = 1 metre, dresses it
 * in worn iron, attaches a sword to the right hand bone so it moves with the swing,
 * enables shadows, and initializes the animation player.
 */

import {
  type AnimationClip,
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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationPlayer } from './anim/index.js';

/**
 * Sword placement in the hand bone's space, measured from the rig: the blade runs
 * along the knuckle line toward the index finger, the handle centred in the fist.
 */
const SWORD_OFFSET: [number, number, number] = [-0.027, 0.094, -0.053];
const SWORD_ROTATION: [number, number, number] = [1.402, 0.005, 0.006];
const SWORD_SCALE = 0.23;
/**
 * Sword across the back in the model's space (+Z forward, +X the hero's left):
 * hilt over the right shoulder, blade down toward the left hip, flat to the back.
 */
const BACK_POSITION = new Vector3(-0.12, 1.42, -0.17);
const BACK_BLADE = new Vector3(0.42, -0.9, 0).normalize();

export interface HeroInstance {
  /** Root 3D container added to the scene. */
  model: Group;
  /** Animation player controlling locomotion and combat clips. */
  anim: AnimationPlayer;
  /** Sword mesh attached to the right hand bone. */
  sword: Object3D;
  /** Right hand bone instance the sword is socketed to. */
  handBone: Bone;
  /** Blade ends in the sword holder's space, for contact checks. */
  bladeBase: Vector3;
  bladeTip: Vector3;
  /** Where the sword rides on the back; its world position is the hilt the hand reaches for. */
  backSocket: Object3D;
  /** Sword in hand (true) or carried on the back (false). */
  arm(armed: boolean): void;
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

/** Dark worn iron for the body, oiled leather for the joints. */
function dressHero(model: Object3D): void {
  const iron = new MeshStandardMaterial({ color: 0x55504a, metalness: 0.75, roughness: 0.5 });
  const leather = new MeshStandardMaterial({ color: 0x2b1e15, metalness: 0.05, roughness: 0.78 });
  model.traverse((node) => {
    if (!(node as Mesh).isMesh) return;
    const mesh = node as Mesh;
    const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? '';
    mesh.material = name.includes('Joints') ? leather : iron;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

/**
 * Loads the hero character, dresses it, attaches the sword to the right hand
 * and sets up the animation player.
 */
export async function loadHero(loader = new GLTFLoader()): Promise<HeroInstance> {
  const heroGltf = await loader.loadAsync('/assets/characters/hero.glb');
  const heroModel = heroGltf.scene;
  heroModel.name = 'Hero';
  dressHero(heroModel);

  const handBone = heroModel.getObjectByName('hand_r') as Bone | undefined;
  if (!handBone) throw new Error('Right hand bone (hand_r) not found in hero rig.');

  let swordMesh: Object3D;
  try {
    const swordGltf = await loader.loadAsync('/assets/characters/sword.glb');
    swordMesh = swordGltf.scene.getObjectByName('Sword')?.clone() ?? createProceduralSword();
  } catch {
    swordMesh = createProceduralSword();
  }
  swordMesh.traverse((child) => {
    if ((child as Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  // A holder keeps the asset's own transform; the blade runs along the holder's +Y.
  const holder = new Group();
  holder.name = 'SwordHolder';
  holder.add(swordMesh);
  // Blade ends from the sword's own bounds, before the holder is placed: the bottom fifth is the grip.
  swordMesh.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(swordMesh);
  const bladeBase = new Vector3(0, bounds.min.y + (bounds.max.y - bounds.min.y) * 0.2, 0);
  const bladeTip = new Vector3(0, bounds.max.y, 0);
  holder.position.set(...SWORD_OFFSET);
  holder.rotation.set(...SWORD_ROTATION);
  holder.scale.setScalar(SWORD_SCALE);
  handBone.add(holder);

  // Back carry: the holder's +Y runs along BACK_BLADE, its +Z points out of the back.
  const spine = heroModel.getObjectByName('spine_03');
  if (!spine) throw new Error('Upper spine bone (spine_03) not found in hero rig.');
  heroModel.updateMatrixWorld(true);
  const toModel = new Matrix4().copy(heroModel.matrixWorld).invert().multiply(spine.matrixWorld);
  const out = new Vector3(0, 0, -1);
  const side = new Vector3().crossVectors(BACK_BLADE, out).normalize();
  const backInModel = new Matrix4().compose(BACK_POSITION,
    new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(side, BACK_BLADE, out)),
    new Vector3().setScalar(SWORD_SCALE));
  const backSocket = new Object3D();
  backSocket.name = 'SwordBackSocket';
  toModel.invert().multiply(backInModel).decompose(backSocket.position, backSocket.quaternion, backSocket.scale);
  spine.add(backSocket);
  const arm = (armed: boolean): void => {
    if (armed) {
      handBone.add(holder);
      holder.position.set(...SWORD_OFFSET);
      holder.rotation.set(...SWORD_ROTATION);
      holder.scale.setScalar(SWORD_SCALE);
    } else {
      backSocket.add(holder);
      holder.position.set(0, 0, 0);
      holder.quaternion.identity();
      holder.scale.setScalar(1);
    }
  };

  // Sword moves share the hero's skeleton and come in a separate animation-only file.
  const combatClips = (await loader.loadAsync('/assets/characters/combat.glb')).animations;
  calmRunBounce(heroGltf.animations);
  const anim = new AnimationPlayer(heroModel, [...heroGltf.animations, ...combatClips], {
    defaultFadeDuration: 0.25,
  });
  anim.play('idle_relaxed');
  arm(false);

  return { model: heroModel, anim, sword: holder, handBone, bladeBase, bladeTip, backSocket, arm };
}
