import { LAKE, landDistance, landNoise, oceanBoundary, riverAt, smooth, VOLCANO } from './base-ground.js';
export { landNoise } from './base-ground.js';
import { SETTLEMENT_PRECINCTS, SETTLEMENTS } from './settlements.js';

/**
 * What the land is made of at a spot. One answer for the painter, the plants and the air above it,
 * so a gold wood has a gold floor and a burn has ash under its dead trunks.
 */
export const LAND_TYPES = [
  'lava', 'ash', 'burn', 'regrowth', 'ginkgo', 'maple', 'pine', 'white_grass', 'terrace', 'meadow', 'marsh',
  'clay', 'sulphur', 'slag', 'black_sand', 'pebble', 'rock', 'snow', 'earth',
] as const;
export type LandType = typeof LAND_TYPES[number];
export const LAND_COUNT = LAND_TYPES.length;
const index = Object.fromEntries(LAND_TYPES.map((name, i) => [name, i])) as Record<LandType, number>;

/** Ground colour of each type in sRGB, 0..255. */
export const LAND_COLOUR: Record<LandType, readonly [number, number, number]> = {
  lava: [30, 24, 22], ash: [134, 129, 124], burn: [52, 46, 43], regrowth: [150, 84, 128],
  ginkgo: [178, 140, 46], maple: [150, 40, 30], pine: [52, 70, 40], white_grass: [196, 188, 150],
  terrace: [168, 150, 62], meadow: [92, 128, 56], marsh: [70, 96, 60], clay: [176, 84, 44],
  sulphur: [206, 194, 112], slag: [92, 60, 46], black_sand: [40, 38, 36], pebble: [128, 132, 132],
  rock: [128, 112, 92], snow: [232, 238, 242], earth: [112, 92, 72],
};

/** 1 inside `radius` of a centre, fading to 0 over `edge` metres. */
const blob = (x: number, z: number, cx: number, cz: number, radius: number, edge: number): number =>
  1 - smooth(radius, radius + edge, Math.hypot(x - cx, z - cz));

const MAPLE_GROVES = [[6600, 8300, 320], [7900, 9700, 280], [8700, 3700, 300], [4300, 5200, 260], [9300, 10400, 240]] as const;
const SULPHUR_FLATS = [[5600, 2500, 520], [11200, 6900, 330], [10100, 6300, 240]] as const;

/**
 * Fill `out` (length LAND_COUNT) with how much of each land type is at a spot; the weights sum to 1.
 * `height` is metres above sea, `slope` is rise over run. Returns the glow of open lava, 0..1.
 */
export function landAt(x: number, z: number, height: number, slope: number, out: Float32Array): number {
  out.fill(0);
  const put = (type: LandType, amount: number): void => {
    if (amount <= 0) return;
    const a = Math.min(1, amount);
    for (let i = 0; i < LAND_COUNT; i++) out[i]! *= 1 - a;
    out[index[type]]! += a;
  };
  // Borders wander by up to 220 m so no land type ends on a ruled line.
  const wx = x + (landNoise(x, z, 700) - 0.5) * 440, wz = z + (landNoise(x + 913, z - 377, 700) - 0.5) * 440;
  const fine = landNoise(x, z, 90), volcano = Math.hypot(wx - VOLCANO.x, wz - VOLCANO.z);
  const river = riverAt(x, z).distance, lakeR = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);

  // Open country: pale upland grass in the west and middle, bare ash toward the volcano and the east.
  out[index.ash] = 1;
  put('white_grass', 1 - smooth(8600, 10400, wx));
  put('meadow', (1 - smooth(8200, 9800, wx)) * (1 - smooth(330, 520, height)) * 0.85);
  put('pine', (1 - smooth(5600, 7000, wx)) * smooth(380, 520, height) * (1 - smooth(1000, 1200, height)));
  put('pine', blob(wx, wz, 4500, 5500, 1500, 600));
  put('ginkgo', blob(wx, wz, 7000, 9000, 1500, 700) * (0.75 + fine * 0.25));
  put('ginkgo', blob(wx, wz, 8300, 8000, 500, 400) * 0.9);
  put('terrace', blob(wx, wz, 9100, 10900, 800, 300));
  // Lower river: green banks, reeds and standing water at the edge.
  const lower = smooth(8800, 10200, z);
  put('meadow', (1 - smooth(120, 320, river)) * lower);
  put('marsh', (1 - smooth(30, 90, river)) * lower * (0.6 + fine * 0.4));
  // The south: the Scorched March and the Ash Track.
  put('ash', smooth(12200, 13400, wz) * (1 - smooth(10500, 12000, wx)));
  // Round the volcano: ash apron, the burn on its west side, fireweed where the burn is healing.
  put('ash', 1 - smooth(2600, 3600, volcano));
  put('regrowth', blob(wx, wz, 9700, 4700, 1500, 500) * (0.55 + fine * 0.45));
  put('burn', blob(wx, wz, 9900, 4500, 950, 450));
  put('slag', blob(wx, wz, 12200, 10300, 1200, 500));
  put('clay', blob(wx, wz, 10100, 8100, 380, 160));
  for (const [cx, cz, r] of SULPHUR_FLATS) put('sulphur', blob(wx, wz, cx, cz, r, 140));
  for (const [cx, cz, r] of MAPLE_GROVES) put('maple', blob(wx, wz, cx, cz, r - 60, 220) * (0.7 + fine * 0.3));
  // Lava runs down the cone in tongues from the crater.
  const angle = Math.atan2(wz - VOLCANO.z, wx - VOLCANO.x);
  const tongue = smooth(0.35, 0.8, Math.sin(angle * 5 + volcano / 420) * 0.5 + 0.5 + (fine - 0.5) * 0.3);
  const lava = Math.max(tongue * (1 - smooth(1500, 2300, volcano)), 1 - smooth(120, 260, volcano));
  // The cone itself is dark cinder; lava runs over it.
  put('black_sand', 1 - smooth(1500, 2300, volcano));
  put('lava', lava);
  // Worked ground under towns and camps.
  const town = SETTLEMENTS[0];
  let earth = blob(x, z, town.x, town.z, town.radius + 40, 120);
  for (const place of SETTLEMENT_PRECINCTS) earth = Math.max(earth, blob(x, z, place.x, place.z, place.radius - 10, 40));
  put('earth', earth);
  // Shores.
  const coast = landDistance(x, z);
  if (oceanBoundary(x, z)) put('black_sand', 1 - smooth(90, 240, coast) + (1 - smooth(4, 14, height)) * 0.6);
  put('pebble', Math.max((1 - smooth(1.12, 1.4, lakeR)), 1 - smooth(11, 24, river)));
  // Height and steepness win over everything growing.
  put('rock', smooth(0.5, 0.95, slope));
  // Hot ground keeps the snow off.
  put('snow', smooth(1080, 1260, height + (fine - 0.5) * 80) * smooth(2400, 3200, volcano) * (1 - smooth(0.9, 1.5, slope)) * (1 - out[index.sulphur]!));
  const cracks = smooth(0.62, 0.9, landNoise(x, z, 34) * 0.6 + landNoise(x + 57, z + 91, 11) * 0.4);
  return lava * (0.15 + 0.85 * cracks);
}

/** The strongest land type in a weight set. */
export function dominantLand(weights: Float32Array): LandType {
  let best = 0;
  for (let i = 1; i < LAND_COUNT; i++) if (weights[i]! > weights[best]!) best = i;
  return LAND_TYPES[best]!;
}

/** Blend the type colours into sRGB bytes at `offset` of `rgba`; alpha carries the lava glow. */
export function landColour(weights: Float32Array, glow: number, x: number, z: number, height: number, rgba: Uint8Array | Uint8ClampedArray, offset: number): void {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < LAND_COUNT; i++) {
    const w = weights[i]!;
    if (w === 0) continue;
    const c = LAND_COLOUR[LAND_TYPES[i]!];
    r += c[0] * w; g += c[1] * w; b += c[2] * w;
  }
  // Terraces read as steps: a dark flooded strip, then a gold one, every 8 m of height.
  const terrace = weights[index.terrace]!;
  if (terrace > 0) {
    const band = smooth(0.2, 0.8, Math.abs((height / 8) % 1 - 0.5) * 2);
    const wet = terrace * (1 - band) * 0.55;
    r += (58 - r) * wet; g += (84 - g) * wet; b += (74 - b) * wet;
  }
  // Sulphur flats hold turquoise pools.
  const sulphur = weights[index.sulphur]!;
  if (sulphur > 0) {
    const pool = sulphur * smooth(0.62, 0.72, landNoise(x, z, 60));
    r += (64 - r) * pool; g += (168 - g) * pool; b += (160 - b) * pool;
  }
  // Broad patches so no land type is one flat colour.
  const patch = 0.86 + landNoise(x + 401, z + 77, 180) * 0.28;
  rgba[offset] = Math.min(255, r * patch); rgba[offset + 1] = Math.min(255, g * patch);
  rgba[offset + 2] = Math.min(255, b * patch); rgba[offset + 3] = Math.round(glow * 255);
}
