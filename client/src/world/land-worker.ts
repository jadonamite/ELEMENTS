import { baseGround } from '../../../shared/src/world/ignis/base-ground.js';
import { IGNIS } from '../../../shared/src/world/ignis/coordinates.js';
import { LAND_COUNT, landAt, landColour } from '../../../shared/src/world/ignis/land.js';

/** Bake the nation's ground colour at one texel per `step` metres. Slopes come from the same height grid. */
self.onmessage = (event: MessageEvent<{ step: number }>) => {
  const step = event.data.step, nx = Math.ceil(IGNIS.width / step), nz = Math.ceil(IGNIS.depth / step);
  const heights = new Float32Array(nx * nz), rgba = new Uint8Array(nx * nz * 4), weights = new Float32Array(LAND_COUNT);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) heights[j * nx + i] = baseGround((i + 0.5) * step, (j + 0.5) * step).height;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const at = j * nx + i, h = heights[at]!;
    const dx = (heights[j * nx + Math.min(nx - 1, i + 1)]! - heights[j * nx + Math.max(0, i - 1)]!) / (2 * step);
    const dz = (heights[Math.min(nz - 1, j + 1) * nx + i]! - heights[Math.max(0, j - 1) * nx + i]!) / (2 * step);
    const x = (i + 0.5) * step, z = (j + 0.5) * step;
    landColour(weights, landAt(x, z, h, Math.hypot(dx, dz), weights), x, z, h, rgba, at * 4);
  }
  self.postMessage({ step, nx, nz, rgba }, { transfer: [rgba.buffer] });
};
