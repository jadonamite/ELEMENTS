import type { AnimationClip, Group, Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BodyKit } from '../body.js';
import { mergeFarBody } from './far-body.js';
import { sanitizeCharacterConfig } from '../creator/creator-types.js';
import { rollLook, seeded, type Look } from './crowd.js';
import type { Townsperson, TownsfolkRole } from './townsfolk.js';

export interface TownsfolkBody {
  model: Group;
  clips: AnimationClip[];
  loadFar?: () => Promise<TownsfolkBody>;
}

/** What each trade does with its hands standing still. */
export const IDLE: Record<TownsfolkRole, string> = {
  smith: 'fold_arms', trader: 'talk', innkeeper: 'talk', guard: 'fold_arms',
  worshipper: 'idle', porter: 'idle', child: 'idle', sentry: 'fold_arms',
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
export function ownLooks(people: readonly Townsperson[]): Look[] {
  return people.filter(p => !p.look).map((p) => {
    let seed = 0;
    for (const c of p.id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const look = rollLook(p.id, p.role, p.sex, seeded(seed));
    if (look.config.hairStyleId === 'beard' && p.sex === 'female') look.config.hairStyleId = 'none';
    return look;
  });
}

/**
 * One real body per look, built like the fighters, with clips fitted to its rig. Everyone wearing
 * a look is a copy of its body, so a crowd costs one build per look, not per person.
 */
export async function loadLookBodies(looks: readonly Look[], children: ReadonlySet<string>,
  loader = new GLTFLoader(), warm?: (model: Object3D) => Promise<void>): Promise<Map<string, TownsfolkBody>> {
  const sets = await Promise.all(['townsfolk_a', 'townsfolk_b', 'townsfolk_mixamo'].map(f => loader.loadAsync(`/assets/characters/${f}.glb`)));
  const clips = sets.flatMap(s => s.animations);
  const kit = new BodyKit(loader);
  const farKit = new BodyKit(loader, 'far');
  const bodies = new Map<string, TownsfolkBody>();
  for (const look of looks) {
    const config = sanitizeCharacterConfig(look.config);
    const model = await kit.build(config, 'hero', look.cloth, look.outfit);
    model.scale.multiplyScalar(look.height * (children.has(look.id) ? CHILD_SCALE : 1));
    let far: Promise<TownsfolkBody> | undefined;
    bodies.set(look.id, { model, clips: await kit.fitClips(config.sex, clips, 'townsfolk', look.outfit), loadFar: () => far ??= (async () => {
      const model = await farKit.build(config, 'hero', look.cloth, look.outfit);
      model.scale.copy(bodies.get(look.id)!.model.scale);
      model.traverse(n => {
        if (!(n as Mesh).isMesh) return;
        (n as Mesh).castShadow = false;
        if (/^eye/i.test(n.name)) n.visible = false;
      });
      const bones = new Set<string>();
      model.traverse(n => { if (n.type === 'Bone') bones.add(n.name); });
      const fitted = await farKit.fitClips(config.sex, clips, 'townsfolk', look.outfit);
      const reduced = fitted.map(clip => {
        const copy = clip.clone();
        copy.tracks = copy.tracks.filter(t => bones.has(t.name.split('.')[0]!));
        return copy;
      });
      mergeFarBody(model);
      await warm?.(model);
      return { model, clips: reduced };
    })() });
  }
  return bodies;
}
