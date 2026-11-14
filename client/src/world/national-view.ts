import { BatchedMesh, BufferAttribute, BufferGeometry, CircleGeometry, FogExp2, Frustum, Group, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Sphere, Vector3, Vector4, type Material, type Camera } from 'three';
import { CRATER, landCell, RIVER, riverAt, LAKE, MINE_LENGTH, minePointAt } from '../../../shared/src/world/ignis/ground.js';
import { LEGACY_SINDR_ORIGIN as O } from '../../../shared/src/world/ignis/coordinates.js';
import { tileGeometry } from './terrain-stream.js';
import { createSmoke } from './effects.js';
import { createSky, type Field } from './landscape.js';

/** Terrain uses its own light aerial perspective, shared across the near/far handover. */
export function terrainAir(material: MeshStandardMaterial, fog: FogExp2): MeshStandardMaterial {
  const m = material.clone(), previous = material.onBeforeCompile;
  m.fog = false;
  m.onBeforeRender = (...args) => {
    material.onBeforeRender(...args);
    for (const key of ['map', 'normalMap', 'aoMap', 'roughnessMap'] as const) {
      if (m[key] !== material[key]) { m[key] = material[key]; m.needsUpdate = true; }
    }
  };
  m.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.terrainFog = { value: fog.color };
    // Distance is taken per pixel: a distance interpolated across a very large triangle (the sea) is wrong everywhere.
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 terrainFog;')
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, terrainFog, 1.0 - exp(-length(vViewPosition) * 0.000045));');
  };
  m.customProgramCacheKey = () => `${material.customProgramCacheKey()}-national-air`;
  return m;
}
export function mineRoadMesh(material: Material): Mesh {
  const n = Math.ceil(MINE_LENGTH / 2), positions = new Float32Array((n + 1) * 6), uv = new Float32Array((n + 1) * 4), indices: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = MINE_LENGTH * i / n, p = minePointAt(s), a = minePointAt(Math.max(0, s - 0.25)), b = minePointAt(Math.min(MINE_LENGTH, s + 0.25));
    const length = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
    for (let side = 0; side <= 1; side++) {
      const w = (side * 2 - 1) * 2.75;
      positions.set([p.x + nx * w - O.x, p.y + 0.08 - O.y, p.z + nz * w - O.z], (i * 2 + side) * 3);
      uv.set([side * 5.5 / 3.2, s / 3.2], (i * 2 + side) * 2);
    }
    if (i < n) { const j = i * 2; indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  }
  const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(positions, 3)); g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('uv1', g.getAttribute('uv')); g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingSphere();
  const mesh = new Mesh(g, material); mesh.name = 'cinderpit-road'; mesh.receiveShadow = true; return mesh;
}
export interface NationalView {
  group: Group; sky: Mesh; ready: Promise<void>; tiles: number; visible: number;
  /** Draw objects and triangles the national view submitted for the last update. */
  stats: { calls: number; triangles: number };
  update(camera: Camera, resident?: readonly ReadonlyMap<string, { ix: number; iz: number }>[]): void; dispose(): void;
}
/**
 * The national silhouette is actual field geometry, using the same global samples as near collision. It lives in the
 * town scene and is drawn by the town camera, so the far tiles, the streamed cells and the town share one depth
 * buffer and hide each other by distance alone. Far tiles are discarded inside resident cells so the two meshes of
 * the same ground never overlap.
 */
export function nationalView(height: (x: number, z: number) => number, material: Material, low: boolean, fog: FogExp2): NationalView {
  const farMaterial = material.clone() as MeshStandardMaterial, reserved = Array.from({ length: 33 }, () => new Vector4());
  // Cloning a Material does not retain its shader callbacks.
  farMaterial.onBeforeCompile = material.onBeforeCompile;
  farMaterial.onBeforeRender = (...args) => {
    material.onBeforeRender(...args);
    for (const key of ['map', 'normalMap', 'aoMap', 'roughnessMap'] as const) {
      const value = (material as MeshStandardMaterial)[key];
      if (farMaterial[key] !== value) { farMaterial[key] = value; farMaterial.needsUpdate = true; }
    }
  };
  farMaterial.customProgramCacheKey = material.customProgramCacheKey.bind(material);
  const previous = farMaterial.onBeforeCompile;
  farMaterial.onBeforeCompile = (shader, renderer) => {
    previous.call(farMaterial, shader, renderer);
    shader.uniforms.residentBounds = { value: reserved };
    shader.uniforms.residentCount = { value: residentCount };
    residentUniform = shader.uniforms.residentCount;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vNationalXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvNationalXZ = (inverse(viewMatrix) * mvPosition).xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vNationalXZ; uniform vec4 residentBounds[33]; uniform int residentCount;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        for (int i = 0; i < 33; i++) {
          if (i >= residentCount) break;
          vec4 b = residentBounds[i];
          if (vNationalXZ.x >= b.x && vNationalXZ.y >= b.y && vNationalXZ.x < b.z && vNationalXZ.y < b.w) discard;
        }`);
  };
  let residentCount = 0;
  let residentUniform: { value: number } | null = null;
  const group = new Group(); group.name = 'national-view';
  const sky = createSky(); sky.scale.setScalar(18000); group.add(sky);
  const n = low ? 49 : 97, vertices = n * n + 4 * n, indices = (n - 1) ** 2 * 6 + (n - 1) * 24;
  const batch = new BatchedMesh(64, vertices * 64, indices * 64, farMaterial);
  batch.name = 'national-far'; batch.frustumCulled = false; batch.sortObjects = false; group.add(batch);
  // Water and the crater take the terrain's light air, not the town's street haze, which would erase them by 2 km.
  const waterMat = terrainAir(new MeshStandardMaterial({ color: 0x2f5563, roughness: 0.32 }), fog);
  const sea = new Mesh(new PlaneGeometry(42000, 42000).rotateX(-Math.PI / 2), waterMat);
  sea.position.set(8000 - O.x, -O.y - 0.02, 9000 - O.z); sea.name = 'sea'; group.add(sea);
  const lake = new Mesh(new CircleGeometry(1, 64).rotateX(-Math.PI / 2), waterMat);
  lake.scale.set(LAKE.rx, 1, LAKE.rz); lake.position.set(LAKE.x - O.x, LAKE.height - O.y, LAKE.z - O.z); group.add(lake);
  const riverPos: number[] = [], riverIndices: number[] = [];
  RIVER.forEach((p, i) => {
    const a = RIVER[Math.max(0, i - 1)]!, b = RIVER[Math.min(RIVER.length - 1, i + 1)]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
    for (const side of [-1, 1]) riverPos.push(p[0] + side * nx * 9 - O.x, p[2] - O.y, p[1] + side * nz * 9 - O.z);
    if (i) { const j = (i - 1) * 2; riverIndices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  });
  const riverGeometry = new BufferGeometry(); riverGeometry.setAttribute('position', new BufferAttribute(new Float32Array(riverPos), 3)); riverGeometry.setIndex(riverIndices); riverGeometry.computeVertexNormals();
  const river = new Mesh(riverGeometry, waterMat); river.name = 'national-river'; group.add(river);
  const crater = new Mesh(new CircleGeometry(CRATER.radius * 0.62, 40).rotateX(-Math.PI / 2), terrainAir(new MeshStandardMaterial({ color: 0xbd471d, emissive: 0x6a1a08, roughness: 0.9 }), fog));
  crater.position.set(CRATER.x - O.x, CRATER.floor + 6 - O.y, CRATER.z - O.z); group.add(crater);
  const plume = createSmoke(Array.from({ length: 6 }, (_, i) => new Vector3(CRATER.x - O.x + i * 8, CRATER.floor + 30 - O.y, CRATER.z - O.z)), 8,
    { rise: 420, drift: [200, 70], size: [45, 180], speed: 0.018, opacity: 0.45, color: 0x403b38, lit: 0x403b38 });
  plume.frustumCulled = false; plume.name = 'volcano-plume'; group.add(plume);
  const plumeMat = plume.material as Material;
  let tiles = 0, visible = 0, stopped = false;
  const stats = { calls: 0, triangles: 0 }, fixed = [sea, lake, river, crater, sky];
  const fixedTriangles = fixed.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3, 0);
  const tileTriangles: number[] = [];
  const bounds: Sphere[] = [], frustum = new Frustum(), projection = new Matrix4();
  const ready = (async () => {
    let slice = performance.now();
    for (let ix = -1; ix <= 6; ix++) for (let iz = -1; iz <= 6; iz++) {
      if (stopped) return;
      const gx = (ix + 0.5) * 3072, gz = (iz + 0.5) * 3072;
      // Conservative polygon intersection, including all land boundary tiles.
      if (!landCell(ix, iz, 3072)) continue;
      const nearGate = Math.hypot(gx - 7100, gz - 9000) < 8000;
      const step = low || !nearGate ? 64 : 32, count = 3072 / step, heights = new Float32Array((count + 1) ** 2);
      // A far tile's grid is coarser than the river, so it would bury the water; within one grid step of the river the
      // far land is held under the surface and the river ribbon shows.
      const far = (lx: number, lz: number): number => {
        const river = riverAt(lx + O.x, lz + O.z), h = height(lx, lz);
        return river.distance < step ? Math.min(h, river.water - O.y - 1.5) : h;
      };
      for (let x = 0; x <= count; x++) {
        for (let z = 0; z <= count; z++) heights[x * (count + 1) + z] = far(ix * 3072 + x * step - O.x, iz * 3072 + z * step - O.z);
        if (performance.now() - slice > 1.5) { await new Promise(resolve => setTimeout(resolve, 0)); slice = performance.now(); }
      }
      const field: Field = { width: 3072, depth: 3072, cx: gx - O.x, cz: gz - O.z, nx: count, nz: count, heights };
      const geometry = tileGeometry(field, 32, far);
      const positions = geometry.getAttribute('position'), oldIndices = geometry.index!, kept: number[] = [];
      for (let i = 0; i < oldIndices.count; i += 3) {
        const a = oldIndices.getX(i), b = oldIndices.getX(i + 1), c = oldIndices.getX(i + 2);
        if (Math.max(positions.getY(a), positions.getY(b), positions.getY(c)) >= -O.y) kept.push(a, b, c);
      }
      geometry.setIndex(kept); tileTriangles.push(kept.length / 3);
      bounds.push(geometry.boundingSphere!.clone().translate(new Vector3(field.cx, 0, field.cz)));
      const id = batch.addGeometry(geometry), instance = batch.addInstance(id);
      batch.setMatrixAt(instance, new Matrix4().makeTranslation(field.cx, 0, field.cz)); geometry.dispose(); tiles++;
      if (performance.now() - slice > 1.5) { await new Promise(resolve => setTimeout(resolve, 0)); slice = performance.now(); }
    }
  })();
  return { group, sky, ready, stats, get tiles() { return tiles; }, get visible() { return visible; }, update(camera, resident) {
    let count = 0;
    if (resident) for (const cells of resident) for (const cell of cells.values()) {
      if (count === reserved.length) break;
      reserved[count++]!.set(cell.ix * 256 - O.x, cell.iz * 256 - O.z, (cell.ix + 1) * 256 - O.x, (cell.iz + 1) * 256 - O.z);
    }
    residentCount = count; if (residentUniform) residentUniform.value = count;
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
    let triangles = 0;
    visible = 0; bounds.forEach((sphere, i) => {
      const shown = frustum.intersectsSphere(sphere); batch.setVisibleAt(i, shown);
      if (shown) { visible++; triangles += tileTriangles[i]!; }
    });
    // The batch is one draw; the fixed meshes and the plume are one each.
    stats.calls = (visible ? 1 : 0) + fixed.length + 1; stats.triangles = triangles + fixedTriangles;
  }, dispose() {
    stopped = true; batch.dispose(); farMaterial.dispose();
    group.removeFromParent();
    group.traverse(object => { const mesh = object as Mesh; if (mesh === batch) return; mesh.geometry?.dispose(); });
    waterMat.dispose(); (crater.material as Material).dispose(); plumeMat.dispose(); (sky.material as Material).dispose();
  } };
}
