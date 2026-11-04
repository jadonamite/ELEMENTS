import type { WorldBuilder } from './builder.js';
import type { Surface } from './materials.js';
import { brackets, roof } from './roofs.js';
import { awning, hangingSign } from './street.js';

/** Hangs a sign string from a house front at local (x, y), in the house's own frame. */
function signAt(b: WorldBuilder, h: TownHouseSpec, x: number, y: number, front: number, n: number): void {
  const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
  b.at(h.x + x * c + front * s, h.z - x * s + front * c, h.yaw, h.y + y);
  hangingSign(b, n);
}

/** Who lives in a building: sets walls, timber colour, roof tile and trim. Rank rises with height in every style. */
export type Rank = 'common' | 'merchant' | 'noble';

export interface TownHouseSpec {
  x: number; z: number; y: number;
  /** Rotation about y; the front faces local +z. */
  yaw: number;
  /** Frontage (local x) and depth (local z). */
  w: number; d: number;
  floors: 1 | 2;
  rank: Rank;
  /** Open shop front with a counter and a cloth over the door. */
  shop?: boolean;
  /** A lantern by the door (lit at dusk). */
  lantern?: boolean;
  /** Door offset along the front; random if missing. */
  door?: number;
  /** Plinth reaches this far below the floor, to hide a drop behind or beside the house. */
  footing?: number;
  /** Two-floor houses: a carved balcony gallery across the upper floor instead of a pent roof. */
  balcony?: boolean;
  /** Diamond boards hung by the door, this many in the string. */
  sign?: number;
  /** A cloth awning over the shop front. */
  awning?: boolean;
  /** Grass and weeds at the plinth's foot. */
  weeds?: boolean;
}

const WALL: Record<Rank, Surface> = { common: 'ashlar_stone_blocks', merchant: 'ash_plaster', noble: 'lime_plaster' };
const UPPER: Record<Rank, Surface> = { common: 'ash_plaster', merchant: 'ash_plaster', noble: 'lime_plaster' };
const TIMBER: Record<Rank, Surface> = { common: 'charred_timber_beams', merchant: 'charred_timber_beams', noble: 'red_lacquer' };

/**
 * A town house from real East Asian street fronts: a stone footing, a ground floor with posts, a tie beam,
 * a lacquer-framed door and slatted lattice windows, a pent roof over the street on two-floor houses,
 * a low upper floor with slatted windows, and a curved hip-and-gable roof.
 */
export function townHouse(b: WorldBuilder, h: TownHouseSpec, rand: () => number): void {
  b.at(h.x, h.z, h.yaw, h.y);
  const P = 0.45, G = 3.1, U = 2.4, { w, d } = h, front = d / 2;
  const foot = h.footing ?? 0.6;
  const wall = WALL[h.rank], timber = TIMBER[h.rank];
  b.box('basalt_rock_face', 0, (P - foot) / 2, 0, w + 0.24, P + foot, d + 0.24);
  // Ground floor body, set back so the posts and beam stand proud.
  b.box(wall, 0, P + G / 2, -0.12, w - 0.1, G, d - 0.24);
  for (const px of [-w / 2 + 0.13, w / 2 - 0.13]) b.box(timber, px, P + G / 2, front - 0.1, 0.26, G, 0.26);
  b.box(timber, 0, P + G - 0.13, front - 0.08, w + 0.1, 0.26, 0.3);
  const door = h.door ?? (rand() - 0.5) * Math.max(0, w - 3);
  if (h.shop) {
    // Open front: shutters up, a deep dark interior, a counter with goods, a cloth hanging over the opening.
    const ow = w - 1.2;
    b.box('charred_timber_beams', 0, P + 1.3, front - 1.6, ow, 2.6, 0.06);
    b.ao([-ow / 2, P + 2.6, front - 1.55], [ow / 2, P + 2.6, front - 1.55], [0, -2.2, 0], 0.9);
    b.box('charred_timber_beams', 0, P + 0.45, front - 0.45, ow, 0.9, 0.7);
    b.box('pale_stone', 0, P + 0.92, front - 0.45, ow + 0.1, 0.06, 0.8);
    for (let gx = -ow / 2 + 0.4; gx < ow / 2 - 0.3; gx += 0.45 + rand() * 0.3) {
      b.cylinder(rand() < 0.5 ? 'terracotta' : 'pale_stone', gx, P + 1.06, front - 0.45 + (rand() - 0.5) * 0.3, 0.12, 0.16, 0.24 + rand() * 0.15, 9);
    }
    for (let k = 0; k < 4; k++) {
      b.box('red_lacquer', -ow / 2 + (k + 0.5) * (ow / 4), P + G - 0.6, front + 0.02, ow / 4 - 0.06, 0.75, 0.02);
    }
    b.light(0, P + 2, front - 0.8, 0xffa060, 4, 6, 0.1);
  } else {
    // Recessed door in a lacquer frame, a step before it.
    b.box('charred_timber_beams', door, P + 1.05, front - 0.36, 1.1, 2.1, 0.08);
    b.ao([door - 0.55, P + 0.01, front - 0.32], [door + 0.55, P + 0.01, front - 0.32], [0, 0, 0.3], 0.8);
    b.ao([door - 0.55, P + 2.1, front - 0.31], [door + 0.55, P + 2.1, front - 0.31], [0, -0.8, 0], 0.7);
    b.box('red_lacquer', door - 0.62, P + 1.12, front - 0.2, 0.15, 2.24, 0.24);
    b.box('red_lacquer', door + 0.62, P + 1.12, front - 0.2, 0.15, 2.24, 0.24);
    b.box('red_lacquer', door, P + 2.3, front - 0.2, 1.4, 0.16, 0.26);
    b.box('basalt_rock_face', door, P - 0.1, front + 0.3, 1.5, 0.2, 0.5);
    // Slatted lattice windows either side of the door where there is room.
    for (const side of [-1, 1]) {
      const room = side < 0 ? door - 0.75 - (-w / 2 + 0.3) : w / 2 - 0.3 - (door + 0.75);
      if (room < 1.1) continue;
      const lw = Math.min(2.4, room - 0.3), cx = side < 0 ? -w / 2 + 0.3 + room / 2 : door + 0.75 + room / 2;
      slats(b, cx, P + 1.55, front - 0.02, lw, 1.3, h.rank === 'noble' ? 'red_lacquer' : 'charred_timber_beams');
    }
  }
  let top = P + G;
  if (h.floors === 2 && h.balcony) {
    // A gallery on joists over the street: floor boards, turned balusters between posts, a hand rail.
    const out = 0.95;
    for (let k = 0; k <= Math.round(w / 1.1); k++) b.box(timber, -w / 2 + 0.15 + k * ((w - 0.3) / Math.round(w / 1.1)), top - 0.12, front + out / 2 - 0.1, 0.14, 0.18, out + 0.3);
    b.box('raw_timber', 0, top + 0.03, front + out / 2, w + 0.1, 0.08, out);
    b.box(timber, 0, top + 0.03, front + out, w + 0.14, 0.14, 0.1);
    const railH = 0.95;
    b.box(timber, 0, top + railH, front + out - 0.02, w + 0.1, 0.08, 0.12);
    b.box(timber, 0, top + 0.28, front + out - 0.02, w + 0.1, 0.06, 0.08);
    const posts = Math.max(2, Math.round(w / 1.8));
    for (let k = 0; k <= posts; k++) b.box(timber, -w / 2 + 0.05 + k * ((w - 0.1) / posts), top + railH / 2, front + out - 0.02, 0.11, railH, 0.11);
    for (let bx = -w / 2 + 0.2; bx < w / 2 - 0.1; bx += 0.17) b.box(timber, bx, top + 0.6, front + out - 0.02, 0.045, 0.6, 0.045);
    b.ao([-w / 2, top + 0.08, front + 0.02], [w / 2, top + 0.08, front + 0.02], [0, 0, out - 0.1], 0.5);
    b.ao([-w / 2, top - 0.22, front - 0.06], [w / 2, top - 0.22, front - 0.06], [0, -0.9, 0], 0.55);
  } else if (h.floors === 2) {
    // Pent roof over the street, then the low upper floor.
    b.box('roof_tile_charcoal', 0, top + 0.2, front + 0.45, w + 0.3, 0.09, 1.3, { x: 0.38 });
    b.box(timber, 0, top - 0.02, front + 0.95, w + 0.3, 0.1, 0.12);
  }
  if (h.floors === 2) {
    b.box(UPPER[h.rank], 0, top + U / 2, -0.2, w - 0.2, U, d - 0.4);
    for (const px of [-w / 2 + 0.2, w / 2 - 0.2]) b.box(timber, px, top + U / 2, front - 0.25, 0.2, U, 0.2);
    const n = Math.max(1, Math.floor(w / 2.6));
    for (let k = 0; k < n; k++) slats(b, (k - (n - 1) / 2) * (w / n), top + 1.35, front - 0.38, Math.min(1.6, w / n - 0.6), 0.8, timber);
    top += U;
  }
  // Soot under the eaves, where rain never washes the plaster.
  b.ao([-w / 2 + 0.1, top - 0.02, front - 0.19], [w / 2 - 0.1, top - 0.02, front - 0.19], [0, -1.2, 0], 0.45);
  roof(b, {
    w: w + 0.3, d: d + 0.1, base: top, pitch: h.rank === 'noble' ? 0.58 : 0.5, overhang: h.balcony ? 1.45 : 1.15, curve: 0.16,
    cornerLift: h.rank === 'noble' ? 0.32 : 0.1, gableRatio: 0.45,
    tile: h.rank === 'noble' ? 'roof_tile_red' : 'roof_tile_charcoal', trim: h.rank === 'noble',
  }, rand);
  if (h.rank !== 'common') brackets(b, 'x', [-w / 2 + 0.4, w / 2 - 0.4], top, front - 0.2, h.rank === 'noble');
  if (h.lantern) lantern(b, door + (door > 0 ? -1.1 : 1.1), P + 2.2, front + 0.25);
  if (h.sign) {
    const sx = h.shop ? (rand() < 0.5 ? -1 : 1) * (w / 2 - 0.35) : door + (door > 0 ? 1 : -1) * 0.95;
    signAt(b, h, sx, P + G - 0.35, front, h.sign);
    b.at(h.x, h.z, h.yaw, h.y);
  }
  if (h.awning && h.shop) awning(b, 0, P + G - 0.35, front, w - 1.0, 1.7, rand() < 0.7 ? 'indigo_cloth' : 'red_lacquer');
  if (h.weeds !== false) {
    for (let k = 0; k < Math.round(w / 1.6); k++) {
      if (rand() < 0.45) continue;
      const wx = -w / 2 + rand() * w;
      if (Math.abs(wx - door) < 0.9 && !h.shop) continue;
      b.plant(rand() < 0.65 ? 'weed' : 'fern', wx, front + 0.2 + rand() * 0.15, 0.6 + rand() * 0.7, 0, rand() * 6);
    }
  }
  b.ao([-w / 2 - 0.12, 0.02, front + 0.13], [w / 2 + 0.12, 0.02, front + 0.13], [0, 0, 1.1], 0.8);
  b.solid(0, (top + 1.5 - foot) / 2, -0.1, w, top + 1.5 + foot, d - 0.2);
  b.at(0, 0, 0);
}

/** Vertical slatted lattice (koshi) over a dim glowing window, in the current frame, face at z = face. */
export function slats(b: WorldBuilder, x: number, y: number, face: number, w: number, h: number, mat: Surface): void {
  b.box('window', x, y, face - 0.08, w - 0.1, h - 0.1, 0.03, undefined, { u: 1, v: 1 });
  b.box(mat, x, y + h / 2, face, w + 0.12, 0.1, 0.14);
  b.box(mat, x, y - h / 2, face + 0.03, w + 0.2, 0.1, 0.2);
  for (const sx of [-1, 1]) b.box(mat, x + sx * w / 2, y, face, 0.1, h, 0.14);
  const n = Math.max(4, Math.round(w / 0.11));
  for (let i = 1; i < n; i++) b.box(mat, x - w / 2 + (i * w) / n, y, face + 0.01, 0.045, h - 0.1, 0.06);
  b.ao([x - w / 2, y + h / 2 - 0.05, face - 0.06], [x + w / 2, y + h / 2 - 0.05, face - 0.06], [0, -h * 0.6, 0], 0.5);
}

/** A paper lantern on a bracket: a glowing body with dark caps, and a small warm light. */
export function lantern(b: WorldBuilder, x: number, y: number, z: number): void {
  b.box('charred_timber_beams', x, y + 0.55, z - 0.15, 0.06, 0.06, 0.5);
  b.cylinder('window', x, y, z, 0.2, 0.2, 0.55, 10);
  b.cylinder('charred_timber_beams', x, y + 0.31, z, 0.14, 0.14, 0.07, 10);
  b.cylinder('charred_timber_beams', x, y - 0.31, z, 0.14, 0.14, 0.07, 10);
  b.light(x, y, z + 0.3, 0xffb070, 6, 8, 0.15);
}

/** A roofed gate: two lacquer posts on stone bases, a tie beam, a small curved roof, open leaves. Front faces +z. */
export function roofedGate(b: WorldBuilder, x: number, z: number, y: number, yaw: number, span: number, rank: Rank,
  rand: () => number): void {
  b.at(x, z, yaw, y);
  const H = rank === 'noble' ? 4.2 : 3.4, mat = TIMBER[rank === 'common' ? 'common' : 'noble'];
  for (const sx of [-1, 1]) {
    b.cylinder('pale_stone', sx * span / 2, 0.2, 0, 0.36, 0.42, 0.4, 12);
    b.cylinder(mat, sx * span / 2, H / 2, 0, 0.2, 0.22, H, 12);
    b.solid(sx * span / 2, H / 2, 0, 0.5, H, 0.5);
    // Leaves swung open against the wall line.
    b.box('charred_timber_beams', sx * (span / 2 - 0.1), H * 0.42, -span / 4 - 0.15, 0.08, H * 0.8, span / 2 - 0.2);
  }
  b.box(mat, 0, H - 0.2, 0, span + 0.9, 0.3, 0.32);
  b.box(mat, 0, H - 0.9, 0, span, 0.18, 0.2);
  if (rank === 'noble') b.box('gold_trim', 0, H - 0.2, 0.17, span * 0.5, 0.12, 0.02);
  roof(b, { w: span + 1.6, d: 2.0, base: H, pitch: 0.55, overhang: 0.7, curve: 0.2, cornerLift: rank === 'noble' ? 0.3 : 0.12,
    gableRatio: 0.5, tile: rank === 'noble' ? 'roof_tile_red' : 'roof_tile_charcoal', trim: rank === 'noble' }, rand);
  b.at(0, 0, 0);
}

/** A hall on a stone podium: a front stair, a veranda of lacquer columns, lattice screens, brackets, a red roof with gold trim. */
export function hall(b: WorldBuilder, x: number, z: number, y: number, yaw: number, w: number, d: number, podiumH: number,
  rand: () => number, tiers = 1): void {
  b.at(x, z, yaw, y);
  b.podium(0, 0, w + 2.4, d + 2.4, podiumH, Math.min(6, w * 0.4));
  b.at(x, z, yaw, y + podiumH);
  const wallH = 4.4, front = d / 2;
  b.box('lime_plaster', 0, wallH / 2, -0.4, w, wallH, d - 0.8);
  b.box('red_lacquer', 0, wallH - 0.15, -0.4, w + 0.1, 0.3, d - 0.7);
  b.box('red_lacquer', 0, 0.2, -0.4, w + 0.1, 0.4, d - 0.7);
  b.solid(0, wallH / 2, -0.4, w, wallH, d - 0.8);
  const cols = Math.max(3, Math.round(w / 3) + 1), step = (w - 1.2) / (cols - 1);
  const xs: number[] = [];
  for (let c = 0; c < cols; c++) {
    const cx = -w / 2 + 0.6 + c * step;
    xs.push(cx);
    b.column(cx, front + 0.6, wallH, 0.26, { mat: 'red_lacquer', baseMat: 'pale_stone' });
    if (c < cols - 1) b.lattice(cx + step / 2, wallH * 0.48, front - 0.8, step * 0.8, 2.6, 1, true);
  }
  b.ao([-w / 2, 0.01, front - 0.78], [w / 2, 0.01, front - 0.78], [0, 0, 1.4], 0.7);
  brackets(b, 'x', xs, wallH, front + 0.6, true);
  roof(b, { w: w + 1.2, d: d + 1.6, base: wallH, pitch: 0.6, overhang: 1.4, curve: 0.24, cornerLift: 0.36, gableRatio: 0.48,
    tile: 'roof_tile_red', trim: true, tiers }, rand);
  b.at(0, 0, 0);
}

/** A notice board: two posts, a small roof, pinned sheets. Front faces +z. */
export function noticeBoard(b: WorldBuilder, x: number, z: number, y: number, yaw: number, rand: () => number): void {
  b.at(x, z, yaw, y);
  for (const sx of [-1.1, 1.1]) { b.box('charred_timber_beams', sx, 1.3, 0, 0.16, 2.6, 0.16); b.solid(sx, 1.3, 0, 0.25, 2.6, 0.25); }
  b.box('charred_timber_beams', 0, 1.55, -0.02, 2.2, 1.3, 0.06);
  for (let i = 0; i < 7; i++) {
    b.box('lime_plaster', -0.8 + rand() * 1.6, 1.2 + rand() * 0.75, 0.02 + i * 0.002, 0.3 + rand() * 0.15, 0.36 + rand() * 0.2, 0.01);
  }
  b.box('roof_tile_charcoal', 0, 2.5, 0.05, 2.8, 0.08, 0.8, { x: 0.25 });
  b.ao([-1.4, 0.01, -0.4], [1.4, 0.01, -0.4], [0, 0, 0.8], 0.4);
  b.at(0, 0, 0);
}

/** A covered market stall: four posts, a cloth roof, a counter of goods. Front faces +z. */
export function stall(b: WorldBuilder, x: number, z: number, y: number, yaw: number, rand: () => number): void {
  b.at(x, z, yaw, y);
  for (const [sx, sz] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]] as const) b.box('charred_timber_beams', sx, 1.2, sz, 0.12, 2.4, 0.12);
  b.box('red_lacquer', 0, 2.45, 0, 3.0, 0.04, 2.3, { x: -0.15 });
  b.box('charred_timber_beams', 0, 0.45, 0.6, 2.6, 0.9, 0.6);
  b.solid(0, 0.5, 0, 2.8, 1, 2);
  for (let gx = -1.1; gx < 1.1; gx += 0.35) b.cylinder(rand() < 0.5 ? 'terracotta' : 'moss', gx, 1.0, 0.6, 0.13, 0.15, 0.2, 8);
  b.ao([-1.5, 0.01, -1.1], [1.5, 0.01, -1.1], [0, 0, 2.2], 0.45);
  b.at(0, 0, 0);
}

/** A stone well with a timber frame and a pulley beam. */
export function well(b: WorldBuilder, x: number, z: number, y: number): void {
  b.at(x, z, 0, y);
  b.cylinder('ashlar_stone_blocks', 0, 0.4, 0, 0.9, 0.95, 0.8, 16);
  b.cylinder('cooled_lava_crust', 0, 0.78, 0, 0.7, 0.7, 0.02, 16);
  for (const sx of [-1, 1]) b.box('charred_timber_beams', sx * 0.85, 1.3, 0, 0.12, 1.8, 0.12);
  b.box('charred_timber_beams', 0, 2.2, 0, 1.9, 0.12, 0.12);
  b.solid(0, 0.5, 0, 1.9, 1, 1.9);
  b.ao([-1.3, 0.01, -1.3], [1.3, 0.01, -1.3], [0, 0, 2.6], 0.3);
  b.at(0, 0, 0);
}

/** An iron brazier with live coals, flame and light. */
export function brazier(b: WorldBuilder, x: number, z: number, y: number): void {
  b.at(x, z, 0, y);
  b.prop('iron_brazier', 0, 0, 0, 1);
  b.cylinder('lava', 0, 0.75, 0, 0.44, 0.44, 0.03, 16);
  b.fire(0, 0.76, 0, 0.8);
  b.light(0, 1.9, 0, 0xff7a2a, 22, 12, 0.3);
  b.solid(0, 0.5, 0, 0.9, 1, 0.9);
  b.at(0, 0, 0);
}

/**
 * A compound wall: stone footing, plastered body, a tiled coping cap with a ridge, from (x0, z0) to (x1, z1)
 * at floor y. Openings are left by building it in pieces.
 */
export function compoundWall(b: WorldBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, rank: Rank): void {
  const L = Math.hypot(x1 - x0, z1 - z0);
  if (L < 0.1) return;
  b.at((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0), y);
  // Local z runs along the wall here.
  const T = 0.5;
  b.box('basalt_rock_face', 0, 0.3, 0, T + 0.16, 0.9, L);
  b.box(rank === 'common' ? 'sooted_plaster' : 'lime_plaster', 0, 0.75 + (h - 0.75) / 2, 0, T, h - 0.75, L);
  b.box('roof_tile_charcoal', -0.3, h + 0.12, 0, 0.62, 0.07, L + 0.2, { z: -0.42 });
  b.box('roof_tile_charcoal', 0.3, h + 0.12, 0, 0.62, 0.07, L + 0.2, { z: 0.42 });
  b.box(rank === 'noble' ? 'red_lacquer' : 'charred_timber_beams', 0, h - 0.04, 0, T + 0.04, 0.12, L);
  b.box('roof_tile_charcoal', 0, h + 0.27, 0, 0.18, 0.14, L + 0.2);
  for (const sx of [-1, 1]) {
    b.ao([sx * (T / 2 + 0.09), 0.02, -L / 2], [sx * (T / 2 + 0.09), 0.02, L / 2], [sx * 1.0, 0, 0], 0.75);
    b.ao([sx * (T / 2 + 0.005), h - 0.1, -L / 2], [sx * (T / 2 + 0.005), h - 0.1, L / 2], [0, -0.7, 0], 0.55);
  }
  b.solid(0, (h + 0.4) / 2, 0, T + 0.2, h + 0.4, L);
  b.at(0, 0, 0);
}
