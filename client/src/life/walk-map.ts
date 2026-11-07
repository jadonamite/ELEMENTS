import { Vector3 } from 'three';
import type { CombatSpace } from '../attacks/space.js';

/** Cell size of the walk map, metres. */
const CELL = 1.5;
/** Highest step up and longest drop between two neighbouring cells (stairs, kerbs), metres. */
const STEP_UP = 1.0;
const DROP = 1.2;
/** The body a person is tested as: a ball this wide held this high above the floor. */
const BODY_RADIUS = 0.35;
const BODY_HEIGHT = 1.0;

const a = new Vector3(), b = new Vector3();

export interface WalkBounds { x0: number; x1: number; z0: number; z1: number }

/**
 * Where people can walk, read from the physics world: cells spread out from known open ground, each kept
 * only if there is floor under it within a step and a body fits there, and each link only if a body can
 * move between the two cells. Starting from the street means roofs and the inside of buildings are never reached.
 */
export class WalkMap {
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly z: number[] = [];
  readonly links: number[][] = [];
  private readonly index = new Map<number, number>();

  private constructor(private readonly space: CombatSpace) {}

  /** Reads the map from the world all at once. */
  static now(space: CombatSpace, seeds: readonly Vector3[], bounds: WalkBounds): WalkMap {
    const map = new WalkMap(space);
    const spread = map.spread(seeds, bounds);
    while (!spread.next().done);
    return map;
  }

  /** Reads the map a few milliseconds per frame, so a loading screen keeps moving. */
  static async over(space: CombatSpace, seeds: readonly Vector3[], bounds: WalkBounds, budgetMs = 6): Promise<WalkMap> {
    const map = new WalkMap(space);
    const spread = map.spread(seeds, bounds);
    for (;;) {
      const until = performance.now() + budgetMs;
      let done = false;
      while (!done && performance.now() < until) done = !!spread.next().done;
      if (done) return map;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  /** Spreads from the seeds one cell at a time. */
  private *spread(seeds: readonly Vector3[], bounds: WalkBounds): Generator<void> {
    const space = this.space;
    const queue: number[] = [];
    for (const s of seeds) {
      const i = this.add(this.cellX(s.x), this.cellZ(s.z), s.y);
      if (i !== null) queue.push(i);
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      const cx = this.cellX(this.x[i]!), cz = this.cellZ(this.z[i]!);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx, nz = cz + dz;
        const wx = nx * CELL, wz = nz * CELL;
        if (wx < bounds.x0 || wx > bounds.x1 || wz < bounds.z0 || wz > bounds.z1) continue;
        let j = this.index.get(this.key(nx, nz));
        if (j === undefined) {
          const y = this.y[i]!;
          const floor = space.floor(wx, y + STEP_UP + 0.05, wz, STEP_UP + DROP + 0.05);
          if (floor === null || floor > y + STEP_UP) continue;
          const added = this.add(nx, nz, floor);
          if (added === null) continue;
          j = added;
          queue.push(j);
        }
        if (this.links[i]!.includes(j)) continue;
        if (Math.abs(this.y[j]! - this.y[i]!) > Math.max(STEP_UP, DROP)) continue;
        if (!this.passable(i, j)) continue;
        this.links[i]!.push(j);
        this.links[j]!.push(i);
      }
      yield;
    }
  }

  get size(): number { return this.x.length; }

  private cellX(x: number): number { return Math.round(x / CELL); }
  private cellZ(z: number): number { return Math.round(z / CELL); }
  private key(cx: number, cz: number): number { return (cx + 4096) * 8192 + (cz + 4096); }

  /** A cell at (cx, cz) standing on `floor`, if a body fits there. */
  private add(cx: number, cz: number, floor: number): number | null {
    const wx = cx * CELL, wz = cz * CELL;
    a.set(wx, floor + BODY_HEIGHT, wz);
    if (!this.space.clear(a, b.set(wx + 0.01, floor + BODY_HEIGHT, wz), BODY_RADIUS + 0.05)) return null;
    const i = this.x.length;
    this.x.push(wx); this.y.push(floor); this.z.push(wz); this.links.push([]);
    this.index.set(this.key(cx, cz), i);
    return i;
  }

  /** True when a body walks from cell i to cell j without touching anything solid. */
  private passable(i: number, j: number): boolean {
    return this.space.clear(a.set(this.x[i]!, this.y[i]! + BODY_HEIGHT, this.z[i]!), b.set(this.x[j]!, this.y[j]! + BODY_HEIGHT, this.z[j]!), BODY_RADIUS);
  }

  /** The walkable cell nearest a point, searching outward up to `reach` metres; null when none is that close. */
  nearest(p: Vector3, reach = 12): number | null {
    const cx = this.cellX(p.x), cz = this.cellZ(p.z);
    const rings = Math.ceil(reach / CELL);
    let best: number | null = null, bestD = Infinity;
    for (let r = 0; r <= rings; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const i = this.index.get(this.key(cx + dx, cz + dz));
        if (i === undefined) continue;
        const d = (this.x[i]! - p.x) ** 2 + (this.z[i]! - p.z) ** 2 + 4 * (this.y[i]! - p.y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /** Shortest way between two points along the map, straightened wherever a body can walk the straight line. */
  route(from: Vector3, to: Vector3): Vector3[] {
    const s = this.nearest(from), t = this.nearest(to);
    if (s === null || t === null) return [];
    const cells = this.search(s, t);
    if (!cells.length) return [];
    const path: Vector3[] = [];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let next = anchor + 1;
      while (next + 1 < cells.length && this.passable(cells[anchor]!, cells[next + 1]!)) next++;
      path.push(new Vector3(this.x[cells[next]!]!, this.y[cells[next]!]!, this.z[cells[next]!]!));
      anchor = next;
    }
    return path;
  }

  /** A* over the cells. */
  private search(s: number, t: number): number[] {
    const n = this.size;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p]![0] <= heap[k]![0]) break; [heap[p], heap[k]] = [heap[k]!, heap[p]!]; k = p; }
    };
    const pop = (): number => {
      const top = heap[0]!; const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ;) {
          const l = 2 * k + 1, r = l + 1; let m = k;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k]!, heap[m]!]; k = m;
        }
      }
      return top[1];
    };
    const h = (i: number) => Math.hypot(this.x[i]! - this.x[t]!, this.z[i]! - this.z[t]!);
    g[s] = 0; push(h(s), s);
    while (heap.length) {
      const i = pop();
      if (i === t) break;
      if (done[i]) continue;
      done[i] = 1;
      for (const j of this.links[i]!) {
        const step = Math.hypot(this.x[j]! - this.x[i]!, this.y[j]! - this.y[i]!, this.z[j]! - this.z[i]!);
        if (g[i]! + step < g[j]!) { g[j] = g[i]! + step; came[j] = i; push(g[j]! + h(j), j); }
      }
    }
    if (came[t] === -1 && s !== t) return [];
    const out: number[] = [];
    for (let i = t; i !== -1; i = came[i]!) out.push(i);
    return out.reverse();
  }
}
