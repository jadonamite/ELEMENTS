import { CylinderGeometry, Matrix4, Vector3 } from 'three';
import { WorldBuilder } from './builder.js';

export const BARRENS = {
  x0: 450,
  x1: 680,
  zMin: -110,
  zMax: 110,
};

/**
 * Builds the Slag Barrens:
 * - Ash and cinder badlands
 * - Cooling basalt lava flows with glowing fissures
 * - Towering hexagonal basalt monoliths (6-12m)
 * - Ruined pre-Edict dungeon portal with iron gate
 * - Burnt deadwood groves
 * - Southern fork: Ash Track toward TERRA
 * - Monster hunt arena clearing
 */
export function buildBarrens(b: WorldBuilder): void {
  const midX = (BARRENS.x0 + BARRENS.x1) / 2;
  const widthX = BARRENS.x1 - BARRENS.x0;
  const depthZ = BARRENS.zMax - BARRENS.zMin;

  b.at(0, 0, 0);

  // 1. Broad ash and cinder ground
  b.box('ash_cinder_ground', midX, -0.06, 0, widthX, 0.1, depthZ);

  // Main travel trail continuing east toward the fort
  b.box('packed_dirt_road', midX, -0.04, 0, widthX, 0.08, 12);

  // 2. Cooling lava crust flows and glowing heat cracks
  for (const [fx, fz, fw, fd] of [
    [490, -35, 42, 28],
    [540, 45, 55, 36],
    [595, -25, 48, 32],
    [630, 30, 40, 24],
  ] as const) {
    b.box('cooled_lava_crust', fx, -0.02, fz, fw, 0.09, fd);
    // Glowing lava cracks through the crust
    b.box('lava', fx, 0.02, fz, fw * 0.75, 0.04, 1.2, { y: 0.35 });
    b.box('lava', fx + 4, 0.02, fz - 3, 1.2, 0.04, fd * 0.65, { y: -0.25 });
    b.light(fx, 0.8, fz, 0xff4a10, 8, 12, 0.2);
    b.embers.push(new Vector3(fx, 0.5, fz), new Vector3(fx + 3, 0.5, fz - 2));
  }

  // 3. Hexagonal basalt column clusters and monolithic formations
  for (const [mx, mz, count, maxH] of [
    [480, 50, 7, 10],
    [515, -60, 9, 12],
    [570, -70, 8, 9],
    [580, 65, 10, 11],
    [640, -50, 6, 8],
    [650, 55, 7, 10],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = 2.5 + (i % 3) * 1.8;
      const colX = mx + Math.cos(a) * r;
      const colZ = mz + Math.sin(a) * r;
      const h = maxH - (i % 4) * 1.8;

      b.at(colX, colZ, a);
      b.add('basalt_rock_face', new CylinderGeometry(1.2, 1.4, h, 6), new Matrix4().makeTranslation(0, h / 2, 0));
      b.solid(0, h / 2, 0, 2.4, h, 2.4);
    }
  }

  // 4. Ruined pre-Edict dungeon entrance (x = 525, z = -75)
  b.at(525, -75, Math.PI / 4);
  // Half-buried stone archway and stairs into blackness
  b.box('ashlar_stone_blocks', -3.2, 3.5, 0, 1.8, 7.0, 3.0);
  b.box('ashlar_stone_blocks', 3.2, 3.5, 0, 1.8, 7.0, 3.0);
  b.box('ashlar_stone_blocks', 0, 7.2, 0, 8.2, 1.8, 3.2);
  // Iron gate blocking entrance
  for (let i = -3; i <= 3; i++) {
    b.box('blackened_rusted_iron', i * 0.7, 3.0, 0, 0.12, 6.0, 0.12);
  }
  b.box('blackened_rusted_iron', 0, 3.0, 0, 5.0, 0.15, 0.15);
  b.solid(0, 3.5, 0, 8.0, 7.0, 3.0);
  // Ancient weathered steps down
  for (let s = 1; s <= 4; s++) {
    b.box('ashlar_stone_blocks', 0, -s * 0.35, -s * 0.6, 4.6, 0.4, 0.8);
  }

  // 5. Southern fork: the Ash Track trail branching toward TERRA
  b.at(0, 0, 0);
  for (let step = 0; step < 12; step++) {
    const tx = 530 + step * 8;
    const tz = step * 9;
    b.box('packed_dirt_road', tx, -0.04, tz, 10, 0.08, 8, { y: 0.65 });
  }
  // Toppled waystone at the fork
  b.at(532, 28, 0.8);
  b.box('ashlar_stone_blocks', 0, 0.4, 0, 1.1, 0.8, 3.4, { x: 0.25, z: 0.15 });
  b.solid(0, 0.4, 0, 1.2, 0.8, 3.4);

  // 6. Burnt deadwood groves
  for (const [gx, gz] of [[470, -20], [550, -45], [620, -15], [605, 45]] as const) {
    b.prop('dead_burnt_tree', gx, gz, 0.3, 1.8);
    b.prop('dead_burnt_tree', gx + 6, gz + 4, 1.2, 1.6);
    b.prop('dead_burnt_tree', gx - 5, gz + 8, 2.1, 1.5);
    b.solid(gx, 2.5, gz, 1.2, 5, 1.2);
  }

  // 7. Monster clearing (Preset C, 28m clearing for beast encounters north of the main trail)
  const clearX = 610, clearZ = -36;
  b.at(clearX, clearZ, 0);
  b.add('ash_cinder_ground', new CylinderGeometry(15, 15, 0.12, 32), new Matrix4().makeTranslation(0, -0.02, 0));
  // Framing boulders around clearing perimeter
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bx = Math.cos(a) * 16.5;
    const bz = Math.sin(a) * 16.5;
    b.prop('boulder_large', bx, bz, a, 1.8);
    b.solid(bx, 1.2, bz, 2.5, 2.4, 2.5);
  }
}
