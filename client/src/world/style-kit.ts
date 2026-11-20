import type { WorldBuilder } from './builder.js';
import type { Surface } from './materials.js';
import { brackets, roof } from './roofs.js';
import { awning, basket, goodsTable, hangingGoods, hangingSign, paperLantern, sack } from './street.js';

/** Hangs a sign string from a house front at local (x, y), in the house's own frame. */
function signAt(b: WorldBuilder, h: TownHouseSpec, x: number, y: number, front: number, n: number): void {
  const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
  b.at(h.x + x * c + front * s, h.z - x * s + front * c, h.yaw, h.y + y);
  hangingSign(b, n);
}

/**
 * Who lives in a building: sets walls, timber colour, roof tile and trim. Rank rises with height in every style:
 * commoners in stone and charred timber, merchants in plaster, guild houses in red lacquer with red tiles and gold
 * on the brackets and ridge, nobles in white plaster, lacquer and gold throughout.
 */
export type Rank = 'common' | 'merchant' | 'guild' | 'noble';

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
  /** Where along the front the shop's keeper stands, house metres from its centre; unset, anywhere behind the counter. */
  keeper?: number;
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
  /** Goods laid out on a table before the front, with someone working it: across a shop, beside a home's door. */
  wares?: boolean;
  /** A walk-in front room instead of a door: a service counter or an open forge, its floor level with the street. */
  room?: FrontRoom;
}

/** A front room open to the street: centred `x` along the front, `w` wide, `d` deep. */
export interface FrontRoom { x: number; w: number; d: number; kind: 'service' | 'forge' }

const WALL: Record<Rank, Surface> = { common: 'ashlar_stone_blocks', merchant: 'ash_plaster', guild: 'ash_plaster', noble: 'lime_plaster' };
const UPPER: Record<Rank, Surface> = { common: 'ash_plaster', merchant: 'ash_plaster', guild: 'lime_plaster', noble: 'lime_plaster' };
const TIMBER: Record<Rank, Surface> = { common: 'charred_timber_beams', merchant: 'charred_timber_beams', guild: 'red_lacquer', noble: 'red_lacquer' };
/** Guild and noble houses carry red tiles, gold ridges and lacquered brackets. */
const rich = (rank: Rank): boolean => rank === 'guild' || rank === 'noble';

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
  const room = h.room;
  if (room) {
    frontRoom(b, h, room, P, G, wall, timber, foot, rand);
  } else {
    b.box('basalt_rock_face', 0, (P - foot) / 2, 0, w + 0.24, P + foot, d + 0.24);
    if (h.shop) {
      // Walls stop at the opening; the counter, keeper and shelves occupy the recess behind it.
      const inner = front - 1.6, depth = inner + d / 2;
      b.box(wall, 0, P + G / 2, -d / 2 + depth / 2, w - 0.1, G, depth);
      for (const side of [-1, 1]) b.box(wall, side * (w / 2 - 0.3), P + G / 2, front - 0.8, 0.6, G, 1.6);
      b.box('raw_timber', 0, P + 0.02, front - 0.8, w - 1.2, 0.04, 1.6);
      b.box('charred_timber_beams', 0, P + G - 0.08, front - 0.8, w - 1.2, 0.16, 1.6);
    } else b.box(wall, 0, P + G / 2, -0.12, w - 0.1, G, d - 0.24);
  }
  // A merchant's shop front is lacquered: red posts and beam over the plain walls; commoners' stay charred timber.
  const frontTimber: Surface = h.shop && h.rank !== 'common' ? 'red_lacquer' : timber;
  for (const px of [-w / 2 + 0.13, w / 2 - 0.13]) b.box(frontTimber, px, P + G / 2, front - 0.1, 0.26, G, 0.26);
  b.box(frontTimber, 0, P + G - 0.13, front - 0.08, w + 0.1, 0.26, 0.3);
  const door = h.door ?? (rand() - 0.5) * Math.max(0, w - 3);
  if (room) {
    // The family living above keeps the front, beside the opening (at `door` when it is clear of the opening).
    const beside = h.door !== undefined && Math.abs(h.door - room.x) > room.w / 2 + 0.4 ? h.door : room.x - room.w / 2 - 0.7;
    b.post('household', beside, front + 0.9, 0);
  } else if (h.shop) {
    // Open front: shutters up, a deep dark interior, a counter with goods, a cloth hanging over the opening.
    const ow = w - 1.2;
    b.box('charred_timber_beams', 0, P + 1.3, front - 1.6, ow, 2.6, 0.06);
    for (const shelf of [1.15, 1.8]) {
      b.box('raw_timber', 0, P + shelf, front - 1.4, ow - 0.3, 0.07, 0.32);
      for (let gx = -ow / 2 + 0.4; gx < ow / 2 - 0.3; gx += 0.55) {
        b.cylinder('terracotta', gx, P + shelf + 0.16, front - 1.4, 0.1, 0.14, 0.28, 8);
      }
    }
    b.box('window', 0, P + 1.95, front - 1.55, ow - 0.6, 0.85, 0.025, undefined, { u: 1, v: 1 });
    b.ao([-ow / 2, P + 2.6, front - 1.55], [ow / 2, P + 2.6, front - 1.55], [0, -2.2, 0], 0.9);
    b.box('charred_timber_beams', 0, P + 0.45, front - 0.45, ow, 0.9, 0.7);
    b.box('pale_stone', 0, P + 0.92, front - 0.45, ow + 0.1, 0.06, 0.8);
    for (let gx = -ow / 2 + 0.4; gx < ow / 2 - 0.3; gx += 0.45 + rand() * 0.3) {
      b.cylinder(rand() < 0.5 ? 'terracotta' : 'pale_stone', gx, P + 1.06, front - 0.45 + (rand() - 0.5) * 0.3, 0.12, 0.16, 0.24 + rand() * 0.15, 9);
    }
    for (let k = 0; k < 4; k++) {
      b.box(frontTimber, -ow / 2 + (k + 0.5) * (ow / 4), P + G - 0.6, front + 0.02, ow / 4 - 0.06, 0.75, 0.02);
    }
    b.light(0, P + 2, front - 0.8, 0xffa060, 4, 6, 0.1);
    const anywhere = (rand() - 0.5) * (ow - 1.2);
    b.post('keeper', h.keeper ?? anywhere, front - 1.2, 0, P);
    if (!h.wares) b.browseAt((rand() - 0.5) * (ow - 1.6), front + 0.9, Math.PI);
    if (h.rank !== 'common') merchantFront(b, 0, ow, Math.min(2.6, w - 1.6), P + G, front);
  } else {
    // Recessed door in a lacquer frame, a step before it.
    b.box('charred_timber_beams', door, P + 1.05, front - 0.36, 1.1, 2.1, 0.08);
    b.post('household', door + (rand() < 0.5 ? -0.9 : 0.9), front + 0.9, (rand() - 0.5) * 0.8);
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
      slats(b, cx, P + 1.55, front - 0.02, lw, 1.3, rich(h.rank) ? 'red_lacquer' : 'charred_timber_beams');
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
    w: w + 0.3, d: d + 0.1, base: top, pitch: rich(h.rank) ? 0.58 : 0.5, overhang: h.balcony ? 1.45 : 1.15, curve: rich(h.rank) ? 0.2 : 0.16,
    cornerLift: h.rank === 'noble' ? 0.32 : h.rank === 'guild' ? 0.26 : 0.1, gableRatio: 0.45,
    tile: rich(h.rank) ? 'roof_tile_red' : 'roof_tile_charcoal', trim: rich(h.rank),
  }, rand);
  if (h.rank !== 'common') {
    const n = rich(h.rank) ? Math.max(2, Math.round(w / 2.2)) : 1;
    const xs = Array.from({ length: n + 1 }, (_, k) => -w / 2 + 0.4 + k * (w - 0.8) / n);
    brackets(b, 'x', xs, top, front - 0.2, rich(h.rank));
  }
  const mouth = room ? room.x : door;
  if (h.lantern) lantern(b, mouth + (mouth > 0 ? -1 : 1) * (room ? room.w / 2 + 0.5 : 1.1), P + 2.2, front + 0.25);
  if (h.sign) {
    const sx = h.shop || room ? (mouth > 0 ? -1 : 1) * (w / 2 - 0.35) : door + (door > 0 ? 1 : -1) * 0.95;
    signAt(b, h, sx, P + G - 0.35, front, h.sign);
    b.at(h.x, h.z, h.yaw, h.y);
  }
  if (h.awning && h.shop) awning(b, 0, P + G - 0.35, front, w - 1.0, 1.7, rand() < 0.7 ? 'indigo_cloth' : 'red_lacquer');
  if (h.wares && !h.shop && !room) {
    // A home on the market street sells from its doorstep: a small table beside the door, clear of it.
    b.at(h.x, h.z, h.yaw, h.y);
    const side = door > 0 ? -1 : 1, tw = Math.min(1.8, w / 2 - 1.4);
    if (tw > 0.9) b.inside(side * (w / 4 + 0.2), front + 1.25, 0, 0, () => goodsTable(b, tw, rand, true));
  }
  if (h.wares && h.shop) {
    // The shop's goods laid out under its awning: a table with its own keeper, sacks and baskets by the posts,
    // dried goods hung from the awning's edge.
    b.at(h.x, h.z, h.yaw, h.y);
    b.inside(0, front + 1.25, 0, 0, () => goodsTable(b, Math.min(2.4, w - 2.6), rand, true));
    for (const sx of [-1, 1]) {
      sack(b, sx * (w / 2 - 0.45), front + 0.45, 0, rand);
      basket(b, sx * (w / 2 - 0.5), front + 0.95, 0, rand);
      b.solid(sx * (w / 2 - 0.47), 0.3, front + 0.7, 0.6, 0.6, 0.9);
    }
    if (h.awning) hangingGoods(b, -w / 2 + 0.8, -w / 2 + 2.2, P + G - 0.95, front + 1.6, rand);
  }
  if (h.weeds !== false) {
    for (let k = 0; k < Math.round(w / 1.6); k++) {
      if (rand() < 0.45) continue;
      const wx = -w / 2 + rand() * w;
      if (Math.abs(wx - mouth) < (room ? room.w / 2 + 0.3 : 0.9) && !h.shop) continue;
      b.plant(rand() < 0.65 ? 'weed' : 'fern', wx, front + 0.2 + rand() * 0.15, 0.6 + rand() * 0.7, 0, rand() * 6);
    }
  }
  b.ao([-w / 2 - 0.12, 0.02, front + 0.13], [w / 2 + 0.12, 0.02, front + 0.13], [0, 0, 1.1], 0.8);
  if (h.shop && !room) {
    // A shop is open behind its counter: solid behind the dark back wall, above the shop, under its floor and at
    // the counter, so the keeper stands in real space between counter and wall. Solids end at the wall head;
    // the roof above is its own solid.
    const inner = front - 1.6, ow = w - 1.2, H = top;
    b.solid(0, (H - foot) / 2, (-d / 2 + 0.1 + inner) / 2, w, H + foot, inner + d / 2 - 0.1);
    b.solid(0, (P + G + H) / 2, (inner + front) / 2, w, H - P - G, front - inner);
    b.solid(0, (P - foot) / 2, (inner + front) / 2, w, P + foot, front - inner);
    b.solid(0, P + 0.45, front - 0.45, ow, 0.9, 0.7);
    for (const sx of [-1, 1]) b.solid(sx * (w / 2 - (w - ow) / 4), P + G / 2, (inner + front) / 2, (w - ow) / 2, G, front - inner);
  } else if (!room) {
    b.solid(0, (top - foot) / 2, -0.1, w, top + foot, d - 0.2);
  } else {
    // Solid all round the room, open in front of it: the sides, the back, and the floors above.
    const rx0 = room.x - room.w / 2, rx1 = room.x + room.w / 2, back = front - room.d;
    if (rx0 > -w / 2 + 0.05) b.solid((-w / 2 + rx0) / 2, (top - foot) / 2, -0.1, rx0 + w / 2, top + foot, d - 0.2);
    if (rx1 < w / 2 - 0.05) b.solid((rx1 + w / 2) / 2, (top - foot) / 2, -0.1, w / 2 - rx1, top + foot, d - 0.2);
    b.solid(room.x, (top - foot) / 2, (-d / 2 + 0.1 + back) / 2, room.w, top + foot, back + d / 2 - 0.1);
    b.solid(room.x, (P + G + top) / 2, back + room.d / 2, room.w, top - P - G, room.d);
  }
  b.at(0, 0, 0);
}

/**
 * The ground floor of a house with a walk-in front room: plinth and walls around an opening whose floor is level
 * with the street, a beamed ceiling, and what the room is for. A service room has a counter with its keeper behind
 * and room to stand before it; a forge room has a hearth at the back, an anvil and its smith.
 */
function frontRoom(b: WorldBuilder, h: TownHouseSpec, r: FrontRoom, P: number, G: number, wall: Surface, timber: Surface,
  foot: number, rand: () => number): void {
  const { w, d } = h, front = d / 2, back = front - r.d;
  const rx0 = r.x - r.w / 2, rx1 = r.x + r.w / 2;
  // Plinth and walls in three pieces round the opening.
  const piece = (x0: number, x1: number, z0: number, z1: number): void => {
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
    b.box('basalt_rock_face', (x0 + x1) / 2, (P - foot) / 2, (z0 + z1) / 2, x1 - x0, P + foot, z1 - z0);
    b.box(wall, (x0 + x1) / 2, P + G / 2, (z0 + z1) / 2 - 0.06, x1 - x0, G, z1 - z0 - 0.12);
  };
  piece(-w / 2 - 0.12, rx0, -d / 2 - 0.12, front + 0.12);
  piece(rx1, w / 2 + 0.12, -d / 2 - 0.12, front + 0.12);
  piece(rx0, rx1, -d / 2 - 0.12, back);
  // The room: worn stone floor at street level, plastered sides, a beamed ceiling, a lintel across the opening.
  b.box('worn_flagstones', r.x, -0.05, back + r.d / 2, r.w, 0.12, r.d);
  b.box('basalt_rock_face', r.x, -(foot + 0.1) / 2 - 0.1, back + r.d / 2, r.w, foot, r.d);
  for (const sx of [rx0 + 0.04, rx1 - 0.04]) b.box('sooted_plaster', sx, (P + G) / 2, back + r.d / 2, 0.08, P + G, r.d);
  b.box('sooted_plaster', r.x, (P + G) / 2, back + 0.04, r.w, P + G, 0.08);
  b.box(timber, r.x, P + G - 0.08, back + r.d / 2, r.w, 0.16, r.d);
  for (let k = 0; k < Math.max(2, Math.round(r.d / 1.2)); k++) b.box(timber, r.x, P + G - 0.24, back + 0.6 + k * 1.2, r.w, 0.18, 0.16);
  const frame: Surface = h.rank !== 'common' ? 'red_lacquer' : timber;
  b.box(frame, r.x, P + G - 0.18, front - 0.08, r.w + 0.4, 0.36, 0.3);
  for (const sx of [rx0, rx1]) b.box(frame, sx, (P + G) / 2, front - 0.1, 0.3, P + G, 0.3);
  if (h.rank !== 'common') merchantFront(b, r.x, r.w, Math.min(2.6, r.w + 0.4), P + G, front);
  b.ao([rx0, 0.012, back + 0.08], [rx1, 0.012, back + 0.08], [0, 0, 1.2], 0.6);
  b.ao([rx0, P + G - 0.33, back + 0.1], [rx1, P + G - 0.33, back + 0.1], [0, -1.4, 0], 0.5);
  b.ao([rx0 + 0.08, 0.012, back], [rx0 + 0.08, 0.012, front], [0.8, 0, 0], 0.5);
  b.ao([rx1 - 0.08, 0.012, back], [rx1 - 0.08, 0.012, front], [-0.8, 0, 0], 0.5);
  if (r.kind === 'service') {
    // Counter across the room 1.6 m in from the back; shelves of goods on the back wall; a lamp over the counter.
    const cz = back + 1.6;
    b.box('charred_timber_beams', r.x, 0.5, cz, r.w - 0.5, 1.0, 0.6);
    b.box(timber, r.x, 1.04, cz, r.w - 0.4, 0.08, 0.72);
    b.solid(r.x, 0.6, cz, r.w - 0.5, 1.2, 0.6);
    for (const y of [1.1, 1.75, 2.4]) {
      b.box('raw_timber', r.x, y, back + 0.3, r.w - 0.6, 0.05, 0.4);
      for (let gx = rx0 + 0.5; gx < rx1 - 0.4; gx += 0.32 + rand() * 0.2) b.cylinder(rand() < 0.5 ? 'terracotta' : 'pale_stone', gx, y + 0.14, back + 0.3, 0.1, 0.13, 0.22, 8);
    }
    b.post('keeper', r.x, back + 0.85, 0);
    b.browseAt(r.x, back + 2.6, Math.PI);
    paperLanternAt(b, r.x, P + G - 0.7, cz + 0.6);
    b.light(r.x, P + 2, cz + 0.8, 0xffa060, 5, 7, 0.1);
  } else {
    // Hearth against the back wall, glowing; an anvil in the room; the smith beside it.
    b.box('ashlar_stone_blocks', r.x, 0.5, back + 0.75, Math.min(2.2, r.w - 0.8), 1.0, 1.3);
    b.box('lava', r.x, 1.02, back + 0.75, Math.min(1.8, r.w - 1.2), 0.04, 0.9);
    b.box('forge', r.x, 1.9, back + 0.1, Math.min(1.8, r.w - 1.2), 1.4, 0.04, undefined, { u: 1, v: 1 });
    b.fire(r.x, 1.04, back + 0.75, 0.7);
    b.solid(r.x, 0.5, back + 0.75, Math.min(2.2, r.w - 0.8), 1.0, 1.3);
    b.light(r.x, 1.8, back + 1.6, 0xff6a20, 30, 11, 0.35);
    // The smith works between the hearth and the anvil, facing out over it.
    b.prop('anvil', r.x, back + 2.7, 0.3 + rand() * 0.3, 1.1);
    b.solid(r.x, 0.4, back + 2.7, 0.9, 0.8, 0.6);
    b.post('smith', r.x + 0.4, back + 1.85, 0);
    // The hearth's stack through the roof at the back, smoking; a quench trough steaming by the anvil; coal and
    // stock heaped at the sides; sparks over the fire and the glow thrown out into the street.
    const stackTop = P + G + 2.4 + 2.6;
    b.box('ashlar_stone_blocks', r.x, (P + G + stackTop) / 2, -d / 2 + 0.8, 1.0, stackTop - P - G, 1.0);
    b.box('basalt_rock_face', r.x, stackTop + 0.1, -d / 2 + 0.8, 1.2, 0.2, 1.2);
    b.chimneys.push(b.world(r.x, stackTop + 0.3, -d / 2 + 0.8), b.world(r.x + 0.2, stackTop + 0.35, -d / 2 + 0.9));
    const tx = r.x - r.w / 2 + 0.55;
    b.box('charred_timber_beams', tx, 0.3, back + 2.4, 0.7, 0.6, 1.2);
    b.box('fresh_water', tx, 0.58, back + 2.4, 0.56, 0.02, 1.06, undefined, { u: 1, v: 1 });
    b.solid(tx, 0.3, back + 2.4, 0.7, 0.6, 1.2);
    b.steam.push(b.world(tx, 0.7, back + 2.4));
    b.cylinder('basalt_rock_face', r.x + r.w / 2 - 0.5, 0.18, back + 0.9, 0.42, 0.55, 0.36, 9);
    b.solid(r.x + r.w / 2 - 0.5, 0.2, back + 0.9, 0.9, 0.4, 0.9);
    for (let k = 0; k < 4; k++) b.box('blackened_rusted_iron', r.x + r.w / 2 - 0.12, 1.3 + k * 0.08, back + 1.6 + k * 0.3, 0.04, 0.9, 0.05, { x: 0.1 });
    b.embers.push(b.world(r.x, 1.4, back + 0.75), b.world(r.x + 0.3, 1.3, back + 2.4));
    b.light(r.x, 1.2, front + 0.8, 0xff7a2a, 12, 8, 0.4);
  }
}

/**
 * A merchant's front over an opening `ow` wide centred at x, its head at `head`: a name board edged in gold over
 * the opening and a paper lantern hung either side. Commoners' openings go without.
 */
function merchantFront(b: WorldBuilder, x: number, ow: number, bw: number, head: number, front: number): void {
  b.box('charred_timber_beams', x, head + 0.32, front + 0.05, bw, 0.46, 0.08);
  b.box('red_lacquer', x, head + 0.32, front + 0.03, bw + 0.16, 0.6, 0.06);
  b.box('gold_trim', x, head + 0.32, front + 0.1, bw - 0.3, 0.05, 0.02);
  for (let k = 0; k < Math.max(2, Math.round(bw / 0.6)); k++) b.box('pale_stone', x - bw / 2 + 0.35 + k * 0.55, head + 0.32, front + 0.1, 0.22, 0.22, 0.015);
  for (const sx of [-1, 1]) paperLantern(b, x + sx * (ow / 2 - 0.15), head - 0.75, front + 0.35, 0.2);
}

/** A hanging paper lantern inside a room, in the current frame. */
function paperLanternAt(b: WorldBuilder, x: number, y: number, z: number): void {
  b.box('charred_timber_beams', x, y + 0.45, z, 0.03, 0.4, 0.03);
  b.cylinder('window', x, y, z, 0.18, 0.18, 0.45, 10);
  b.cylinder('charred_timber_beams', x, y + 0.25, z, 0.12, 0.12, 0.06, 10);
  b.cylinder('charred_timber_beams', x, y - 0.25, z, 0.12, 0.12, 0.06, 10);
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
  b.post('keeper', 0, -0.2);
  b.ao([-1.5, 0.01, -1.1], [1.5, 0.01, -1.1], [0, 0, 2.2], 0.45);
  b.at(0, 0, 0);
}

/** A home meal stall with a visible bowl sign, cookware, steam and a nearby customer bench. */
export function homeMealStall(b: WorldBuilder, x: number, z: number, y: number, yaw: number, seat: { x: number; y: number; z: number }): void {
  b.at(x, z, yaw, y);
  for (const px of [-2.2, 2.2]) for (const pz of [-1.3, 1.3]) {
    b.box('charred_timber_beams', px, 1.3, pz, 0.16, 2.6, 0.16);
  }
  b.box('indigo_cloth', 0, 2.75, 0.2, 5.2, 0.08, 3.6, { x: 0.18 });
  b.box('red_lacquer', 0, 2.42, 2.02, 5.2, 0.32, 0.08);

  for (const sx of [-1.4, 1.4]) {
    b.box('charred_timber_beams', sx, 0.95, 1.2, 1.6, 0.12, 0.9);
    b.box('charred_timber_beams', sx, 0.5, 1.45, 1.6, 0.9, 0.08);
    b.solid(sx, 0.55, 1.2, 1.6, 1.1, 0.9);
  }

  b.box('charred_timber_beams', 0, 3.38, 2.08, 1.45, 0.95, 0.14);
  b.box('red_lacquer', 0, 3.38, 2.17, 1.3, 0.8, 0.05);
  b.box('pale_stone', 0, 3.63, 2.21, 0.78, 0.09, 0.06);
  b.box('pale_stone', -0.31, 3.43, 2.21, 0.09, 0.36, 0.06, { z: 0.5 });
  b.box('pale_stone', 0.31, 3.43, 2.21, 0.09, 0.36, 0.06, { z: -0.5 });
  b.box('pale_stone', 0, 3.24, 2.21, 0.18, 0.08, 0.06);
  for (const sx of [-0.16, 0, 0.16]) b.box('gold_trim', sx, 3.86, 2.21, 0.05, 0.2, 0.06, { z: sx * 1.1 });

  b.box('charred_timber_beams', 0, 0.48, -0.55, 1.3, 0.92, 0.9);
  b.cylinder('terracotta', 0, 1.12, -0.55, 0.38, 0.31, 0.38, 12);
  b.cylinder('gold_trim', 0, 1.34, -0.55, 0.42, 0.42, 0.07, 16);
  for (const sx of [-1.25, 1.25]) {
    b.cylinder('terracotta', sx, 1.08, 1.18, 0.2, 0.25, 0.14, 12);
    b.cylinder('pale_stone', sx, 1.16, 1.18, 0.23, 0.23, 0.035, 12);
  }
  b.steam.push(b.world(0, 1.62, -0.55));

  const dx = seat.x - x, dz = seat.z - z;
  const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const localZ = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const localY = seat.y - y;
  b.box('charred_timber_beams', localX, localY + 0.52, localZ, 1.7, 0.14, 0.58);
  for (const sx of [-0.64, 0.64]) for (const sz of [-0.18, 0.18]) {
    b.box('charred_timber_beams', localX + sx, localY + 0.25, localZ + sz, 0.12, 0.5, 0.12);
  }
  b.box('charred_timber_beams', localX, localY + 0.23, localZ, 1.36, 0.1, 0.12);
  b.browseAt(0, 2.65, Math.PI, 0);
  b.at(0, 0, 0);
}

/**
 * A merchant's stall: four posts, a sloping cloth roof with a valance, a counter of goods across the front, stock
 * crated behind, and the keeper standing between the two. Open at the sides, so the keeper walks in and out.
 * Front faces +z.
 */
export function marketStall(b: WorldBuilder, x: number, z: number, y: number, yaw: number, rand: () => number,
  cloth: Surface = rand() < 0.5 ? 'indigo_cloth' : 'red_lacquer'): void {
  b.at(x, z, yaw, y);
  for (const px of [-2.2, 2.2]) for (const pz of [-1.3, 1.3]) {
    b.box('charred_timber_beams', px, 1.3, pz, 0.16, 2.6, 0.16);
    b.solid(px, 1.3, pz, 0.22, 2.6, 0.22);
  }
  b.box('charred_timber_beams', 0, 0.95, 1.2, 4.6, 0.12, 0.9);
  b.box('charred_timber_beams', 0, 0.5, 1.45, 4.4, 0.9, 0.08);
  b.solid(0, 0.55, 1.2, 4.4, 1.1, 0.9);
  b.box(cloth, 0, 2.75, 0.2, 5.2, 0.04, 3.6, { x: 0.22 });
  b.box(cloth, 0, 2.42, 2.02, 5.2, 0.32, 0.02);
  for (let gx = -1.9; gx < 2; gx += 0.38 + rand() * 0.2) b.cylinder(rand() < 0.5 ? 'terracotta' : 'raw_timber', gx, 1.12, 1.2 + (rand() - 0.5) * 0.4, 0.13, 0.16, 0.22 + rand() * 0.14, 9);
  b.prop('crate', -1.4, -0.9, 0.3, 0.8);
  b.prop('barrel', 1.5, -0.95, 0, 0.8);
  b.solid(-1.4, 0.4, -0.9, 0.8, 0.8, 0.8);
  b.solid(1.5, 0.4, -0.95, 0.7, 0.8, 0.7);
  // Full to the edges: baskets heaped on the counter's ends, sacks against the front posts, goods hung inside.
  for (const sx of [-1, 1]) {
    basket(b, sx * 1.75, 1.2, 1.01, rand, 0.2);
    sack(b, sx * 2.55, 1.55, 0, rand);
    b.solid(sx * 2.55, 0.3, 1.55, 0.5, 0.6, 0.5);
  }
  if (rand() < 0.6) b.prop('crate', -0.4, -1.0, 1.2, 0.7);
  hangingGoods(b, -1.9, 1.9, 2.2, 1.0, rand);
  b.post('keeper', 0, 0.2);
  for (const bx of [-1.1, 1.1]) b.browseAt(bx, 2.35, Math.PI);
  b.ao([-2.4, 0.012, -1.5], [2.4, 0.012, -1.5], [0, 0, 3.4], 0.4);
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
