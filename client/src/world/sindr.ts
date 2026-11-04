import { CylinderGeometry, Matrix4, Vector3 } from 'three';
import { seeded, WorldBuilder, type HouseSpec } from './builder.js';
import type { Peak } from './landscape.js';
import { circleArea, Levels, rectArea, stripArea, type Area, type Rect } from './levels.js';
import type { Surface } from './materials.js';
import { brackets, roof } from './roofs.js';
import { SINDR_SPAWN } from '../../../shared/src/net/index.js';
import anchorData from './sindr-anchors.json';
import { stairRun, stairs } from './stairs.js';
import { compoundWall, hall, noticeBoard, roofedGate, stall, townHouse, well, type Rank } from './style-kit.js';
import { awning, clutter, handCart, lampPost, lanternString, paperLantern, parkedCart, paveStreet, runnel, timberStack, wetPatch, type Strip } from './street.js';
import { dressTerrace, planter, retainingWall, terraceTop } from './walls.js';

/**
 * Sindr, the IGNIS forge town, built as a hill town: a long lower street (Cinder Row) runs east from the
 * Shrine of Embers past the market square to the Gorge Road; from the square one lane, the Rise, climbs north
 * in short flights between stepped rows of houses, commoners low and merchants above, through the well yard
 * to the Lord's Gate and the Master's Hall; behind the hall a switchback road climbs the crag to Brandr's Keep.
 * Every named place comes from sindr-anchors.json, which the other systems read too. x runs east, north is -z.
 */

export interface Anchor {
  id: string; kind: string; name: string;
  x: number; y: number; z: number; yaw: number; reach: number;
  merchant?: string | null;
  door?: { x: number; z: number };
  path?: Array<{ x: number; y: number; z: number }>;
}
export const ANCHORS: Anchor[] = anchorData.anchors as Anchor[];
export function anchor(id: string): Anchor {
  const a = ANCHORS.find((k) => k.id === id);
  if (!a) throw new Error(`Sindr has no anchor ${id}`);
  return a;
}

export const SPAWN = SINDR_SPAWN;
/** Cinder Row: house fronts stand `half` either side of z 0. */
const STREET = { x0: 52, x1: 224, half: 8 };
const SQUARE = { x0: 104, x1: 146, z0: -16, z1: 16 };
/** The Rise: its lane between the house fronts, and the terraces' width. */
const LANE = { x0: 120, x1: 130, cx: 125 };
const BAND = { x0: 98, x1: 152 };
/** The Rise's levels, south to north: z1 is the south edge (where the wall below stands), z0 the north. */
const RISE: Array<{ name: string; z0: number; z1: number; y: number }> = [
  { name: 'rise-0', z0: -22, z1: -16, y: 0 },
  { name: 'rise-1', z0: -36, z1: -22, y: 1.5 },
  { name: 'rise-2', z0: -50, z1: -36, y: 3 },
  { name: 'rise-yard', z0: -68, z1: -50, y: 4.5 },
  { name: 'rise-4', z0: -86, z1: -68, y: 7.5 },
  { name: 'rise-top', z0: -128, z1: -86, y: 11 },
];
/** The keep road: three legs up the crag's face, two turning landings, the gate court. */
const KEEP_ROAD = {
  legs: [
    { name: 'keep-1', x0: 146, x1: 192, z0: -134, z1: -128, y0: 11, y1: 17.5 },
    { name: 'keep-2', x0: 192, x1: 146, z0: -142, z1: -134, y0: 17.5, y1: 24 },
    { name: 'keep-3', x0: 146, x1: 196, z0: -150, z1: -142, y0: 24, y1: 30 },
  ],
  landings: [
    { name: 'keep-turn-1', r: { x0: 192, x1: 198, z0: -142, z1: -128 }, y: 17.5 },
    { name: 'keep-turn-2', r: { x0: 140, x1: 146, z0: -150, z1: -134 }, y: 24 },
    { name: 'keep-turn-3', r: { x0: 196, x1: 202, z0: -170, z1: -142 }, y: 30 },
  ],
  court: { x0: 160, x1: 202, z0: -170, z1: -150 },
  y: 30,
};
/** The keep stands on its crag at the head of the road; its platform is level with the gate court. */
export const KEEP = { x: anchor('keep').x, z: anchor('keep').z };
const KEEP_Y = KEEP_ROAD.y - 6;

export const PEAKS: Peak[] = [
  { x: KEEP.x, z: KEEP.z - 8, radius: 48, height: 46 },
];

/** Ground people walk on that is not built by the town itself: the shrine, the roads, the outer zones. */
export const WALKABLE = new Levels([
  circleArea('shrine', 0, 0, 22),
  rectArea('shrine-road', { x0: 10, x1: 60, z0: -8, z1: 8 }),
  rectArea('cinder-row', { x0: 48, x1: 228, z0: -STREET.half, z1: STREET.half }),
  rectArea('north-plots', { x0: 48, x1: 228, z0: -21, z1: -STREET.half }),
  rectArea('south-quarter', { x0: 48, x1: 228, z0: STREET.half, z1: 56 }),
  rectArea('gorge-road', { x0: 224, x1: 450, z0: -9, z1: 9 }),
  rectArea('slag-barrens', { x0: 450, x1: 680, z0: -110, z1: 110 }),
  rectArea('east-fort', { x0: 680, x1: 765, z0: -35, z1: 35 }),
]);

const EAST = Math.PI / 2, WEST = -Math.PI / 2;
const SHRINE_R = 16;

/**
 * Builds the town and returns the walkable ground it adds (terraces, flights, the keep road).
 * Run once on a scratch builder for the ground, so the land is shaped to the town before it is built.
 */
export function buildSindr(b: WorldBuilder): Area[] {
  const rand = seeded(7);
  const areas: Area[] = [];
  shrine(b);
  road(b);
  cinderRow(b, rand);
  square(b, rand);
  rise(b, rand, areas);
  topTerrace(b, rand, areas);
  keepRoad(b, rand, areas);
  greatForge(b, rand);
  raidHall(b, rand);
  plotEdge(b, rand);
  eastGate(b);
  keep(b, KEEP_Y);
  b.at(0, 0, 0);
  return areas;
}

// ---------------------------------------------------------------------------------------------------------------
// Cinder Row: the lower street, wide enough for one against six, with the steaming runnel along its north side.

/** Paving across Cinder Row, north to south: earth-covered cobbles, a cobble band, flagstones, a band, cobbles. */
const ROW_STRIPS: Strip[] = [
  { w: 3.2, surface: 'basalt_cobblestone' }, { w: 1.2, surface: 'river_cobbles' }, { w: 7.2, surface: 'worn_flagstones' },
  { w: 1.2, surface: 'river_cobbles' }, { w: 3.2, surface: 'basalt_cobblestone' },
];
const RUNNEL_Z = -6.3;

function cinderRow(b: WorldBuilder, rand: () => number): void {
  const spans: Array<[number, number]> = [[STREET.x0, SQUARE.x0], [SQUARE.x1, STREET.x1]];
  for (const [x0, x1] of spans) {
    paveStreet(b, { x0, z0: 0, x1, z1: 0, y: 0, strips: ROW_STRIPS, verge: [1.5, 2.6], crossEvery: 12, wet: 1.1 }, rand);
  }
  // Spots along the south edge already holding a lamp, a tree, a cart or a heap.
  const taken: number[] = [];
  const used = (x: number, r: number): boolean => taken.some((t) => Math.abs(t - x) < r);
  for (const [x0, x1] of spans) {
    let i = 0;
    for (let x = x0 + 7; x < x1 - 4; x += 12.5, i++) {
      taken.push(x);
      if (i % 2 === 0) taken.push(x + 6);
      // A cart parked along the south edge every third lamp, cover in a street fight.
      else if (i % 3 === 1) { parkedCart(b, x + 3.4, STREET.half - 2.0, 0, Math.PI / 2 + (rand() - 0.5) * 0.15, rand); taken.push(x + 3.4, x + 2, x + 4.8); }
    }
  }
  // House rows: north backs onto the hill, south onto the forge quarter. Doors on the north cross the runnel.
  const bridges: number[] = [];
  const row = (x0: number, x1: number, side: 1 | -1, gaps: Array<[number, number]>, nearSquare: number): void => {
    let x = x0 + 0.4;
    while (x < x1 - 5) {
      const w = 6.2 + rand() * 3;
      if (x + w > x1 - 0.2) break;
      const cx = x + w / 2;
      if (gaps.some(([a, c]) => cx + w / 2 > a && cx - w / 2 < c)) { x += 1.5; continue; }
      const d = 7 + rand() * 1.6;
      const rank: Rank = Math.abs(cx - nearSquare) < 40 && rand() < 0.6 ? 'merchant' : 'common';
      const shop = rand() < 0.45;
      townHouse(b, {
        x: cx, z: side * (STREET.half + d / 2), y: 0, yaw: side > 0 ? UP_FACE : 0, w, d,
        floors: rand() < 0.82 ? 2 : 1, rank, shop, ...(side < 0 ? { door: 0 } : {}),
        balcony: rand() < 0.55, sign: rand() < 0.55 ? 2 + Math.floor(rand() * 3) : 0, awning: shop && rand() < 0.7,
        lantern: rank === 'merchant' || rand() < 0.3, footing: 1.2,
      }, rand);
      if (side < 0) bridges.push(cx);
      // Life outside the door, beside it rather than in it: heaps of barrels and crates, a timber stack. The
      // north side keeps to single pieces, between the house and its runnel bridge.
      const fz = side * (STREET.half - 1.1);
      const k = rand();
      const ox = cx + (rand() < 0.5 ? -1 : 1) * (w / 2 - 1.3);
      b.at(0, 0, 0);
      if (side > 0 && !used(ox, 2.2)) {
        if (k < 0.75) clutter(b, ox, STREET.half - 0.5, 0, Math.PI, rand);
        else timberStack(b, ox, fz - 0.6, Math.PI / 2 + (rand() - 0.5) * 0.2, rand);
        taken.push(ox);
      } else if (side < 0 && Math.abs(ox - cx) > 1.4 && k < 0.5) {
        b.prop(k < 0.25 ? 'barrel' : 'crate', ox, fz, rand() * 6, 0.9); b.solid(ox, 0.45, fz, 0.85, 0.9, 0.85);
      }
      x += w + (rand() < 0.25 ? 1.2 + rand() * 1.5 : 0.25);
    }
  };
  row(STREET.x0, SQUARE.x0, -1, [], SQUARE.x0);
  row(SQUARE.x1, STREET.x1, -1, [], SQUARE.x1);
  row(STREET.x0, SQUARE.x0, 1, [[84, 95]], SQUARE.x0);
  row(SQUARE.x1, STREET.x1, 1, [[183, 195]], SQUARE.x1);
  b.at(0, 0, 0);
  runnel(b, STREET.x0 + 4, SQUARE.x0 - 1, RUNNEL_Z, 1.0, 1, bridges.filter((x) => x < SQUARE.x0), rand);
  runnel(b, SQUARE.x1 + 1, STREET.x1 - 3, RUNNEL_Z, 1.0, 1, bridges.filter((x) => x > SQUARE.x1), rand);
  // Lamps along the south edge, arms over the street; trees on the south verge, crowns over the road.
  for (const [x0, x1] of spans) {
    let i = 0;
    for (let x = x0 + 7; x < x1 - 4; x += 12.5, i++) {
      lampPost(b, x, 6.6, 0, UP_FACE);
      if (i % 2 === 0) b.plant(i % 4 === 0 ? 'ginkgo' : 'maple', x + 6 + (rand() - 0.5) * 2, 7.2 + rand() * 0.4, 0.85 + rand() * 0.3, 0, rand() * 6);
    }
  }
  // Red lanterns strung across the street near the square, and at the gates.
  for (const x of [70, 96, 156, 176, 206]) lanternString(b, [x, 5.6, -7.6], [x + 2, 5.4, 7.6], 5);
  // Weeds at the foot of the runnel kerbs and along the south verge.
  for (let x = STREET.x0 + 3; x < STREET.x1 - 3; x += 1.7 + rand() * 2.5) {
    if (x > SQUARE.x0 - 1 && x < SQUARE.x1 + 1) continue;
    b.plant(rand() < 0.6 ? 'weed' : 'fern', x, RUNNEL_Z - 0.9, 0.5 + rand() * 0.6, 0, rand() * 6);
    if (rand() < 0.5) b.plant('weed', x + rand(), 7.6 + rand() * 0.3, 0.6 + rand() * 0.6, 0, rand() * 6);
  }
}
/** Yaw for a front facing north (local +z turned to -z). */
const UP_FACE = Math.PI;

// ---------------------------------------------------------------------------------------------------------------
// The market square: flagstones ringed by cobble bands, the four stalls the merchants trade from, the slag well.

function square(b: WorldBuilder, rand: () => number): void {
  const cx = (SQUARE.x0 + SQUARE.x1) / 2;
  paveStreet(b, {
    x0: SQUARE.x0, z0: 0, x1: SQUARE.x1, z1: 0, y: 0, verge: [1.8, 1.8], wet: 0.7, keepClear: [[15, 27]],
    strips: [{ w: 2.4, surface: 'basalt_cobblestone' }, { w: 1.2, surface: 'river_cobbles' }, { w: 24.8, surface: 'worn_flagstones' },
      { w: 1.2, surface: 'river_cobbles' }, { w: 2.4, surface: 'basalt_cobblestone' }],
  }, rand);
  // Cobble bands crossing the square, framing the well.
  b.at(0, 0, 0);
  for (const x of [cx - 6.5, cx + 6.5]) b.box('river_cobbles', x, 0.008, 0, 1.2, 0.012, 24.8);
  // The slag well: a stone rim over molten run-off.
  b.add('ashlar_stone_blocks', new CylinderGeometry(3.2, 3.4, 0.8, 28, 1, true), new Matrix4().makeTranslation(cx, 0.4, 0));
  b.add('ashlar_stone_blocks', new CylinderGeometry(3.6, 3.6, 0.18, 28), new Matrix4().makeTranslation(cx, 0.82, 0));
  b.add('basalt_rock_face', new CylinderGeometry(2.7, 2.7, 0.18, 28), new Matrix4().makeTranslation(cx, 0.82, 0));
  b.add('lava', new CylinderGeometry(2.6, 2.6, 0.05, 28), new Matrix4().makeTranslation(cx, 0.55, 0));
  b.add('blackened_rusted_iron', new CylinderGeometry(0.12, 0.12, 3.4, 8), new Matrix4().makeTranslation(cx - 2.2, 2.0, 0));
  b.add('blackened_rusted_iron', new CylinderGeometry(0.12, 0.12, 3.4, 8), new Matrix4().makeTranslation(cx + 2.2, 2.0, 0));
  b.box('blackened_rusted_iron', cx, 3.6, 0, 4.8, 0.2, 0.2);
  b.ao([cx - 4, 0.012, -3.6], [cx + 4, 0.012, -3.6], [0, 0, 7.2], 0.25);
  b.light(cx, 1.6, 0, 0xff5a18, 45, 18, 0.12);
  b.embers.push(new Vector3(cx, 0.8, 0), new Vector3(cx + 1, 0.8, 0.6));
  b.steam.push(new Vector3(cx - 1.5, 0.9, 0.5), new Vector3(cx + 1.2, 0.9, -0.8));
  b.solid(cx, 0.5, 0, 7.2, 1, 7.2);
  // Stalls where the merchants trade (the anchors), under cloth roofs with goods and crates.
  for (const a of ANCHORS.filter((k) => k.kind === 'stall' && k.y === 0)) {
    b.at(a.x, a.z, a.yaw);
    for (const px of [-2.2, 2.2]) for (const pz of [-1.3, 1.3]) b.box('charred_timber_beams', px, 1.3, pz, 0.16, 2.6, 0.16);
    b.box('charred_timber_beams', 0, 0.95, 1.2, 4.6, 0.12, 0.9);
    b.box('charred_timber_beams', 0, 0.5, 1.45, 4.4, 0.9, 0.08);
    b.box(rand() < 0.5 ? 'indigo_cloth' : 'red_lacquer', 0, 2.75, 0.2, 5.2, 0.04, 3.6, { x: 0.22 });
    b.box('indigo_cloth', 0, 2.42, 2.02, 5.2, 0.32, 0.02);
    for (let gx = -1.9; gx < 2; gx += 0.38 + rand() * 0.2) b.cylinder(rand() < 0.5 ? 'terracotta' : 'raw_timber', gx, 1.12, 1.2 + (rand() - 0.5) * 0.4, 0.13, 0.16, 0.22 + rand() * 0.14, 9);
    b.prop('crate', -1.4, -0.6, 0.3, 0.8);
    b.prop('barrel', 1.5, -0.7, 0, 0.8);
    b.solid(0, 1.3, 0, 4.8, 2.6, 3);
  }
  b.at(0, 0, 0);
  for (const [x, z] of [[-18, -13], [18, -13], [-18, 13], [18, 13]] as const) brazier(b, cx + x, z, 1);
  const nb = anchor('notice_board');
  noticeBoard(b, nb.x, nb.z, nb.y, nb.yaw, rand);
  // Frontage: houses on the square's north side either side of the Rise, and on the south either side of the Raid Hall lane.
  for (const [x0, x1] of [[SQUARE.x0 + 0.2, LANE.x0 - 0.3], [LANE.x1 + 0.3, SQUARE.x1 - 0.2]] as const) {
    const n = 2, w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      townHouse(b, { x: x0 + w * (i + 0.5), z: SQUARE.z0 - 2.9, y: 0, yaw: 0, w: w - 0.3, d: 5.6, floors: 2, rank: 'merchant',
        shop: i % 2 === 0, balcony: true, sign: 3, awning: true, lantern: true, footing: 1.6 }, rand);
    }
  }
  for (const [x0, x1] of [[SQUARE.x0 + 0.2, 119.5], [128.5, SQUARE.x1 - 0.2]] as const) {
    const n = 2, w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      townHouse(b, { x: x0 + w * (i + 0.5), z: SQUARE.z1 + 4, y: 0, yaw: UP_FACE, w: w - 0.3, d: 8, floors: 2, rank: 'merchant',
        shop: i % 2 === 1, balcony: i % 2 === 0, sign: 2, awning: true, lantern: true }, rand);
    }
  }
  b.at(0, 0, 0);
  // Ginkgos at the square's corners, the tallest trees in the lower town.
  for (const [x, z] of [[SQUARE.x0 + 2.5, -12.5], [SQUARE.x1 - 2.5, 12.5], [SQUARE.x0 + 2.5, 12.6]] as const) {
    b.plant('ginkgo', x, z, 1.05 + rand() * 0.2, 0, rand() * 6);
    b.cylinder('ashlar_stone_blocks', x, 0.2, z, 1.3, 1.4, 0.4, 14);
    b.solid(x, 0.25, z, 2.4, 0.5, 2.4);
  }
  // Alley behind the square's west houses: a cramped corner the robbers favour.
  const hide = anchor('alley_hideout');
  b.prop('crate', hide.x - 1, hide.z + 0.5, 0.4, 0.9); b.prop('barrel', hide.x + 0.8, hide.z - 0.6, 0, 0.9);
  b.solid(hide.x - 1, 0.4, hide.z + 0.5, 0.9, 0.8, 0.9);
}

// ---------------------------------------------------------------------------------------------------------------
// The Rise: terraces up the lane, a flight at each, retaining walls between, houses facing the lane.

function rise(b: WorldBuilder, rand: () => number, areas: Area[]): void {
  RISE.forEach((lv, k) => {
    if (k === 0) {
      paveLane(b, lv.z1, lv.z0, lv.y, rand);
      return;
    }
    if (lv.name === 'rise-top') return;
    level(b, areas, lv.name, { x0: BAND.x0, x1: BAND.x1, z0: lv.z0, z1: lv.z1 }, lv.y, RISE[k - 1]!.y);
    paveLane(b, lv.z1, lv.z0, lv.y, rand);
  });
  // Flights and the walls they break, at each level's north edge.
  for (let k = 0; k + 1 < RISE.length; k++) {
    const lo = RISE[k]!, hi = RISE[k + 1]!, run = stairRun(hi.y - lo.y);
    areas.push(stairs(b, { from: { x: LANE.cx, z: lo.z0 + run, y: lo.y }, to: { x: LANE.cx, z: lo.z0, y: hi.y }, width: LANE.x1 - LANE.x0 - 1, surface: 'ashlar_stone_blocks', cheeks: true }, rand));
    const arched = hi.y - lo.y >= 3;
    retainingWall(b, { path: [{ x: BAND.x1, z: lo.z0 }, { x: LANE.x1, z: lo.z0 }], bottom: lo.y, top: hi.y, arched, parapet: 0 }, rand);
    retainingWall(b, { path: [{ x: LANE.x0, z: lo.z0 }, { x: BAND.x0, z: lo.z0 }], bottom: lo.y, top: hi.y, arched, parapet: 0 }, rand);
    lampPost(b, LANE.x0 + 0.6, lo.z0 + run + 1.2, lo.y, EAST);
    lampPost(b, LANE.x1 - 0.6, lo.z0 + run + 3.4, lo.y, WEST);
  }
  // Houses on the levels below the yard: two each side, gable ends stepping up the lane.
  const rows: Array<{ k: number; rank: Rank }> = [{ k: 1, rank: 'common' }, { k: 2, rank: 'merchant' }, { k: 4, rank: 'merchant' }];
  for (const { k, rank } of rows) {
    const lv = RISE[k]!, len = lv.z1 - lv.z0 - 0.8;
    for (const side of [-1, 1] as const) {
      const front = side < 0 ? LANE.x0 - 0.3 : LANE.x1 + 0.3;
      if (k === 2) {
        countingHouse(b, anchor(side < 0 ? 'counting_house_w' : 'counting_house_e'));
        houseAlong(b, front, side, lv.z0 + 0.4, lv.z0 + 0.4 + (len - 10.2), lv.y, rank, rand);
        continue;
      }
      const split = lv.z0 + 0.4 + len * (0.45 + rand() * 0.1);
      houseAlong(b, front, side, lv.z0 + 0.4, split, lv.y, rank, rand);
      houseAlong(b, front, side, split + 0.3, lv.z1 - 0.4, lv.y, rank, rand);
    }
    // Back gardens and yards behind the lane houses, with a tree in each.
    for (const side of [-1, 1] as const) {
      const r = side < 0 ? { x0: BAND.x0 + 0.4, x1: LANE.x0 - 8.2, z0: lv.z0 + 0.6, z1: lv.z1 - 0.6 } : { x0: LANE.x1 + 8.2, x1: BAND.x1 - 0.4, z0: lv.z0 + 0.6, z1: lv.z1 - 0.6 };
      dressTerrace(b, r, lv.y, rand, { density: 0.7, edge: 's' });
      b.plant(rand() < 0.5 ? 'maple' : 'ginkgo', (r.x0 + r.x1) / 2 + (rand() - 0.5) * 4, (r.z0 + r.z1) / 2, 0.75 + rand() * 0.25, lv.y, rand() * 6);
    }
  }
  // Heaps at the house feet on each level, clear of the flight at the level's north end and its lamps.
  for (const lv of [RISE[1]!, RISE[2]!, RISE[4]!]) {
    const z = lv.z1 - 2.6 - rand() * 3;
    clutter(b, LANE.x0 + 0.45, z, lv.y, EAST, rand);
    clutter(b, LANE.x1 - 0.45, z - 3 - rand() * 2, lv.y, WEST, rand);
  }
  yard(b, rand);
  // Red lanterns over the lane at each level, strung from eave to eave.
  for (const lv of RISE.slice(1, 5)) lanternString(b, [LANE.x0 - 0.2, lv.y + 5.2, (lv.z0 + lv.z1) / 2 + 2], [LANE.x1 + 0.2, lv.y + 5.0, (lv.z0 + lv.z1) / 2 + 1], 4);
}

/** A terrace: paved, filled solid, and its ground recorded so the land is shaped to it. */
function level(b: WorldBuilder, areas: Area[], name: string, r: Rect, y: number, base: number, surface: Surface = 'basalt_cobblestone'): void {
  terraceTop(b, r, y, base, surface);
  areas.push(rectArea(name, r, y, base));
}

/** The Rise's lane paving between z (south) and z (north): flagstones, cobble bands, earth at the house feet. */
function paveLane(b: WorldBuilder, zSouth: number, zNorth: number, y: number, rand: () => number): void {
  paveStreet(b, {
    x0: LANE.cx, z0: zSouth, x1: LANE.cx, z1: zNorth, y: y + 0.004, verge: [1, 1], wet: 1.4, crossEvery: 9,
    strips: [{ w: 1.6, surface: 'basalt_cobblestone' }, { w: 0.9, surface: 'river_cobbles' }, { w: 5, surface: 'worn_flagstones' },
      { w: 0.9, surface: 'river_cobbles' }, { w: 1.6, surface: 'basalt_cobblestone' }],
  }, rand);
}

/** A house facing the lane, frontage along z from za to zb; side -1 is west of the lane. */
function houseAlong(b: WorldBuilder, front: number, side: -1 | 1, za: number, zb: number, y: number, rank: Rank, rand: () => number): void {
  const w = Math.abs(zb - za), d = 7;
  if (w < 4) return;
  const shop = rank !== 'common' && rand() < 0.6;
  townHouse(b, {
    x: front + side * d / 2, z: (za + zb) / 2, y, yaw: side < 0 ? EAST : WEST, w: w - 0.1, d, floors: 2, rank, shop,
    balcony: rand() < 0.6, sign: rand() < 0.7 ? 2 + Math.floor(rand() * 3) : 0, awning: shop, lantern: rank !== 'common' || rand() < 0.4,
    footing: 3.2,
  }, rand);
  b.at(0, 0, 0);
}

/** A counting house: a heavy stone strongroom below, a lacquered office above, a two-tier roof. Faces its anchor's yaw. */
function countingHouse(b: WorldBuilder, a: Anchor): void {
  b.at(a.x, a.z, a.yaw, a.y);
  const tw = 9.4, td = 9.4, baseH = 4.6, upperH = 3.8;
  b.box('basalt_rock_face', 0, -0.9, 0, tw + 0.3, 1.8, td + 0.3);
  b.box('ashlar_stone_blocks', 0, baseH / 2, 0, tw, baseH, td);
  for (const sx of [-2.4, 2.4]) {
    b.box('blackened_rusted_iron', sx, 2.6, td / 2 + 0.05, 0.5, 1.2, 0.1);
    b.ao([sx - 0.35, 3.25, td / 2 + 0.01], [sx + 0.35, 3.25, td / 2 + 0.01], [0, -0.6, 0], 0.5);
  }
  // An iron-studded strongroom door of black timber in a lacquered frame.
  b.box('charred_timber_beams', 0, 1.35, td / 2 - 0.1, 1.7, 2.7, 0.12);
  for (const sx of [-1, 1]) b.box('red_lacquer', sx * 1.0, 1.45, td / 2 + 0.02, 0.22, 2.9, 0.26);
  b.box('red_lacquer', 0, 2.95, td / 2 + 0.02, 2.4, 0.24, 0.28);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) b.box('blackened_rusted_iron', -0.5 + k * 0.5, 0.55 + i * 0.6, td / 2 - 0.02, 0.08, 0.08, 0.05);
  b.ao([-0.85, 2.7, td / 2 - 0.03], [0.85, 2.7, td / 2 - 0.03], [0, -0.9, 0], 0.6);
  b.box('lime_plaster', 0, baseH + upperH / 2, 0, tw - 0.4, upperH, td - 0.4);
  for (const cx of [-tw / 2 + 0.4, tw / 2 - 0.4]) for (const cz of [-td / 2 + 0.4, td / 2 - 0.4]) b.box('red_lacquer', cx, baseH + upperH / 2, cz, 0.5, upperH, 0.5);
  b.lattice(0, baseH + upperH * 0.55, td / 2 - 0.1, 2.6, 1.8, 1, true);
  brackets(b, 'x', [-tw / 2 + 0.4, 0, tw / 2 - 0.4], baseH + upperH, td / 2 - 0.4, true);
  roof(b, { w: tw, d: td, base: baseH + upperH, pitch: 0.62, overhang: 1.3, curve: 0.22, cornerLift: 0.32, gableRatio: 0.5, tiers: 2, tile: 'roof_tile_red', trim: true });
  paperLantern(b, -1.6, 3.5, td / 2 + 0.5); paperLantern(b, 1.6, 3.5, td / 2 + 0.5);
  b.light(0, 3.2, td / 2 + 1, 0xffa060, 6, 9, 0.1);
  b.solid(0, (baseH + upperH) / 2, 0, tw, baseH + upperH, td);
  b.at(0, 0, 0);
}

/** The well yard: the inn, the well, a stall, a great ginkgo, benches and braziers; the widest ground on the Rise. */
function yard(b: WorldBuilder, rand: () => number): void {
  const lv = RISE[3]!;
  const inn = anchor('inn');
  townHouse(b, { x: inn.x, z: inn.z, y: lv.y, yaw: inn.yaw, w: 12, d: 9, floors: 2, rank: 'merchant', balcony: true, sign: 4,
    lantern: true, door: 0, footing: 4.6 }, rand);
  b.at(inn.x, inn.z, inn.yaw, lv.y);
  awning(b, -3.8, 3.2, 4.5, 3.2, 2.0, 'indigo_cloth');
  b.at(0, 0, 0);
  const w = anchor('yard_well');
  well(b, w.x, w.z, lv.y);
  const st = anchor('stall_yard');
  stall(b, st.x, st.z, lv.y, st.yaw, rand);
  b.plant('ginkgo', 114, -53.5, 1.25, lv.y, 1.2);
  b.cylinder('ashlar_stone_blocks', 114, lv.y + 0.25, -53.5, 1.5, 1.6, 0.5, 14);
  b.solid(114, lv.y + 0.25, -53.5, 2.8, 0.5, 2.8);
  brazier(b, LANE.x0 - 1.5, -52.5, 1);
  brazier(b, LANE.x1 + 1.5, -66, 1);
  for (const [x, z] of [[106, -51.5], [146, -66]] as const) { b.at(0, 0, 0); timberStack(b, x, z, 0, rand); }
  dressTerrace(b, { x0: BAND.x0 + 0.5, x1: 110, z0: lv.z0 + 0.5, z1: lv.z1 - 0.5 }, lv.y, rand, { density: 0.8, clear: [{ x0: 103, x1: 108, z0: -59, z1: -53 }] });
  b.at(0, 0, 0);
  parkedCart(b, 117.5, -64.5, lv.y, 0.4, rand);
  for (let i = 0; i < 4; i++) wetPatch(b, 112 + rand() * 20, lv.y + 0.016, -52 - rand() * 8, 1.5 + rand() * 2.5, 1 + rand() * 1.5, rand() * 3);
}

// ---------------------------------------------------------------------------------------------------------------
// The top terrace: noble houses, the Lord's Gate, the Master's Hall on its podium.

function topTerrace(b: WorldBuilder, rand: () => number, areas: Area[]): void {
  const top = RISE[RISE.length - 1]!, below = RISE[RISE.length - 2]!;
  level(b, areas, top.name, { x0: BAND.x0, x1: BAND.x1, z0: top.z0, z1: top.z1 }, top.y, below.y, 'pale_stone');
  const gate = anchor('noble_gate');
  paveLane(b, top.z1, gate.z + 1.2, top.y, rand);
  roofedGate(b, gate.x, gate.z, top.y, gate.yaw, 3.6, 'noble', rand);
  compoundWall(b, BAND.x0 + 0.4, gate.z, gate.x - 2.4, gate.z, top.y, 2.8, 'noble');
  compoundWall(b, gate.x + 2.4, gate.z, BAND.x1 - 0.4, gate.z, top.y, 2.8, 'noble');
  // Noble houses before the gate, facing the lane.
  for (const side of [-1, 1] as const) {
    const front = side < 0 ? LANE.x0 - 0.3 : LANE.x1 + 0.3;
    townHouse(b, { x: front + side * 4, z: (top.z1 + gate.z) / 2 + 0.6, y: top.y, yaw: side < 0 ? EAST : WEST, w: 10.4, d: 8, floors: 2,
      rank: 'noble', balcony: true, lantern: true, door: 0, footing: 3.6 }, rand);
    b.plant('maple', front + side * 11, gate.z + 4, 0.9, top.y, rand() * 6);
  }
  // The hall court: pale paving, maples, stone lanterns, the hall.
  const h = anchor('masters_hall');
  b.at(0, 0, 0);
  b.box('pale_stone', h.x, top.y + 0.006, (gate.z + top.z0) / 2, 18, 0.012, gate.z - top.z0 - 2);
  hall(b, h.x, h.z, top.y, h.yaw, 22, 9, 1.4, rand, 2);
  for (const sx of [-1, 1]) {
    b.plant('maple', h.x + sx * 15, gate.z - 6, 1.0, top.y, rand() * 6);
    b.plant('maple', h.x + sx * 19, h.z + 4, 0.85, top.y, rand() * 6);
    stoneLantern(b, h.x + sx * 6, gate.z - 4, top.y);
    townHouse(b, { x: h.x + sx * 20.5, z: h.z - 2, y: top.y, yaw: sx < 0 ? EAST : WEST, w: 12, d: 7.5, floors: 2, rank: 'noble', lantern: true, footing: 1 }, rand);
  }
  dressTerrace(b, { x0: BAND.x0 + 0.5, x1: LANE.x0 - 8.6, z0: top.z1 - 12, z1: top.z1 - 0.6 }, top.y, rand, { density: 0.5, edge: 's' });
  dressTerrace(b, { x0: LANE.x1 + 8.6, x1: BAND.x1 - 0.5, z0: top.z1 - 12, z1: top.z1 - 0.6 }, top.y, rand, { density: 0.5, edge: 's' });
  b.at(0, 0, 0);
}

/** A stone lantern (toro): base, shaft, a fire box glowing at night, a curved cap. */
function stoneLantern(b: WorldBuilder, x: number, z: number, y: number): void {
  b.at(x, z, 0, y);
  b.box('pale_stone', 0, 0.15, 0, 0.9, 0.3, 0.9);
  b.cylinder('pale_stone', 0, 0.85, 0, 0.16, 0.2, 1.1, 8);
  b.box('pale_stone', 0, 1.45, 0, 0.75, 0.12, 0.75);
  b.box('window', 0, 1.75, 0, 0.42, 0.48, 0.42, undefined, { u: 1, v: 1 });
  b.box('pale_stone', 0, 2.06, 0, 0.95, 0.14, 0.95);
  b.box('pale_stone', 0, 2.2, 0, 0.4, 0.16, 0.4);
  b.light(0, 1.7, 0, 0xffb070, 3, 6, 0.15);
  b.solid(0, 1.1, 0, 0.9, 2.2, 0.9);
  b.at(0, 0, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// The keep road: legs cut into the crag, a tall wall between each, a parapet on the drop side.

function keepRoad(b: WorldBuilder, rand: () => number, areas: Area[]): void {
  const legFloor = (l: typeof KEEP_ROAD.legs[number]) => (x: number): number =>
    l.y0 + (l.y1 - l.y0) * Math.min(1, Math.max(0, (x - l.x0) / (l.x1 - l.x0)));
  for (const l of KEEP_ROAD.legs) {
    const len = Math.abs(l.x1 - l.x0), w = l.z1 - l.z0, cz = (l.z0 + l.z1) / 2;
    const yaw = l.x1 > l.x0 ? Math.PI / 2 : -Math.PI / 2;
    areas.push(stripArea(l.name, l.x0, cz, yaw, len, w, l.y0, l.y1));
    // Paving: a slab tilted along the leg, its collider beneath.
    const pitch = Math.atan2(l.y1 - l.y0, len);
    b.at(l.x0, cz, yaw, l.y0);
    const m = Math.hypot(len, l.y1 - l.y0);
    b.box('packed_dirt_road', 0, -0.15 + Math.sin(pitch) * m / 2, len / 2, w, 0.3, m, { x: -pitch });
    b.box('river_cobbles', -w / 2 + 0.6, -0.14 + Math.sin(pitch) * m / 2, len / 2, 1.0, 0.3, m, { x: -pitch });
    b.solidTilted(0, -0.3 + Math.sin(pitch) * m / 2, len / 2, w, 0.6, m, -pitch);
    b.at(0, 0, 0);
  }
  for (const t of KEEP_ROAD.landings) {
    level(b, areas, t.name, t.r, t.y, t.y - 3);
  }
  level(b, areas, 'keep-court', KEEP_ROAD.court, KEEP_ROAD.y, KEEP_ROAD.y - 4);
  // Walls between the legs: each holds the higher leg above the lower one.
  const [l1, l2, l3] = KEEP_ROAD.legs as [typeof KEEP_ROAD.legs[number], typeof KEEP_ROAD.legs[number], typeof KEEP_ROAD.legs[number]];
  const f1 = legFloor(l1), f2 = legFloor(l2), f3 = legFloor(l3);
  retainingWall(b, { path: [{ x: 192, z: l1.z0 }, { x: 146, z: l1.z0 }], bottom: (x) => f1(x), top: (x) => f2(x), parapet: 0.9, batter: 0.05 }, rand);
  retainingWall(b, { path: [{ x: 196, z: l2.z0 }, { x: 146, z: l2.z0 }], bottom: (x) => f2(x), top: (x) => f3(x), parapet: 0.9, batter: 0.05 }, rand);
  retainingWall(b, { path: [{ x: 196, z: l3.z0 }, { x: KEEP_ROAD.court.x0, z: l3.z0 }], bottom: (x) => f3(x), top: KEEP_ROAD.y, parapet: 0.9, batter: 0.05 }, rand);
  // The outer edge of the first leg, above the top terrace's east side.
  retainingWall(b, { path: [{ x: BAND.x1, z: l1.z1 }, { x: 192, z: l1.z1 }].reverse(), bottom: 11, top: (x) => f1(x), parapet: 0.9, batter: 0.05 }, rand);
  // Lamps at each turn.
  for (const t of KEEP_ROAD.landings) lampPost(b, (t.r.x0 + t.r.x1) / 2, t.r.z1 - 0.8, t.y, UP_FACE);
  b.at(0, 0, 0);
}
function shrine(b: WorldBuilder): void {
  b.at(0, 0, 0);
  // Base floor discs
  b.add('pale_stone', new CylinderGeometry(SHRINE_R, SHRINE_R, 0.2, 48), new Matrix4().makeTranslation(0, -0.09, 0));
  b.add('basalt_cobblestone', new CylinderGeometry(4.2, 4.2, 0.2, 32), new Matrix4().makeTranslation(0, -0.08, 0));

  // Sunken: three basalt terraces ring the floor, open to the east where the road leaves.
  const segments = 40;
  for (let i = 0; i < segments; i++) {
    const a = (i + 0.5) / segments * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.32) continue;
    const arc = Math.PI * 2 * (SHRINE_R + 2) / segments * 1.04;
    for (let t = 0; t < 3; t++) {
      const r = SHRINE_R + 0.7 + t * 1.3;
      const h = 0.55 * (t + 1);
      b.at(Math.cos(a) * r, Math.sin(a) * r, -a + Math.PI / 2);
      b.box('basalt_rock_face', 0, h / 2, 0, arc * r / (SHRINE_R + 2), h, 1.35);
    }
    b.at(Math.cos(a) * (SHRINE_R + 2), Math.sin(a) * (SHRINE_R + 2), -a + Math.PI / 2);
    b.solid(0, 1, 0, arc, 2, 4);
  }

  // Twelve noble red lacquer columns with moulded pale stone bases and capitals
  // The east opening (-0.35 to +0.35 rad) is left wide open so the road connects freely
  const colRadius = 12.5;
  const colH = 6.4;
  for (let k = 0; k < 12; k++) {
    const a = (k + 0.5) * (Math.PI * 2 / 12);
    const x = Math.cos(a) * colRadius, z = Math.sin(a) * colRadius;
    b.at(x, z, a);
    b.column(0, 0, colH, 0.38, { mat: 'red_lacquer', baseMat: 'pale_stone' });
    // North-half white plaster backing wall segments between columns
    if (z < -3) {
      b.box('lime_plaster', 0, colH / 2, 0.5, 4.2, colH * 0.85, 0.22);
    }
  }

  // 12-sided open roof ring over the perimeter columns (leaving the center open to the sky for smoke)
  const roofSegments = 12;
  const rOuter = 14.8;
  const rInner = 10.2;
  for (let i = 0; i < roofSegments; i++) {
    const a0 = i * (Math.PI * 2 / roofSegments);
    const a1 = (i + 1) * (Math.PI * 2 / roofSegments);
    const aMid = (a0 + a1) / 2;
    const chordLen = Math.hypot(Math.cos(a1) * rOuter - Math.cos(a0) * rOuter, Math.sin(a1) * rOuter - Math.sin(a0) * rOuter);
    b.at(Math.cos(aMid) * (rOuter + rInner) / 2, Math.sin(aMid) * (rOuter + rInner) / 2, -aMid + Math.PI / 2);
    b.box('roof_tile_red', 0, colH + 0.45, 0, chordLen + 0.3, 0.14, rOuter - rInner + 0.2, { x: 0.32 });
    b.box('gold_trim', 0, colH + 0.22, (rOuter - rInner) / 2, chordLen + 0.3, 0.08, 0.06);
  }

  // The unquenched brazier at center
  b.at(0, 0, 0);
  b.add('ashlar_stone_blocks', new CylinderGeometry(1.5, 1.8, 0.9, 16), new Matrix4().makeTranslation(0, 0.45, 0));
  b.add('blackened_rusted_iron', new CylinderGeometry(1.35, 0.7, 0.7, 20, 1, true), new Matrix4().makeTranslation(0, 1.25, 0));
  b.add('blackened_rusted_iron', new CylinderGeometry(0.7, 0.7, 0.06, 20), new Matrix4().makeTranslation(0, 0.92, 0));
  b.add('lava', new CylinderGeometry(1.2, 1.2, 0.04, 20), new Matrix4().makeTranslation(0, 1.38, 0));
  b.fire(0, 1.3, 0, 2.6);
  b.fire(0.5, 1.3, 0.3, 1.6);
  b.fire(-0.45, 1.3, -0.35, 1.8);
  b.light(0, 3.2, 0, 0xff7428, 90, 30, 0.3);
  b.solid(0, 0.8, 0, 3.2, 1.6, 3.2);
}

function road(b: WorldBuilder): void {
  b.at(0, 0, 0);
  // Packed dirt from the shrine's mouth to the town gate.
  b.box('packed_dirt_road', 36, -0.04, 0, 34, 0.1, 6.5);
  for (const z of [-5.2, 5.2]) {
    b.at(STREET.x0, z, 0);
    b.box('ashlar_stone_blocks', 0, 2.6, 0, 1.6, 5.2, 1.6);
    b.box('basalt_rock_face', 0, 5.35, 0, 2.0, 0.3, 2.0);
    b.box('basalt_rock_face', 0, 0.25, 0, 2.0, 0.5, 2.0);
    b.solid(0, 2.6, 0, 1.6, 5.2, 1.6);
    brazier(b, 0, Math.sign(z) * -1.6, 1.1);
  }
  b.at(STREET.x0, 0, 0);
  b.box('charred_timber_beams', 0, 5.2, 0, 0.5, 0.5, 12);
}

/** An iron brazier on a stand: the kit model plus its fire and light. */
function brazier(b: WorldBuilder, x: number, z: number, scale = 1): void {
  b.prop('iron_brazier', x, z, 0, scale);
  // Live coals over the model's flat basket top; the flame stands on them.
  b.cylinder('lava', x, 0.75 * scale, z, 0.44 * scale, 0.44 * scale, 0.03 * scale, 16);
  b.fire(x, 0.76 * scale, z, 0.8 * scale);
  b.light(x, 1.9 * scale, z, 0xff7a2a, 28, 14, 0.3);
  b.solid(x, 0.6, z, 0.7, 1.2, 0.7);
}

function greatForge(b: WorldBuilder, rand: () => number): void {

  b.at(0, 0, 0);
  b.box('basalt_cobblestone', 90, -0.03, 14, 8, 0.1, 19);
  // A raised basalt terrace under an open timber hall.
  const cx = 82, cz = 36;
  b.at(cx, cz, 0);
  b.box('basalt_rock_face', 0, 0.2, 0, 26, 0.4, 18);
  for (let i = -3; i <= 3; i++) for (const z of [-7.5, 7.5]) {
    b.box('ashlar_stone_blocks', i * 4, 0.7, z, 1.0, 0.6, 1.0);
    b.box('charred_timber_beams', i * 4, 3.6, z, 0.45, 5.4, 0.45);
  }
  for (const z of [-7.5, 7.5]) b.box('charred_timber_beams', 0, 6.4, z, 25.5, 0.45, 0.5);
  for (let i = -3; i <= 3; i++) b.box('charred_timber_beams', i * 4, 6.4, 0, 0.4, 0.4, 15.5);
  roof(b, {
    w: 26,
    d: 18,
    base: 6.4,
    pitch: 0.56,
    overhang: 1.2,
    curve: 0.16,
    cornerLift: 0.12,
    gableRatio: 0.45,
    tile: 'roof_tile_charcoal',
    trim: false,
  });
  // The great hearth and its stack.
  b.box('ashlar_stone_blocks', 0, 1.2, -3.5, 7, 1.6, 3.4);
  b.box('lava', 0, 2.03, -3.5, 5.6, 0.06, 2.4);
  b.box('ashlar_stone_blocks', 0, 9, -5.5, 3.4, 15, 3.0);
  b.box('basalt_rock_face', 0, 16.6, -5.5, 3.9, 0.4, 3.5);
  b.chimneys.push(b.world(0, 17, -5.5), b.world(0.3, 17, -5.2));
  b.fire(-1.5, 2.0, -3.5, 1.4); b.fire(0.6, 2.0, -3.2, 1.8); b.fire(2.0, 2.0, -3.7, 1.2);
  b.light(0, 3.4, -1.0, 0xff6a1a, 90, 26, 0.35);
  for (const x of [-8, -4, 4, 8]) {
    b.prop('anvil', x, 1.5, x * 0.2, 1.15, 0.4);
    b.box('lava', x + 0.9, 0.45, 3.4, 1.0, 0.05, 1.0);
    b.box('ashlar_stone_blocks', x + 0.9, 0.42, 3.4, 1.3, 0.04, 1.3);
    b.light(x + 0.9, 1.0, 3.4, 0xff5a10, 3, 5, 0.3);
  }
  b.inside(10, 3, 1.2, 0.4, () => handCart(b, rand));
  b.prop('barrel', -11, 5, 0, 1, 0.4);
  b.prop('barrel', -10.2, 6, 1, 1, 0.4);
  b.solid(0, 1.2, -3.5, 7, 2.4, 3.4);
  b.solid(0, 9, -5.5, 3.4, 18, 3.0);
  b.solid(0, 0.2, 0, 26, 0.4, 18);
  for (let i = -3; i <= 3; i++) for (const z of [-7.5, 7.5]) b.solid(i * 4, 3, z, 1.0, 6, 1.0);
}

function raidHall(b: WorldBuilder, rand: () => number): void {
  b.at(0, 0, 0);
  b.box('basalt_cobblestone', 124, -0.03, 22, 9, 0.1, 12);
  b.house({ x: 124, z: 34, yaw: Math.PI, w: 13, d: 11, floors: 2, stone: true, chimney: 0, pitch: 0.55, door: 0 }, rand);
  b.at(124, 34, Math.PI);
  // Boarded door and a faded banner: closed until raids open.
  for (let i = 0; i < 3; i++) b.box('charred_timber_beams', 0, 0.9 + i * 0.6, 5.65, 1.8, 0.22, 0.12, { z: (i - 1) * 0.12 });
  b.box('sooted_plaster', 0, 5.2, 5.62, 2.2, 3.2, 0.04);
  b.box('blackened_rusted_iron', 0, 6.9, 5.7, 2.8, 0.1, 0.1);
  brazier(b, -4, 7.5, 1);
}

function plotEdge(b: WorldBuilder, rand: () => number): void {
  // Empty surveyed plots behind a low wall, staked out and waiting.
  b.at(0, 0, 0);
  const x0 = 168, x1 = 214, z0 = 16, z1 = 50;
  b.box('packed_dirt_road', (x0 + x1) / 2, -0.035, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0);
  const wall = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    b.at((ax + bx) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az));
    b.box('ashlar_stone_blocks', 0, 0.45, 0, 0.7, 0.9, len);
    b.solid(0, 0.45, 0, 0.7, 0.9, len);
  };
  wall(x0, z0, x0 + 18, z0); wall(x0 + 24, z0, x1, z0);
  wall(x0, z0, x0, z1); wall(x1, z0, x1, z1); wall(x0, z1, x1, z1);
  b.at(0, 0, 0);
  for (let px = x0 + 7.7; px < x1 - 2; px += 11.5) for (let pz = z0 + 8.5; pz < z1 - 2; pz += 17) {
    for (const [dx, dz] of [[-5, -7.5], [5, -7.5], [-5, 7.5], [5, 7.5]] as const) {
      b.add('charred_timber_beams', new CylinderGeometry(0.06, 0.06, 1.0, 5), new Matrix4().makeTranslation(px + dx, 0.5, pz + dz));
    }
    if (rand() > 0.6) b.prop('crate', px, pz, rand() * 3, 0.8);
  }
}

function eastGate(b: WorldBuilder): void {
  b.at(STREET.x1 + 1, 0, 0);
  for (const s of [-1, 1]) {
    b.box('basalt_rock_face', 0, 0.4, s * 6.8, 6, 0.8, 5);
    b.box('ashlar_stone_blocks', 0, 5.5, s * 6.8, 5.4, 10, 4.4);
    for (let i = 0; i < 3; i++) b.box('ashlar_stone_blocks', -2.1 + i * 2.1, 11, s * 6.8 + s * 1.9, 1, 1, 0.8);
    b.window(2.72, 6.5, 0, 0.5, 1.0);
    b.solid(0, 5, s * 6.8, 6, 10, 5);
  }
  b.box('ashlar_stone_blocks', 0, 9.2, 0, 4.4, 1.6, 9.2);
  b.box('blackened_rusted_iron', 0, 7.6, 0, 0.3, 0.6, 9);
  brazier(b, 3.4, -3.4, 1.1);
  brazier(b, 3.4, 3.4, 1.1);
  // Roadside boulders framing the gorge entrance (open road)
  b.at(0, 0, 0);
  b.prop('boulder_huge', 262, -7.5, 0.4, 3.2);
  b.prop('boulder_large', 258, 8.0, 2.1, 2.6);
  b.prop('rock_cluster_b', 256, -8.5, 1.0, 2.2);
}

function keep(b: WorldBuilder, y: number): void {
  // Brandr's Keep on the crag: tiered castle keep over arched basalt retaining walls
  b.at(KEEP.x, KEEP.z, 0.15, y);

  // Arched retaining wall stepping up the rock
  b.box('basalt_rock_face', 0, -3, 0, 36, 8, 28);
  b.box('ashlar_stone_blocks', 0, 3, 0, 32, 6, 24);

  // Central 3-tier pagoda-style main keep tower
  const towerW = 14, towerD = 14;
  const towerH = 14;
  b.box('ashlar_stone_blocks', 0, 6 + towerH * 0.35, 0, towerW, towerH * 0.7, towerD);
  b.box('lime_plaster', 0, 6 + towerH * 0.85, 0, towerW - 0.6, towerH * 0.3, towerD - 0.6);

  roof(b, {
    w: towerW,
    d: towerD,
    base: 6 + towerH,
    pitch: 0.66,
    overhang: 1.4,
    curve: 0.24,
    cornerLift: 0.36,
    gableRatio: 0.52,
    tiers: 3,
    tile: 'roof_tile_red',
    trim: true,
  });

  // Corner turrets with 2-tier roofs
  for (const [tx, tz] of [[-14, 10], [14, 10], [-14, -10], [14, -10]] as const) {
    b.box('ashlar_stone_blocks', tx, 8, tz, 5.5, 16, 5.5);
    roof(b, {
      w: 5.5,
      d: 5.5,
      base: 16,
      pitch: 0.65,
      overhang: 1.1,
      curve: 0.22,
      cornerLift: 0.28,
      gableRatio: 0.5,
      tiers: 2,
      tile: 'roof_tile_red',
      trim: true,
    });
  }

  // Windows, torches and chimneys
  for (const [wx, wy] of [[-4, 8], [4, 8], [-2, 14], [2, 14]] as const) {
    b.window(wx, wy, towerD / 2 + 0.05, 0.7, 1.4);
  }
  b.fire(-14, 16.5, 10, 1.6);
  b.fire(14, 16.5, 10, 1.6);
  b.light(0, 8, 14, 0xff6a20, 14, 32, 0.2);
  b.chimneys.push(b.world(-3, 30, -3));
  b.solid(0, 12, 0, 32, 24, 24);
}
