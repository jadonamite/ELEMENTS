import { CylinderGeometry, Matrix4, Vector3 } from 'three';
import { seeded, WorldBuilder, type HouseSpec } from './builder.js';
import type { Peak } from './landscape.js';
import { circleArea, Levels, rectArea } from './levels.js';
import { brackets, roof } from './roofs.js';

/** Sindr, the IGNIS forge town, and the Shrine of Embers west of it. x runs east toward the fort; north is -z. */

export const SPAWN = { x: 2, z: 0, facing: Math.PI / 2 };
const STREET = { x0: 52, x1: 224, half: 4.5 };
const SQUARE = { x0: 104, x1: 146, z0: -16, z1: 16 };
const YARD = { x: 124, z: -40, r: 14 };
const SHRINE_R = 16;

/** Ground people walk on: the shrine, its road, the town, gorge road, barrens and fort. */
export const WALKABLE = new Levels([
  circleArea('shrine', 0, 0, 22),
  rectArea('shrine-road', { x0: 10, x1: 60, z0: -8, z1: 8 }),
  rectArea('town', { x0: 48, x1: 228, z0: -66, z1: 56 }),
  rectArea('keep-gate', { x0: 180, x1: 200, z0: -80, z1: -60 }),
  rectArea('gorge-road', { x0: 224, x1: 450, z0: -9, z1: 9 }),
  rectArea('slag-barrens', { x0: 450, x1: 680, z0: -110, z1: 110 }),
  rectArea('east-fort', { x0: 680, x1: 765, z0: -35, z1: 35 }),
]);

export const PEAKS: Peak[] = [
  { x: 190, z: -118, radius: 42, height: 36 },
];

/** The keep's footing on the crag. */
export const KEEP = { x: 190, z: -122 };

/** Builds the town; ground gives the land height so the keep sits on its crag. */
export function buildSindr(b: WorldBuilder, ground: (x: number, z: number) => number): void {
  const rand = seeded(7);
  shrine(b);
  road(b);
  street(b);
  houses(b, rand);
  square(b);
  mastersHall(b, rand);
  greatForge(b, rand);
  raidHall(b, rand);
  countingHouses(b);
  plotEdge(b, rand);
  keepPath(b);
  eastGate(b);
  keep(b, ground(KEEP.x, KEEP.z) - 2);
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

function street(b: WorldBuilder): void {
  b.at(0, 0, 0);
  const len = STREET.x1 - STREET.x0;
  const mid = (STREET.x0 + STREET.x1) / 2;
  b.box('basalt_cobblestone', mid, -0.04, 0, len, 0.1, STREET.half * 2);
  // Slag gutter down the street's south side, broken by the square's well.
  for (const [x0, x1] of [[STREET.x0 + 2, SQUARE.x0 - 1], [SQUARE.x1 + 1, STREET.x1 - 2]] as const) {
    const cx = (x0 + x1) / 2, l = x1 - x0;
    b.box('lava', cx, 0.03, 2.6, l, 0.04, 0.55);
    b.box('basalt_rock_face', cx, 0.1, 2.6 - 0.45, l, 0.2, 0.35);
    b.box('basalt_rock_face', cx, 0.1, 2.6 + 0.45, l, 0.2, 0.35);
    // Flagstone bridges every so often.
    for (let x = x0 + 9; x < x1 - 3; x += 17) b.box('ashlar_stone_blocks', x, 0.2, 2.6, 1.6, 0.16, 1.4);
    for (let x = x0 + 4; x < x1; x += 4.5) b.light(x, 0.4, 2.6, 0xff4a10, 1.6, 3.5, 0.15);
  }
  let side = 1;
  for (let x = STREET.x0 + 10; x < STREET.x1 - 4; x += 15) {
    if (x > SQUARE.x0 - 4 && x < SQUARE.x1 + 4) continue;
    brazier(b, x, side * -3.9);
    side *= -1;
  }
}

function houses(b: WorldBuilder, rand: () => number): void {
  const row = (x0: number, x1: number, face: number, gaps: Array<[number, number]> = []): void => {
    let x = x0;
    while (x < x1 - 4) {
      const w = 6 + rand() * 4;
      if (x + w > x1) break;
      const cx = x + w / 2;
      if (gaps.some(([a, c]) => cx + w / 2 > a && cx - w / 2 < c)) { x += 2; continue; }
      const d = 8 + rand() * 3;
      const floors = (rand() > 0.35 ? 2 : rand() > 0.5 ? 3 : 1) as 1 | 2 | 3;
      const spec: HouseSpec = {
        x: cx, z: face * (STREET.half + 1.6 + d / 2), yaw: face > 0 ? Math.PI : 0, w, d, floors,
        forge: rand() < 0.3, stone: rand() < 0.2, pitch: 0.7 + rand() * 0.25,
      };
      b.house(spec, rand);
      // Barrels, crates and carts outside some doors.
      b.at(spec.x, spec.z, spec.yaw);
      if (rand() > 0.5) b.prop('barrel', (rand() - 0.5) * (w - 2), d / 2 + 0.9, rand() * 6, 0.9);
      if (rand() > 0.6) b.prop('crate', (rand() - 0.5) * (w - 2), d / 2 + 0.8, rand() * 6, 0.9);
      x += w + 0.4 + (rand() > 0.75 ? 2.5 : 0);
    }
  };
  row(STREET.x0 + 2, SQUARE.x0 - 1, -1);
  row(STREET.x0 + 2, SQUARE.x0 - 1, 1, [[64, 92]]);
  // East rows start past the two counting houses, which stand at the square's mouth (x 146.5 to 155.5).
  row(SQUARE.x1 + 11, STREET.x1, -1, [[184, 196]]);
  row(SQUARE.x1 + 11, STREET.x1, 1, [[166, 216]]);
  b.at(0, 0, 0);
  // Square frontage: houses on its north and south sides, lanes left open to the hall and the Raid Hall.
  for (const [x, w] of [[109, 9], [140, 10]] as const) {
    b.house({ x, z: SQUARE.z0 - 6, yaw: 0, w, d: 10, floors: 3, forge: false }, rand);
    b.house({ x, z: SQUARE.z1 + 6, yaw: Math.PI, w, d: 10, floors: 2, forge: x > 120 }, rand);
  }
}

function square(b: WorldBuilder): void {
  b.at(0, 0, 0);
  const cx = (SQUARE.x0 + SQUARE.x1) / 2;
  b.box('basalt_cobblestone', cx, -0.03, 0, SQUARE.x1 - SQUARE.x0, 0.1, SQUARE.z1 - SQUARE.z0);
  // The slag well: a stone rim over molten run-off.
  b.add('ashlar_stone_blocks', new CylinderGeometry(3.2, 3.4, 0.8, 28, 1, true), new Matrix4().makeTranslation(cx, 0.4, 0));
  b.add('ashlar_stone_blocks', new CylinderGeometry(3.6, 3.6, 0.18, 28), new Matrix4().makeTranslation(cx, 0.82, 0));
  b.add('basalt_rock_face', new CylinderGeometry(2.7, 2.7, 0.18, 28), new Matrix4().makeTranslation(cx, 0.82, 0));
  b.add('lava', new CylinderGeometry(2.6, 2.6, 0.05, 28), new Matrix4().makeTranslation(cx, 0.55, 0));
  b.add('blackened_rusted_iron', new CylinderGeometry(0.12, 0.12, 3.4, 8), new Matrix4().makeTranslation(cx - 2.2, 2.0, 0));
  b.add('blackened_rusted_iron', new CylinderGeometry(0.12, 0.12, 3.4, 8), new Matrix4().makeTranslation(cx + 2.2, 2.0, 0));
  b.box('blackened_rusted_iron', cx, 3.6, 0, 4.8, 0.2, 0.2);
  b.light(cx, 1.6, 0, 0xff5a18, 45, 18, 0.12);
  b.embers.push(new Vector3(cx, 0.8, 0), new Vector3(cx + 1, 0.8, 0.6));
  b.at(cx, 0, 0);
  b.solid(0, 0.5, 0, 7.2, 1, 7.2);
  // Market stalls: timber frame, plank counter, canvas-coloured slate awning.
  for (const [x, z, yaw] of [[-12, -8, 0], [12, -8, 0], [-12, 8, Math.PI], [12, 8, Math.PI]] as const) {
    b.at(cx + x, z, yaw);
    for (const px of [-2.2, 2.2]) for (const pz of [-1.3, 1.3]) b.box('charred_timber_beams', px, 1.3, pz, 0.16, 2.6, 0.16);
    b.box('charred_timber_beams', 0, 0.95, 1.2, 4.6, 0.12, 0.9);
    b.box('charred_timber_beams', 0, 0.5, 1.45, 4.4, 0.9, 0.08);
    b.box('roof_tile_charcoal', 0, 2.75, 0.2, 5.2, 0.08, 3.6, { x: 0.22 });
    b.prop('crate', -1.4, -0.6, 0.3, 0.8);
    b.prop('barrel', 1.5, -0.7, 0, 0.8);
    b.solid(0, 1.3, 0, 4.8, 2.6, 3);
  }
  for (const [x, z] of [[-18, -13], [18, -13], [-18, 13], [18, 13]] as const) brazier(b, cx + x, z, 1);
}

function mastersHall(b: WorldBuilder, rand: () => number): void {
  void rand;
  b.at(0, 0, 0);
  // Lane from the square to the yard
  b.box('basalt_cobblestone', YARD.x, -0.03, -21, 9, 0.1, 10);
  b.add('packed_dirt_road', new CylinderGeometry(YARD.r, YARD.r, 0.1, 40), new Matrix4().makeTranslation(YARD.x, -0.03, YARD.z));
  // Low yard wall with a gap on the south side
  for (let i = 0; i < 28; i++) {
    const a = (i + 0.5) / 28 * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.3) continue;
    if (Math.abs(a - Math.PI * 1.5) < 0.6) continue;
    b.at(YARD.x + Math.cos(a) * (YARD.r + 0.5), YARD.z + Math.sin(a) * (YARD.r + 0.5), -a + Math.PI / 2);
    b.box('ashlar_stone_blocks', 0, 0.55, 0, 3.3, 1.1, 0.6);
    b.solid(0, 0.55, 0, 3.3, 1.1, 0.6);
  }
  b.at(0, 0, 0);
  for (const [dx, dz] of [[-6, 6], [6, 6]] as const) brazier(b, YARD.x + dx, YARD.z + dz, 1.1);
  // Training posts in the yard
  for (const [dx, dz] of [[-7, -4], [7, -4]] as const) {
    b.add('charred_timber_beams', new CylinderGeometry(0.18, 0.2, 2.0, 8), new Matrix4().makeTranslation(YARD.x + dx, 1.0, YARD.z + dz));
    b.at(YARD.x + dx, YARD.z + dz, 0);
    b.solid(0, 1, 0, 0.4, 2, 0.4);
    b.at(0, 0, 0);
  }

  // The Master's Hall: 2.4 m stone podium, white plaster walls, red lacquer columns, dougong brackets, noble roof
  const hallX = YARD.x;
  const hallZ = YARD.z - YARD.r - 8;
  const podiumH = 2.4;
  const hallW = 26;
  const hallD = 13;
  const wallH = 4.8;

  b.at(hallX, hallZ, 0);
  b.podium(0, 0, hallW + 2, hallD + 2, podiumH, 6.0);

  // Main hall body on the podium
  const hallBase = podiumH;
  b.box('lime_plaster', 0, hallBase + wallH / 2, 0, hallW, wallH, hallD);
  b.solid(0, hallBase + wallH / 2, 0, hallW, wallH, hallD);

  // Front veranda along south (+z) side with red lacquer columns
  const frontZ = hallD / 2;
  const cols = 7;
  const colSpacing = (hallW - 2.4) / (cols - 1);
  const colPositions: number[] = [];
  for (let c = 0; c < cols; c++) {
    const cx = -hallW / 2 + 1.2 + c * colSpacing;
    colPositions.push(cx);
    b.column(cx, frontZ + 1.2, wallH, 0.32, { mat: 'red_lacquer', baseMat: 'pale_stone' });
    if (c < cols - 1) {
      b.lattice(cx + colSpacing / 2, hallBase + wallH * 0.55, frontZ, colSpacing * 0.78, 2.2, 1, true);
    }
  }

  // Dougong bracket sets under the eaves
  brackets(b, 'x', colPositions, hallBase + wallH, frontZ + 1.2, true);
  brackets(b, 'x', colPositions, hallBase + wallH, -frontZ, true);

  // Noble grand hip-and-gable roof
  roof(b, {
    w: hallW + 1.2,
    d: hallD + 2.4,
    base: hallBase + wallH,
    pitch: 0.62,
    overhang: 1.6,
    curve: 0.25,
    cornerLift: 0.38,
    gableRatio: 0.48,
    tile: 'roof_tile_red',
    trim: true,
  });

  b.light(0, hallBase + 2.6, frontZ + 1.6, 0xff8a3a, 18, 14, 0.2);
}

function greatForge(b: WorldBuilder, rand: () => number): void {
  void rand;
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
  b.prop('wooden_cart', 10, 3, 1.2, 1.2, 0.4);
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

function countingHouses(b: WorldBuilder): void {
  // Twin stone and lacquer treasuries at the square's east mouth
  for (const s of [-1, 1]) {
    b.at(SQUARE.x1 + 5, s * 10.5, s > 0 ? Math.PI : 0);
    const tw = 9.4, td = 9.4;
    const baseH = 5.5;
    const upperH = 4.5;

    // Heavy ashlar stone ground bastion
    b.box('ashlar_stone_blocks', 0, baseH / 2, 0, tw, baseH, td);
    // Narrow barred slit windows on ground level
    b.box('blackened_rusted_iron', -2.2, 3.0, td / 2 + 0.05, 0.4, 1.2, 0.1);
    b.box('blackened_rusted_iron', 2.2, 3.0, td / 2 + 0.05, 0.4, 1.2, 0.1);

    // Reinforced iron-studded red lacquer vault door
    b.box('red_lacquer', 0, 1.9, td / 2 + 0.04, 2.2, 3.2, 0.18);
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 3; k++) {
        b.box('gold_trim', -0.7 + k * 0.7, 0.8 + i * 0.75, td / 2 + 0.14, 0.1, 0.1, 0.05);
      }
    }

    // Upper floor: lime plaster with red lacquer corner framing
    b.box('lime_plaster', 0, baseH + upperH / 2, 0, tw - 0.4, upperH, td - 0.4);
    for (const cx of [-tw / 2 + 0.4, tw / 2 - 0.4]) {
      for (const cz of [-td / 2 + 0.4, td / 2 - 0.4]) {
        b.box('red_lacquer', cx, baseH + upperH / 2, cz, 0.5, upperH, 0.5);
      }
    }
    b.lattice(0, baseH + upperH * 0.55, td / 2 - 0.1, 2.2, 1.8, 1, true);

    // Two-tier noble roof with gold trim
    roof(b, {
      w: tw,
      d: td,
      base: baseH + upperH,
      pitch: 0.65,
      overhang: 1.3,
      curve: 0.22,
      cornerLift: 0.32,
      gableRatio: 0.5,
      tiers: 2,
      tile: 'roof_tile_red',
      trim: true,
    });

    b.solid(0, (baseH + upperH) / 2, 0, tw, baseH + upperH, td);
  }
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

function keepPath(b: WorldBuilder): void {
  // Lane north to the foot of the crag, closed by a gate until the keep opens.
  b.at(0, 0, 0);
  b.box('basalt_cobblestone', 190, -0.03, -34, 8, 0.1, 60);
  b.at(190, -66, 0);
  for (const s of [-1, 1]) {
    b.box('ashlar_stone_blocks', s * 4.4, 3.2, 0, 2.2, 6.4, 2.2);
    b.box('basalt_rock_face', s * 4.4, 6.55, 0, 2.6, 0.3, 2.6);
    b.solid(s * 4.4, 3.2, 0, 2.2, 6.4, 2.2);
  }
  for (let i = -3; i <= 3; i++) b.box('blackened_rusted_iron', i * 0.95, 2.4, 0, 0.12, 4.8, 0.12);
  for (const y of [0.6, 2.4, 4.2]) b.box('blackened_rusted_iron', 0, y, 0, 6.6, 0.14, 0.14);
  b.solid(0, 2.4, 0, 6.6, 4.8, 0.6);
  brazier(b, -4.4, 2.4, 1);
  brazier(b, 4.4, 2.4, 1);
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
