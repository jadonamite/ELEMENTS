import type { AnimationClip, Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BodyKit } from '../body.js';
import { rollRandomCharacter, sanitizeCharacterConfig } from '../creator/creator-types.js';
import { SINDR_TOWNSFOLK, type Townsperson, type TownsfolkRole } from './townsfolk.js';

export interface TownsfolkBody {
  model: Group;
  clips: AnimationClip[];
  /** Clip played standing at a waypoint. */
  idle: string;
  /** Clip played walking between waypoints. */
  walk: string;
}

/** What each trade does with its hands standing still. */
const IDLE: Record<TownsfolkRole, string> = {
  smith: 'fold_arms', trader: 'talk', innkeeper: 'talk', guard: 'fold_arms',
  worshipper: 'idle', porter: 'idle', child: 'idle',
};

/** Everyday walks; each person keeps one, so no two neighbours move alike. */
const WALKS = ['walk', 'walk_plain', 'walk_easy', 'walk_strut', 'walk_sage'];
const FEMALE_WALKS = [...WALKS, 'walk_female', 'walk_female'];

function walkFor(npc: Townsperson, i: number): string {
  if (npc.role === 'porter') return i % 2 ? 'walk_carry' : 'walk_carry_box';
  if (npc.role === 'trader' && i % 3 === 0) return 'walk_bag';
  if (npc.role === 'guard') return 'walk_plain';
  const pool = npc.sex === 'female' ? FEMALE_WALKS : WALKS;
  return pool[i % pool.length]!;
}

/** Tints over the outfit's own cloth texture, by trade: soot-dark wool, leather, undyed linen, ember red. */
const CLOTH: Record<TownsfolkRole, readonly number[]> = {
  smith: [0x8a7a6c, 0x7a6e64, 0x96806a],
  trader: [0xc9a27e, 0xb88a6a, 0xd8c3a5, 0xa8937a],
  innkeeper: [0xc4a88a, 0xb5927a],
  guard: [0x8f8f94, 0x9c948c],
  worshipper: [0xb5654a, 0xa8473a, 0xc08a6a],
  porter: [0xb3a48c, 0xa39478, 0xc2b296],
  child: [0xd0b490, 0xc29a78, 0xb87a5a],
};

const CHILD_SCALE = 0.72;

/** One real body per townsperson, built like the fighters, with walk and idle fitted to its rig. */
export async function loadTownsfolkBodies(
  people: readonly Townsperson[] = SINDR_TOWNSFOLK,
  loader = new GLTFLoader(),
): Promise<Map<string, TownsfolkBody>> {
  const sets = await Promise.all(['townsfolk_a', 'townsfolk_b', 'townsfolk_mixamo'].map(f => loader.loadAsync(`/assets/characters/${f}.glb`)));
  const clips = sets.flatMap(s => s.animations);
  const kit = new BodyKit(loader);
  const bodies = new Map<string, TownsfolkBody>();
  for (const [i, npc] of people.entries()) {
    const config = rollRandomCharacter();
    config.sex = npc.sex;
    if (config.hairStyleId === 'beard' && config.sex === 'female') config.hairStyleId = 'none';
    const palette = CLOTH[npc.role];
    const model = await kit.build(sanitizeCharacterConfig(config), 'hero', palette[i % palette.length]);
    if (npc.role === 'child') model.scale.multiplyScalar(CHILD_SCALE);
    bodies.set(npc.id, { model, clips: await kit.fitClips(config.sex, clips, 'townsfolk'), idle: IDLE[npc.role], walk: walkFor(npc, i) });
  }
  return bodies;
}
