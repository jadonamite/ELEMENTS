import { BufferAttribute, BufferGeometry, Mesh, type Material } from 'three';
import { IGNIS, LEGACY_SINDR_ORIGIN, type Point3 } from '../../../shared/src/world/ignis/coordinates.js';
import { NATIONAL_ROUTES, routePointAt, type NationalRoute } from '../../../shared/src/world/ignis/routes.js';

export interface NationalRoadChunk {
  id: string;
  route: NationalRoute;
  start: number;
  end: number;
  /** Near terrain owners use these global cell keys to decide when to create/dispose the ribbon. */
  cells: readonly string[];
}

/** Metadata only: constructing the manifest does not allocate any meshes or materials. */
export function nationalRoadChunks(chunkLength = 256): readonly NationalRoadChunk[] {
  if (!Number.isFinite(chunkLength) || chunkLength <= 0) throw new Error('Road chunk length must be positive');
  const chunks: NationalRoadChunk[] = [];
  for (const route of NATIONAL_ROUTES) {
    if (route.id === 'mine') continue;
    const count = Math.ceil(route.length / chunkLength);
    for (let i = 0; i < count; i++) {
      const start = route.length * i / count, end = route.length * (i + 1) / count;
      const cells = new Set<string>(), radius = route.width / 2;
      // Include every crossed cell and both sides of a road lying on a cell edge.
      const stations = [start, ...route.points.filter(p => p.s > start && p.s < end).map(p => p.s), end];
      for (let j = 1; j < stations.length; j++) {
        const a = routePointAt(route, stations[j - 1]!), b = routePointAt(route, stations[j]!);
        for (let x = Math.floor((Math.min(a.x, b.x) - radius) / IGNIS.cellSize); x <= Math.floor((Math.max(a.x, b.x) + radius) / IGNIS.cellSize); x++) {
          for (let z = Math.floor((Math.min(a.z, b.z) - radius) / IGNIS.cellSize); z <= Math.floor((Math.max(a.z, b.z) + radius) / IGNIS.cellSize); z++) cells.add(`${x}:${z}`);
        }
      }
      chunks.push({ id: `ignis:road:${route.id}:${i}`, route, start, end, cells: [...cells] });
    }
  }
  return chunks;
}

/**
 * One ribbon from the shared profile, in the caller's render origin. Retain every profile vertex so
 * segment joins agree with the shared ground sampler. Material lifetime belongs to the caller.
 */
export function nationalRoadGeometry(route: NationalRoute, origin: Point3 = LEGACY_SINDR_ORIGIN,
  start = 0, end = route.length, spacing = 4): BufferGeometry {
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Invalid road geometry range');
  start = Math.max(0, Math.min(route.length, start));
  end = Math.max(start, Math.min(route.length, end));
  const stations = new Set<number>([start, end]);
  for (const p of route.points) if (p.s > start && p.s < end) stations.add(p.s);
  const steps = Math.ceil((end - start) / spacing);
  for (let i = 1; i < steps; i++) stations.add(start + (end - start) * i / steps);
  const samples = [...stations].sort((a, b) => a - b);
  const positions = new Float32Array(samples.length * 6), uv = new Float32Array(samples.length * 4), indices: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!, p = routePointAt(route, s);
    const a = routePointAt(route, Math.max(0, s - 0.25)), b = routePointAt(route, Math.min(route.length, s + 0.25));
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
    for (let side = 0; side < 2; side++) {
      const offset = (side * 2 - 1) * route.width / 2;
      positions.set([p.x + nx * offset - origin.x, p.y + 0.08 - origin.y, p.z + nz * offset - origin.z], (i * 2 + side) * 3);
      uv.set([side * route.width / 3.2, s / 3.2], (i * 2 + side) * 2);
    }
    if (i < samples.length - 1) { const j = i * 2; indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', geometry.getAttribute('uv'));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Dispose mesh.geometry when its chunk leaves residency; never dispose the shared material here. */
export function nationalRoadMesh(chunk: NationalRoadChunk, material: Material, origin: Point3 = LEGACY_SINDR_ORIGIN): Mesh {
  const mesh = new Mesh(nationalRoadGeometry(chunk.route, origin, chunk.start, chunk.end), material);
  mesh.name = chunk.id; mesh.receiveShadow = true;
  return mesh;
}
