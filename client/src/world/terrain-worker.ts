import { groundHeight } from '../../../shared/src/world/ignis/ground.js';
import { IGNIS, LEGACY_SINDR_ORIGIN as O } from '../../../shared/src/world/ignis/coordinates.js';
import { tileGeometry } from './terrain-grid.js';
import type { TerrainResult } from './terrain-stream.js';
interface Patch { x0: number; z0: number; nx: number; nz: number; heights: Float32Array }
let patch: Patch | null = null;
self.onmessage = (event: MessageEvent<{ patch?: Patch; ix: number; iz: number; step: number }>) => {
  if (event.data.patch) { patch = event.data.patch; return; }
  const { ix, iz, step } = event.data, start = performance.now(), size = IGNIS.cellSize, n = size / step;
  const height = (x: number, z: number): number => {
    const px = patch ? (x - patch.x0) / 2 : -1, pz = patch ? (z - patch.z0) / 2 : -1;
    return patch && px >= 0 && pz >= 0 && px <= patch.nx && pz <= patch.nz
      ? patch.heights[Math.round(px) * (patch.nz + 1) + Math.round(pz)]! : groundHeight(x + O.x, z + O.z) - O.y;
  };
  const heights = new Float32Array((n + 1) ** 2);
  for (let x = 0; x <= n; x++) for (let z = 0; z <= n; z++) {
    heights[x * (n + 1) + z] = height(ix * size + x * step - O.x, iz * size + z * step - O.z);
  }
  const g = tileGeometry({ width: size, depth: size, cx: (ix + 0.5) * size - O.x, cz: (iz + 0.5) * size - O.z, nx: n, nz: n, heights }, 16, height);
  const result: TerrainResult = { heights, positions: g.getAttribute('position').array as Float32Array,
    normals: g.getAttribute('normal').array as Float32Array, uv: g.getAttribute('uv').array as Float32Array,
    indices: g.index!.array as Uint16Array | Uint32Array, cpuMs: performance.now() - start };
  self.postMessage(result, { transfer: [result.heights.buffer, result.positions.buffer, result.normals.buffer, result.uv.buffer, result.indices.buffer] });
};
