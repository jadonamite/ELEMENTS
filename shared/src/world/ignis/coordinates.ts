export interface Point3 { x: number; y: number; z: number }
export interface Region { id: string; origin: Point3 }

export const IGNIS = { id: 'ignis', width: 16000, depth: 18000, cellSize: 256, regionSize: 2000, altitudeBand: 800 } as const;
export const LOCAL_LIMITS = { horizontal: 5000, vertical: 500 } as const;
/** Registration of the unchanged legacy town, not a relocation to the proposed atlas layout. */
export const LEGACY_SINDR_ORIGIN: Point3 = { x: 6875, y: 380, z: 9000 };
export const CITY_ORIGIN: Point3 = { x: 6550, y: 0, z: 8650 };

function finite(p: Point3): void {
  if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error('Position must be finite');
}
export function toGlobal(local: Point3, origin: Point3): Point3 {
  finite(local); finite(origin);
  return { x: local.x + origin.x, y: local.y + origin.y, z: local.z + origin.z };
}
export function toLocal(global: Point3, origin: Point3): Point3 {
  finite(global); finite(origin);
  return { x: global.x - origin.x, y: global.y - origin.y, z: global.z - origin.z };
}
export function withinLocalBounds(p: Point3): boolean {
  return [p.x, p.y, p.z].every(Number.isFinite) && Math.abs(p.x) <= LOCAL_LIMITS.horizontal
    && Math.abs(p.z) <= LOCAL_LIMITS.horizontal && Math.abs(p.y) <= LOCAL_LIMITS.vertical;
}
/** Stable IDs use nation-global metres; render-origin shifts never change them. */
export function cellId(p: Point3): string {
  finite(p);
  return `ignis:cell:${Math.floor(p.x / IGNIS.cellSize)}:${Math.floor(p.z / IGNIS.cellSize)}`;
}
export function regionFor(p: Point3): Region {
  finite(p);
  const x = Math.floor(p.x / IGNIS.regionSize), z = Math.floor(p.z / IGNIS.regionSize), y = Math.floor(p.y / IGNIS.altitudeBand);
  return { id: `ignis:region:${x}:${z}:${y}`, origin: { x: (x + 0.5) * IGNIS.regionSize, y: (y + 0.5) * IGNIS.altitudeBand, z: (z + 0.5) * IGNIS.regionSize } };
}
export function placeId(anchor: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(anchor)) throw new Error('Invalid place key');
  return `ignis:sindr:${anchor}`;
}
