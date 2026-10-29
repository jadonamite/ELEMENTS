/**
 * Hero loading and setup: loads the hero GLB model at 1 unit = 1 metre, attaches
 * a sword to the right hand bone so it moves with the swing, attaches the dark iron
 * helmet to the head bone, enables shadows, and initializes the animation player.
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

export interface HeroInstance {
  /** Root 3D container added to the scene. */
  model: Group;
  /** Animation player controlling locomotion and combat clips. */
  anim: AnimationPlayer;
  /** Sword mesh attached to the right hand bone. */
  sword: Object3D;
  /** Right hand bone instance the sword is socketed to. */
  handBone: Bone;
  /** Helmet mesh attached to head bone, if present. */
  helmet?: Object3D | undefined;
  /** Head bone instance the helmet is socketed to. */
  headBone?: Bone | undefined;
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
 * Loads the hero character, attaches the sword and helmet to the skeleton,
 * and sets up the animation player.
 */
export async function loadHero(loader = new GLTFLoader()): Promise<HeroInstance> {
  const heroGltf = await loader.loadAsync('/assets/characters/hero.glb');
  const heroModel = heroGltf.scene;
  heroModel.name = 'Hero';

  // Enable shadows on all character meshes
  heroModel.traverse((node) => {
    if ((node as Mesh).isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  // Locate the right hand bone (PalmR or MiddleHandR)
  const handBone = (heroModel.getObjectByName('PalmR') ??
    heroModel.getObjectByName('MiddleHandR')) as Bone | undefined;

  if (!handBone) {
    throw new Error('Right hand bone (PalmR) not found in hero rig.');
  }

  // Load and attach the sword mesh to the right hand bone
  let swordMesh: Object3D;
  try {
    const swordGltf = await loader.loadAsync('/assets/characters/sword.glb');
    const sourceSword = swordGltf.scene.getObjectByName('Sword');
    if (sourceSword) {
      swordMesh = sourceSword.clone();
      // Scale matching 1.05m arming sword length inside local bone coordinates
      swordMesh.scale.set(0.75, 0.75, 0.75);
    } else {
      swordMesh = createProceduralSword();
    }
  } catch {
    swordMesh = createProceduralSword();
  }

  swordMesh.traverse((child) => {
    if ((child as Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  handBone.add(swordMesh);

  // Load and attach dark iron helmet to the head bone
  let helmetMesh: Object3D | undefined;
  const headBone = heroModel.getObjectByName('Head') as Bone | undefined;
  if (headBone) {
    try {
      const helmetGltf = await loader.loadAsync('/assets/characters/helmet.glb');
      const sourceHelmet = helmetGltf.scene.getObjectByName('Helmet');
      if (sourceHelmet) {
        helmetMesh = sourceHelmet.clone();
        helmetMesh.scale.set(0.92, 0.92, 0.92);
        helmetMesh.position.set(0, 0.0085, 0);
        helmetMesh.traverse((child) => {
          if ((child as Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        headBone.add(helmetMesh);
      }
    } catch {
      // Helmet asset is optional fallback
    }
  }

  // Initialize the animation player with clips from the hero GLB
  const anim = new AnimationPlayer(heroModel, heroGltf.animations, {
    defaultFadeDuration: 0.25,
  });

  // Default to idle clip
  anim.play('idle');

  return {
    model: heroModel,
    anim,
    sword: swordMesh,
    handBone,
    helmet: helmetMesh,
    headBone,
  };
}

/**
 * Creates a 1m x 1m x 1m test box placed on the floor for direct height reference.
 */
export function createTestBox(x = 1.5, z = 0): Mesh {
  const geo = new BoxGeometry(1, 1, 1);
  const mat = new MeshStandardMaterial({
    color: 0x4a5568,
    roughness: 0.6,
    metalness: 0.2,
  });
  const box = new Mesh(geo, mat);
  box.name = 'TestBox1m';
  box.position.set(x, 0.5, z); // Center at Y=0.5 so base is at Y=0, top at Y=1.0m
  box.castShadow = true;
  box.receiveShadow = true;
  return box;
}
