import type { CharacterConfig } from '../creator/creator-types.js';
import { BODY_PRESET_OPTIONS, HAIR_COLOR_PRESETS, HAIR_STYLE_OPTIONS, SKIN_TONE_PRESETS } from '../creator/creator-types.js';
import type { Townsperson, TownsfolkRole } from './townsfolk.js';

/** One way a person can look: body, hair, skin, build, height and cloth dye. Built once, copied for everyone who wears it. */
export interface Look {
  id: string;
  config: CharacterConfig;
  cloth: number;
  /** Height on top of the build preset; children are scaled again by the body loader. */
  height: number;
}

/** Small seeded random, so the same town comes back every visit. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;

/** Cloth dyes by trade over the outfit's own texture: soot-dark wool, leather, undyed linen, ember red. */
export const CLOTH: Record<TownsfolkRole, readonly number[]> = {
  smith: [0x8a7a6c, 0x7a6e64, 0x96806a, 0x6e625a],
  trader: [0xc9a27e, 0xb88a6a, 0xd8c3a5, 0xa8937a, 0x9c6b4e],
  innkeeper: [0xc4a88a, 0xb5927a],
  guard: [0x8f8f94, 0x9c948c],
  worshipper: [0xb5654a, 0xa8473a, 0xc08a6a, 0x8e3a2c],
  porter: [0xb3a48c, 0xa39478, 0xc2b296, 0x8c7c64],
  child: [0xd0b490, 0xc29a78, 0xb87a5a],
};

/** A look rolled for a trade and sex, varied in every part the body kit offers. */
export function rollLook(id: string, role: TownsfolkRole, sex: 'male' | 'female', r: () => number): Look {
  const hairs = HAIR_STYLE_OPTIONS.filter(h => h.allowedSex.includes(sex));
  return {
    id,
    config: {
      sex,
      skinToneId: pick(r, SKIN_TONE_PRESETS).id,
      hairStyleId: pick(r, hairs).id,
      hairColorId: pick(r, HAIR_COLOR_PRESETS).id,
      bodyPreset: role === 'child' ? 'lean' : pick(r, BODY_PRESET_OPTIONS).id,
    },
    cloth: pick(r, CLOTH[role]),
    height: 0.93 + r() * 0.13,
  };
}

const MALE = ['Hrafn', 'Ulf', 'Bjarni', 'Eirik', 'Gunnar', 'Halvard', 'Ketil', 'Leif', 'Orm', 'Ragnar', 'Sigurd', 'Thorkel', 'Vidar', 'Arn', 'Egil', 'Fafnir', 'Grim', 'Hakon', 'Ivar', 'Knut', 'Ottar', 'Sten', 'Toke', 'Yngve'];
const FEMALE = ['Astrid', 'Brynja', 'Dagny', 'Eydis', 'Frida', 'Gudrun', 'Hild', 'Ingrid', 'Jorunn', 'Kari', 'Liv', 'Ragna', 'Sigrid', 'Thora', 'Unn', 'Yrsa', 'Asa', 'Bera', 'Edda', 'Gyda', 'Halla', 'Ragnhild', 'Signy', 'Tova'];
const BYNAME = ['Ash-Walker', 'Coal-Eye', 'of the Slag Well', 'Ember-Hand', 'Soot-Cheek', 'of Cinder Row', 'Kiln-Born', 'Iron-Back', 'Bellows', 'of the West Gate', 'Smoke-Hair', 'Quench', 'Cinder-Foot', 'of the Rise', 'Sparks', 'Basalt', 'Tongs', 'of the Forge Lane', 'Ore-Carrier', 'Red-Cloak'];
const CHILD = ['little', 'young'];

/** How the crowd divides into trades; children and porters are what make a street feel lived in. */
const CROWD_ROLES: readonly [TownsfolkRole, number][] = [
  ['porter', 0.26], ['trader', 0.22], ['smith', 0.16], ['worshipper', 0.12], ['child', 0.16], ['guard', 0.08],
];

const DIALOGUE: Record<TownsfolkRole, string> = {
  smith: 'smith_sindr', trader: 'trader_sindr', innkeeper: 'innkeeper_sindr', guard: 'guard_sindr',
  worshipper: 'worshipper_sindr', porter: 'porter_sindr', child: 'child_sindr',
};

export interface Crowd {
  /** Looks worn by the crowd; each is built once. */
  looks: Look[];
  /** The people, each wandering the street in one of the looks. */
  people: Townsperson[];
}

/**
 * A town crowd: `lookCount` distinct looks worn by `count` people, each with their own name and trade.
 * Same seed, same crowd. Positions come later, from the streets the world says are open.
 */
export function makeCrowd(count: number, lookCount: number, seed = 7): Crowd {
  const r = seeded(seed);
  const looks: Look[] = [];
  const lookRole: TownsfolkRole[] = [];
  const lookSex: ('male' | 'female')[] = [];
  for (let i = 0; i < lookCount; i++) {
    let x = r(), role: TownsfolkRole = 'porter';
    for (const [name, share] of CROWD_ROLES) { if ((x -= share) < 0) { role = name; break; } }
    const sex = r() < 0.5 ? 'male' : 'female';
    looks.push(rollLook(`crowd_look_${i}`, role, sex, r));
    lookRole.push(role);
    lookSex.push(sex);
  }
  const used = new Set<string>();
  const people: Townsperson[] = [];
  for (let i = 0; i < count; i++) {
    const l = i % lookCount;
    const role = lookRole[l]!, sex = lookSex[l]!;
    let name = '';
    for (let tries = 0; tries < 40 && (!name || used.has(name)); tries++) {
      const first = pick(r, sex === 'male' ? MALE : FEMALE);
      name = role === 'child' ? `${first}, ${pick(r, CHILD)} ${sex === 'male' ? 'son' : 'daughter'} of ${pick(r, MALE)}` : `${first} ${pick(r, BYNAME)}`;
    }
    used.add(name);
    const isLit = r() < 0.2;
    const here = { x: 0, y: 0, z: 0, facing: 0 };
    people.push({
      id: `crowd_${i}`, name, role, dialogueRole: DIALOGUE[role], isLit, element: isLit ? 'IGNIS' : 'DIM', sex,
      look: looks[l]!.id, wander: true,
      schedule: { work: here, market: here, inn: here, home: here },
    });
  }
  return { looks, people };
}
