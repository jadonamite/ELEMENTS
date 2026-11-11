import { BufferAttribute, BufferGeometry } from 'three';
import type { Field } from './landscape.js';

/**
 * Grid samples are shared with Rapier. A skirt hangs from the tile edge to close the crack where a finer mesh
 * sits on a coarser one. It is a repair, not a surface, so it is sized to the crack, and an edge normal is
 * sampled over the tile's own interval so the boundary row shades like the row beside it.
 */
export function tileGeometry(field: Field, skirt = 16, height?: (x: number, z: number) => number): BufferGeometry {
  const { nx, nz, width, depth, heights } = field, row = nz + 1;
  const base = (nx + 1) * row, edgeCount = 2 * (nx + nz + 2);
  const positions = new Float32Array((base + edgeCount) * 3);
  const normals = new Float32Array(positions.length), uv = new Float32Array((base + edgeCount) * 2);
  const indices: number[] = [];
  for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
    const i = ix * row + iz, x = ix * width / nx - width / 2, z = iz * depth / nz - depth / 2;
    positions.set([x, heights[i]!, z], i * 3);
    let dx = (heights[Math.min(nx, ix + 1) * row + iz]! - heights[Math.max(0, ix - 1) * row + iz]!) / ((ix === 0 || ix === nx ? 1 : 2) * width / nx);
    let dz = (heights[ix * row + Math.min(nz, iz + 1)]! - heights[ix * row + Math.max(0, iz - 1)]!) / ((iz === 0 || iz === nz ? 1 : 2) * depth / nz);
    if (height && (ix === 0 || ix === nx || iz === 0 || iz === nz)) {
      // Sample the edge normal over the tile's own interval, not a fixed 2 m: a stencil that disagrees with the grid
      // gives the boundary row a different slope from the row beside it, which shades as a comb along every tile edge.
      const wx = x + field.cx, wz = z + field.cz, hx = width / nx, hz = depth / nz;
      dx = (height(wx + hx, wz) - height(wx - hx, wz)) / (2 * hx);
      dz = (height(wx, wz + hz) - height(wx, wz - hz)) / (2 * hz);
    }
    const length = Math.hypot(dx, 1, dz);
    normals.set([-dx / length, 1 / length, -dz / length], i * 3);
    uv.set([(x + field.cx) / 3.2, (z + field.cz) / 3.2], i * 2);
    if (ix < nx && iz < nz) indices.push(i, i + 1, i + row, i + 1, i + row + 1, i + row);
  }
  let next = base;
  for (const edge of [Array.from({ length: row }, (_, z) => z), Array.from({ length: row }, (_, z) => nx * row + nz - z),
    Array.from({ length: nx + 1 }, (_, x) => x * row + nz), Array.from({ length: nx + 1 }, (_, x) => (nx - x) * row)]) {
    const start = next;
    for (const i of edge) {
      positions.set([positions[i * 3]!, positions[i * 3 + 1]! - skirt, positions[i * 3 + 2]!], next * 3);
      normals.set([normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!], next * 3);
      uv.set([uv[i * 2]!, uv[i * 2 + 1]!], next * 2); next++;
    }
    for (let k = 0; k < edge.length - 1; k++) indices.push(edge[k]!, start + k, edge[k + 1]!, edge[k + 1]!, start + k, start + k + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2)); g.setAttribute('uv1', g.getAttribute('uv'));
  g.setIndex(indices); g.computeBoundingSphere(); return g;
}
