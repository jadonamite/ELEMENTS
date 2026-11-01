import { seeded, type WorldBuilder } from './builder.js';
import { rectArea, stripArea, type Area, type Rect } from './levels.js';
import { stairRun, stairs } from './stairs.js';
import { retainingWall, terraceTop } from './walls.js';

/**
 * A test hill on the open Slag Barrens (?town&terraceTest): ground at 0, a terrace at 3.5 and one at 7,
 * joined by a straight stair, a stair turning on a landing, and a switchback lane, with plain and arched
 * retaining walls and parapets. North is -z.
 */
export const TERRACE_TEST = {
  low: { x0: 505, x1: 565, z0: -88, z1: -64 } as Rect,
  high: { x0: 505, x1: 565, z0: -116, z1: -88 } as Rect,
  lowY: 3.5,
  highY: 7,
  /** A spot on the ground in front of the hill, facing it. */
  view: { x: 535, z: -30 },
};

const L = TERRACE_TEST;
const STAIR1_X = 515, STAIR1_W = 3;
const TURN = { x: 529.2, w: 2.4 };
const MID_Y = (L.lowY + L.highY) / 2;
const LANE = { x0: 541, len: 10.5, w: 3.2, turnX1: 555.5, padX0: 537.5 };

/** Ground areas of the hill; listed after the barrens so they win where they overlap it. */
export function terraceTestAreas(): Area[] {
  const run1 = stairRun(L.lowY), runHalf = stairRun(MID_Y - L.lowY);
  const z = L.low.z1; // south face of the low terrace
  const turnZ0 = L.low.z0 + runHalf; // foot of the second flight
  const laneOuter = z + LANE.w * 1.5, laneInner = z + LANE.w * 0.5;
  // The high terrace's terrain rises to it only along the back, where the hill meets it.
  const highGround = (_x: number, zz: number): number => (zz < L.high.z0 + 6 ? L.highY - 0.05 : 0);
  return [
    rectArea('test-low', L.low, L.lowY, 0),
    rectArea('test-high', L.high, L.highY, highGround),
    stripArea('test-stair', STAIR1_X, z + run1, Math.PI, run1, STAIR1_W + 1, 0, L.lowY, 0),
    stripArea('test-turn-1', TURN.x - TURN.w / 2 - runHalf, turnZ0 + TURN.w / 2, Math.PI / 2, runHalf, TURN.w + 1, L.lowY, MID_Y, 0),
    rectArea('test-turn-landing', { x0: TURN.x - TURN.w / 2, x1: TURN.x + TURN.w / 2, z0: turnZ0, z1: turnZ0 + TURN.w }, MID_Y, 0),
    stripArea('test-turn-2', TURN.x, turnZ0, Math.PI, runHalf, TURN.w + 1, MID_Y, L.highY, 0),
    stripArea('test-lane-1', LANE.x0, laneOuter, Math.PI / 2, LANE.len, LANE.w, 0, L.lowY / 2, 0),
    rectArea('test-lane-turn', { x0: LANE.x0 + LANE.len, x1: LANE.turnX1, z0: z, z1: z + LANE.w * 2 }, L.lowY / 2, 0),
    stripArea('test-lane-2', LANE.x0 + LANE.len, laneInner, -Math.PI / 2, LANE.len, LANE.w, L.lowY / 2, L.lowY, 0),
    rectArea('test-lane-top', { x0: LANE.padX0, x1: LANE.x0, z0: z, z1: z + LANE.w }, L.lowY, 0),
  ];
}

export function buildTerraceTest(b: WorldBuilder): void {
  const rand = seeded(41);
  const z = L.low.z1, run1 = stairRun(L.lowY), runHalf = stairRun(MID_Y - L.lowY);
  const turnZ0 = L.low.z0 + runHalf;

  // Terrace tops.
  terraceTop(b, L.low, L.lowY, 0, 'basalt_cobblestone');
  terraceTop(b, L.high, L.highY, 0, 'ash_cinder_ground');

  // Low terrace: plain battered walls, gaps where the stair and the lane arrive.
  retainingWall(b, {
    path: [{ x: L.low.x1, z }, { x: L.low.x0, z }], bottom: 0, top: L.lowY, batter: 0.08,
    gaps: [{ x: STAIR1_X, z, half: STAIR1_W / 2 + 0.5 }, { x: (LANE.padX0 + LANE.x0) / 2, z, half: (LANE.x0 - LANE.padX0) / 2 + 0.2 }],
  }, rand);
  retainingWall(b, { path: [{ x: L.low.x0, z }, { x: L.low.x0, z: L.low.z0 }], bottom: 0, top: L.lowY }, rand);
  retainingWall(b, { path: [{ x: L.low.x1, z: L.low.z0 }, { x: L.low.x1, z }], bottom: 0, top: L.lowY }, rand);

  // High terrace: arched walls, parapets, a gap at the head of the turning stair.
  retainingWall(b, {
    path: [{ x: L.high.x1, z: L.low.z0 }, { x: L.high.x0, z: L.low.z0 }], bottom: L.lowY, top: L.highY,
    arched: true, parapet: 0.9, gaps: [{ x: TURN.x, z: L.low.z0, half: TURN.w / 2 + 0.55 }],
  }, rand);
  retainingWall(b, { path: [{ x: L.high.x0, z: L.high.z1 }, { x: L.high.x0, z: L.high.z0 }], bottom: 0, top: L.highY, arched: true, parapet: 0.9 }, rand);
  retainingWall(b, { path: [{ x: L.high.x1, z: L.high.z0 }, { x: L.high.x1, z: L.high.z1 }], bottom: 0, top: L.highY, arched: true, parapet: 0.9 }, rand);

  // Straight stair, ground to the low terrace, one landing.
  stairs(b, { from: { x: STAIR1_X, z: z + run1, y: 0 }, to: { x: STAIR1_X, z, y: L.lowY }, width: STAIR1_W, surface: 'ashlar_stone_blocks' }, rand);

  // Turning stair on the low terrace: east to a landing, then north to the high terrace.
  const landing = { x0: TURN.x - TURN.w / 2, x1: TURN.x + TURN.w / 2, z0: turnZ0, z1: turnZ0 + TURN.w };
  stairs(b, {
    from: { x: landing.x0 - runHalf, z: turnZ0 + TURN.w / 2, y: L.lowY }, to: { x: landing.x0, z: turnZ0 + TURN.w / 2, y: MID_Y },
    width: TURN.w, surface: 'pale_stone',
  }, rand);
  terraceTop(b, landing, MID_Y, L.lowY, 'pale_stone');
  retainingWall(b, { path: [{ x: landing.x1, z: landing.z1 }, { x: landing.x0, z: landing.z1 }], bottom: L.lowY, top: MID_Y, parapet: 0.9, batter: 0.03 }, rand);
  retainingWall(b, { path: [{ x: landing.x1, z: landing.z0 }, { x: landing.x1, z: landing.z1 }], bottom: L.lowY, top: MID_Y, parapet: 0.9, batter: 0.03 }, rand);
  stairs(b, { from: { x: TURN.x, z: turnZ0, y: MID_Y }, to: { x: TURN.x, z: L.low.z0, y: L.highY }, width: TURN.w, surface: 'pale_stone' }, rand);

  // Switchback lane at 1:6: east along the outer strip, a turning platform, west along the inner strip.
  const outer = { z0: z + LANE.w, z1: z + LANE.w * 2 }, inner = { z0: z, z1: z + LANE.w };
  const lane1 = (x: number): number => (L.lowY / 2) * Math.min(1, Math.max(0, (x - LANE.x0) / LANE.len));
  const lane2 = (x: number): number => L.lowY / 2 + (L.lowY / 2) * Math.min(1, Math.max(0, (LANE.x0 + LANE.len - x) / LANE.len));
  laneSlab(b, LANE.x0, LANE.x0 + LANE.len, outer, 0, L.lowY / 2);
  laneSlab(b, LANE.x0 + LANE.len, LANE.x0, inner, L.lowY / 2, L.lowY);
  terraceTop(b, { x0: LANE.x0 + LANE.len, x1: LANE.turnX1, z0: z, z1: outer.z1 }, L.lowY / 2, 0, 'basalt_cobblestone');
  terraceTop(b, { x0: LANE.padX0, x1: LANE.x0, ...inner }, L.lowY, 0, 'basalt_cobblestone');
  retainingWall(b, { path: [{ x: LANE.x0 + LANE.len, z: outer.z1 }, { x: LANE.x0, z: outer.z1 }], bottom: 0, top: (x) => lane1(x), parapet: 0.9 }, rand);
  retainingWall(b, { path: [{ x: LANE.turnX1, z: outer.z1 }, { x: LANE.x0 + LANE.len, z: outer.z1 }], bottom: 0, top: L.lowY / 2, parapet: 0.9 }, rand);
  retainingWall(b, { path: [{ x: LANE.turnX1, z }, { x: LANE.turnX1, z: outer.z1 }], bottom: 0, top: L.lowY / 2, parapet: 0.9 }, rand);
  retainingWall(b, { path: [{ x: LANE.x0 + LANE.len, z: inner.z1 }, { x: LANE.x0, z: inner.z1 }], bottom: (x) => lane1(x), top: (x) => lane2(x), parapet: 0.9 }, rand);
  retainingWall(b, { path: [{ x: LANE.x0, z: inner.z1 }, { x: LANE.padX0, z: inner.z1 }], bottom: 0, top: L.lowY, parapet: 0.9 }, rand);
  retainingWall(b, { path: [{ x: LANE.padX0, z: inner.z1 }, { x: LANE.padX0, z }], bottom: 0, top: L.lowY, parapet: 0.9 }, rand);

  // Stand-in houses, one per terrace.
  for (const [x, zz, y] of [[552, -78, L.lowY], [548, -104, L.highY]] as const) {
    b.at(x, zz, 0, y);
    b.box('lime_plaster', 0, 2.2, 0, 6, 4.4, 5);
    b.box('basalt_rock_face', 0, 0.3, 0, 6.3, 0.6, 5.3);
    b.solid(0, 2.2, 0, 6, 4.4, 5);
  }
  b.at(0, 0, 0);
}

/** A lane slab between x0 and x1 rising from y0 to y1 (cobbled, its ramp collider under it). */
function laneSlab(b: WorldBuilder, x0: number, x1: number, zs: { z0: number; z1: number }, y0: number, y1: number): void {
  const len = Math.abs(x1 - x0), rise = y1 - y0, th = Math.atan2(rise, len), T = 0.6;
  const s = Math.hypot(len, rise);
  // Frame: local +z runs from x0 toward x1.
  b.at((x0 + x1) / 2, (zs.z0 + zs.z1) / 2, x1 > x0 ? Math.PI / 2 : -Math.PI / 2, (y0 + y1) / 2);
  b.box('basalt_cobblestone', 0, -T / 2 / Math.cos(th), 0, zs.z1 - zs.z0, T, s, { x: -th });
  b.solidTilted(0, -T / 2 / Math.cos(th), 0, zs.z1 - zs.z0, T, s, -th);
  b.at(0, 0, 0);
}
