import type { Walkable } from './landscape.js';

/** A walking height: flat, or a lane or stair that rises. */
export type Floor = number | ((x: number, z: number) => number);

export interface Area {
  name: string;
  /** Signed distance in metres, negative inside. */
  distance(x: number, z: number): number;
  /** Where feet stand. */
  floor: Floor;
  /** Terrain height under built ground (a terrace slab, a stair); defaults to the floor. */
  ground?: Floor | undefined;
  /** Axis-aligned bounds, for skipping far areas cheaply. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

const at = (f: Floor, x: number, z: number): number => (typeof f === 'number' ? f : f(x, z));

/** Blend width (m) for the floor that hills rise from outside walkable ground. */
const SOFT = 4;

/**
 * Walkable ground at many heights. Later areas win where areas overlap, so a terrace or stair
 * listed after the flat it stands in takes over that patch.
 */
export class Levels implements Walkable {
  constructor(readonly areas: Area[]) {}

  with(more: Area[]): Levels { return new Levels([...this.areas, ...more]); }

  distance(x: number, z: number): number {
    let d = Infinity;
    for (const a of this.areas) d = Math.min(d, a.distance(x, z));
    return d;
  }

  /** The area whose ground holds (x, z): the last one containing it, else null. */
  private inside(x: number, z: number): Area | null {
    for (let i = this.areas.length - 1; i >= 0; i--) {
      const a = this.areas[i]!, b = a.bounds;
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (a.distance(x, z) <= 0) return a;
    }
    return null;
  }

  floorAt(x: number, z: number): number {
    const a = this.inside(x, z);
    return a ? at(a.floor, x, z) : this.soft(x, z, (b) => b.floor);
  }

  groundAt(x: number, z: number): number {
    const a = this.inside(x, z);
    return a ? at(a.ground ?? a.floor, x, z) : this.soft(x, z, (b) => b.floor);
  }

  /** Outside every area: the floors of the nearest areas, blended so hills never crack where the nearest one changes. */
  private soft(x: number, z: number, pick: (a: Area) => Floor): number {
    let best = Infinity;
    const ds = this.areas.map((a) => { const d = a.distance(x, z); best = Math.min(best, d); return d; });
    let sum = 0, weight = 0;
    this.areas.forEach((a, i) => {
      const w = Math.exp(-(ds[i]! - best) / SOFT);
      if (w < 1e-3) return;
      const p = nearestOn(a, x, z);
      sum += w * at(pick(a), p.x, p.z);
      weight += w;
    });
    return weight > 0 ? sum / weight : 0;
  }
}

/** The point of an area's bounds nearest to (x, z), where a sloped floor is read. */
function nearestOn(a: Area, x: number, z: number): { x: number; z: number } {
  const b = a.bounds;
  return { x: Math.min(b.x1, Math.max(b.x0, x)), z: Math.min(b.z1, Math.max(b.z0, z)) };
}

export interface Rect { x0: number; x1: number; z0: number; z1: number }

export function rectDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, x - r.x1), dz = Math.max(r.z0 - z, z - r.z1);
  if (dx <= 0 && dz <= 0) return Math.max(dx, dz);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
}

export function rectArea(name: string, r: Rect, floor: Floor = 0, ground?: Floor): Area {
  return { name, distance: (x, z) => rectDistance(r, x, z), floor, ground, bounds: r };
}

export function circleArea(name: string, cx: number, cz: number, radius: number, floor: Floor = 0): Area {
  return {
    name, distance: (x, z) => Math.hypot(x - cx, z - cz) - radius, floor,
    bounds: { x0: cx - radius, x1: cx + radius, z0: cz - radius, z1: cz + radius },
  };
}

/**
 * A strip along a direction: from (x0, z0) for `length` metres at heading `yaw` (0 = +z, as builder frames),
 * `width` wide. Its floor rises linearly from y0 to y1 along the strip.
 */
export function stripArea(name: string, x0: number, z0: number, yaw: number, length: number, width: number,
  y0: number, y1: number, ground?: Floor): Area {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const local = (x: number, z: number): { a: number; s: number } => {
    const dx = x - x0, dz = z - z0;
    return { a: dx * fx + dz * fz, s: dx * fz - dz * fx };
  };
  const ends = [[0, -width / 2], [0, width / 2], [length, -width / 2], [length, width / 2]]
    .map(([a, s]) => ({ x: x0 + fx * a! + fz * s!, z: z0 + fz * a! - fx * s! }));
  return {
    name,
    distance(x, z) {
      const { a, s } = local(x, z);
      const da = Math.max(-a, a - length), ds = Math.abs(s) - width / 2;
      if (da <= 0 && ds <= 0) return Math.max(da, ds);
      return Math.hypot(Math.max(da, 0), Math.max(ds, 0));
    },
    floor: y0 === y1 ? y0 : (x, z) => y0 + (y1 - y0) * Math.min(1, Math.max(0, local(x, z).a / length)),
    ground,
    bounds: {
      x0: Math.min(...ends.map((e) => e.x)), x1: Math.max(...ends.map((e) => e.x)),
      z0: Math.min(...ends.map((e) => e.z)), z1: Math.max(...ends.map((e) => e.z)),
    },
  };
}
