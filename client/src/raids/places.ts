import type { DungeonDef } from '../../../shared/src/index.js';
import type { WorldBuilder } from '../world/builder.js';
import type { Surface } from '../world/materials.js';

/** The Raid Hall's interior and the Undervault's hand-built rooms, built from the IGNIS kit surfaces and props. */

export interface Spot { x: number; z: number }

/** Where things stand inside the Hall; the hero walks to them and presses C. */
export const HALL = {
  spawn: { x: 0, z: 11, facing: Math.PI },
  counter: { x: 0, z: -7.2 },
  broker: { x: 0, z: -9.6 },
  fighters: { x: -8.6, z: -3, step: 2.2 },
  salvage: { x: 8.2, z: 1.5 },
  salvageBuyer: { x: 9.6, z: 3.0 },
  board: { x: 10.4, z: -6 },
  stair: { x: 7.5, z: -11 },
};

function shell(b: WorldBuilder, x0: number, x1: number, z0: number, z1: number, h: number, wall: Surface, floor: Surface,
  doors: { south?: number; north?: number }, ceiling: Surface = 'basalt_rock_face'): void {
  const t = 1.2;
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.at(0, 0, 0);
  b.box(floor, cx, -0.15, cz, w, 0.3, d);
  b.box(ceiling, cx, h + 0.4, cz, w + t * 2, 0.8, d + t * 2);
  b.solid(cx, h + 0.4, cz, w + t * 2, 0.8, d + t * 2);
  for (const [x, sx] of [[x0 - t / 2, t], [x1 + t / 2, t]] as const) {
    b.box(wall, x, h / 2, cz, sx, h, d + t * 2);
    b.solid(x, h / 2, cz, sx, h, d + t * 2);
  }
  for (const [z, gap] of [[z0 - t / 2, doors.south ?? 0], [z1 + t / 2, doors.north ?? 0]] as const) {
    if (gap <= 0) { b.box(wall, cx, h / 2, z, w, h, t); b.solid(cx, h / 2, z, w, h, t); continue; }
    const side = (w - gap) / 2;
    for (const sx of [x0 + side / 2, x1 - side / 2]) { b.box(wall, sx, h / 2, z, side, h, t); b.solid(sx, h / 2, z, side, h, t); }
    const lintel = h - 4.2;
    if (lintel > 0) { b.box(wall, cx, 4.2 + lintel / 2, z, gap, lintel, t); b.solid(cx, 4.2 + lintel / 2, z, gap, lintel, t); }
    b.box('blackened_rusted_iron', cx, 4.25, z, gap + 0.6, 0.3, t + 0.2);
  }
}

function brazier(b: WorldBuilder, x: number, z: number, scale = 1): void {
  b.at(0, 0, 0);
  b.prop('iron_brazier', x, z, 0, scale);
  b.fire(x, 1.05 * scale, z, 0.55 * scale);
  b.light(x, 1.6 * scale, z, 0xff7a30, 6 * scale, 11 * scale, 0.3);
  b.solid(x, 0.6, z, 0.7, 1.2, 0.7);
}

function torchBracket(b: WorldBuilder, x: number, z: number, y = 2.8): void {
  b.box('blackened_rusted_iron', x, y, z, 0.18, 0.5, 0.18);
  b.fire(x, y + 0.35, z, 0.3);
  b.light(x, y + 0.6, z, 0xff8a40, 3.2, 8, 0.35);
}

/** The Sindr branch: soot-black hall, a counter of black timber, fighters along the west wall, the salvage corner east. */
export function buildHall(b: WorldBuilder): void {
  const x0 = -12, x1 = 12, z0 = -13, z1 = 14, h = 9;
  shell(b, x0, x1, z0, z1, h, 'ashlar_stone_blocks', 'basalt_cobblestone', { south: 3.4 }, 'charred_timber_beams');
  b.at(0, 0, 0);
  // Street door: a pale slab of daylight behind the threshold.
  b.box('window', 0, 2.1, z1 + 1.25, 3.4, 4.2, 0.05, undefined, { u: 1, v: 1 });
  b.light(0, 3, z1 - 1, 0xffd6a0, 3, 9, 0);
  // Roof trusses and posts.
  for (let z = z0 + 3; z < z1; z += 5) {
    b.box('charred_timber_beams', 0, h - 0.6, z, x1 - x0, 0.5, 0.5);
    for (const x of [x0 + 0.6, x1 - 0.6]) b.box('charred_timber_beams', x, h / 2, z, 0.5, h, 0.5);
  }
  // Counter across the north end.
  b.box('charred_timber_beams', 0, 0.55, -8.2, 8, 1.1, 1.0);
  b.box('red_lacquer', 0, 1.15, -8.2, 8.3, 0.1, 1.2);
  b.solid(0, 0.6, -8.2, 8, 1.2, 1.0);
  // Key rack on the wall behind: iron pegs, a few keys of dull bronze.
  b.box('charred_timber_beams', 0, 3.2, z0 + 0.1, 5, 1.6, 0.2);
  for (let i = 0; i < 8; i++) {
    b.box('blackened_rusted_iron', -2 + i * 0.57, 3.5, z0 + 0.3, 0.06, 0.06, 0.3);
    if (i % 3 !== 1) b.box('gold_trim', -2 + i * 0.57, 3.15, z0 + 0.42, 0.12, 0.5, 0.04);
  }
  // Banners of the Hall.
  for (const x of [-5, 5]) b.box('red_lacquer', x, 5.6, z0 + 0.15, 1.8, 4, 0.06);
  // Fighters' corner: a rack of weapons and a bench.
  b.box('charred_timber_beams', x0 + 0.5, 1.6, -1, 0.3, 2.4, 8);
  for (let i = 0; i < 6; i++) b.box('blackened_rusted_iron', x0 + 0.75, 1.7, -4.2 + i * 1.3, 0.08, 2.2, 0.08, { z: 0.12 });
  b.box('charred_timber_beams', x0 + 1.3, 0.45, 6, 0.8, 0.9, 5);
  b.solid(x0 + 1.3, 0.45, 6, 0.8, 0.9, 5);
  // Salvage corner: crates, barrels, a weighing table.
  b.box('charred_timber_beams', HALL.salvage.x + 0.6, 0.5, HALL.salvage.z + 0.2, 1.6, 1.0, 2.6);
  b.box('blackened_rusted_iron', HALL.salvage.x + 0.6, 1.1, HALL.salvage.z - 0.4, 0.5, 0.2, 0.5);
  b.solid(HALL.salvage.x + 0.6, 0.5, HALL.salvage.z + 0.2, 1.6, 1.0, 2.6);
  for (const [x, z, id, s] of [[10.6, 6.5, 'crate', 1], [10.4, 8.2, 'crate', 0.9], [9.2, 7.6, 'barrel', 1], [10.8, -1.6, 'barrel', 1], [10.5, 10.8, 'crate', 1.1]] as const) {
    b.prop(id, x, z, x * 0.3, s);
    b.solid(x, 0.5, z, 1.0 * s, 1, 1.0 * s);
  }
  // Job and complaints board on the east wall.
  b.box('charred_timber_beams', x1 - 0.1, 2.6, HALL.board.z, 0.2, 2.2, 3.2);
  for (let i = 0; i < 7; i++) b.box('lime_plaster', x1 - 0.22, 2.2 + (i % 2) * 0.8, HALL.board.z - 1.2 + i * 0.4, 0.03, 0.55, 0.36);
  // The stair down to the Undervault: an iron-bound doorway in the north-east corner.
  b.box('basalt_rock_face', HALL.stair.x, 2.4, z0 + 0.4, 3.4, 4.8, 0.6);
  b.box('blackened_rusted_iron', HALL.stair.x, 2.0, z0 + 0.75, 2.4, 3.6, 0.12);
  for (let i = 0; i < 4; i++) b.box('gold_trim', HALL.stair.x - 0.9 + i * 0.6, 2, z0 + 0.84, 0.06, 3.4, 0.04);
  b.box('lava', HALL.stair.x, 0.12, z0 + 1.6, 2.2, 0.04, 0.6);
  b.light(HALL.stair.x, 1.2, z0 + 1.8, 0xff4a10, 2.5, 5, 0.4);
  brazier(b, -4.5, -6);
  brazier(b, 4.5, -6);
  brazier(b, -6, 7);
  brazier(b, 6, 7);
  for (const z of [-10, 0, 10]) { torchBracket(b, x0 + 0.2, z); torchBracket(b, x1 - 0.2, z + 2); }
}

export interface PlacedRoom {
  id: string;
  index: number;
  kind: 'entry' | 'fight' | 'boss';
  name: string;
  x0: number; x1: number; z0: number; z1: number; h: number;
  /** Where foes appear when the party walks in. */
  spawns: Spot[];
  /** The carved tablet, if the room has one. */
  carving: Spot | null;
  carvingText: string | null;
  /** The doorway out, closed by the gate until the room is cleared. */
  gate: { x: number; z: number; w: number } | null;
  start: Spot;
}

export const DUNGEON_Z = 300;
const CORRIDOR = 7;

/** Lays the run's rooms end to end, in the order the server drew. */
export function layoutRun(order: readonly string[], dungeon: DungeonDef): PlacedRoom[] {
  let z = DUNGEON_Z;
  return order.map((id, index) => {
    const def = dungeon.rooms[id]!;
    const [w, d, h] = def.kind === 'boss' ? [32, 32, 14] : def.kind === 'entry' ? [14, 16, 7] : [22, 24, 8];
    const room: PlacedRoom = {
      id, index, kind: def.kind, name: def.name, x0: -w / 2, x1: w / 2, z0: z, z1: z + d, h,
      spawns: [], carving: null, carvingText: def.carving ? dungeon.carvings[def.carving] ?? null : null,
      gate: index < order.length - 1 ? { x: 0, z: z + d + 0.6, w: 3.6 } : null,
      start: { x: 0, z: z + 2.5 },
    };
    const n = def.enemies.reduce((s, e) => s + e.count, 0);
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI - Math.PI / 2;
      room.spawns.push({ x: Math.sin(a) * w * 0.28, z: z + d * 0.68 + Math.cos(a) * d * 0.12 });
    }
    if (def.kind === 'boss') room.spawns[0] = { x: 0, z: z + d * 0.62 };
    if (room.carvingText) room.carving = { x: w / 2 - 1.4, z: z + d * 0.3 };
    z += d + CORRIDOR;
    return room;
  });
}

function corridor(b: WorldBuilder, from: PlacedRoom): void {
  const z0 = from.z1 + 1.2, z1 = z0 + CORRIDOR - 2.4, w = 4.4, h = 4.4;
  b.at(0, 0, 0);
  b.box('basalt_cobblestone', 0, -0.15, (z0 + z1) / 2, w, 0.3, z1 - z0 + 2.4);
  b.box('basalt_rock_face', 0, h + 0.4, (z0 + z1) / 2, w + 2, 0.8, z1 - z0 + 2.4);
  for (const x of [-w / 2 - 0.5, w / 2 + 0.5]) {
    b.box('ashlar_stone_blocks', x, h / 2, (z0 + z1) / 2, 1, h, z1 - z0 + 2.4);
    b.solid(x, h / 2, (z0 + z1) / 2, 1, h, z1 - z0 + 2.4);
  }
  torchBracket(b, -w / 2 + 0.05, (z0 + z1) / 2, 2.6);
}

function carvingTablet(b: WorldBuilder, at: Spot): void {
  b.at(0, 0, 0);
  b.box('pale_stone', at.x + 0.6, 1.8, at.z, 0.4, 3.0, 2.2);
  // The old names glow faintly in the cut lines.
  for (let i = 0; i < 6; i++) b.box('forge', at.x + 0.38, 1.0 + i * 0.4, at.z - 0.6 + (i % 3) * 0.5, 0.03, 0.08, 0.5);
  b.light(at.x - 0.2, 2, at.z, 0xff9a50, 1.6, 4, 0.1);
  b.solid(at.x + 0.6, 1.5, at.z, 0.4, 3, 2.2);
}

/** Each room id has its own hand-built dressing on the common shell. */
export function buildRoom(b: WorldBuilder, r: PlacedRoom, isLast: boolean): void {
  const cz = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0;
  const wall: Surface = r.kind === 'boss' ? 'basalt_rock_face' : 'ashlar_stone_blocks';
  shell(b, r.x0, r.x1, r.z0, r.z1, r.h, wall, r.kind === 'boss' ? 'cooled_lava_crust' : 'basalt_cobblestone', { south: r.index === 0 ? 0 : 3.6, north: isLast ? 0 : 3.6 });
  if (!isLast) corridor(b, r);
  b.at(0, 0, 0);
  if (r.carving) carvingTablet(b, r.carving);
  switch (r.id) {
    case 'vault_gate': {
      // The stair the party came down, and the great key door.
      for (let i = 0; i < 8; i++) { b.box('ashlar_stone_blocks', 0, 0.2 + i * 0.35, r.z0 + 0.6 + i * 0.1, 5, 0.4, 1.4 - i * 0.1); }
      b.solid(0, 1.4, r.z0 + 0.8, 5, 2.8, 1.6);
      for (const x of [-4.5, 4.5]) b.column(x, r.z1 - 2, r.h - 0.2, 0.45, { mat: 'basalt_rock_face', baseMat: 'ashlar_stone_blocks' });
      b.box('gold_trim', 0, 4.9, r.z1 + 0.1, 5.2, 0.25, 0.3);
      brazier(b, -4.2, cz);
      brazier(b, 4.2, cz);
      break;
    }
    case 'collapsed_hall': {
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
        const z = r.z0 + 4 + i * 5.2;
        if ((i + (s > 0 ? 1 : 0)) % 3 === 2) {
          // A fallen column across the floor.
          b.box('ashlar_stone_blocks', s * 5, 0.45, z, 0.9, 0.9, 4.5, { y: 0.5 * s });
          b.solid(s * 5, 0.45, z, 1.6, 0.9, 3.6);
        } else b.column(s * 6.5, z, r.h - 0.3, 0.42, { mat: 'ashlar_stone_blocks', baseMat: 'basalt_rock_face' });
      }
      for (const [x, z, id, sc] of [[-8, r.z0 + 7, 'boulder_large', 0.9], [8.5, r.z0 + 16, 'boulder_medium_a', 1.2], [-3, r.z0 + 20, 'rock_cluster_a', 1], [7, r.z0 + 3, 'rock_cluster_b', 1]] as const) {
        b.prop(id, x, z, x, sc);
        b.solid(x, 0.6, z, 1.6 * sc, 1.2, 1.6 * sc);
      }
      // Light falls through a break in the vault.
      b.light(2, r.h - 0.5, cz + 2, 0xc8d4ff, 3, 12, 0);
      brazier(b, -8.5, r.z1 - 3);
      torchBracket(b, r.x0 + 0.15, r.z0 + 6);
      break;
    }
    case 'name_gallery': {
      // Carved panels along both walls, the names lit in their cuts.
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
        const z = r.z0 + 3 + i * 4.4;
        b.box('pale_stone', s * (w / 2 - 0.15), 3, z, 0.3, 4, 2.8);
        for (let k = 0; k < 4; k++) b.box('forge', s * (w / 2 - 0.32), 2 + k * 0.6, z - 0.8 + (k % 2) * 0.9, 0.03, 0.1, 0.7);
        b.prop('stone_pillar', s * (w / 2 - 2.2), z + 2.2, 0, 0.8);
        b.solid(s * (w / 2 - 2.2), 1.5, z + 2.2, 0.9, 3, 0.9);
      }
      for (let i = 0; i < 3; i++) torchBracket(b, 0, r.z0 + 5 + i * 7, r.h - 1.4);
      brazier(b, 0, cz);
      break;
    }
    case 'cinder_well': {
      // A lava channel across the room, two bridges over it.
      const lz = cz - 1;
      b.box('lava', 0, 0.02, lz, w, 0.06, 3.4);
      b.box('basalt_rock_face', 0, -0.4, lz, w, 0.6, 4.2);
      for (const x of [-4.5, 4.5]) {
        b.box('ashlar_stone_blocks', x, 0.15, lz, 3, 0.3, 4.6);
        for (const s of [-1, 1]) { b.box('blackened_rusted_iron', x + s * 1.45, 0.8, lz, 0.08, 1.0, 4.6); b.solid(x + s * 1.45, 0.8, lz, 0.1, 1.6, 4.6); }
      }
      for (const [xa, xb] of [[r.x0, -6], [-3, 3], [6, r.x1]] as const) b.solid((xa + xb) / 2, 1, lz, xb - xa, 2, 3.4);
      for (let i = 0; i < 6; i++) b.light(-9 + i * 3.6, 0.6, lz, 0xff4a10, 3.5, 6, 0.5);
      b.fire(-8, 0.2, lz, 0.5); b.fire(2, 0.2, lz, 0.4); b.fire(8.5, 0.2, lz, 0.45);
      torchBracket(b, r.x0 + 0.15, r.z1 - 4);
      torchBracket(b, r.x1 - 0.15, r.z0 + 4);
      break;
    }
    case 'slag_crypt': {
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
        const z = r.z0 + 6 + i * 6;
        b.box('basalt_rock_face', s * 6.5, 0.6, z, 2.2, 1.2, 4);
        b.box('ashlar_stone_blocks', s * 6.5, 1.3, z, 2.4, 0.2, 4.2, i === 1 ? { y: 0.25 * s } : undefined);
        b.solid(s * 6.5, 0.7, z, 2.4, 1.4, 4.2);
      }
      // The scavengers' camp: a fire, their crates and barrels.
      b.fire(0, 0.1, cz + 3, 0.7);
      b.light(0, 1, cz + 3, 0xff8030, 5, 10, 0.4);
      for (const [x, z, id] of [[2.2, cz + 5, 'crate'], [-2.4, cz + 4.6, 'barrel'], [1.6, cz + 6.4, 'barrel'], [-1.2, cz + 6.8, 'crate']] as const) {
        b.prop(id, x, z, x, 0.9); b.solid(x, 0.45, z, 0.9, 0.9, 0.9);
      }
      b.prop('wooden_cart', -7.5, r.z1 - 3, 0.8, 0.9);
      b.solid(-7.5, 0.6, r.z1 - 3, 2.4, 1.2, 1.6);
      torchBracket(b, r.x1 - 0.15, r.z0 + 3);
      break;
    }
    case 'silent_forge': {
      // A cold forge mouth with the last heat in its throat, anvils, slag heaps.
      b.box('ashlar_stone_blocks', 0, 2.2, r.z1 - 1.6, 6, 4.4, 2.4);
      b.box('forge', 0, 1.2, r.z1 - 2.85, 2.6, 1.4, 0.06);
      b.light(0, 1.4, r.z1 - 3.6, 0xff5a10, 4, 9, 0.2);
      b.solid(0, 2.2, r.z1 - 1.6, 6, 4.4, 2.4);
      for (const [x, z] of [[-5, cz - 3], [5, cz - 2], [-3, cz + 4], [6.5, cz + 5]] as const) {
        b.prop('anvil', x, z, x * 0.4, 1.2); b.solid(x, 0.45, z, 1.1, 0.9, 0.6);
      }
      for (const [x, z] of [[-8.5, r.z0 + 4], [8.2, r.z1 - 6]] as const) {
        b.prop('rock_cluster_a', x, z, 0, 1.2); b.box('cooled_lava_crust', x, 0.2, z, 3, 0.4, 3);
      }
      for (let i = 0; i < 5; i++) b.box('blackened_rusted_iron', -6 + i * 3, r.h - 1.6, cz, 0.06, 3.2, 0.06);
      brazier(b, -8.8, r.z1 - 3);
      brazier(b, 8.8, r.z0 + 3);
      break;
    }
    case 'warden_chamber': {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        b.column(Math.cos(a) * 12, cz + Math.sin(a) * 12, r.h - 0.3, 0.75, { mat: 'basalt_rock_face', baseMat: 'ashlar_stone_blocks' });
      }
      b.podium(0, cz + 6, 9, 5, 0.5);
      b.box('lava', 0, 0.03, cz, 4, 0.04, 4, { y: Math.PI / 4 });
      b.light(0, 1.2, cz, 0xff4010, 6, 16, 0.4);
      for (const [x, z] of [[-9, r.z0 + 4], [9, r.z0 + 4], [-11, cz + 8], [11, cz + 8]] as const) brazier(b, x, z, 1.4);
      break;
    }
    default:
      brazier(b, 0, cz);
  }
}
