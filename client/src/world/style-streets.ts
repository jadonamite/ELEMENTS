import { seeded, type WorldBuilder } from './builder.js';
import { rectArea, type Area, type Floor, type Rect } from './levels.js';
import { stairRun, stairs, type StairSpec } from './stairs.js';
import {
  brazier, compoundWall, hall, lantern, noticeBoard, roofedGate, stall, townHouse, well, type Rank,
} from './style-kit.js';
import { dressTerrace, planter, retainingWall, terraceTop } from './walls.js';

/**
 * Three trial streets for choosing Sindr's maze style (?town&style=hill|warren|cliff), each about 40 x 45 m,
 * on the north edge of the Slag Barrens so the volcano stands behind them. Each runs commoners low to nobles high.
 *
 * Street coordinates: s across (east is +s), a up the street (north, away from the barrens).
 */
export type StreetStyle = 'hill' | 'warren' | 'cliff';
export const STYLES: StreetStyle[] = ['hill', 'warren', 'cliff'];
export const STYLE_ORIGIN = { x: 600, z: -110 };

const O = STYLE_ORIGIN;
const X = (s: number): number => O.x + s;
const Z = (a: number): number => O.z - a;
const R = (s0: number, s1: number, a0: number, a1: number): Rect => ({ x0: X(s0), x1: X(s1), z0: Z(a1), z1: Z(a0) });
/** Yaws for fronts facing down the street (toward the barrens), up it, east and west. */
const DOWN = 0, UP = Math.PI, EAST = Math.PI / 2, WEST = -Math.PI / 2;

/** Collects the walkable areas while it builds, so the terrain can be shaped to the street before the town is built. */
class Street {
  readonly areas: Area[] = [];
  constructor(readonly b: WorldBuilder, readonly rand: () => number) {}

  /** A paved or ash level filled solid to `base`, walkable. */
  level(name: string, r: Rect, y: number, base: number, surface: Parameters<typeof terraceTop>[4] = 'basalt_cobblestone'): void {
    terraceTop(this.b, r, y, base, surface);
    this.areas.push(rectArea(name, r, y, base < y ? base : undefined));
  }

  /** A flight up the street axis (along +a) or across it, in street coordinates. */
  flight(s0: number, a0: number, y0: number, s1: number, a1: number, y1: number, width: number,
    surface: StairSpec['surface'] = 'ashlar_stone_blocks', cheeks: StairSpec['cheeks'] = true, landingEvery = 12): void {
    this.areas.push(stairs(this.b, { from: { x: X(s0), z: Z(a0), y: y0 }, to: { x: X(s1), z: Z(a1), y: y1 }, width, surface, cheeks, landingEvery }, this.rand));
  }

  /**
   * A retaining wall in street coordinates between points; the drop is on the left walking from p0 to p1
   * (walk west for a drop toward the barrens).
   */
  wall(p: Array<[number, number]>, bottom: Floor, top: Floor, opts: { arched?: boolean; parapet?: number; gaps?: Array<[number, number, number]>; batter?: number } = {}): void {
    retainingWall(this.b, {
      path: p.map(([s, a]) => ({ x: X(s), z: Z(a) })), bottom, top, arched: opts.arched, parapet: opts.parapet, batter: opts.batter,
      gaps: opts.gaps?.map(([s, a, half]) => ({ x: X(s), z: Z(a), half })),
    }, this.rand);
  }

  house(s: number, a: number, y: number, yaw: number, w: number, d: number, floors: 1 | 2, rank: Rank,
    extra: { shop?: boolean; lantern?: boolean; door?: number; footing?: number } = {}): void {
    townHouse(this.b, { x: X(s), z: Z(a), y, yaw, w, d, floors, rank, ...extra }, this.rand);
  }

  dress(r: Rect, y: number, edge: 'n' | 's' | 'e' | 'w' | undefined, clear: Rect[], density = 0.6): void {
    dressTerrace(this.b, r, y, this.rand, { edge, clear, density });
  }
}

/** Builds the chosen street and returns its walkable ground. Run once on a scratch builder for the areas. */
export function buildStyleStreet(style: StreetStyle, b: WorldBuilder): Area[] {
  const st = new Street(b, seeded(style === 'hill' ? 11 : style === 'warren' ? 23 : 37));
  if (style === 'hill') hill(st);
  else if (style === 'warren') warren(st);
  else cliff(st);
  b.at(0, 0, 0);
  return st.areas;
}

/** Where to stand for the comparison shots: [name, x, z, height to drop from, facing, pitch]. */
export function styleViews(style: StreetStyle): Array<[string, number, number, number, number, number]> {
  const v = (name: string, s: number, a: number, y: number, facing: number, pitch: number): [string, number, number, number, number, number] =>
    [name, X(s), Z(a), y, facing, pitch];
  const N = Math.PI; // facing north, up the street
  if (style === 'hill') {
    return [v('approach', 0, -16, 1, N, -0.42), v('lane', 0.5, 4, 0.5, N, -0.2), v('flight', -1, 17, 3.5, N, -0.05),
      v('yard', -5, 26, 5, N * 0.8, -0.18), v('top', 4, 33, 8, 0.25, -0.38), v('overview', 22, -20, 1, N * 1.2, -0.6)];
  }
  if (style === 'warren') {
    return [v('approach', 0, -12, 1, N, -0.32), v('lane', 0, 5, 0.5, N, -0.12), v('dogleg', -6, 15, 0.5, N * 0.85, -0.12),
      v('court', -4, 27, 0.5, N, -0.15), v('top', -2, 38, 3.5, 0.2, -0.4), v('overview', 24, -18, 1, N * 1.2, -0.6)];
  }
  return [v('approach', 0, -16, 1, N, -0.4), v('stair', 10, 3, 0.5, N * 1.25, -0.2), v('notch', -1, 12, 6.5, N, 0.05),
    v('bridge', 9, 22.5, 12.5, -Math.PI / 2, -0.15), v('top', -12, 32, 18.5, 0.3, -0.4), v('overview', 24, -20, 1, N * 1.22, -0.55)];
}

// ---------------------------------------------------------------------------------------------------------------
// A. Hill town: one lane climbing in short flights between stepped house rows (castle-town and temple approaches,
// such as Ninenzaka in Kyoto or the Kotohira approach), a turning yard with the inn and the notice board, then a
// stair cut into the top terrace that doubles back to the lord's gate and hall.

function hill(st: Street): void {
  const SPAN = 16, LANE = 2.2, SEC = 5;
  const run = stairRun(1.5);
  const ys = [0, 1.5, 3.0, 4.5];
  // Bands: each runs from its lower edge to the head of the flight that leaves it.
  const bands: Array<{ a0: number; a1: number; y: number }> = [];
  let a = 0;
  for (let k = 0; k < 3; k++) { bands.push({ a0: a, a1: a + SEC + run, y: ys[k]! }); a += SEC + run; }
  const yard = { a0: a, a1: a + 6.5, y: ys[3]! };
  bands.push(yard);
  const T0 = yard.a1, T1 = T0 + 22, TY = 7.5;
  const slot = { s0: -11.6, s1: -8.4 }, slotRun = stairRun(TY - yard.y);

  // Levels and flights up the lane.
  bands.forEach((band, k) => {
    st.level(`hill-band-${k}`, R(-SPAN, SPAN, band.a0, band.a1), band.y, k ? ys[k - 1]! : -0.6, k % 2 ? 'basalt_cobblestone' : 'ashlar_stone_blocks');
    if (k < 3) st.flight(0, band.a1 - run, band.y, 0, band.a1, ys[k + 1]!, LANE * 2, 'ashlar_stone_blocks');
  });
  // The lane's own paving down the middle of each band.
  for (const band of bands.slice(0, 3)) {
    st.b.at(0, 0, 0);
    st.b.box('pale_stone', X(0), band.y + 0.005, Z((band.a0 + band.a1 - run) / 2), LANE * 2, 0.012, band.a1 - run - band.a0);
  }
  // Retaining walls between bands, broken by the flight; parapets on the upper edge away from the lane.
  for (let k = 0; k < 3; k++) {
    const aw = bands[k]!.a1, lo = ys[k]!, hi = ys[k + 1]!;
    st.wall([[SPAN, aw], [LANE + 0.5, aw]], lo, hi, { parapet: 0.8 });
    st.wall([[-LANE - 0.5, aw], [-SPAN, aw]], lo, hi, { parapet: 0.8 });
  }
  // Top terrace, with a slot for the doubling-back stair.
  st.level('hill-top-e', R(slot.s1, SPAN, T0, T0 + slotRun), TY, yard.y);
  st.level('hill-top-w', R(-SPAN, slot.s0, T0, T0 + slotRun), TY, yard.y);
  st.level('hill-top', R(-SPAN, SPAN, T0 + slotRun, T1), TY, yard.y, 'pale_stone');
  st.flight(-10, T0, yard.y, -10, T0 + slotRun, TY, slot.s1 - slot.s0 - 0.2, 'pale_stone', false);
  const stairY = (_x: number, z: number): number => yard.y + (TY - yard.y) * Math.min(1, Math.max(0, (O.z - z - T0) / slotRun));
  st.wall([[SPAN, T0], [slot.s1, T0]], yard.y, TY, { arched: true, parapet: 0.9 });
  st.wall([[slot.s0, T0], [-SPAN, T0]], yard.y, TY, { arched: true, parapet: 0.9 });
  st.wall([[slot.s1, T0], [slot.s1, T0 + slotRun]], stairY, TY, { parapet: 0.9, batter: 0.02 });
  st.wall([[slot.s0, T0 + slotRun], [slot.s0, T0]], stairY, TY, { parapet: 0.9, batter: 0.02 });

  // Commoners in the lowest bands: small stone houses tight on the lane, one a forge-smith's shop.
  const row = (band: { a0: number; a1: number; y: number }, rank: Rank, floors: 1 | 2, shopE = false, shopW = false): void => {
    const len = band.a1 - band.a0 - 0.6, mid = (band.a0 + band.a1) / 2;
    const wE = len, wW = len;
    st.house(LANE + 4.4, mid, band.y, WEST, wE - 0.4, 6.4, floors, rank, { shop: shopE, lantern: rank !== 'common', footing: 2 });
    st.house(-LANE - 4.4, mid, band.y, EAST, wW - 0.4, 6.4, floors, rank, { shop: shopW, lantern: rank !== 'common', footing: 2 });
    st.dress(R(LANE + 7.8, SPAN - 0.3, band.a0 + 0.3, band.a1 - 0.3), band.y, undefined, [], 0.9);
    st.dress(R(-SPAN + 0.3, -LANE - 7.8, band.a0 + 0.3, band.a1 - 0.3), band.y, undefined, [], 0.9);
  };
  row(bands[0]!, 'common', 1, true);
  row(bands[1]!, 'common', 2, false, true);
  row(bands[2]!, 'merchant', 2, true, true);
  // Planters and a brazier where each flight starts.
  bands.slice(0, 3).forEach((band, k) => {
    planter(st.b, X(LANE + 1.2), band.y, Z(band.a1 - run - 0.8), 0.35, st.rand);
    if (k === 1) brazier(st.b, X(-LANE - 0.9), Z(band.a1 - run - 1.2), band.y);
  });
  // The yard: the inn on the east, the notice board, a stall and the well on the west.
  st.house(10, (yard.a0 + yard.a1) / 2, yard.y, WEST, 6, 9, 2, 'merchant', { lantern: true });
  noticeBoard(st.b, X(-4.5), Z(yard.a0 + 1.2), yard.y, DOWN, st.rand);
  stall(st.b, X(-13), Z(yard.a0 + 3), yard.y, EAST, st.rand);
  well(st.b, X(-6.5), Z(yard.a1 - 2.2), yard.y);
  brazier(st.b, X(3.2), Z(yard.a1 - 1.2), yard.y);
  lantern(st.b, X(4.6), yard.y + 2.6, Z(yard.a0 + 0.4));

  // Nobles on top: the gate on the lane's axis, a counting house, the master's hall on its podium.
  roofedGate(st.b, X(0), Z(T0 + slotRun + 1.5), TY, DOWN, 3.2, 'noble', st.rand);
  compoundWall(st.b, X(-SPAN + 0.4), Z(T0 + slotRun + 1.5), X(-2.2), Z(T0 + slotRun + 1.5), TY, 2.6, 'noble');
  compoundWall(st.b, X(2.2), Z(T0 + slotRun + 1.5), X(SPAN - 0.4), Z(T0 + slotRun + 1.5), TY, 2.6, 'noble');
  st.house(11, T0 + 3.4, TY, DOWN, 8, 5.6, 2, 'noble', { lantern: true, door: -1 });
  hall(st.b, X(0), Z(T1 - 4.6), TY, DOWN, 14, 6, 1.2, st.rand);
  st.dress(R(-SPAN + 0.5, -4, T0 + slotRun + 2.5, T1 - 0.5), TY, undefined, [R(-10.5, -4, T1 - 12, T1)], 0.6);
  st.dress(R(-7.6, 5.5, T0 + 0.5, T0 + slotRun + 0.8), TY, 's', [R(-8.4, -6.5, T0, T0 + slotRun)], 0.5);
}

// ---------------------------------------------------------------------------------------------------------------
// B. Courtyard warren: walled compounds with narrow gaps between them (Beijing hutong and siheyuan, Kyoto machiya
// blocks). The lane doglegs past gates and a bridging house to a well court, then a short stair to a raised noble
// compound. Height changes are small; rank shows in wall height, plaster and roofs.

function warren(st: Street): void {
  const SPAN = 18;
  // Ground: one low level, a half-metre step, and the raised noble compound.
  st.level('warren-low', R(-SPAN, SPAN, 0, 22), 0, -0.6, 'basalt_cobblestone');
  st.level('warren-mid', R(-SPAN, SPAN, 22, 33), 0.6, 0, 'basalt_cobblestone');
  st.level('warren-high', R(-SPAN, SPAN, 33, 48), 2.4, 0.6, 'pale_stone');
  st.flight(-4, 22 - stairRun(0.6), 0, -4, 22, 0.6, 2.4, 'basalt_rock_face', false);
  st.wall([[SPAN, 22], [-2.6, 22]], 0, 0.6, {});
  st.wall([[-5.4, 22], [-SPAN, 22]], 0, 0.6, {});
  st.flight(-4, 33 - stairRun(1.8), 0.6, -4, 33, 2.4, 2.6, 'pale_stone');
  st.wall([[SPAN, 33], [-2.3, 33]], 0.6, 2.4, { arched: false });
  st.wall([[-5.7, 33], [-SPAN, 33]], 0.6, 2.4, {});

  const W = 3.2; // compound wall height for commoners
  // Lane: from the barrens north at s 0 to a 12, dogleg west to s -4, north to the court and the stair.
  // Compound A (east of the lane, low): a commoner yard with two houses inside.
  const cA: Rect = { x0: 1.6, x1: SPAN, z0: 0.5, z1: 13 }; // street coords in x=s, z=a for readability
  wallsAround(st, cA, 0, W, 'common', [{ side: 'w', at: 7, half: 1.1 }]);
  roofedGate(st.b, X(cA.x0), Z(7), 0, WEST, 2.2, 'common', st.rand);
  st.house(9.5, 3.4, 0, UP, 9, 4.6, 1, 'common', { footing: 0.6 });
  st.house(14.5, 10, 0, WEST, 5.4, 5.2, 2, 'common', {});
  st.dress(R(3, 12, 6, 12), 0, undefined, [R(1, 4, 6, 8)], 1);
  // Compound B (west of the lane, low): a shop house fronting the lane, its yard behind.
  st.house(-4.6, 6, 0, EAST, 7.5, 5.6, 2, 'merchant', { shop: true, lantern: true });
  wallsAround(st, { x0: -SPAN, x1: -7.4, z0: 0.5, z1: 10.4 }, 0, W, 'common', []);
  st.house(-13, 5.5, 0, EAST, 8, 6, 1, 'common', {});
  // The dogleg: a bridging house spans the lane where it turns west.
  bridgeHouse(st, 0.0, 12.4, 0);
  // Compound C (east, mid): walls hard on the lane, a dead-end gap between C and A.
  wallsAround(st, { x0: -1.5, x1: SPAN, z0: 15, z1: 21.6 }, 0, W + 0.4, 'merchant', [{ side: 's', at: 8, half: 1.2 }]);
  roofedGate(st.b, X(8), Z(15), 0, DOWN, 2.4, 'merchant', st.rand);
  st.house(10, 18.2, 0, WEST, 6, 8, 2, 'merchant', { lantern: true });
  // West of the dogleg: the inn with its lantern, facing the lane.
  st.house(-11, 16.5, 0, EAST, 9.5, 7, 2, 'merchant', { lantern: true, door: 1.5 });
  wallsAround(st, { x0: -SPAN, x1: -15, z0: 11, z1: 21.6 }, 0, W, 'common', []);
  noticeBoard(st.b, X(-1.2), Z(18.5), 0, WEST, st.rand);

  // Well court on the mid level.
  well(st.b, X(-4), Z(27.5), 0.6);
  stall(st.b, X(-11), Z(26), 0.6, EAST, st.rand);
  stall(st.b, X(3.4), Z(26.2), 0.6, WEST, st.rand);
  brazier(st.b, X(-0.5), Z(30.8), 0.6);
  st.house(11, 27.5, 0.6, WEST, 9.4, 7, 2, 'merchant', { shop: true, lantern: true });
  st.house(-15, 29.5, 0.6, EAST, 6, 5, 1, 'common', {});
  st.dress(R(-SPAN + 0.5, -7, 23, 32.5), 0.6, undefined, [R(-13, -9, 24, 28)], 0.7);

  // Noble compound on the high level: a tall plastered wall with the gate on the stair head, the hall inside.
  const hy = 2.4;
  compoundWall(st.b, X(-SPAN + 0.3), Z(35.5), X(-6.1), Z(35.5), hy, 3.8, 'noble');
  compoundWall(st.b, X(-1.9), Z(35.5), X(SPAN - 0.3), Z(35.5), hy, 3.8, 'noble');
  roofedGate(st.b, X(-4), Z(35.5), hy, DOWN, 3.4, 'noble', st.rand);
  hall(st.b, X(0), Z(43), hy, DOWN, 15, 6.5, 1.0, st.rand);
  st.house(-13.5, 41, hy, EAST, 6, 7, 2, 'noble', {});
  st.dress(R(7, SPAN - 0.5, 36.5, 47.5), hy, undefined, [], 0.7);
  st.dress(R(-SPAN + 0.5, 6, 33.4, 35), hy, 's', [R(-6, -2, 33, 36)], 0.4);
}

/** Compound walls round a rectangle given in street coordinates (x = s, z = a), with gate gaps on named sides. */
function wallsAround(st: Street, r: Rect, y: number, h: number, rank: Rank, gaps: Array<{ side: 'n' | 's' | 'e' | 'w'; at: number; half: number }>): void {
  const sides: Array<['n' | 's' | 'e' | 'w', [number, number], [number, number]]> = [
    ['s', [r.x0, r.z0], [r.x1, r.z0]], ['n', [r.x0, r.z1], [r.x1, r.z1]], ['w', [r.x0, r.z0], [r.x0, r.z1]], ['e', [r.x1, r.z0], [r.x1, r.z1]],
  ];
  for (const [side, p0, p1] of sides) {
    const ns = side === 'n' || side === 's';
    const cuts = gaps.filter((g) => g.side === side).sort((m, n) => m.at - n.at);
    let from = ns ? p0[0] : p0[1];
    const end = ns ? p1[0] : p1[1];
    const piece = (u0: number, u1: number): void => {
      if (u1 - u0 < 0.3) return;
      if (ns) compoundWall(st.b, X(u0), Z(p0[1]), X(u1), Z(p0[1]), y, h, rank);
      else compoundWall(st.b, X(p0[0]), Z(u0), X(p0[0]), Z(u1), y, h, rank);
    };
    for (const g of cuts) { piece(from, g.at - g.half); from = g.at + g.half; }
    piece(from, end);
  }
}

/** A house carried over the lane on beams: two stone piers, a timber upper room, a small roof. */
function bridgeHouse(st: Street, s: number, a: number, y: number): void {
  const b = st.b;
  b.at(X(s), Z(a), WEST, y);
  // Local x runs along the street (north is -x here), local z across it.
  for (const sz of [-2.4, 2.4]) {
    b.box('ashlar_stone_blocks', 0, 1.9, sz, 2.6, 3.8, 1.2);
    b.solid(0, 1.9, sz, 2.6, 3.8, 1.2);
  }
  b.box('charred_timber_beams', 0, 3.95, 0, 2.8, 0.3, 6.2);
  for (const sx of [-1.1, 0, 1.1]) b.box('charred_timber_beams', sx, 3.75, 0, 0.18, 0.18, 6);
  b.box('sooted_plaster', 0, 5.3, 0, 2.6, 2.4, 6);
  b.ao([-1.4, 3.79, -1.8], [-1.4, 3.79, 1.8], [2.8, 0, 0], 0.35);
  for (const sz of [-1.6, 1.6]) {
    b.box('window', 1.32, 5.4, sz, 0.03, 0.8, 1.2, undefined, { u: 1, v: 1 });
    for (let k = -2; k <= 2; k++) b.box('charred_timber_beams', 1.35, 5.4, sz + k * 0.22, 0.05, 0.8, 0.05);
  }
  b.box('roof_tile_charcoal', 0.75, 6.85, 0, 1.9, 0.09, 7, { z: -0.45 });
  b.box('roof_tile_charcoal', -0.75, 6.85, 0, 1.9, 0.09, 7, { z: 0.45 });
  b.box('roof_tile_charcoal', 0, 7.25, 0, 0.25, 0.18, 7.1);
  b.ao([-1.3, 0.02, -1.8], [-1.3, 0.02, 1.8], [2.6, 0, 0], 0.3);
  lantern(b, 1.6, 3.2, 0);
  b.at(0, 0, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// C. Cliff town: terraces cut into a steep slope, held by tall arched retaining walls, stairs running along the
// wall faces, a ravine notch between two spurs crossed by a covered bridge, and a hall on a timber stage over the
// drop (kakezukuri, as at Kiyomizu-dera; cliff villages of Guizhou and Hunan).

function cliff(st: Street): void {
  const SPAN = 20, Y1 = 6, Y2 = 12, Y3 = 18;
  const N0 = -4, N1 = 2; // the notch between the two upper spurs
  const run6 = stairRun(6);
  // Levels.
  st.level('cliff-street', R(-SPAN, SPAN, 0, 8), 0, -0.6, 'basalt_cobblestone');
  st.level('cliff-1', R(-SPAN, SPAN, 8, 18), Y1, 0, 'basalt_cobblestone');
  st.level('cliff-notch', R(N0, N1, 18, 28), Y1, 0, 'ash_cinder_ground');
  st.level('cliff-2w', R(-SPAN, N0, 18, 28), Y2, Y1, 'basalt_cobblestone');
  st.level('cliff-2e', R(N1, SPAN, 18, 28), Y2, Y1, 'basalt_cobblestone');
  st.level('cliff-3', R(-SPAN, SPAN, 28, 44), Y3, Y2, 'pale_stone');

  // Street to the first terrace: a stair along the wall face, rising west, arriving on a landing by a parapet gap.
  const s1 = { from: 16.5, to: 16.5 - run6, a: 6.6 };
  st.flight(s1.from, s1.a, 0, s1.to, s1.a, Y1, 2.4, 'ashlar_stone_blocks', 'left');
  st.level('cliff-landing-1', R(s1.to - 2.4, s1.to, 5.4, 8), Y1, 0, 'ashlar_stone_blocks');
  st.wall([[SPAN, 8], [-SPAN, 8]], 0, Y1, { arched: true, parapet: 0.9, gaps: [[s1.to - 1.2, 8, 1.4]] });
  st.wall([[s1.to, 5.4], [s1.to - 2.4, 5.4]], 0, Y1, { parapet: 0.9 });
  st.wall([[s1.to - 2.4, 5.4], [s1.to - 2.4, 8]], 0, Y1, { parapet: 0.9 });

  // First terrace to the east spur: a stair along the next wall rising east, a landing at the far end.
  const s2 = { from: 3.2, to: 3.2 + run6, a: 16.6 };
  st.flight(s2.from, s2.a, Y1, s2.to, s2.a, Y2, 2.4, 'ashlar_stone_blocks', 'right');
  st.level('cliff-landing-2', R(s2.to, Math.min(SPAN, s2.to + 2.4), 15.4, 18), Y2, Y1, 'ashlar_stone_blocks');
  st.wall([[SPAN, 18], [N1, 18]], Y1, Y2, { arched: true, parapet: 0.9, gaps: [[s2.to + 1.2, 18, 1.4]] });
  st.wall([[N0, 18], [-SPAN, 18]], Y1, Y2, { arched: true, parapet: 0.9 });
  st.wall([[s2.to + 2.4, 15.4], [s2.to, 15.4]], Y1, Y2, { parapet: 0.9 });
  st.wall([[s2.to, 15.4], [s2.to, 18]], Y1, Y2, {});
  // Notch walls: the spurs' sides and the tall back wall.
  st.wall([[N0, 18], [N0, 28]], Y1, Y2, { arched: true, parapet: 0.9, gaps: [[N0, 23, 1.3]] });
  st.wall([[N1, 28], [N1, 18]], Y1, Y2, { arched: true, parapet: 0.9, gaps: [[N1, 23, 1.3]] });
  st.wall([[N1, 28], [N0, 28]], Y1, Y3, { arched: true, parapet: 0.9 });
  st.wall([[SPAN, 28], [N1, 28]], Y2, Y3, { arched: true, parapet: 0.9 });
  st.wall([[N0, 28], [-SPAN, 28]], Y2, Y3, { arched: true, parapet: 0.9, gaps: [[-18.6, 28, 1.6]] });

  // The covered bridge across the notch joins the two spurs at the second level.
  coveredBridge(st, N0, N1, 23, Y2);

  // West spur to the top: a stair along the top wall rising west to a landing at the far west.
  const s3 = { from: -6.2, to: -6.2 - stairRun(6, 18), a: 26.6 };
  st.flight(s3.from, s3.a, Y2, s3.to, s3.a, Y3, 2.4, 'pale_stone', 'left', 18);

  // Houses: commoners on the street and the first terrace, merchants and the inn on the spurs, nobles on top.
  st.house(-12, 2.6, 0, DOWN, 8, 5.2, 1, 'common', { footing: 0.6 });
  st.house(-3.2, 2.6, 0, DOWN, 6, 5.2, 1, 'common', { shop: true });
  st.house(-14, 11.5, Y1, DOWN, 10, 5, 1, 'common', { footing: 0.6 });
  st.house(-5, 11.5, Y1, DOWN, 5.5, 5, 1, 'common', {});
  st.house(9, 11.2, Y1, DOWN, 7, 4.6, 1, 'common', { shop: true, lantern: true });
  st.house(-12.5, 22.1, Y2, DOWN, 10, 4.4, 2, 'merchant', { lantern: true, door: 2 });
  st.house(11.5, 24, Y2, DOWN, 9, 6.6, 2, 'merchant', { lantern: true });
  hall(st.b, X(4), Z(37), Y3, DOWN, 16, 7, 1.0, st.rand, 2);
  st.house(-12, 34, Y3, DOWN, 7, 6, 2, 'noble', { lantern: true });
  stage(st, -11, 19.5, Y2, Y1);

  // Life on the levels.
  noticeBoard(st.b, X(4), Z(7.4), 0, DOWN, st.rand);
  stall(st.b, X(11), Z(3), 0, DOWN, st.rand);
  brazier(st.b, X(1), Z(3.5), 0);
  well(st.b, X(-1), Z(25.5), Y1);
  brazier(st.b, X(N1 + 2.2), Z(20.5), Y2);
  st.dress(R(-SPAN + 0.4, 0, 8.4, 9.5), Y1, 's', [R(s1.to - 3, s1.to + 1, 8, 10)], 0.5);
  planter(st.b, X(N1 + 1.2), Y2, Z(26.8), 0.4, st.rand);
  st.dress(R(-SPAN + 0.5, -4.5, 28.4, 30), Y3, 's', [R(-SPAN, -16.5, 28, 31)], 0.5);
  st.dress(R(-SPAN + 0.5, SPAN - 0.5, 41, 43.5), Y3, undefined, [], 0.6);
}

/** A covered timber bridge from s0 to s1 at a, floor y: deck on beams, lacquer posts, rails, a tiled roof. */
function coveredBridge(st: Street, s0: number, s1: number, a: number, y: number): void {
  const b = st.b, L = s1 - s0 + 1.2;
  b.at(X((s0 + s1) / 2), Z(a), EAST, y);
  // Local z runs along the bridge (east), x across it.
  b.box('charred_timber_beams', 0, -0.12, 0, 2.8, 0.24, L);
  for (const sx of [-1.1, 0, 1.1]) b.box('charred_timber_beams', sx, -0.42, 0, 0.26, 0.4, L);
  b.solid(0, -0.15, 0, 2.8, 0.3, L);
  for (const sx of [-1.3, 1.3]) {
    for (let k = 0; k <= 3; k++) b.box('red_lacquer', sx, 1.3, -L / 2 + 0.3 + k * (L - 0.6) / 3, 0.18, 2.6, 0.18);
    b.box('red_lacquer', sx, 0.85, 0, 0.1, 0.1, L);
    b.box('red_lacquer', sx, 0.35, 0, 0.06, 0.06, L);
    b.solid(sx, 0.6, 0, 0.2, 1.2, L);
  }
  b.box('red_lacquer', 0, 2.62, 0, 2.9, 0.16, L);
  b.box('roof_tile_red', 0.85, 3.0, 0, 1.9, 0.09, L + 1.0, { z: -0.42 });
  b.box('roof_tile_red', -0.85, 3.0, 0, 1.9, 0.09, L + 1.0, { z: 0.42 });
  b.box('gold_trim', 0, 3.38, 0, 0.2, 0.14, L + 1.0);
  b.ao([-1.2, 0.01, -L / 2], [-1.2, 0.01, L / 2], [0.7, 0, 0], 0.4);
  b.ao([1.2, 0.01, -L / 2], [1.2, 0.01, L / 2], [-0.7, 0, 0], 0.4);
  lantern(b, 0, 2.2, 0);
  b.at(0, 0, 0);
}

/** A timber stage over the drop: a deck at `top` reaching south off the spur, carried on a grid of posts and ties to `bottom`. */
function stage(st: Street, s: number, a: number, top: number, bottom: number): void {
  const b = st.b, W = 9, D = 3.6;
  b.at(X(s), Z(a), 0, 0);
  // Local +z is toward the barrens: the deck pokes out from the spur's wall at a = 18 (local z = a - 18 back).
  const z0 = a - 18;
  b.box('charred_timber_beams', 0, top - 0.1, z0 + D / 2 - 0.2, W, 0.2, D);
  b.solid(0, top - 0.1, z0 + D / 2 - 0.2, W, 0.2, D);
  for (let i = 0; i <= 4; i++) {
    const px = -W / 2 + 0.3 + i * (W - 0.6) / 4;
    for (const pz of [z0 + 0.9, z0 + D - 0.4]) {
      b.box('charred_timber_beams', px, (top + bottom) / 2 - 0.1, pz, 0.3, top - bottom - 0.2, 0.3);
      b.solid(px, (top + bottom) / 2, pz, 0.35, top - bottom, 0.35);
      b.box('ashlar_stone_blocks', px, bottom + 0.15, pz, 0.6, 0.3, 0.6);
    }
  }
  for (const ty of [bottom + 2, bottom + 4]) {
    b.box('charred_timber_beams', 0, ty, z0 + 0.9, W, 0.18, 0.14);
    b.box('charred_timber_beams', 0, ty, z0 + D - 0.4, W, 0.18, 0.14);
  }
  // Railing on the deck's three open sides.
  b.box('red_lacquer', 0, top + 0.9, z0 + D - 0.25, W, 0.1, 0.1);
  for (const sx of [-1, 1]) b.box('red_lacquer', sx * (W / 2 - 0.05), top + 0.9, z0 + D / 2, 0.1, 0.1, D);
  for (let i = 0; i <= 10; i++) b.box('red_lacquer', -W / 2 + i * W / 10, top + 0.45, z0 + D - 0.25, 0.08, 0.9, 0.08);
  b.solid(0, top + 0.55, z0 + D - 0.25, W, 1.1, 0.2);
  for (const sx of [-1, 1]) b.solid(sx * (W / 2 - 0.05), top + 0.55, z0 + D / 2, 0.2, 1.1, D);
  b.ao([-W / 2, bottom + 0.02, z0 + 0.2], [W / 2, bottom + 0.02, z0 + 0.2], [0, 0, D], 0.35);
  b.at(0, 0, 0);
  void UP;
}
