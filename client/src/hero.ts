/**
 * Hero loading and setup: loads the hero GLB model at 1 unit = 1 metre, dresses it
 * in worn iron, attaches a sword to the right hand bone so it moves with the swing,
 * enables shadows, and initializes the animation player.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type Bone,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationPlayer } from './anim/index.js';

/** Sword placement in the hand bone's space. */
const SWORD_OFFSET: [number, number, number] = [0, 0.08, 0.03];
const SWORD_ROTATION: [number, number, number] = [0, 0, -Math.PI / 2];
const SWORD_SCALE = 0.23;

export interface HeroInstance {
  /** Root 3D container added to the scene. */
  model: Group;
  /** Animation player controlling locomotion and combat clips. */
  anim: AnimationPlayer;
  /** Sword mesh attached to the right hand bone. */
  sword: Object3D;
  /** Right hand bone instance the sword is socketed to. */
  handBone: Bone;
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
  holder.position.set(...SWORD_OFFSET);
  holder.rotation.set(...SWORD_ROTATION);
  holder.scale.setScalar(SWORD_SCALE);
  handBone.add(holder);

  const anim = new AnimationPlayer(heroModel, heroGltf.animations, {
    defaultFadeDuration: 0.25,
  });
  anim.play('idle');

  return { model: heroModel, anim, sword: holder, handBone };
}
