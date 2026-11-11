import type { Box3 } from 'three';

const CELL = 8;
/** How far above or below a piece's top feet may be and still stand on it, in metres. */
const REACH = 0.3;

/**
 * What the ground is made of at any spot, recorded from the very pieces the town is drawn with:
 * every built piece leaves its bounds and its surface here, and the piece whose top is nearest
 * under a pair of feet names what they stand on.
 */
export class Treads<S extends string = string> {
  private readonly bounds: number[] = [];
  private readonly surfaces: S[] = [];
  private readonly cells = new Map<string, number[]>();

  add(surface: S, box: Box3): void {
    const index = this.surfaces.length;
    this.surfaces.push(surface);
    this.bounds.push(box.min.x, box.max.x, box.min.z, box.max.z, box.min.y, box.max.y);
    for (let cx = Math.floor(box.min.x / CELL); cx <= Math.floor(box.max.x / CELL); cx++) {
      for (let cz = Math.floor(box.min.z / CELL); cz <= Math.floor(box.max.z / CELL); cz++) {
        const key = `${cx},${cz}`;
        const list = this.cells.get(key);
        if (list) list.push(index); else this.cells.set(key, [index]);
      }
    }
  }

  /** The surface under feet at (x, y, z), or null on open land. Later pieces win a tie, as they are laid on top. */
  at(x: number, y: number, z: number): S | null {
    const list = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!list) return null;
    let best: S | null = null;
    let nearest = Infinity;
    for (const index of list) {
      const b = index * 6;
      if (x < this.bounds[b]! || x > this.bounds[b + 1]! || z < this.bounds[b + 2]! || z > this.bounds[b + 3]!) continue;
      if (y < this.bounds[b + 4]! - REACH || y > this.bounds[b + 5]! + REACH) continue;
      const gap = Math.abs(this.bounds[b + 5]! - y);
      if (gap <= nearest + 0.02) { nearest = Math.min(nearest, gap); best = this.surfaces[index]!; }
    }
    return best;
  }
}
