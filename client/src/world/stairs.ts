import { BoxGeometry, ExtrudeGeometry, Matrix4, Shape } from 'three';
import type { WorldBuilder } from './builder.js';
import type { Surface } from './materials.js';
import { stripArea, type Area } from './levels.js';

export interface StairSpec {
  /** Bottom of the flight: centre of the first step's front edge. */
  from: { x: number; z: number; y: number };
  /** Top: centre of the last step's back edge. */
  to: { x: number; z: number; y: number };
  width: number;
  surface: 'ashlar_stone_blocks' | 'pale_stone' | 'basalt_rock_face';
  /** Side walls with coping and newels: both (default), none, or only the one on the climber's left or right. */
  cheeks?: boolean | 'left' | 'right';
  /** Steps between landings. */
  landingEvery?: number;
}

const RISE = 0.165, TREAD = 0.32, LANDING = 1.4, NOSE = 0.03, TREAD_T = 0.08, CHEEK_W = 0.5, CHEEK_H = 0.75;

function stepCount(rise: number): number {
  return Math.max(Math.ceil(rise / 0.18), Math.min(Math.floor(rise / 0.15), Math.round(rise / RISE)));
}

/** Horizontal run of a stair climbing `rise`, for laying out where its foot goes. */
export function stairRun(rise: number, landingEvery = 12): number {
  const n = stepCount(rise);
  return n * TREAD + Math.floor((n - 1) / landingEvery) * LANDING;
}

type Segment = { kind: 'flight'; a0: number; y0: number; m: number } | { kind: 'landing'; a0: number; y0: number; d: number };

/**
 * A stone stair of real steps: even risers, treads of two or three stones with a chamfered nosing,
 * landings, cheek walls with coping and newels. The hero walks an invisible ramp through the nosings.
 * Returns the ground it occupies, with a floor that rises along the flight.
 */
export function stairs(b: WorldBuilder, spec: StairSpec, rand: () => number): Area {
  const { from, to, width: w } = spec;
  const every = spec.landingEvery ?? 12;
  const run = Math.hypot(to.x - from.x, to.z - from.z), rise = to.y - from.y;
  const yaw = Math.atan2(to.x - from.x, to.z - from.z);
  const n = stepCount(rise), r = rise / n;
  const landings = Math.floor((n - 1) / every);
  const t = (run - landings * LANDING) / n;
  if (t < 0.28 || t > 0.37) console.warn(`stair tread ${t.toFixed(3)} m outside 0.28-0.37`);

  // Flights split as evenly as possible around the landings.
  const segs: Segment[] = [];
  let a = 0, y = 0;
  for (let f = 0; f <= landings; f++) {
    const m = Math.floor(n / (landings + 1)) + (f < n % (landings + 1) ? 1 : 0);
    segs.push({ kind: 'flight', a0: a, y0: y, m });
    a += m * t; y += m * r;
    if (f < landings) { segs.push({ kind: 'landing', a0: a, y0: y, d: LANDING }); a += LANDING; }
  }

  b.at(from.x, from.z, yaw, from.y);
  const surf: Surface = spec.surface;
  const fillBottom = -0.4;
  for (const s of segs) {
    if (s.kind === 'flight') {
      for (let i = 1; i <= s.m; i++) {
        const top = s.y0 + i * r, z0 = s.a0 + (i - 1) * t;
        // The step's body: its front face is the riser.
        b.box(surf, 0, (fillBottom + top - TREAD_T) / 2, z0 + t / 2, w, top - TREAD_T - fillBottom, t);
        treadStones(b, surf, w, z0 - NOSE, t + NOSE, top, rand);
        // Contact shadow where the tread meets the cheeks and the next riser.
        if (spec.cheeks !== false) {
          if (spec.cheeks !== 'right') b.ao([w / 2, top + 0.004, z0], [w / 2, top + 0.004, z0 + t], [-0.5, 0, 0], 0.8);
          if (spec.cheeks !== 'left') b.ao([-w / 2, top + 0.004, z0], [-w / 2, top + 0.004, z0 + t], [0.5, 0, 0], 0.8);
        }
        if (i < s.m) b.ao([-w / 2, top + 0.004, z0 + t], [w / 2, top + 0.004, z0 + t], [0, 0, -0.16], 0.45);
      }
    } else {
      b.box(surf, 0, (fillBottom + s.y0 - TREAD_T) / 2, s.a0 + s.d / 2, w, s.y0 - TREAD_T - fillBottom, s.d);
      // Landing paved in larger slabs, two courses.
      treadStones(b, surf, w, s.a0, s.d / 2, s.y0, rand);
      treadStones(b, surf, w, s.a0 + s.d / 2, s.d / 2, s.y0, rand);
    }
  }

  // Walking surface: one ramp per flight through the nosings, flat boxes on the last tread and landings.
  const T = 0.6;
  const surfaceAt: Array<{ a0: number; a1: number; y0: number; y1: number }> = [];
  for (const s of segs) {
    if (s.kind === 'flight') {
      const aS = s.a0 - t, yS = s.y0, aE = s.a0 + (s.m - 1) * t, yE = s.y0 + s.m * r;
      const len = Math.hypot(aE - aS, yE - yS), th = Math.atan2(yE - yS, aE - aS);
      const mz = (aS + aE) / 2 + Math.sin(th) * T / 2, my = (yS + yE) / 2 - Math.cos(th) * T / 2;
      b.solidTilted(0, my, mz, w, T, len, -th);
      b.solid(0, yE - T / 2, aE + t / 2, w, T, t);
      surfaceAt.push({ a0: aS, a1: aE, y0: yS, y1: yE }, { a0: aE, a1: aE + t, y0: yE, y1: yE });
    } else {
      b.solid(0, s.y0 - T / 2, s.a0 + s.d / 2, w, T, s.d);
      surfaceAt.push({ a0: s.a0, a1: s.a0 + s.d, y0: s.y0, y1: s.y0 });
    }
  }

  if (spec.cheeks !== false) {
    const sides = spec.cheeks === 'left' ? [1] : spec.cheeks === 'right' ? [-1] : [-1, 1];
    cheeks(b, surf === 'pale_stone' ? 'ashlar_stone_blocks' : surf, segs, t, r, w, run, rise, fillBottom, sides);
  }
  b.at(0, 0, 0);

  const area = stripArea('stair', from.x, from.z, yaw, run, w + 2 * CHEEK_W, from.y, to.y, from.y);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  area.floor = (x, z) => {
    const along = (x - from.x) * fx + (z - from.z) * fz;
    for (const p of surfaceAt) {
      if (along <= p.a1) return from.y + p.y0 + (p.y1 - p.y0) * Math.max(0, (along - p.a0) / Math.max(1e-6, p.a1 - p.a0));
    }
    return to.y;
  };
  return area;
}

/** Two or three stones across a tread, a joint between them, each with a chamfered front edge. */
function treadStones(b: WorldBuilder, surf: Surface, w: number, z0: number, depth: number, top: number, rand: () => number): void {
  const count = w > 2.6 ? 3 : 2;
  const cuts = [0];
  for (let i = 1; i < count; i++) cuts.push((i / count + (rand() - 0.5) * 0.18) * w);
  cuts.push(w);
  const c = 0.022;
  for (let i = 0; i < count; i++) {
    const x0 = -w / 2 + cuts[i]! + (i ? 0.006 : 0), x1 = -w / 2 + cuts[i + 1]! - (i < count - 1 ? 0.006 : 0);
    // Profile in (along, height): chamfer on the front top edge.
    const shape = new Shape();
    shape.moveTo(0, -TREAD_T);
    shape.lineTo(depth, -TREAD_T);
    shape.lineTo(depth, 0);
    shape.lineTo(c, 0);
    shape.lineTo(0, -c);
    shape.closePath();
    const g = new ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false });
    // Shape x -> along (local z), shape y -> height, extrusion -> across (local -x).
    const sink = (rand() - 0.5) * 0.006;
    b.add(surf, g, new Matrix4().makeTranslation(x1, top + sink, z0).multiply(new Matrix4().makeRotationY(-Math.PI / 2)));
  }
}

/** Cheek walls on both sides following the nosing line, coping along the top, newels at the foot and head. */
function cheeks(b: WorldBuilder, surf: Surface, segs: Segment[], t: number, r: number, w: number, run: number, rise: number, bottom: number,
  sides: number[]): void {
  // The top line of the cheek, as points along the stair.
  const line: Array<[number, number]> = [];
  for (const s of segs) {
    if (s.kind === 'flight') {
      line.push([s.a0, s.y0 + r + CHEEK_H], [s.a0 + (s.m - 1) * t, s.y0 + s.m * r + CHEEK_H]);
    } else {
      line.push([s.a0 + 0.15, s.y0 + CHEEK_H], [s.a0 + s.d - 0.15, s.y0 + CHEEK_H]);
    }
  }
  line.push([run, rise + CHEEK_H]);
  const shape = new Shape();
  shape.moveTo(0, bottom);
  shape.lineTo(run, bottom);
  for (let i = line.length - 1; i >= 0; i--) shape.lineTo(line[i]![0], line[i]![1]);
  shape.closePath();
  for (const side of sides) {
    const xc = side * (w / 2 + CHEEK_W / 2);
    const g = new ExtrudeGeometry(shape, { depth: CHEEK_W, bevelEnabled: false });
    b.add(surf, g, new Matrix4().makeTranslation(xc + CHEEK_W / 2, 0, 0).multiply(new Matrix4().makeRotationY(-Math.PI / 2)));
    // Coping and colliders along each piece of the top line.
    const pts: Array<[number, number]> = [[0, line[0]![1]], ...line];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a0, y0] = pts[i]!, [a1, y1] = pts[i + 1]!;
      if (a1 - a0 < 0.01) continue;
      const len = Math.hypot(a1 - a0, y1 - y0), th = Math.atan2(y1 - y0, a1 - a0);
      b.box('pale_stone', xc, (y0 + y1) / 2 + 0.06, (a0 + a1) / 2, CHEEK_W + 0.12, 0.12, len + 0.02, { x: -th });
      const H = 3;
      b.solidTilted(xc, (y0 + y1) / 2 + 0.12 - Math.cos(th) * H / 2, (a0 + a1) / 2 + Math.sin(th) * H / 2, CHEEK_W, H, len, -th);
    }
    // Newels at the foot and the head.
    for (const [a, top] of [[0.1, r + CHEEK_H + 0.35], [run - 0.35, rise + CHEEK_H + 0.35]] as const) {
      const base = a < 1 ? bottom : rise + bottom;
      b.add(surf, new BoxGeometry(0.7, top - base, 0.7), new Matrix4().makeTranslation(xc, (top + base) / 2, a));
      b.box('pale_stone', xc, top + 0.06, a, 0.84, 0.12, 0.84);
      b.box('pale_stone', xc, top + 0.17, a, 0.56, 0.1, 0.56);
      b.solid(xc, (top + base) / 2, a, 0.7, top - base + 0.3, 0.7);
    }
  }
}
