import type { AnimationClip, Group, Mesh, Object3D, SkinnedMesh } from 'three';
import { AnimationPlayer } from '../anim/player.js';
import type { Loaders } from '../assets/loaders.js';
import { bodyKit, markRest, type OutfitId } from '../body.js';
import { sanitizeCharacterConfig } from '../creator/creator-types.js';

/**
 * A nation's master as drawn: one body for the intro and for the master's post in town, built from the close-up
 * set, with the player that moves it (feet kept on the floor, as every walking body's are). The body kit marks the
 * model's sex, which is the voice the master speaks in.
 */
export async function buildMasterBody(loaders: Loaders, nation: string): Promise<{ model: Group; clips: AnimationClip[]; anim: AnimationPlayer }> {
  const townSets = await Promise.all(
    ['townsfolk_a', 'townsfolk_b', 'townsfolk_mixamo'].map(name => loaders.model(`/assets/characters/${name}.glb`)),
  );
  const config = sanitizeCharacterConfig({
    sex: 'male', skinToneId: 'bronze', hairStyleId: 'beard', hairColorId: 'silver', bodyPreset: 'broad',
  });
  // IGNIS has his own whole person (Brandr from his sheet); the other masters wear rags until theirs are built.
  const outfit: OutfitId = nation === 'IGNIS' ? 'master_ignis' : 'rags';
  const kit = bodyKit(loaders, 'close');
  const model = await kit.build(config, 'hero', nation === 'AQUES' ? 0x667f86 : nation === 'TERRA' ? 0x77705e : nation === 'AURA' ? 0x9a8d9e : undefined, outfit);
  try {
    const clips = await kit.fitClips(config.sex, townSets.flatMap(markRest), 'townsfolk', outfit);
    model.name = `NationMaster-${nation}`;
    model.traverse(node => {
      if ('isMesh' in node && node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    return { model, clips, anim: new AnimationPlayer(model, clips, { defaultFadeDuration: 0.25, plantFeet: true }) };
  } catch (error) {
    releaseMaster(model);
    throw error;
  }
}

/** The master's own materials and skeletons go; geometry and textures belong to the shared body files the crowd also draws. */
export function releaseMaster(model: Object3D): void {
  model.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as SkinnedMesh).isSkinnedMesh) (mesh as SkinnedMesh).skeleton.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  });
}
