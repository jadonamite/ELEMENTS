import type { AnimationClip, Group, Mesh, Object3D } from 'three';
import type { Loaders } from '../assets/loaders.js';
import { bodyKit, type BodyKit, markRest } from '../body.js';
import { mergeFarBody } from './far-body.js';
import { sanitizeCharacterConfig } from '../creator/creator-types.js';
import { rollLook, seeded, type Look, type PlayerPerson } from './crowd.js';
import type { Townsperson, TownsfolkRole } from './townsfolk.js';

export interface TownsfolkBody {
  model: Group;
  clips: AnimationClip[];
  loadFar?: () => Promise<TownsfolkBody>;
}

/** What each trade does with its hands standing still. */
export const IDLE: Record<TownsfolkRole, string> = {
  smith: 'fold_arms', trader: 'talk', innkeeper: 'talk', guard: 'fold_arms',
  worshipper: 'idle', porter: 'idle', child: 'idle',
};

/** Everyday walks; each person keeps one, so no two neighbours move alike. */
const WALKS = ['walk', 'walk_plain', 'walk_easy', 'walk_strut', 'walk_sage'];
const FEMALE_WALKS = [...WALKS, 'walk_female', 'walk_female'];

export function walkFor(npc: Townsperson, i: number): string {
  if (npc.role === 'porter') return i % 2 ? 'walk_carry' : 'walk_carry_box';
  if (npc.role === 'trader' && i % 3 === 0) return 'walk_bag';
  if (npc.role === 'guard') return 'walk_plain';
  const pool = npc.sex === 'female' ? FEMALE_WALKS : WALKS;
  return pool[i % pool.length]!;
}

const CHILD_SCALE = 0.72;

/** Named townsfolk each get a look of their own, rolled from their id so it stays the same. */
export function ownLooks(people: readonly Townsperson[], player?: PlayerPerson): Look[] {
  return people.filter(p => !p.look).map((p) => {
    let seed = 0;
    for (const c of p.id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const look = rollLook(p.id, p.role, p.sex, seeded(seed), player);
    if (look.config.hairStyleId === 'beard' && p.sex === 'female') look.config.hairStyleId = 'none';
    return look;
  });
}

/**
 * One real body per look, built like the fighters, with clips fitted to its rig. Everyone wearing
 * a look is a copy of its body, so a crowd costs one build per look, not per person. Looks are built
 * in batches (the people near the start first) and each batch side by side; the kits keep what loaded.
 */
export class LookBodies {
  private readonly kit: BodyKit;
  private readonly farKit: BodyKit;
  private readonly clips: Promise<AnimationClip[]>;

  constructor(private readonly children: ReadonlySet<string>, loaders: Loaders,
    private readonly warm?: (model: Object3D) => Promise<void>) {
    this.kit = bodyKit(loaders);
    this.farKit = bodyKit(loaders, 'far');
    this.clips = Promise.all(['townsfolk_a', 'townsfolk_b', 'townsfolk_mixamo'].map(f => loaders.model(`/assets/characters/${f}.glb`)))
      .then(sets => sets.flatMap(markRest));
  }

  async build(looks: readonly Look[]): Promise<Map<string, TownsfolkBody>> {
    const clips = await this.clips;
    return new Map(await Promise.all(looks.map(async (look): Promise<[string, TownsfolkBody]> => [look.id, await this.body(look, clips)])));
  }

  private async body(look: Look, clips: readonly AnimationClip[]): Promise<TownsfolkBody> {
    const config = sanitizeCharacterConfig(look.config);
    const [model, fitted] = await Promise.all([
      this.kit.build(config, 'hero', look.cloth, look.outfit),
      this.kit.fitClips(config.sex, clips, 'townsfolk', look.outfit),
    ]);
    model.scale.multiplyScalar(look.height * (this.children.has(look.id) ? CHILD_SCALE : 1));
    let far: Promise<TownsfolkBody> | undefined;
    return { model, clips: fitted, loadFar: () => far ??= (async () => {
      const farModel = await this.farKit.build(config, 'hero', look.cloth, look.outfit);
      farModel.scale.copy(model.scale);
      farModel.traverse(n => {
        if (!(n as Mesh).isMesh) return;
        (n as Mesh).castShadow = false;
        if (/^eye/i.test(n.name)) n.visible = false;
      });
      const bones = new Set<string>();
      farModel.traverse(n => { if (n.type === 'Bone') bones.add(n.name); });
      const farFitted = await this.farKit.fitClips(config.sex, clips, 'townsfolk', look.outfit);
      const reduced = farFitted.map(clip => {
        const copy = clip.clone();
        copy.tracks = copy.tracks.filter(t => bones.has(t.name.split('.')[0]!));
        return copy;
      });
      mergeFarBody(farModel);
      await this.warm?.(farModel);
      return { model: farModel, clips: reduced };
    })() };
  }
}
