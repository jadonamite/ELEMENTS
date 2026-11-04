import { BufferAttribute, BufferGeometry, CylinderGeometry, Matrix4, PlaneGeometry, Quaternion, TorusGeometry, Vector3 } from 'three';
import type { Bucket, WorldBuilder } from './builder.js';
import type { Surface } from './materials.js';

/**
 * Street ground and street furniture for Sindr's lanes. A street is laid in its own frame: `along` runs the
 * street's length, `across` runs from one house row to the other. Paving is three materials at once, as old
 * East Asian town streets are: big worn flagstones down the middle, bands of rounded cobbles either side, and
 * packed earth along the house fronts, its edge ragged over the cobbles; wet patches lie where water stands.
 */

export interface Strip {
  /** Width across the street. */
  w: number;
  surface: Surface;
}

export interface StreetSpec {
  /** Centre line ends and the paving height. */
  x0: number; z0: number; x1: number; z1: number; y: number;
  /** Strips from the left side (walking x0 to x1) to the right. Their widths add up to the street's width. */
  strips: Strip[];
  /** Earth along the left and right edges, metres deep, laid over the outer strips with a ragged inner edge. */
  verge?: [number, number];
  /** A cobble band across the flagstones every this many metres. */
  crossEvery?: number;
  /** Wet patches per 100 square metres. */
  wet?: number;
  /** Lengths along the street (from x0) left without wet patches or cross bands: flights, wells, stalls. */
  keepClear?: Array<[number, number]>;
}

/** Lays a street's paving: strips as thin slabs, cross bands, earth verges and wet patches. */
export function paveStreet(b: WorldBuilder, s: StreetSpec, rand: () => number): void {
  const L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
  const yaw = Math.atan2(s.x1 - s.x0, s.z1 - s.z0);
  const W = s.strips.reduce((t, k) => t + k.w, 0);
  // Local frame: z along the street from 0 to L, x across from -W/2 (left) to W/2... left walking +z is +x.
  b.at(s.x0, s.z0, yaw, s.y);
  const T = 0.14;
  let x = W / 2;
  const flags: Array<[number, number]> = [];
  for (const k of s.strips) {
    const cx = x - k.w / 2;
    b.box(k.surface, cx, -T / 2 + 0.005, L / 2, k.w, T, L);
    if (k.surface === 'worn_flagstones') flags.push([cx, k.w]);
    x -= k.w;
  }
  const clear = (a: number, pad: number): boolean => (s.keepClear ?? []).every(([c0, c1]) => a < c0 - pad || a > c1 + pad);
  if (s.crossEvery) {
    for (let a = s.crossEvery * (0.5 + rand() * 0.3); a < L - 1; a += s.crossEvery * (0.85 + rand() * 0.3)) {
      if (!clear(a, 1)) continue;
      for (const [cx, w] of flags) b.box('river_cobbles', cx, 0.007, a, w, 0.012, 0.9);
    }
  }
  if (s.verge) {
    const [left, right] = s.verge;
    if (left > 0) verge(b, W / 2, W / 2 - left, L, rand);
    if (right > 0) verge(b, -W / 2, -W / 2 + right, L, rand);
  }
  const area = L * W;
  const n = Math.round((area / 100) * (s.wet ?? 0));
  for (let i = 0; i < n; i++) {
    const a = 1 + rand() * (L - 2);
    if (!clear(a, 1.5)) continue;
    const across = (rand() - 0.5) * (W - 2);
    const w = 1.2 + rand() * 3.2, d = 0.9 + rand() * 2.2;
    wetPatch(b, across, 0.012, a, w, d, rand() * Math.PI);
  }
  b.at(0, 0, 0);
}

/**
 * Packed earth from an outer edge (alpha 1) to a ragged inner edge (alpha 0), in the current frame.
 * x runs from xOut to xIn; the street runs along z from 0 to L.
 */
export function verge(b: WorldBuilder, xOut: number, xIn: number, L: number, rand: () => number): void {
  const cols = 4, rows = Math.max(2, Math.round(L / 0.5));
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  // The ragged line: a random walk along the street, held inside the verge.
  const reach: number[] = [];
  let r = 0.6;
  for (let j = 0; j <= rows; j++) { r = Math.min(1, Math.max(0.25, r + (rand() - 0.5) * 0.35)); reach.push(r); }
  const vert = (i: number, j: number): void => {
    const u = i / cols, z = (j / rows) * L;
    pos.push(xOut + (xIn - xOut) * u, 0.016, z);
    nor.push(0, 1, 0);
    const edge = reach[j]!;
    const a = u < edge * 0.55 ? 1 : Math.max(0, 1 - (u - edge * 0.55) / (edge * 0.45 + 0.05)) * (0.75 + rand() * 0.25);
    col.push(1, 1, 1, Math.min(1, a));
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      vert(i, j); vert(i + 1, j); vert(i + 1, j + 1);
      vert(i, j); vert(i + 1, j + 1); vert(i, j + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  b.add('dirt_verge', g, new Matrix4());
}

/** A patch of standing water, in the current frame. */
export function wetPatch(b: WorldBuilder, x: number, y: number, z: number, w: number, d: number, yaw: number): void {
  const g = new PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(yaw);
  b.add('wet', g, new Matrix4().makeTranslation(x, y, z), { u: 1, v: 1 });
}

/**
 * The runnel: a stone channel of hot spring water along a street, steaming, with a timber rail on the street
 * side and slab bridges across it. In world coordinates, running along x from x0 to x1 at z; `side` is +1 if
 * the street is on the +z side of the channel.
 */
export function runnel(b: WorldBuilder, x0: number, x1: number, z: number, width: number, side: 1 | -1,
  bridges: number[], rand: () => number): void {
  b.at(0, 0, 0);
  const L = x1 - x0, cx = (x0 + x1) / 2, K = 0.32, KH = 0.28;
  b.box('basalt_rock_face', cx, 0.005, z, L, 0.01, width);
  b.box('water', cx, 0.15, z, L, 0.02, width - 0.04, undefined, { u: L / 4, v: 1 });
  for (const s of [-1, 1]) {
    const kz = z + s * (width / 2 + K / 2);
    b.box('ashlar_stone_blocks', cx, KH / 2, kz, L, KH, K);
    b.box('pale_stone', cx, KH + 0.03, kz, L, 0.06, K + 0.06);
    b.ao([x0, 0.17, z + s * (width / 2 - 0.01)], [x1, 0.17, z + s * (width / 2 - 0.01)], [0, -0.15, -s * 0.3], 0.7);
  }
  const free = (x: number, pad: number): boolean => bridges.every((bx) => Math.abs(x - bx) > pad);
  // Rail on the street side: square posts every two metres, a top rail and a mid rail, broken at each bridge.
  const rz = z + side * (width / 2 + K / 2);
  let runStart: number | null = null;
  const closeRun = (end: number): void => {
    if (runStart === null || end - runStart < 0.8) { runStart = null; return; }
    const l = end - runStart, c = (runStart + end) / 2;
    b.box('charred_timber_beams', c, KH + 0.95, rz, l, 0.1, 0.12);
    b.box('charred_timber_beams', c, KH + 0.55, rz, l, 0.07, 0.07);
    b.solid(c, 0.6, rz, l, 1.2, 0.4);
    runStart = null;
  };
  for (let x = x0 + 0.3; x <= x1 - 0.3; x += 2) {
    if (!free(x, 1.3)) { closeRun(x - 1); continue; }
    if (runStart === null) runStart = x;
    b.box('charred_timber_beams', x, KH + 0.5, rz, 0.14, 1.0, 0.14);
  }
  closeRun(x1 - 0.3);
  // Bridges: one thick slab across, a step of kerb either side, and the far kerb solid against the water.
  for (const bx of bridges) {
    b.box('ashlar_stone_blocks', bx, 0.3, z, 1.9, 0.12, width + K * 2 + 0.3);
    b.box('pale_stone', bx, 0.37, z, 1.95, 0.02, width + K * 2 + 0.35);
    b.solid(bx, 0.15, z, 1.9, 0.36, width + K * 2 + 0.3);
  }
  // The water itself and the house-side kerb stop the hero away from the bridges.
  b.solid(cx, 0.6, z - side * (width / 2 + K / 2), L, 1.2, K);
  const vents = Math.floor(L / 7);
  for (let i = 0; i < vents; i++) {
    const x = x0 + (i + 0.5) * (L / vents) + (rand() - 0.5) * 2;
    if (free(x, 1.4)) b.steam.push(b.world(x, 0.3, z));
  }
}

/** A lamp post: stone foot, timber post, a bracket arm and a glazed lantern, lit through dusk. Arm points along +z. */
export function lampPost(b: WorldBuilder, x: number, z: number, y: number, yaw: number): void {
  b.at(x, z, yaw, y);
  b.box('ashlar_stone_blocks', 0, 0.25, 0, 0.5, 0.5, 0.5);
  b.box('pale_stone', 0, 0.52, 0, 0.58, 0.06, 0.58);
  b.box('charred_timber_beams', 0, 2.1, 0, 0.18, 3.2, 0.18);
  b.box('charred_timber_beams', 0, 3.55, 0.35, 0.1, 0.1, 0.8);
  b.box('charred_timber_beams', 0, 3.25, 0.12, 0.06, 0.6, 0.06, { x: 0.7 });
  // The lantern: glazed box under a small hipped cap, hanging from the arm's end.
  b.box('window', 0, 3.15, 0.7, 0.34, 0.46, 0.34, undefined, { u: 1, v: 1 });
  b.box('blackened_rusted_iron', 0, 3.43, 0.7, 0.46, 0.06, 0.46);
  b.box('blackened_rusted_iron', 0, 3.5, 0.7, 0.26, 0.08, 0.26);
  b.box('blackened_rusted_iron', 0, 2.9, 0.7, 0.4, 0.05, 0.4);
  b.light(0, 3.1, 0.7, 0xffb070, 9, 11, 0.12);
  b.ao([-0.35, 0.01, -0.35], [0.35, 0.01, -0.35], [0, 0, 0.7], 0.5);
  b.solid(0, 1.8, 0, 0.4, 3.6, 0.4);
  b.at(0, 0, 0);
}

/** A hanging shop sign: a string of diamond boards with dark marks, hung off a bracket from a house front. Faces +z. */
export function hangingSign(b: WorldBuilder, n: number): void {
  // Called in a house's frame; the bracket starts at the origin.
  b.box('charred_timber_beams', 0, 0, 0.35, 0.08, 0.08, 0.7);
  for (let i = 0; i < n; i++) {
    const y = -0.42 - i * 0.56;
    b.box('charred_timber_beams', 0, y + 0.3, 0.68, 0.02, 0.14, 0.02);
    b.box('ash_plaster', 0, y, 0.68, 0.36, 0.36, 0.05, { z: Math.PI / 4 });
    b.box('charred_timber_beams', 0, y, 0.68, 0.16, 0.05, 0.065, { z: (i % 2 ? 0.4 : -0.3) });
    b.box('charred_timber_beams', 0, y - 0.05, 0.68, 0.05, 0.14, 0.065);
  }
}

/** A cloth awning on two poles, sloping down from a house front at local z0 out along +z, w wide. */
export function awning(b: WorldBuilder, x: number, y: number, z0: number, w: number, depth: number, cloth: Surface = 'indigo_cloth'): void {
  const drop = 0.55, slope = Math.atan2(drop, depth);
  b.box(cloth, x, y - drop / 2, z0 + depth / 2, w, 0.03, Math.hypot(depth, drop), { x: slope });
  b.box(cloth, x, y - drop - 0.18, z0 + depth, w, 0.36, 0.02);
  b.box('charred_timber_beams', x, y - drop - 0.02, z0 + depth, w + 0.1, 0.06, 0.06);
  for (const sx of [-1, 1]) {
    b.box('charred_timber_beams', x + sx * (w / 2 - 0.05), (y - drop) / 2, z0 + depth, 0.07, y - drop, 0.07);
    b.solid(x + sx * (w / 2 - 0.05), (y - drop) / 2, z0 + depth, 0.2, y - drop, 0.2);
  }
}

/** A stack of sawn planks on bearers, in the current frame. */
export function timberStack(b: WorldBuilder, x: number, z: number, yaw: number, rand: () => number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const put = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, roll = 0): void =>
    b.box('raw_timber', x + lx * c + lz * s, ly, z - lx * s + lz * c, sx, sy, sz, { y: yaw, z: roll });
  for (const lz of [-1.1, 0, 1.1]) put(0, 0.06, lz, 1.2, 0.12, 0.14);
  const rows = 3 + Math.floor(rand() * 3);
  for (let r = 0; r < rows; r++) {
    const n = 5 - Math.floor(r / 2);
    for (let i = 0; i < n; i++) put((i - (n - 1) / 2) * 0.24 + (rand() - 0.5) * 0.04, 0.16 + r * 0.08, (rand() - 0.5) * 0.3, 0.22, 0.06, 2.8 + rand() * 0.3);
  }
  // A plank or two leaning on the stack, as in a yard being worked.
  if (rand() < 0.6) put(0.75, 0.6, 0.2, 0.22, 0.05, 2.6, 0.9);
  b.ao([x - 0.9, 0.01, z - 1.6], [x + 0.9, 0.01, z - 1.6], [0, 0, 3.2], 0.45);
  b.solid(x, 0.3 + rows * 0.04, z, Math.abs(1.3 * c) + Math.abs(3 * s), 0.6 + rows * 0.08, Math.abs(1.3 * s) + Math.abs(3 * c));
}

/** Red paper lanterns strung on a rope between two points, sagging, in world coordinates. */
export function lanternString(b: WorldBuilder, p0: [number, number, number], p1: [number, number, number], n: number): void {
  b.at(0, 0, 0);
  const at = (t: number): [number, number, number] => [
    p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - Math.sin(Math.PI * t) * 0.5, p0[2] + (p1[2] - p0[2]) * t,
  ];
  for (let i = 0; i < 12; i++) {
    const a = at(i / 12), c = at((i + 1) / 12);
    const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const dir = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
    b.add('charred_timber_beams', new CylinderGeometry(0.012, 0.012, len, 4), new Matrix4().compose(
      new Vector3((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2),
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir), new Vector3(1, 1, 1)));
  }
  for (let i = 1; i <= n; i++) {
    const p = at(i / (n + 1));
    paperLantern(b, p[0], p[1] - 0.45, p[2]);
  }
}

/** A red paper lantern: ribbed body, dark caps, a tassel. */
export function paperLantern(b: WorldBuilder, x: number, y: number, z: number, r = 0.22): void {
  const body: Bucket = 'paper';
  b.add(body, new CylinderGeometry(r * 0.75, r * 0.75, r * 0.3, 10).translate(0, r * 0.95, 0), new Matrix4().makeTranslation(x, y, z));
  b.add(body, new CylinderGeometry(r, r * 0.75, r * 0.5, 10).translate(0, r * 0.55, 0), new Matrix4().makeTranslation(x, y, z));
  b.add(body, new CylinderGeometry(r, r, r * 0.6, 10), new Matrix4().makeTranslation(x, y, z));
  b.add(body, new CylinderGeometry(r * 0.75, r, r * 0.5, 10).translate(0, -r * 0.55, 0), new Matrix4().makeTranslation(x, y, z));
  b.cylinder('charred_timber_beams', x, y + r * 1.15, z, r * 0.55, r * 0.55, 0.06, 8);
  b.cylinder('charred_timber_beams', x, y - r * 0.85, z, r * 0.55, r * 0.55, 0.06, 8);
  b.cylinder('red_lacquer', x, y - r * 1.25, z, 0.03, 0.05, 0.3, 5);
  b.cylinder('charred_timber_beams', x, y + r * 1.5, z, 0.01, 0.01, 0.6, 4);
}

/**
 * A heap of street clutter against a wall, in world coordinates, `out` pointing from the wall into the street:
 * a few barrels, crates stacked two high, sometimes planks. Each piece is solid, so it is cover in a fight.
 */
export function clutter(b: WorldBuilder, x: number, z: number, y: number, out: number, rand: () => number): void {
  b.at(0, 0, 0);
  const ax = Math.sin(out + Math.PI / 2), az = Math.cos(out + Math.PI / 2);
  const ox = Math.sin(out), oz = Math.cos(out);
  let along = -0.9;
  const n = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const px = x + ax * along + ox * (0.1 + rand() * 0.3), pz = z + az * along + oz * (0.1 + rand() * 0.3);
    const k = rand();
    if (k < 0.5) {
      b.prop('barrel', px, pz, rand() * 6, 0.85 + rand() * 0.15, y);
      b.solid(px, y + 0.5, pz, 0.75, 1, 0.75);
      along += 0.8;
    } else {
      b.prop('crate', px, pz, out + (rand() - 0.5) * 0.4, 0.85, y);
      if (rand() < 0.6) b.prop('crate', px, pz, out + (rand() - 0.5) * 0.6, 0.7, y + 0.78);
      b.solid(px, y + 0.7, pz, 0.85, 1.4, 0.85);
      along += 0.95;
    }
  }
  b.ao([x + ax * -1.4 + ox * 0.05, y + 0.012, z + az * -1.4 + oz * 0.05], [x + ax * (along + 0.4) + ox * 0.05, y + 0.012, z + az * (along + 0.4) + oz * 0.05], [ox * 1.1, 0, oz * 1.1], 0.4);
}

/**
 * A two-wheeled hand cart at the current frame's origin, its bed along local z with the shafts forward (+z)
 * resting on the ground: plank bed with side boards, spoked wheels 1.3 m across with iron tyres, an iron axle.
 * Sometimes loaded with a barrel or crates. Solid, so it is cover in a fight.
 */
export function handCart(b: WorldBuilder, rand: () => number): void {
  const wheelR = 0.66, axleZ = -0.2;
  // The bed pivots on the axle and tips forward until the shaft ends touch the ground.
  const rise = 0.3, shaftEnd = 3.2;
  const tilt = Math.asin((wheelR + rise - 0.12) / shaftEnd);
  b.inside(0, axleZ, 0, wheelR, () => {
    // Positions in the bed's own frame (y up from the axle, z forward), turned down by `tilt` about the axle.
    const piece = (bucket: Bucket, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number): void => {
      const y = ly * Math.cos(tilt) - lz * Math.sin(tilt), z = ly * Math.sin(tilt) + lz * Math.cos(tilt);
      b.box(bucket, lx, y, z, sx, sy, sz, { x: tilt });
    };
    for (let i = 0; i < 6; i++) piece('raw_timber', -0.6 + i * 0.24, rise, 0.3, 0.23, 0.06, 2.4);
    for (const sx of [-1, 1]) {
      piece('raw_timber', sx * 0.72, rise + 0.2, 0.3, 0.06, 0.34, 2.4);
      piece('charred_timber_beams', sx * 0.5, rise - 0.08, 1.2, 0.09, 0.1, 4.0);
      for (const lz of [-0.8, 0.3, 1.4]) piece('charred_timber_beams', sx * 0.72, rise + 0.22, lz, 0.08, 0.48, 0.08);
    }
    piece('raw_timber', 0, rise + 0.2, -0.9, 1.5, 0.34, 0.06);
    piece('charred_timber_beams', 0, rise - 0.08, shaftEnd - 0.2, 1.1, 0.08, 0.08);
  });
  // Wheels and axle, upright on the ground; a wheel turns in the y-z plane about an axle along x.
  const alongX = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  b.add('blackened_rusted_iron', new CylinderGeometry(0.05, 0.05, 1.9, 8), new Matrix4().compose(new Vector3(0, wheelR, axleZ), alongX, new Vector3(1, 1, 1)));
  for (const sx of [-1, 1]) {
    const hub = new Matrix4().makeTranslation(sx * 0.88, wheelR, axleZ);
    b.add('blackened_rusted_iron', new TorusGeometry(wheelR - 0.03, 0.035, 6, 28).rotateY(Math.PI / 2), hub);
    b.add('charred_timber_beams', new TorusGeometry(wheelR - 0.09, 0.05, 6, 24).rotateY(Math.PI / 2), hub);
    b.add('charred_timber_beams', new CylinderGeometry(0.11, 0.11, 0.22, 10).rotateZ(Math.PI / 2), hub);
    for (let k = 0; k < 10; k++) {
      const len = wheelR - 0.16;
      b.add('raw_timber', new CylinderGeometry(0.025, 0.032, len, 5).translate(0, len / 2 + 0.08, 0).rotateX((k / 10) * Math.PI * 2), hub);
    }
  }
  const load = rand(), bedTop = wheelR + rise + 0.03;
  if (load < 0.35) b.prop('barrel', 0, -0.5, rand() * 6, 0.8, bedTop + 0.05);
  else if (load < 0.65) { b.prop('crate', -0.3, -0.4, rand(), 0.8, bedTop); b.prop('crate', 0.35, 0.1, rand(), 0.75, bedTop - 0.08); }
  b.solid(0, 0.7, 0.9, 1.9, 1.4, 4.4);
}

/** A hand cart parked along a wall, in world coordinates, shafts down. */
export function parkedCart(b: WorldBuilder, x: number, z: number, y: number, yaw: number, rand: () => number): void {
  b.at(x, z, yaw, y);
  handCart(b, rand);
  b.at(0, 0, 0);
}
