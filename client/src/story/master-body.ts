import type { AnimationClip, Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BodyKit, type OutfitId } from '../body.js';
import { sanitizeCharacterConfig } from '../creator/creator-types.js';
import { disposeObject } from '../scene.js';

/**
 * A nation's master as drawn: one body for the intro and for the master's post in town. The body kit marks the
 * model's sex, which is the voice the master speaks in. Which master each nation has is still open, so every
 * nation shares this build for now.
 */
export async function buildMasterBody(nation: string): Promise<{ model: Group; clips: AnimationClip[] }> {
  const loader = new GLTFLoader();
  const townSets = await Promise.all(
    ['townsfolk_a', 'townsfolk_b', 'townsfolk_mixamo'].map(name => loader.loadAsync(`/assets/characters/${name}.glb`)),
  );
  try {
    const config = sanitizeCharacterConfig({
      sex: 'male', skinToneId: 'bronze', hairStyleId: 'beard', hairColorId: 'silver', bodyPreset: 'broad',
    });
    const outfit: OutfitId = nation === 'IGNIS' ? 'shaper_ignis' : 'rags';
    const kit = new BodyKit(loader);
    const model = await kit.build(config, 'hero', nation === 'AQUES' ? 0x667f86 : nation === 'TERRA' ? 0x77705e : nation === 'AURA' ? 0x9a8d9e : undefined, outfit);
    const clips = await kit.fitClips(config.sex, townSets.flatMap(set => set.animations), 'townsfolk', outfit);
    model.name = `NationMaster-${nation}`;
    model.traverse(node => {
      if ('isMesh' in node && node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    return { model, clips };
  } finally {
    for (const set of townSets) disposeObject(set.scene);
  }
}
