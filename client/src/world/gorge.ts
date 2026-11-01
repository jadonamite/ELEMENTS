import { CylinderGeometry, Matrix4, Vector3 } from 'three';
import { WorldBuilder } from './builder.js';

export const GORGE = {
  x0: 224,
  x1: 450,
  zMid: 0,
  halfW: 6.5,
};

/**
 * Builds the Gorge Road:
 * - Winding road bed through a volcanic basalt canyon
 * - High basalt cliff walls along north and south sides (16-24m high)
 * - Collapsed stone archway choke point at x = 310
 * - Abandoned overturned wagon and crates at x = 390
 * - Road braziers placed along alternating sides
 */
export function buildGorge(b: WorldBuilder): void {
  // Road bed from East Gate (x 224) to the Slag Barrens (x 450)
  const len = GORGE.x1 - GORGE.x0;
  const midX = (GORGE.x0 + GORGE.x1) / 2;

  b.at(0, 0, 0);
  // Main dirt and ash road
  b.box('packed_dirt_road', midX, -0.04, 0, len, 0.1, GORGE.halfW * 2);

  // Patches of broken crumbling cobblestone along the old road
  for (let x = GORGE.x0 + 15; x < GORGE.x1 - 20; x += 35) {
    b.box('basalt_cobblestone', x, -0.02, (x % 2 === 0 ? 1 : -1) * 1.5, 14, 0.08, 5.0);
  }

  // Dramatic towering basalt canyon walls flanking the road
  for (let x = GORGE.x0; x <= GORGE.x1; x += 18) {
    const northH = 18 + Math.sin(x * 0.1) * 6;
    const southH = 16 + Math.cos(x * 0.12) * 5;

    // North cliff wall (z = -14)
    b.at(x, -14, 0);
    b.box('basalt_rock_face', 0, northH / 2, 0, 22, northH, 14);
    b.solid(0, northH / 2, 0, 20, northH, 12);

    // South cliff wall (z = +14)
    b.at(x, 14, 0);
    b.box('basalt_rock_face', 0, southH / 2, 0, 22, southH, 14);
    b.solid(0, southH / 2, 0, 20, southH, 12);
  }

  // Old weathered road braziers on stone plinths along alternating sides
  let brazierSide = -1;
  for (let x = GORGE.x0 + 20; x < GORGE.x1 - 15; x += 36) {
    const bz = brazierSide * (GORGE.halfW - 1.2);
    brazierSide *= -1;

    b.at(x, bz, 0);
    b.box('ashlar_stone_blocks', 0, 0.4, 0, 1.2, 0.8, 1.2);
    b.prop('iron_brazier', 0, 0, 0, 1.0, 0.8);
    b.cylinder('lava', 0, 1.55, 0, 0.42, 0.42, 0.04, 12);
    b.fire(0, 1.6, 0, 0.9);
    b.light(0, 2.4, 0, 0xff6a22, 24, 12, 0.3);
    b.solid(0, 0.8, 0, 1.2, 1.6, 1.2);
  }

  // 1. Collapsed ancient stone arch choke point at x = 310
  b.at(310, 0, 0);
  // Standing north pier
  b.box('ashlar_stone_blocks', 0, 4.5, -4.5, 2.6, 9.0, 2.6);
  b.solid(0, 4.5, -4.5, 2.6, 9.0, 2.6);

  // Broken south pier
  b.box('ashlar_stone_blocks', 0, 2.0, 4.5, 2.6, 4.0, 2.6);
  b.solid(0, 2.0, 4.5, 2.6, 4.0, 2.6);

  // Fallen arch block narrowing the pass to 4m
  b.box('ashlar_stone_blocks', 0.6, 1.2, 2.2, 2.4, 2.4, 3.2, { z: 0.22, y: 0.15 });
  b.solid(0.6, 1.2, 2.2, 2.4, 2.4, 3.2);

  // Rubble and stone debris around the arch
  b.prop('rock_cluster_b', -2.5, -3.2, 0.5, 1.6);
  b.prop('boulder_large', 2.8, 3.6, 1.2, 1.4);

  // 2. Abandoned timber wagon and spilled cargo at x = 390
  b.at(390, 0, 0);
  // Tipped wagon
  b.prop('wooden_cart', 0, 2.2, -0.35, 1.2);
  b.solid(0, 1.0, 2.2, 3.2, 2.0, 2.4);

  // Spilled crates and barrels
  b.prop('crate', -2.2, 1.4, 0.4, 0.9);
  b.prop('crate', -1.2, 3.2, 0.8, 0.9);
  b.prop('barrel', 1.8, 2.8, 0, 0.85);
  b.prop('barrel', 2.6, 1.6, 1.1, 0.85);

  // Dead trees on ledges
  b.prop('dead_burnt_tree', -15, -11, 0.6, 1.8, 6.0);
  b.prop('dead_burnt_tree', 25, 12, 1.4, 2.0, 5.5);
  b.prop('dead_burnt_tree', -80, 11.5, 0.2, 1.9, 7.0);
}
