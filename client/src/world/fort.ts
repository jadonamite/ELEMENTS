import { CylinderGeometry, Matrix4, Vector3 } from 'three';
import { WorldBuilder } from './builder.js';
import { roof } from './roofs.js';

export const FORT = {
  gateX: 758,
  gateZ: 0,
  wallHeight: 14,
};

/** Checks if a position is within the East Border Fort gatehouse threshold (for M3.9 zone transition). */
export function isAtFortGate(pos: { x: number; z: number }): boolean {
  return Math.abs(pos.x - FORT.gateX) <= 6 && Math.abs(pos.z - FORT.gateZ) <= 5;
}

/**
 * Builds the East Border Fort:
 * - 14m tall basalt ashlar curtain wall spanning north-south at x = 758
 * - Twin flanking watchtowers with charcoal roofs
 * - Massive central gatehouse and lowered iron portcullis
 * - Garrison courtyard with barracks facade, supply crates, weapon racks, and braziers
 */
export function buildFort(b: WorldBuilder): void {
  const gx = FORT.gateX;
  const wallH = FORT.wallHeight;

  // 1. High curtain walls extending north and south to the mountains
  b.at(gx, 0, 0);
  // South wall section (z: 14 to 65)
  b.box('ashlar_stone_blocks', 0, wallH / 2, 40, 5.0, wallH, 52);
  b.solid(0, wallH / 2, 40, 5.0, wallH, 52);
  // North wall section (z: -65 to -14)
  b.box('ashlar_stone_blocks', 0, wallH / 2, -40, 5.0, wallH, 52);
  b.solid(0, wallH / 2, -40, 5.0, wallH, 52);

  // Battlements on top of the curtain walls
  for (let z = 16; z < 64; z += 3.5) {
    b.box('ashlar_stone_blocks', -2.2, wallH + 0.6, z, 0.8, 1.2, 1.8);
    b.box('ashlar_stone_blocks', 2.2, wallH + 0.6, z, 0.8, 1.2, 1.8);
  }
  for (let z = -64; z < -16; z += 3.5) {
    b.box('ashlar_stone_blocks', -2.2, wallH + 0.6, z, 0.8, 1.2, 1.8);
    b.box('ashlar_stone_blocks', 2.2, wallH + 0.6, z, 0.8, 1.2, 1.8);
  }

  // 2. Central Gatehouse (x = gx, z = 0)
  // Gatehouse archway
  b.box('ashlar_stone_blocks', 0, wallH / 2 + 1.5, 0, 8.0, wallH + 3.0, 10.0);
  b.solid(0, wallH / 2 + 1.5, -7.0, 8.0, wallH + 3.0, 4.0);
  b.solid(0, wallH / 2 + 1.5, 7.0, 8.0, wallH + 3.0, 4.0);

  // Red lacquer ornamental trim above the gate (representing the Lord's imperial authority)
  b.box('red_lacquer', -4.1, 7.5, 0, 0.4, 1.6, 7.2);
  b.box('gold_trim', -4.15, 8.5, 0, 0.1, 0.4, 5.0);

  // Lowered iron portcullis blocking the passage
  for (let i = -4; i <= 4; i++) {
    b.box('blackened_rusted_iron', 0, 3.2, i * 0.75, 0.18, 6.4, 0.18);
  }
  for (const py of [1.2, 3.2, 5.2]) {
    b.box('blackened_rusted_iron', 0, py, 0, 0.22, 0.22, 7.2);
  }
  b.solid(0, 3.2, 0, 1.2, 6.4, 7.4);

  // 3. Twin Watchtowers flanking the gate (z = -14 and +14)
  for (const sz of [-1, 1]) {
    const tz = sz * 14;
    const towerW = 9.0, towerD = 9.0;
    const towerH = wallH + 4.5;

    b.at(gx, tz, 0);
    b.box('ashlar_stone_blocks', 0, towerH / 2, 0, towerW, towerH, towerD);
    b.solid(0, towerH / 2, 0, towerW, towerH, towerD);

    // Watchtower charcoal hip-and-gable roof
    roof(b, {
      w: towerW,
      d: towerD,
      base: towerH,
      pitch: 0.64,
      overhang: 1.2,
      curve: 0.2,
      cornerLift: 0.25,
      gableRatio: 0.5,
      tile: 'roof_tile_charcoal',
      trim: false,
    });

    // Lookout windows
    for (const [wx, wy, dir] of [
      [-towerW / 2 - 0.05, towerH - 3.0, -1],
      [towerW / 2 + 0.05, towerH - 3.0, 1],
    ] as const) {
      b.window(wx, wy, 0, 0.8, 1.4, dir);
    }

    // Braziers atop watchtowers
    b.at(gx, tz + sz * 3.5, 0);
    b.prop('iron_brazier', 0, 0, 0, 1.1, towerH);
    b.cylinder('lava', 0, towerH + 0.8, 0, 0.45, 0.45, 0.04, 12);
    b.fire(0, towerH + 0.85, 0, 1.2);
    b.light(0, towerH + 2.0, 0, 0xff7424, 32, 16, 0.3);
  }

  // 4. Garrison Courtyard (x: 700 to 750, z: -30 to 30)
  b.at(gx - 28, 0, 0);
  // Cobblestone parade ground
  b.box('basalt_cobblestone', 0, -0.04, 0, 50, 0.08, 48);

  // Barracks building along south edge of courtyard (z = 24)
  b.at(gx - 28, 24, Math.PI);
  const barrackW = 28, barrackD = 10, barrackH = 4.5;
  b.box('ashlar_stone_blocks', 0, barrackH / 2, 0, barrackW, barrackH, barrackD);
  b.solid(0, barrackH / 2, 0, barrackW, barrackH, barrackD);

  roof(b, {
    w: barrackW,
    d: barrackD,
    base: barrackH,
    pitch: 0.58,
    overhang: 1.0,
    curve: 0.16,
    cornerLift: 0.12,
    gableRatio: 0.45,
    tile: 'roof_tile_charcoal',
    trim: false,
  });

  // Supply depot along north edge of courtyard (z = -20)
  b.at(gx - 25, -20, 0);
  b.prop('wooden_cart', -6, 0, 0.4, 1.2);
  b.prop('crate', 2, 0, 0.2, 1.0);
  b.prop('crate', 4, 1, 0.8, 0.9);
  b.prop('barrel', 0, 2.5, 0, 0.9);
  b.prop('barrel', 1.8, 2.5, 0.4, 0.9);
  b.solid(0, 1.0, 0, 12, 2.0, 8);

  // Courtyard braziers
  for (const [bx, bz] of [[gx - 15, -12], [gx - 15, 12], [gx - 40, -10], [gx - 40, 10]] as const) {
    b.at(bx, bz, 0);
    b.prop('iron_brazier', 0, 0, 0, 1.0);
    b.cylinder('lava', 0, 0.75, 0, 0.42, 0.42, 0.03, 12);
    b.fire(0, 0.78, 0, 0.9);
    b.light(0, 1.8, 0, 0xff7424, 25, 14, 0.3);
    b.solid(0, 0.6, 0, 1.0, 1.2, 1.0);
  }
}
