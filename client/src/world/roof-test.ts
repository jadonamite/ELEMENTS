import type { WorldBuilder } from './builder.js';
import { brackets, roof } from './roofs.js';

/**
 * Builds the six sample test buildings demonstrating the East Asian roof family:
 * 1. Common house roof, charcoal, w 8 d 9, no trim
 * 2. Common house roof, charcoal, w 12 d 10, steeper pitch
 * 3. Noble hall roof, red, w 16 d 11, trim, brackets
 * 4. Two-tier noble tower, red, w 8 d 8, trim
 * 5. Three-tier keep tower, red, w 10 d 10, trim, on a 4 m basalt ashlar base
 * 6. Gate roof, red, w 7 d 4, trim, high corner lift
 */
export function buildRoofTestRow(b: WorldBuilder): void {
  const wallH = 3.6;

  // 1. Common house roof, charcoal, w 8 d 9, no trim
  b.at(135, 60, 0);
  b.box('sooted_plaster', 0, wallH / 2, 0, 8, wallH, 9);
  roof(b, {
    w: 8,
    d: 9,
    base: wallH,
    pitch: 0.58,
    overhang: 0.9,
    curve: 0.18,
    cornerLift: 0.12,
    gableRatio: 0.42,
    tile: 'roof_tile_charcoal',
    trim: false,
  });

  // 2. Common house roof, charcoal, w 12 d 10, steeper
  b.at(152, 60, 0);
  b.box('sooted_plaster', 0, wallH / 2, 0, 12, wallH, 10);
  roof(b, {
    w: 12,
    d: 10,
    base: wallH,
    pitch: 0.68,
    overhang: 1.0,
    curve: 0.22,
    cornerLift: 0.15,
    gableRatio: 0.45,
    tile: 'roof_tile_charcoal',
    trim: false,
  });

  // 3. Noble hall roof, red, w 16 d 11, trim, brackets
  b.at(174, 60, 0);
  b.box('lime_plaster', 0, wallH / 2, 0, 16, wallH, 11);
  // Red lacquer perimeter columns
  for (let x = -7; x <= 7; x += 3.5) {
    b.box('red_lacquer', x, wallH / 2, 5.5, 0.45, wallH, 0.45);
    b.box('red_lacquer', x, wallH / 2, -5.5, 0.45, wallH, 0.45);
  }
  // Dougong bracket sets along South (+z) and North (-z) eaves
  brackets(b, 'x', [-7, -3.5, 0, 3.5, 7], wallH, 5.5, true);
  brackets(b, 'x', [-7, -3.5, 0, 3.5, 7], wallH, -5.5, true);
  roof(b, {
    w: 16,
    d: 11,
    base: wallH,
    pitch: 0.62,
    overhang: 1.5,
    curve: 0.25,
    cornerLift: 0.38,
    gableRatio: 0.48,
    tile: 'roof_tile_red',
    trim: true,
  });

  // 4. Two-tier noble tower, red, w 8 d 8, trim
  b.at(194, 60, 0);
  b.box('lime_plaster', 0, wallH / 2, 0, 8, wallH, 8);
  roof(b, {
    w: 8,
    d: 8,
    base: wallH,
    pitch: 0.65,
    overhang: 1.3,
    curve: 0.22,
    cornerLift: 0.32,
    gableRatio: 0.5,
    tiers: 2,
    tile: 'roof_tile_red',
    trim: true,
  });

  // 5. Three-tier keep tower, red, w 10 d 10, trim, on a 4 m basalt ashlar base
  b.at(212, 60, 0);
  const baseH = 4.0;
  b.box('ashlar_stone_blocks', 0, baseH / 2, 0, 11.2, baseH, 11.2);
  b.box('lime_plaster', 0, baseH + wallH / 2, 0, 10, wallH, 10);
  roof(b, {
    w: 10,
    d: 10,
    base: baseH + wallH,
    pitch: 0.66,
    overhang: 1.4,
    curve: 0.24,
    cornerLift: 0.36,
    gableRatio: 0.52,
    tiers: 3,
    tile: 'roof_tile_red',
    trim: true,
  });

  // 6. Gate roof, red, w 7 d 4, trim, high corner lift
  b.at(228, 60, 0);
  const gateWallH = 4.2;
  // Two side gate piers
  b.box('red_lacquer', -2.6, gateWallH / 2, 0, 1.2, gateWallH, 3.6);
  b.box('red_lacquer', 2.6, gateWallH / 2, 0, 1.2, gateWallH, 3.6);
  // Cross beam
  b.box('red_lacquer', 0, gateWallH - 0.3, 0, 7.0, 0.6, 1.2);
  roof(b, {
    w: 7,
    d: 4,
    base: gateWallH,
    pitch: 0.6,
    overhang: 1.4,
    curve: 0.3,
    cornerLift: 0.48,
    gableRatio: 0.55,
    tile: 'roof_tile_red',
    trim: true,
  });
}
