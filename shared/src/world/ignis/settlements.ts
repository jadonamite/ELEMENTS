import { IGNIS } from './coordinates.js';
import { LAKE, shapedLand } from './land-form.js';

export const SETTLEMENTS = [
  // Map pins. Sindr and Cinderpit are surveyed pads; the other heights are nominal and each precinct takes its
  // floor from the land under it.
  { name: 'Sindr', x: 7000, z: 9000, height: 380, radius: 220 },
  { name: 'East Border Fort', x: 2000, z: 9000, height: 250, radius: 110 },
  { name: 'Pinewatch', x: 4500, z: 5500, height: 680, radius: 100 },
  { name: 'Crown Lake', x: 8000, z: 4000, height: 820, radius: 100 },
  { name: 'Cinderpit', x: 10500, z: 7000, height: 740, radius: 180 },
  { name: 'Terrace village', x: 9000, z: 11000, height: 260, radius: 120 },
  { name: 'Salt Quay', x: 14350, z: 15000, height: 8, radius: 80 },
  { name: 'March station', x: 8400, z: 14500, height: 210, radius: 100 },
] as const;
export interface SettlementHouse { x: number; z: number; yaw: number; w: number; d: number }
export interface SettlementPrecinct {
  id: string; name: string; x: number; z: number; height: number;
  radius: number; shoulder: number; houses: readonly SettlementHouse[];
  anchor: { readonly x: number; readonly z: number };
  contentReach: number;
  industry: 'mine' | 'forestry' | 'fishing' | 'farming' | 'port' | 'station' | 'fort';
}

/** Building offsets are metres from the dry precinct centre; fronts open toward the central lane. */
function homes(count: number): SettlementHouse[] {
  return Array.from({ length: count }, (_, i) => ({
    x: (i % 2 === 0 ? -1 : 1) * 22,
    z: -40 + Math.floor(i / 2) * 19,
    yaw: i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2,
    w: 10, d: 9,
  }));
}
function precinct(name: typeof SETTLEMENTS[number]['name'], industry: SettlementPrecinct['industry'], count: number, dx = 0, dz = 0, water?: number): SettlementPrecinct {
  const anchor = SETTLEMENTS.find(p => p.name === name)!, x = anchor.x + dx, z = anchor.z + dz;
  const radius = Math.max(anchor.radius, industry === 'fort' ? 150 : 110);
  // The floor is the average land under the precinct, so cut and fill balance; the bank widens with the height it has to take up.
  let height: number = anchor.height, shoulder = 70;
  if (name !== 'Cinderpit') {
    let sum = shapedLand(x, z).height, lean = 0;
    for (let i = 0; i < 12; i++) sum += shapedLand(x + Math.cos(i * Math.PI / 6) * radius * 0.6, z + Math.sin(i * Math.PI / 6) * radius * 0.6).height;
    // A waterside floor stands just above its water so landings and quays meet it.
    height = water === undefined ? Math.max(3, Math.round(sum / 13)) : water + 1.5;
    for (let i = 0; i < 12; i++) lean = Math.max(lean, Math.abs(shapedLand(x + Math.cos(i * Math.PI / 6) * radius, z + Math.sin(i * Math.PI / 6) * radius).height - height));
    shoulder = Math.min(300, Math.max(70, lean * 3));
  }
  return { ...anchor, anchor: { x: anchor.x, z: anchor.z }, x, z, height,
    id: `ignis:settlement:${name.toLowerCase().replaceAll(' ', '-')}`, radius, shoulder,
    contentReach: industry === 'fishing' ? 160 : industry === 'fort' ? 150 : industry === 'port' ? 290 : 110, industry, houses: homes(count) };
}
export const SETTLEMENT_PRECINCTS: readonly SettlementPrecinct[] = [
  precinct('Cinderpit', 'mine', 8), precinct('Pinewatch', 'forestry', 6),
  // Atlas water pins locate the lake/outlet, so dry buildings stand on the adjoining bank.
  precinct('Crown Lake', 'fishing', 4, 560, 0, LAKE.height),
  precinct('Terrace village', 'farming', 6, 200, -200),
  precinct('Salt Quay', 'port', 6, -220, 0),
  precinct('March station', 'station', 4),
  // The gate faces the national edge; its inspection yard stands inside the boundary.
  precinct('East Border Fort', 'fort', 4, 160, 0),
];

/** Dry working precincts keep their surveyed floors after broad valley shaping. */
export function settlementGround(x: number, z: number, height: number): number {
  for (const place of SETTLEMENT_PRECINCTS) {
    const distance = Math.hypot(x - place.x, z - place.z);
    if (distance >= place.radius + place.shoulder) continue;
    const t = Math.max(0, Math.min(1, (distance - place.radius) / place.shoulder));
    height = place.height + (height - place.height) * t * t * (3 - 2 * t);
  }
  return height;
}

/** Includes the whole precinct, so adjacent terrain cells retain one shared content owner. */
export function settlementCells(place: SettlementPrecinct): readonly string[] {
  const keys: string[] = [], reach = place.contentReach;
  for (let x = Math.floor((place.x - reach) / IGNIS.cellSize); x <= Math.floor((place.x + reach) / IGNIS.cellSize); x++) {
    for (let z = Math.floor((place.z - reach) / IGNIS.cellSize); z <= Math.floor((place.z + reach) / IGNIS.cellSize); z++) keys.push(`${x}:${z}`);
  }
  return keys;
}
