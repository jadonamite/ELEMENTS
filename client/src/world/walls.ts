import { BoxGeometry, BufferAttribute, BufferGeometry, ExtrudeGeometry, Matrix4, Path, Shape } from 'three';
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
  arched?: boolean;
  /** Inward lean of the face per metre of height. */
  batter?: number;
  /** Height of a low wall on top, 0 for none. */
  parapet?: number;
  /** Openings in the coping and parapet, for stair heads and lane tops. */
  gaps?: Array<{ x: number; z: number; half: number }>;
  /** Body thickness behind the face. */
  thickness?: number;
  face?: Surface;
}

const PLINTH_H = 0.5, COPING_H = 0.14, COPING_W = 0.55, PIER_W = 0.9, PIER_OUT = 0.35, RECESS = 0.3;

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
    if (spec.arched && flat && samples[0]!.top - samples[0]!.bot > 2.2) {
      arcade(b, face, samples, L, batter, T, rand);
    } else {
      strip(b, face, samples, (s) => s.bot + PLINTH_H, (s) => s.top - 0.03, (s, y) => lean(s, y), () => -T);
    }
    // Coping and parapet, broken at gaps.
    const runs = splitRuns(samples);
    for (const run of runs) {
      strip(b, 'pale_stone', run, (s) => s.top - 0.03, (s) => s.top + COPING_H, () => 0.08, () => 0.08 - COPING_W);
      if (spec.parapet) {
        const ph = spec.parapet;
        strip(b, face, run, (s) => s.top + COPING_H, (s) => s.top + ph, () => 0, () => -0.45, true);
        strip(b, 'pale_stone', run, (s) => s.top + ph, (s) => s.top + ph + 0.1, () => 0.05, () => -0.5, true);
      }
    }
    // Colliders: the body per piece (to its lower top, so a sloped wall never pokes above a lane), the parapet above.
    for (let k = 0; k < m; k++) {
      const a = samples[k]!, c = samples[k + 1]!;
      const len = Math.abs(a.lx - c.lx), lx = (a.lx + c.lx) / 2;
      const bot = Math.min(a.bot, c.bot) - 0.3;
      const top = Math.min(a.top, c.top);
      const front = batter * (Math.max(a.top, c.top) - bot) * 0.5;
      if (top > bot) b.solid(lx, (bot + top) / 2, (front - T) / 2, len, top - bot, front + T);
      if (a.gap || c.gap) continue;
      // The coping band only as wide as the visible coping, so the ground behind it stays level with the terrace.
      const cTop = Math.max(a.top, c.top) + COPING_H;
      b.solid(lx, (top + cTop) / 2, 0.08 - COPING_W / 2, len, cTop - top, COPING_W);
      if (spec.parapet) {
        const pt = Math.max(a.top, c.top) + spec.parapet + 0.1;
        b.solid(lx, (cTop + pt) / 2, -0.225, len, pt - cTop, 0.55);
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
  strip(b, face, samples, () => bot + PLINTH_H, () => top - 0.03, (s, y) => batter * (top - y) - RECESS, () => -T);
  const bays = Math.max(1, Math.round(L / 4.6));
  const bay = L / bays;
  const skin = new Shape();
  skin.moveTo(-L / 2, bot + PLINTH_H);
  skin.lineTo(L / 2, bot + PLINTH_H);
  skin.lineTo(L / 2, top - 0.03);
  skin.lineTo(-L / 2, top - 0.03);
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
  }
}

/** The top of a terrace: a paved or ash slab at the floor, filled solid to the base for the hero. */
export function terraceTop(b: WorldBuilder, r: Rect, floor: number, base: number, surface: Surface): void {
  b.at(0, 0, 0);
  const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  b.box(surface, cx, floor - 0.3, cz, w, 0.6, d);
  b.solid(cx, (floor + base) / 2 - 0.15, cz, w, floor - base + 0.3, d);
}
