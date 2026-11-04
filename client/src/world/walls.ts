import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, ExtrudeGeometry, IcosahedronGeometry, Matrix4, Path, Shape } from 'three';
import type { Surface } from './materials.js';
import type { WorldBuilder } from './builder.js';
import type { Floor, Rect } from './levels.js';

const at = (f: Floor, x: number, z: number): number => (typeof f === 'number' ? f : f(x, z));

export interface WallSpec {
  /** Along the top edge; the lower side is on the left walking along the path. */
  path: Array<{ x: number; z: number }>;
  bottom: Floor;
  top: Floor;
  /** Buttress piers with blind round arches between them (flat top and bottom only). */
  arched?: boolean | undefined;
  /** Inward lean of the face per metre of height. */
  batter?: number | undefined;
  /** Height of a low wall on top, 0 for none. */
  parapet?: number | undefined;
  /** Openings in the coping and parapet, for stair heads and lane tops. */
  gaps?: Array<{ x: number; z: number; half: number }> | undefined;
  /** Body thickness behind the face. */
  thickness?: number;
  face?: Surface;
}

const PLINTH_H = 0.5, COPING_H = 0.16, COPING_W = 0.55, PIER_W = 0.9, PIER_OUT = 0.35, RECESS = 0.5;
/** The coping sits this far above the terrace: flush to the foot, just enough to keep the two surfaces apart. */
const LIP = 0.012;

interface Sample { lx: number; x: number; z: number; bot: number; top: number; gap: boolean }

/**
 * A retaining wall: battered stone face on a basalt plinth course, a dressed coping on top,
 * an optional parapet, and for arched walls buttress piers with blind arches between them.
 */
export function retainingWall(b: WorldBuilder, spec: WallSpec, rand: () => number): void {
  const batter = spec.batter ?? 0.08, T = spec.thickness ?? 1.0, face = spec.face ?? 'ashlar_stone_blocks';
  for (let i = 0; i + 1 < spec.path.length; i++) {
    const p0 = spec.path[i]!, p1 = spec.path[i + 1]!;
    const L = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (L < 0.05) continue;
    const dx = (p1.x - p0.x) / L, dz = (p1.z - p0.z) / L;
    // Local +z faces the lower side; local +x runs from p1 toward p0.
    b.at((p0.x + p1.x) / 2, (p0.z + p1.z) / 2, Math.atan2(dz, -dx), 0);
    const m = Math.max(1, Math.ceil(L / 1.5));
    const samples: Sample[] = [];
    for (let k = 0; k <= m; k++) {
      const s = (k / m) * L, x = p0.x + dx * s, z = p0.z + dz * s;
      const gap = (spec.gaps ?? []).some((g) => Math.hypot(g.x - x, g.z - z) < g.half);
      samples.push({ lx: L / 2 - s, x, z, bot: at(spec.bottom, x, z), top: at(spec.top, x, z), gap });
    }
    const flat = samples.every((s) => Math.abs(s.bot - samples[0]!.bot) < 0.01 && Math.abs(s.top - samples[0]!.top) < 0.01);
    const lean = (s: Sample, y: number): number => batter * (s.top - y);

    // Plinth course, proud of the foot.
    strip(b, 'basalt_rock_face', samples, (s) => s.bot - 0.3, (s) => s.bot + PLINTH_H, (s) => lean(s, s.bot) + 0.12, () => -T);
    const tall = samples[0]!.top - samples[0]!.bot;
    if (spec.arched && flat && tall > 2.2) {
      arcade(b, face, samples, L, batter, T, rand);
    } else {
      strip(b, face, samples, (s) => s.bot + PLINTH_H, (s) => s.top - COPING_H + LIP, (s, y) => lean(s, y), () => -T);
      // A string course halfway up a tall plain wall, and odd stones left proud by the masons.
      if (flat && tall > 4.5) {
        const y = samples[0]!.bot + tall * 0.52;
        strip(b, 'pale_stone', samples, () => y, () => y + 0.18, (s) => lean(s, y) + 0.06, () => -0.2);
      }
      for (let k = 0; k < m; k++) {
        const a = samples[k]!, c = samples[k + 1]!;
        const lo = Math.max(a.bot, c.bot) + PLINTH_H + 0.3, hi = Math.min(a.top, c.top) - COPING_H - 0.4;
        for (let n = 0; n < 2; n++) {
          if (hi - lo < 0.5 || rand() < 0.45) continue;
          const y = lo + rand() * (hi - lo), w = 0.5 + rand() * 0.6, h = 0.28 + rand() * 0.16;
          const lx = c.lx + (a.lx - c.lx) * (0.15 + rand() * 0.7);
          b.box(face, lx, y, lean(a, y) + 0.018, w, h, 0.07);
        }
      }
    }
    // Weathering: shadow where the plinth meets the ground, damp up the foot, rain streaks under the coping, moss.
    for (let k = 0; k < m; k++) {
      const a = samples[k]!, c = samples[k + 1]!;
      const fa = lean(a, a.bot) + 0.125, fc = lean(c, c.bot) + 0.125;
      b.ao([a.lx, a.bot + 0.02, fa], [c.lx, c.bot + 0.02, fc], [0, 0, 1.2], 0.85);
      b.ao([a.lx, a.bot, fa + 0.004], [c.lx, c.bot, fc + 0.004], [0, 0.9, 0], 0.55);
      if (!a.gap || !c.gap) {
        const ya = a.top - COPING_H, yc = c.top - COPING_H, d = Math.min(1.8, ya - a.bot - PLINTH_H);
        if (d > 0.4 && !(spec.arched && flat)) b.ao([a.lx, ya, lean(a, ya) + 0.005], [c.lx, yc, lean(c, yc) + 0.005], [0, -d, batter * d], 0.32 + rand() * 0.15);
      }
      if (rand() < 0.4) {
        const w = 0.25 + rand() * 0.5, lx = (a.lx + c.lx) / 2;
        b.box('moss', lx, (a.bot + c.bot) / 2 + 0.012, (fa + fc) / 2 + w / 2, Math.abs(a.lx - c.lx) * (0.5 + rand() * 0.5), 0.025, w);
      }
    }
    // Coping, flush with the terrace so a flight or lane arrives without a lip; parapet on top, both broken at gaps.
    strip(b, 'pale_stone', samples, (s) => s.top - COPING_H + LIP, (s) => s.top + LIP, () => 0.08, () => 0.08 - COPING_W);
    for (const run of splitRuns(samples)) {
      if (spec.parapet) {
        const ph = spec.parapet;
        strip(b, face, run, (s) => s.top + LIP, (s) => s.top + ph, () => 0, () => -0.45, true);
        strip(b, 'pale_stone', run, (s) => s.top + ph, (s) => s.top + ph + 0.1, () => 0.05, () => -0.5, true);
        // Shadow along the parapet's foot on the terrace side.
        for (let k = 0; k + 1 < run.length; k++) {
          const a = run[k]!, c = run[k + 1]!;
          b.ao([a.lx, a.top + LIP + 0.01, -0.455], [c.lx, c.top + LIP + 0.01, -0.455], [0, 0, -0.7], 0.6);
        }
      }
    }
    // Colliders: the body per piece up to its lower top (so a sloped wall never pokes above a lane), the parapet above.
    for (let k = 0; k < m; k++) {
      const a = samples[k]!, c = samples[k + 1]!;
      const len = Math.abs(a.lx - c.lx), lx = (a.lx + c.lx) / 2;
      const bot = Math.min(a.bot, c.bot) - 0.3;
      const top = Math.min(a.top, c.top);
      const front = batter * (Math.max(a.top, c.top) - bot) * 0.5;
      if (top > bot) b.solid(lx, (bot + top) / 2, (front - T) / 2, len, top - bot, front + T);
      if (a.gap || c.gap) continue;
      if (spec.parapet) {
        const base = Math.max(a.top, c.top), pt = base + spec.parapet + 0.1;
        b.solid(lx, (base + pt) / 2, -0.225, len, pt - base, 0.55);
      }
    }
  }
  b.at(0, 0, 0);
}

function splitRuns(samples: Sample[]): Sample[][] {
  const runs: Sample[][] = [];
  let cur: Sample[] = [];
  for (const s of samples) {
    if (s.gap) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
    cur.push(s);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/**
 * A wall-like prism along samples: front face (z by height), top, back, and end caps, in the current frame.
 * Free-standing pieces (parapets) also get their back face.
 */
function strip(b: WorldBuilder, bucket: Surface, samples: Sample[],
  yb: (s: Sample) => number, yt: (s: Sample) => number,
  zFront: (s: Sample, y: number) => number, zBack: (s: Sample) => number, back = false): void {
  const pos: number[] = [];
  const quad = (a: number[], b2: number[], c: number[], d: number[]): void => { pos.push(...a, ...b2, ...c, ...a, ...c, ...d); };
  const P = (s: Sample) => {
    const bot = yb(s), top = yt(s);
    return { fb: [s.lx, bot, zFront(s, bot)], ft: [s.lx, top, zFront(s, top)], bb: [s.lx, bot, zBack(s)], bt: [s.lx, top, zBack(s)] };
  };
  for (let k = 0; k + 1 < samples.length; k++) {
    // lx decreases along the samples; wind so faces point outward.
    const a = P(samples[k]!), c = P(samples[k + 1]!);
    quad(c.fb, a.fb, a.ft, c.ft);
    quad(c.ft, a.ft, a.bt, c.bt);
    if (back) quad(a.bb, c.bb, c.bt, a.bt);
  }
  const first = P(samples[0]!), last = P(samples[samples.length - 1]!);
  quad(first.fb, first.bb, first.bt, first.ft);
  quad(last.bb, last.fb, last.ft, last.bt);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  const uv = new Float32Array((pos.length / 3) * 2);
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  b.add(bucket, g, new Matrix4());
}

/** Battered blind arcade: a recessed back face, a skin with round-arched openings, and buttress piers. */
function arcade(b: WorldBuilder, face: Surface, samples: Sample[], L: number, batter: number, T: number, rand: () => number): void {
  const bot = samples[0]!.bot, top = samples[0]!.top, H = top - bot;
  const shear = new Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, -batter, 1, batter * top, 0, 0, 0, 1);
  const put = (bucket: Surface, g: BufferGeometry, x: number, y: number, z: number): void => {
    g.translate(x, y, z);
    b.add(bucket, g, shear);
  };
  // Recessed back panel and the body behind it.
  const skinTop = top - COPING_H + LIP;
  strip(b, face, samples, () => bot + PLINTH_H, () => skinTop, (s, y) => batter * (top - y) - RECESS, () => -T);
  // Contact shadow in frame space: the arcade pieces are sheared back by the batter.
  const zs = (y: number, z: number): number => z + batter * (top - y);
  const bays = Math.max(1, Math.round(L / 4.6));
  const bay = L / bays;
  const skin = new Shape();
  skin.moveTo(-L / 2, bot + PLINTH_H);
  skin.lineTo(L / 2, bot + PLINTH_H);
  skin.lineTo(L / 2, skinTop);
  skin.lineTo(-L / 2, skinTop);
  skin.closePath();
  const ow = Math.max(0.8, bay - PIER_W - 0.5);
  const spring = Math.max(bot + PLINTH_H + 0.6, Math.min(bot + H * 0.5, top - 0.45 - ow / 2));
  for (let i = 0; i < bays; i++) {
    const cx = -L / 2 + (i + 0.5) * bay;
    const hole = new Path();
    hole.moveTo(cx - ow / 2, bot + PLINTH_H + 0.25);
    hole.lineTo(cx + ow / 2, bot + PLINTH_H + 0.25);
    hole.lineTo(cx + ow / 2, spring);
    hole.absarc(cx, spring, ow / 2, 0, Math.PI, false);
    hole.lineTo(cx - ow / 2, bot + PLINTH_H + 0.25);
    skin.holes.push(hole);
    // The recess is half a metre deep: darken its back under the crown, its sill and its jambs.
    const sill = bot + PLINTH_H + 0.25, crown = spring + ow / 2;
    b.ao([cx - ow / 2, crown, zs(crown, -RECESS + 0.01)], [cx + ow / 2, crown, zs(crown, -RECESS + 0.01)], [0, -(crown - sill) * 0.9, batter * (crown - sill) * 0.9], 0.75);
    b.ao([cx - ow / 2, sill + 0.006, zs(sill, -RECESS)], [cx + ow / 2, sill + 0.006, zs(sill, -RECESS)], [0, 0, RECESS], 0.8);
    for (const sx of [-1, 1]) {
      b.ao([cx + sx * ow / 2, sill, zs(sill, -RECESS + 0.01)], [cx + sx * ow / 2, spring, zs(spring, -RECESS + 0.01)], [-sx * ow * 0.3, 0, 0], 0.45);
    }
    // Voussoir ring: a slightly proud band of dressed stone round each arch.
    const ring = new Shape();
    ring.moveTo(cx + ow / 2 + 0.28, spring);
    ring.absarc(cx, spring, ow / 2 + 0.28, 0, Math.PI, false);
    ring.lineTo(cx - ow / 2, spring);
    ring.absarc(cx, spring, ow / 2, Math.PI, 0, true);
    ring.closePath();
    put('pale_stone', new ExtrudeGeometry(ring, { depth: 0.06, bevelEnabled: false, curveSegments: 14 }), 0, 0, 0);
    // Weep holes low in the recess: dark spouts.
    for (const off of [-ow / 4, ow / 4]) {
      if (rand() < 0.25) continue;
      put('cooled_lava_crust', new BoxGeometry(0.14, 0.14, 0.2), cx + off, bot + PLINTH_H + 0.45, -RECESS + 0.05);
    }
  }
  put(face, new ExtrudeGeometry(skin, { depth: RECESS, bevelEnabled: false, curveSegments: 14 }), 0, 0, -RECESS);
  // Buttress piers at every bay line, each with a stepped cap under the coping.
  for (let i = 0; i <= bays; i++) {
    const px = Math.max(-L / 2 + PIER_W / 2, Math.min(L / 2 - PIER_W / 2, -L / 2 + i * bay));
    put(face, new BoxGeometry(PIER_W, H - PLINTH_H - 0.03, PIER_OUT + 0.05), px, bot + PLINTH_H + (H - PLINTH_H - 0.03) / 2, PIER_OUT / 2 - 0.025);
    put('basalt_rock_face', new BoxGeometry(PIER_W + 0.16, PLINTH_H + 0.3, PIER_OUT + 0.22), px, bot + (PLINTH_H - 0.3) / 2, PIER_OUT / 2 + 0.06);
    put('pale_stone', new BoxGeometry(PIER_W + 0.1, 0.12, PIER_OUT + 0.12), px, top - 0.6, PIER_OUT / 2 + 0.01);
    // Shadow down both sides of the pier where it meets the wall skin.
    for (const sx of [-1, 1]) {
      const ex = px + sx * PIER_W / 2;
      b.ao([ex, bot + PLINTH_H, zs(bot + PLINTH_H, 0.005)], [ex, top - 0.7, zs(top - 0.7, 0.005)], [sx * 0.6, 0, 0], 0.4);
    }
  }
}

/** The top of a terrace: a paved or ash slab at the floor, filled solid to the base for the hero. */
export function terraceTop(b: WorldBuilder, r: Rect, floor: number, base: number, surface: Surface): void {
  b.at(0, 0, 0);
  const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  b.box(surface, cx, floor - 0.3, cz, w, 0.6, d);
  b.solid(cx, (floor + base) / 2 - 0.15, cz, w, floor - base + 0.3, d);
}

export interface DressSpec {
  /** Ground to keep free: lanes, stair heads, doors. */
  clear?: Rect[];
  /** Edge that faces the drop, for the drain channel and the planters: 'n' is -z, 's' +z, 'e' +x, 'w' -x. */
  edge?: 'n' | 's' | 'e' | 'w' | undefined;
  /** How busy, 0..1. */
  density?: number;
}

/**
 * Makes a terrace top look lived on: a drain channel along the drop, planters with shrubs, a bench,
 * a washing line, firewood, water barrels and crates, worn and mossy patches. Pieces avoid `clear`.
 */
export function dressTerrace(b: WorldBuilder, r: Rect, y: number, rand: () => number, spec: DressSpec = {}): void {
  b.at(0, 0, 0);
  const clear = spec.clear ?? [], density = spec.density ?? 0.6;
  const free = (x: number, z: number, pad: number): boolean =>
    x > r.x0 + pad && x < r.x1 - pad && z > r.z0 + pad && z < r.z1 - pad
    && clear.every((c) => x < c.x0 - pad || x > c.x1 + pad || z < c.z0 - pad || z > c.z1 + pad);
  const spot = (pad: number): { x: number; z: number } | null => {
    for (let i = 0; i < 12; i++) {
      const x = r.x0 + rand() * (r.x1 - r.x0), z = r.z0 + rand() * (r.z1 - r.z0);
      if (free(x, z, pad)) return { x, z };
    }
    return null;
  };
  // Drain channel a little in from the drop, and planters on the lip side of it.
  if (spec.edge) {
    const ns = spec.edge === 'n' || spec.edge === 's';
    const len = ns ? r.x1 - r.x0 : r.z1 - r.z0;
    const at = spec.edge === 'n' ? r.z0 + 0.9 : spec.edge === 's' ? r.z1 - 0.9 : spec.edge === 'w' ? r.x0 + 0.9 : r.x1 - 0.9;
    const cx = ns ? (r.x0 + r.x1) / 2 : at, cz = ns ? at : (r.z0 + r.z1) / 2;
    b.box('basalt_rock_face', cx, y + 0.006, cz, ns ? len : 0.34, 0.012, ns ? 0.34 : len);
    b.box('cooled_lava_crust', cx, y + 0.01, cz, ns ? len : 0.2, 0.012, ns ? 0.2 : len);
    const pots = Math.floor(len / 3.2);
    for (let i = 0; i < pots; i++) {
      if (rand() > 0.35 + density * 0.4) continue;
      const u = (i + 0.5 + (rand() - 0.5) * 0.4) * (len / pots);
      const off = spec.edge === 'n' || spec.edge === 'w' ? -0.45 : 0.45;
      const px = ns ? r.x0 + u : at + off, pz = ns ? at + off : r.z0 + u;
      if (free(px, pz, 0.2) || !clear.length) planter(b, px, y, pz, 0.24 + rand() * 0.16, rand);
    }
  }
  const area = (r.x1 - r.x0) * (r.z1 - r.z0);
  const count = Math.round(area / 45 * density);
  for (let i = 0; i < count; i++) {
    const p = spot(1.2);
    if (!p) continue;
    const kind = rand();
    const yaw = rand() < 0.5 ? 0 : Math.PI / 2;
    if (kind < 0.22) planter(b, p.x, y, p.z, 0.32 + rand() * 0.22, rand);
    else if (kind < 0.36) bench(b, p.x, y, p.z, yaw);
    else if (kind < 0.5) washingLine(b, p.x, y, p.z, yaw, rand);
    else if (kind < 0.62) firewood(b, p.x, y, p.z, yaw, rand);
    else if (kind < 0.8) { b.prop('barrel', p.x, p.z, rand() * 6, 0.9, y); b.solid(p.x, y + 0.5, p.z, 0.8, 1, 0.8); }
    else { b.prop('crate', p.x, p.z, rand() * 0.5, 0.8, y); b.solid(p.x, y + 0.4, p.z, 0.9, 0.8, 0.9); }
  }
  // Worn and damp patches on the paving.
  for (let i = 0; i < count * 2; i++) {
    const p = spot(0.4);
    if (!p) continue;
    const w = 0.8 + rand() * 2, d = 0.6 + rand() * 1.5;
    if (rand() < 0.5) b.box('moss', p.x, y + 0.006, p.z, w * 0.6, 0.012, d * 0.6);
    else b.ao([p.x - w / 2, y + 0.008, p.z], [p.x + w / 2, y + 0.008, p.z], [0, 0, d], 0.18);
  }
}

/** A fired clay pot with a shrub, its shadow on the ground. */
export function planter(b: WorldBuilder, x: number, y: number, z: number, r: number, rand: () => number): void {
  b.at(x, z, rand() * 6, y);
  const h = r * 1.5;
  b.cylinder('terracotta', 0, h / 2, 0, r, r * 0.78, h, 12);
  b.cylinder('terracotta', 0, h - 0.04, 0, r + 0.05, r + 0.05, 0.08, 12);
  // A shrub as a loose clump of leaf masses, not one ball.
  for (let i = 0; i < 4; i++) {
    const s = r * (0.6 + rand() * 0.5), a = rand() * 6.28, o = i ? r * 0.55 : 0;
    const g = new IcosahedronGeometry(s, 1);
    g.scale(1, 0.7 + rand() * 0.6, 1);
    b.add('moss', g, new Matrix4().makeTranslation(Math.cos(a) * o, h + s * 0.6 + (i ? rand() * r * 0.6 : r * 0.5), Math.sin(a) * o));
  }
  b.ao([-r * 1.3, 0.01, -r * 1.3], [r * 1.3, 0.01, -r * 1.3], [0, 0, r * 2.6], 0.25);
  b.solid(0, h / 2, 0, r * 2, h, r * 2);
  b.at(0, 0, 0);
}

function bench(b: WorldBuilder, x: number, y: number, z: number, yaw: number): void {
  b.at(x, z, yaw, y);
  for (const sx of [-0.7, 0.7]) b.box('ashlar_stone_blocks', sx, 0.22, 0, 0.3, 0.44, 0.42);
  b.box('charred_timber_beams', 0, 0.48, 0, 1.9, 0.08, 0.45);
  b.ao([-1, 0.01, -0.3], [1, 0.01, -0.3], [0, 0, 0.6], 0.4);
  b.solid(0, 0.25, 0, 1.9, 0.5, 0.45);
  b.at(0, 0, 0);
}

function washingLine(b: WorldBuilder, x: number, y: number, z: number, yaw: number, rand: () => number): void {
  b.at(x, z, yaw, y);
  for (const sx of [-1.6, 1.6]) { b.box('charred_timber_beams', sx, 1.1, 0, 0.12, 2.2, 0.12); b.solid(sx, 1.1, 0, 0.2, 2.2, 0.2); }
  b.box('charred_timber_beams', 0, 2.15, 0, 3.4, 0.05, 0.05);
  for (let u = -1.2; u < 1.3; u += 0.55 + rand() * 0.3) {
    const h = 0.6 + rand() * 0.5;
    b.box(rand() < 0.3 ? 'red_lacquer' : 'lime_plaster', u, 2.12 - h / 2, 0, 0.4 + rand() * 0.2, h, 0.02);
  }
  b.at(0, 0, 0);
}

function firewood(b: WorldBuilder, x: number, y: number, z: number, yaw: number, rand: () => number): void {
  b.at(x, z, yaw, y);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6 - row; i++) {
      const g = new CylinderGeometry(0.08, 0.08, 0.7 + rand() * 0.15, 7).rotateX(Math.PI / 2);
      b.add('charred_timber_beams', g, new Matrix4().makeTranslation((i - (5 - row) / 2) * 0.17, 0.08 + row * 0.15, 0));
    }
  }
  b.ao([-0.7, 0.01, -0.5], [0.7, 0.01, -0.5], [0, 0, 1], 0.35);
  b.solid(0, 0.25, 0, 1.1, 0.5, 0.8);
  b.at(0, 0, 0);
}
