import { randomBytes } from 'node:crypto';
import { IGNIS, LEGACY_SINDR_ORIGIN, SINDR_SPAWN, regionFor, toGlobal, toLocal, type Point3 } from '@elements/shared';

export interface NationalRegion {
  id: string;
  origin: Point3;
  column: number;
  row: number;
  band: number;
}

/** Metres shared by both owners while a connection changes rooms. */
export const REGION_OVERLAP = 32;
export const HANDOFF_SECONDS = 5;
export const NATIONAL_SPAWN = toGlobal({ x: SINDR_SPAWN.x, y: 0, z: SINDR_SPAWN.z }, LEGACY_SINDR_ORIGIN);
export const SPAWN_REGION = regionFor(NATIONAL_SPAWN).id;

/** Only canonical IDs inside the national envelope and supported altitude bands exist. */
export function nationalRegion(id: string): NationalRegion | null {
  const match = /^ignis:region:(0|[1-9]\d*):(0|[1-9]\d*):(-1|0|[1-9]\d*)$/.exec(id);
  if (!match) return null;
  const column = Number(match[1]), row = Number(match[2]), band = Number(match[3]);
  if (column >= IGNIS.width / IGNIS.regionSize || row >= IGNIS.depth / IGNIS.regionSize || band < -1 || band > 3) return null;
  return { id, column, row, band, origin: {
    x: (column + 0.5) * IGNIS.regionSize,
    y: (band + 0.5) * IGNIS.altitudeBand,
    z: (row + 0.5) * IGNIS.regionSize,
  } };
}

export function regionContains(region: NationalRegion, local: Point3): boolean {
  const global = toGlobal(local, region.origin);
  return [local.x, local.y, local.z].every(Number.isFinite)
    && Math.abs(local.x) <= IGNIS.regionSize / 2 + REGION_OVERLAP
    && Math.abs(local.z) <= IGNIS.regionSize / 2 + REGION_OVERLAP
    && Math.abs(local.y) <= IGNIS.altitudeBand / 2 + REGION_OVERLAP
    && global.x >= 0 && global.x < IGNIS.width && global.z >= 0 && global.z < IGNIS.depth;
}

export function adjacentRegions(a: NationalRegion, b: NationalRegion): boolean {
  const differences = [Math.abs(a.column - b.column), Math.abs(a.row - b.row), Math.abs(a.band - b.band)];
  return differences.every(d => d <= 1) && differences.some(d => d === 1);
}

/** Persistent national positions are metres ASL; legacy zones retain their existing frame. */
export function persistentPosition(zone: string, local: Point3): Point3 {
  const region = nationalRegion(zone);
  return region ? toGlobal(local, region.origin) : { ...local };
}

export function networkPosition(zone: string, global: Point3): Point3 {
  const region = nationalRegion(zone);
  return region ? toLocal(global, region.origin) : { ...global };
}

/** Last known national locations survive room disposal, but not a process restart. */
const nationalPositions = new Map<string, { zone: string; position: Point3 }>();

export function rememberNationalPosition(accountId: string, zone: string, local: Point3): void {
  const region = nationalRegion(zone);
  if (!region || !regionContains(region, local)) return;
  const position = persistentPosition(zone, local);
  const owner = regionFor(position);
  if (nationalRegion(owner.id)) nationalPositions.set(accountId, { zone: owner.id, position });
}

export function lastNationalPosition(accountId: string): { zone: string; position: Point3 } | undefined {
  const saved = nationalPositions.get(accountId);
  return saved ? { zone: saved.zone, position: { ...saved.position } } : undefined;
}

interface Crossing<T> {
  accountId: string;
  source: string;
  target: string;
  expiresAt: number;
  take: () => T;
  valid: () => boolean;
}

/** Tokens stay in this server process and can be consumed only once by the same account. */
export class RegionHandoffs<T> {
  private readonly tokens = new Map<string, Crossing<T>>();

  issue(crossing: Crossing<T>, now: number): string {
    for (const [token, pending] of this.tokens) {
      if (pending.expiresAt <= now || !pending.valid() || pending.accountId === crossing.accountId) this.tokens.delete(token);
    }
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, crossing);
    return token;
  }

  accepts(token: unknown, accountId: string, target: string, now: number): boolean {
    if (typeof token !== 'string') return false;
    const crossing = this.tokens.get(token);
    return !!crossing && crossing.accountId === accountId && crossing.target === target
      && crossing.expiresAt > now && crossing.valid();
  }

  consume(token: unknown, accountId: string, target: string, now: number): T {
    if (!this.accepts(token, accountId, target, now)) throw new Error('Crossing expired or refused');
    const crossing = this.tokens.get(token as string)!;
    this.tokens.delete(token as string);
    return crossing.take();
  }
}
