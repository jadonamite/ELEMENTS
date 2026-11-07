import { ExtrudeGeometry, Matrix4, Shape } from 'three';
import type { WorldBuilder } from './builder.js';
import { rectArea, type Area } from './levels.js';
import type { Surface } from './materials.js';
import { stairRun, stairs } from './stairs.js';
import { retainingWall } from './walls.js';

/**
 * Stone water works for towns built on canals: balustrades along a drop, a walled canal reach with its sluice,
 * outlet and water stair, and an arched bridge. Each piece takes its dimensions and place, so the same pieces
 * build every reach and crossing in the nation.
 */

/** Height of a rail's collider: above a standing jump, so nobody steps or hops into the water by accident. */
const RAIL_SOLID = 1.6;

/**
 * A stone balustrade from `a` to `c` standing at height y: a base course, square posts with caps, a low panel and
 * a heavy top rail. `gaps` are stretches along it (metres from `a`) left open for stairs and crossings.
 */
export function balustrade(b: WorldBuilder, a: { x: number; z: number }, c: { x: number; z: number }, y: number,
  gaps: Array<[number, number]> = [], rand: () => number = () => 0.5): void {
  const L = Math.hypot(c.x - a.x, c.z - a.z);
  if (L < 0.3) return;
  b.at(a.x, a.z, Math.atan2(c.x - a.x, c.z - a.z), y);
  const runs: Array<[number, number]> = [];
  let s = 0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > s + 0.3) runs.push([s, Math.min(g0, L)]);
    s = Math.max(s, g1);
  }
  if (L > s + 0.3) runs.push([s, L]);
  for (const [s0, s1] of runs) {
    const len = s1 - s0, mid = (s0 + s1) / 2;
    b.box('pale_stone', 0, 0.09, mid, 0.44, 0.18, len);
    b.box('ashlar_stone_blocks', 0, 0.36, mid, 0.18, 0.36, len);
    b.box('ashlar_stone_blocks', 0, 0.93, mid, 0.32, 0.16, len + 0.1);
    b.box('pale_stone', 0, 1.02, mid, 0.36, 0.04, len + 0.12);
    const n = Math.max(1, Math.round(len / 1.9));
    for (let k = 0; k <= n; k++) {
      const z = s0 + (k / n) * len;
      b.box('ashlar_stone_blocks', 0, 0.55, z, 0.32, 1.1, 0.32);
      b.box('pale_stone', 0, 1.14, z, 0.4, 0.08, 0.4);
      if (k < n) {
        // Short turned balusters between the panel and the rail.
        const bay = len / n;
        for (let j = 1; j < 4; j++) b.cylinder('ashlar_stone_blocks', 0, 0.68, z + (j / 4) * bay, 0.05, 0.07, 0.34, 6);
      }
    }
    if (rand() < 0.7) b.box('moss', 0, 0.185, s0 + rand() * len * 0.6, 0.46, 0.02, 0.6 + rand() * 1.4);
    b.ao([-0.24, 0.012, s0], [-0.24, 0.012, s1], [-0.5, 0, 0], 0.5);
    b.ao([0.24, 0.012, s0], [0.24, 0.012, s1], [0.5, 0, 0], 0.5);
    b.solid(0, RAIL_SOLID / 2, mid, 0.4, RAIL_SOLID, len);
  }
  b.at(0, 0, 0);
}

export interface CanalSpec {
  /** The open channel: x along the flow (west to east), z0 its north edge, z1 its south edge. */
  x0: number; x1: number; z0: number; z1: number;
  /** Water surface and bed along the flow. */
  surface: (x: number) => number;
  bed: (x: number) => number;
  /** Ground level along the south bank. */
  south: number;
  /** Ground levels along the north bank, as stretches of x. */
  north: Array<{ x0: number; x1: number; top: number }>;
  /** Openings in the south rail for crossings, as stretches of x. */
  crossings: Array<[number, number]>;
  /** Stretches of x along the north bank that are not railed (a crossing's landing). */
  openNorth?: Array<[number, number]>;
}

const WALL_T = 1.2, END_T = 3;

/**
 * A canal reach in stone: battered walls up to each bank, a cobbled bed, the moving water at its true height,
 * a sluice where the feeder comes in at the head, a grated culvert where it leaves, rails on both banks and a
 * water stair down from the south bank so anyone in the water can climb out. Returns the channel as ground the
 * terrain is cut below, so nothing but the bed lies under the water.
 */
export function canal(b: WorldBuilder, c: CanalSpec, rand: () => number): Area[] {
  const L = c.x1 - c.x0, W = c.z1 - c.z0, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  const fall = c.surface(c.x0) - c.surface(c.x1), pitch = Math.atan2(fall, L);
  const mid = (f: (x: number) => number): number => (f(c.x0) + f(c.x1)) / 2;
  // Bed and water, tilted with the flow (the frame's +z runs downstream).
  b.at(cx, cz, Math.PI / 2, 0);
  b.box('basalt_cobblestone', 0, mid(c.bed) - 0.2, 0, W, 0.4, L, { x: pitch });
  b.solidTilted(0, mid(c.bed) - 0.3, 0, W, 0.6, L, pitch);
  b.box('fresh_water', 0, mid(c.surface), 0, W - 0.04, 0.02, L, { x: pitch }, { u: 1, v: 1 });
  b.at(0, 0, 0);
  // Walls: the south bank in dressed stone, the north bank in rough basalt like the cliff it holds.
  retainingWall(b, { path: [{ x: c.x0, z: c.z1 }, { x: c.x1, z: c.z1 }], bottom: (x) => c.bed(x), top: c.south, batter: 0.02, parapet: 0, thickness: WALL_T }, rand);
  for (const n of [...c.north].sort((p, q) => q.x0 - p.x0)) {
    retainingWall(b, { path: [{ x: n.x1, z: c.z0 }, { x: n.x0, z: c.z0 }], bottom: (x) => c.bed(x), top: n.top, batter: 0.02, parapet: 0,
      thickness: WALL_T, face: n.top > c.south + 1 ? 'basalt_rock_face' : 'ashlar_stone_blocks' }, rand);
  }
  retainingWall(b, { path: [{ x: c.x0, z: c.z0 }, { x: c.x0, z: c.z1 }], bottom: c.bed(c.x0), top: c.south, batter: 0.02, parapet: 0, thickness: END_T }, rand);
  sluice(b, c, rand);
  outlet(b, c);
  // The water stair: down the south wall from the head of the reach, so the way out is beside the sluice crew.
  const top = { x: c.x0 + 3.6, z: c.z1 - 0.7, y: c.south };
  let foot = top.x + stairRun(c.south - c.bed(top.x + 12));
  foot = top.x + stairRun(c.south - c.bed(foot));
  const areas: Area[] = [];
  areas.push(stairs(b, { from: { x: foot, z: top.z, y: c.bed(foot) }, to: top, width: 1.2, surface: 'ashlar_stone_blocks', cheeks: 'right' }, rand));
  b.at(0, 0, 0);
  b.box('ashlar_stone_blocks', (c.x0 + top.x) / 2, c.south - 0.2, top.z, top.x - c.x0, 0.4, 1.2);
  b.box('ashlar_stone_blocks', (c.x0 + top.x) / 2, (c.south + c.bed(c.x0)) / 2 - 0.2, top.z, top.x - c.x0, c.south - c.bed(c.x0) - 0.4, 1.2);
  b.solid((c.x0 + top.x) / 2, (c.south + c.bed(c.x0)) / 2, top.z, top.x - c.x0, c.south - c.bed(c.x0), 1.2);
  // Rails: the south bank is open at the stair head and the crossings; the north bank follows its ground.
  const southGaps: Array<[number, number]> = [[0, top.x - c.x0 + 0.1], ...c.crossings.map(([a, z]): [number, number] => [a - c.x0, z - c.x0])];
  balustrade(b, { x: c.x0, z: c.z1 + 0.35 }, { x: c.x1, z: c.z1 + 0.35 }, c.south, southGaps, rand);
  for (const n of c.north) {
    if (n.top <= c.south + 0.01) continue;
    const gaps = (c.openNorth ?? []).filter(([a, z]) => z > n.x0 && a < n.x1).map(([a, z]): [number, number] => [a - n.x0, z - n.x0]);
    balustrade(b, { x: n.x0, z: c.z0 - 0.35 }, { x: n.x1, z: c.z0 - 0.35 }, n.top, gaps, rand);
  }
  // Moss along the waterline, weeds in the joints.
  for (let x = c.x0 + 1; x < c.x1 - 1; x += 1.3 + rand() * 2.2) {
    for (const [z, s] of [[c.z1 - 0.03, -1], [c.z0 + 0.03, 1]] as const) {
      if (rand() < 0.55) b.box('moss', x, c.surface(x) + 0.12 + rand() * 0.2, z + s * 0.02, 0.8 + rand() * 1.6, 0.25 + rand() * 0.3, 0.04);
    }
    if (rand() < 0.3) b.plant(rand() < 0.5 ? 'fern' : 'weed', x, c.z0 + 0.25, 0.5 + rand() * 0.4, c.surface(x) + 0.5, rand() * 6);
  }
  areas.unshift(rectArea('canal', { x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1 }, (x) => c.bed(x), (x) => c.bed(x) - 1.2));
  return areas;
}

/** The head of the reach: a gate in a stone frame across the feeder's mouth, the water dropping out under it. */
function sluice(b: WorldBuilder, c: CanalSpec, rand: () => number): void {
  const cz = (c.z0 + c.z1) / 2, s = c.surface(c.x0), gateW = 2.6;
  // The feeder's mouth sits just over the water; the gate is raised above it in the frame's grooves.
  const mouth0 = s + 0.2, mouth1 = s + 0.2 + Math.min(0.9, (c.south - s) * 0.55), gateH = 1.2, top = Math.max(c.south + 1.2, mouth1 + gateH + 0.3);
  b.at(c.x0, cz, Math.PI / 2, 0);
  for (const sx of [-1, 1]) {
    b.box('ashlar_stone_blocks', sx * (gateW / 2 + 0.35), (c.bed(c.x0) + top) / 2, 0.3, 0.7, top - c.bed(c.x0), 0.6);
    b.box('pale_stone', sx * (gateW / 2 + 0.35), top + 0.05, 0.3, 0.86, 0.12, 0.76);
  }
  b.box('ashlar_stone_blocks', 0, top - 0.25, 0.3, gateW + 1.4, 0.5, 0.6);
  b.box('raw_timber', 0, mouth1 + gateH / 2 + 0.05, 0.05, gateW, gateH, 0.14);
  for (const y of [mouth1 + 0.35, mouth1 + gateH - 0.25]) b.box('blackened_rusted_iron', 0, y, 0.13, gateW + 0.04, 0.08, 0.03);
  b.box('blackened_rusted_iron', 0, top + 0.45, 0.3, 0.12, 0.9, 0.12);
  b.cylinder('blackened_rusted_iron', 0, top + 0.95, 0.3, 0.3, 0.3, 0.08, 12);
  // The dark mouth below the gate and the sheet of water spilling from it into the reach.
  b.box('basalt_rock_face', 0, (mouth0 + mouth1) / 2, -0.02, gateW, mouth1 - mouth0, 0.04);
  b.box('fresh_water', 0, (s + mouth1) / 2, 0.15, gateW - 0.2, mouth1 - s, 0.05, { x: 0.35 }, { u: 1, v: 1 });
  b.box('fresh_water', 0, s + 0.06, 0.5, gateW - 0.1, 0.03, 1.0, undefined, { u: 1, v: 1 });
  b.ao([-gateW / 2, mouth1, 0.01], [gateW / 2, mouth1, 0.01], [0, -0.4, 0], 0.8);
  b.solid(0, (c.bed(c.x0) + top) / 2, 0.3, gateW + 2.1, top - c.bed(c.x0), 0.6);
  for (let i = 0; i < 3; i++) b.steam.push(b.world((rand() - 0.5) * gateW, s + 0.15, 0.7 + rand() * 0.6));
  b.at(0, 0, 0);
}

/** The foot of the reach: an arched culvert through the end wall, barred with iron, the water running on in the dark. */
function outlet(b: WorldBuilder, c: CanalSpec): void {
  const W = c.z1 - c.z0, cz = (c.z0 + c.z1) / 2, bed = c.bed(c.x1), top = c.south, archW = 4.2;
  const crown = Math.min(c.surface(c.x1) + 1.6, top - 0.35);
  // The wall's outline with the arch cut up into it from the bed.
  const spring = crown - archW / 2, shape = new Shape();
  shape.moveTo(-W / 2, bed - 0.4); shape.lineTo(-archW / 2, bed - 0.4); shape.lineTo(-archW / 2, spring);
  shape.absarc(0, spring, archW / 2, Math.PI, 0, true);
  shape.lineTo(archW / 2, bed - 0.4); shape.lineTo(W / 2, bed - 0.4); shape.lineTo(W / 2, top); shape.lineTo(-W / 2, top); shape.closePath();
  // Shape x runs across the canal (+z), the extrusion runs downstream (+x) through the wall.
  b.at(c.x1, cz, 0, 0);
  b.add('ashlar_stone_blocks', new ExtrudeGeometry(shape, { depth: END_T, bevelEnabled: false, curveSegments: 12 }), new Matrix4().makeRotationY(Math.PI / 2));
  // Voussoirs round the mouth, the dark beyond, the grate across it.
  const ring = new Shape();
  ring.absarc(0, spring, archW / 2 + 0.45, 0, Math.PI, false);
  ring.lineTo(-archW / 2, spring);
  ring.absarc(0, spring, archW / 2, Math.PI, 0, true);
  ring.closePath();
  b.add('pale_stone', new ExtrudeGeometry(ring, { depth: 0.12, bevelEnabled: false, curveSegments: 12 }), new Matrix4().makeRotationY(Math.PI / 2).premultiply(new Matrix4().makeTranslation(-0.1, 0, 0)));
  b.box('basalt_rock_face', END_T - 0.1, (bed + crown) / 2, 0, 0.1, crown - bed + 0.4, archW);
  b.ao([0.02, crown - 0.05, -archW / 2], [0.02, crown - 0.05, archW / 2], [1.6, -0.6, 0], 0.95);
  for (let z = -archW / 2 + 0.3; z < archW / 2; z += 0.32) b.box('blackened_rusted_iron', 0.3, (bed + crown) / 2, z, 0.06, crown - bed, 0.06);
  for (const y of [bed + 0.6, c.surface(c.x1) + 0.4, crown - 0.6]) b.box('blackened_rusted_iron', 0.3, y, 0, 0.08, 0.08, archW);
  b.solid(END_T / 2, (bed + top) / 2 - 0.2, 0, END_T, top - bed + 0.4, W);
  b.at(0, 0, 0);
}

export interface BridgeSpec {
  /** Centre line x; the bridge runs along z from z0 to z1. */
  x: number; z0: number; z1: number;
  /** Clear width between the rails, and the deck's walking height. */
  clear: number; deck: number;
  /** The water's span (the canal walls) and the lowest point under it. */
  span: [number, number]; bed: number;
  /** Where the arch springs from the walls. */
  spring: number;
}

/**
 * A stone arch bridge: a segmental arch springing from the canal walls, solid spandrels, a paved deck level with
 * both banks, voussoirs picked out in pale stone, and balustrades along both sides. Only the deck and the rails
 * are solid, so the water and the bed under the arch stay open.
 */
export function archBridge(b: WorldBuilder, s: BridgeSpec, rand: () => number): void {
  const len = s.z1 - s.z0, outer = s.clear + 0.9, thick = 0.4;
  const a0 = s.span[0] - s.z0, a1 = s.span[1] - s.z0, half = (a1 - a0) / 2, am = (a0 + a1) / 2;
  const crown = s.deck - thick - 0.05, rise = Math.max(0.3, crown - s.spring);
  const R = (half * half + rise * rise) / (2 * rise), cy = crown - R, th = Math.asin(half / R);
  // Body: shape x along the bridge (local z), shape y up; extruded across (local -x).
  // The body's outline with the arch cut up into it over the water.
  const body = new Shape();
  body.moveTo(0, s.bed - 0.3); body.lineTo(a0, s.bed - 0.3); body.lineTo(a0, s.spring);
  body.absarc(am, cy, R, Math.PI / 2 + th, Math.PI / 2 - th, true);
  body.lineTo(a1, s.bed - 0.3); body.lineTo(len, s.bed - 0.3); body.lineTo(len, s.deck - thick); body.lineTo(0, s.deck - thick); body.closePath();
  const across = (x: number): Matrix4 => new Matrix4().makeTranslation(x, 0, 0).multiply(new Matrix4().makeRotationY(-Math.PI / 2));
  b.at(s.x, s.z0, 0, 0);
  b.add('ashlar_stone_blocks', new ExtrudeGeometry(body, { depth: outer, bevelEnabled: false, curveSegments: 16 }), across(outer / 2));
  const ring = new Shape();
  ring.absarc(am, cy, R + 0.4, Math.PI / 2 + th, Math.PI / 2 - th, true);
  ring.absarc(am, cy, R, Math.PI / 2 - th, Math.PI / 2 + th, false);
  ring.closePath();
  for (const x of [outer / 2 + 0.06, -outer / 2 + 0.02]) b.add('pale_stone', new ExtrudeGeometry(ring, { depth: 0.08, bevelEnabled: false, curveSegments: 16 }), across(x));
  b.box('ashlar_stone_blocks', 0, s.deck - thick / 2, len / 2, outer, thick, len);
  b.box('worn_flagstones', 0, s.deck - 0.04, len / 2, s.clear, 0.1, len);
  for (const sx of [-1, 1]) b.box('pale_stone', sx * (outer / 2 + 0.04), s.deck - thick - 0.05, len / 2, 0.12, 0.14, len);
  b.ao([-s.clear / 2, s.deck + 0.012, 0], [-s.clear / 2, s.deck + 0.012, len], [0.5, 0, 0], 0.55);
  b.ao([s.clear / 2, s.deck + 0.012, 0], [s.clear / 2, s.deck + 0.012, len], [-0.5, 0, 0], 0.55);
  b.solid(0, s.deck - 0.3, len / 2, outer, 0.6, len);
  b.at(0, 0, 0);
  for (const sx of [-1, 1]) balustrade(b, { x: s.x + sx * (s.clear / 2 + 0.22), z: s.z0 }, { x: s.x + sx * (s.clear / 2 + 0.22), z: s.z1 }, s.deck, [], rand);
}
