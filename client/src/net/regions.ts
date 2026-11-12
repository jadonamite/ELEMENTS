import { IGNIS, regionFor, type Point3, type Region } from '../../../shared/src/index.js';

/** Canonical network frames inside the national envelope. */
export function networkRegion(id: string): Region | null {
  const m = /^ignis:region:(0|[1-9]\d*):(0|[1-9]\d*):(-1|0|[1-9]\d*)$/.exec(id);
  if (!m) return null;
  const column = Number(m[1]), row = Number(m[2]), band = Number(m[3]);
  if (column >= IGNIS.width / IGNIS.regionSize || row >= IGNIS.depth / IGNIS.regionSize || band < -1 || band > 3) return null;
  return regionFor({ x: column * IGNIS.regionSize, y: band * IGNIS.altitudeBand, z: row * IGNIS.regionSize });
}

export function adjacentNetworkRegions(a: Region, b: Region): boolean {
  const differences = [Math.abs(a.origin.x - b.origin.x) / IGNIS.regionSize,
    Math.abs(a.origin.z - b.origin.z) / IGNIS.regionSize,
    Math.abs(a.origin.y - b.origin.y) / IGNIS.altitudeBand];
  return differences.every(d => d <= 1) && differences.some(d => d === 1);
}

export function finitePoint(raw: unknown): raw is Point3 {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Point3;
  return [p.x, p.y, p.z].every(v => typeof v === 'number' && Number.isFinite(v));
}
