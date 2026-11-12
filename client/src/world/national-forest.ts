import RAPIER from '@dimforge/rapier3d-compat';
import {
  Box3, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, FogExp2,
  Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion,
  SRGBColorSpace, Texture, Vector3, type Material, type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { IGNIS, LEGACY_SINDR_ORIGIN, type Point3 } from '../../../shared/src/world/ignis/coordinates.js';
import { groundAt, groundHeight, landDistance, mineAt, riverAt, SETTLEMENTS, smooth } from '../../../shared/src/world/ignis/ground.js';
import { nationalRoadAt } from '../../../shared/src/world/ignis/routes.js';
import { SETTLEMENT_PRECINCTS } from '../../../shared/src/world/ignis/settlements.js';
import { seeded, type Part } from './builder.js';
import { terrainAir } from './national-view.js';

export type ForestRegion = 'managed' | 'deep' | 'burn' | 'regrowth';
export type ForestKind = 'pine' | 'sapling' | 'snag' | 'stump';
export interface ForestSpot extends Point3 {
  id: string;
  region: ForestRegion;
  kind: ForestKind;
  yaw: number;
  scale: number;
}
interface ResidentCell { ix: number; iz: number }
interface ForestChunk {
  group: Group;
  spots: readonly ForestSpot[];
  near: boolean;
  instances: InstancedMesh[];
}
export interface NationalForestOptions {
  renderer: WebGLRenderer;
  /** Shared scanned timber; the forest never disposes it. */
  bark: Material;
  low: boolean;
  fog?: FogExp2;
  world?: RAPIER.World;
  origin?: Point3;
}
export interface NationalForest {
  group: Group;
  /** Live residency totals, including all planted stems regardless of graphics quality. */
  stats: { cells: number; stems: number; colliders: number; managed: number; deep: number; burn: number; regrowth: number };
  update(near: ReadonlyMap<string, ResidentCell>, mid?: ReadonlyMap<string, ResidentCell>, localPosition?: Point3): void;
  dispose(): void;
}

/** Forest clearance follows the existing graded lake and Pinewatch roads, not an independent road surface. */
export const FOREST_ACCESS = {
  northSouth: { routeId: 'lake', from: [6400, 5000], to: [6400, 7000], canopySetback: 12 },
  pinewatch: { routeId: 'forest', from: [4500, 5500], to: [6400, 7000], canopySetback: 12 },
} as const;

const SIZE = IGNIS.cellSize;
const ellipse = (x: number, z: number, cx: number, cz: number, rx: number, rz: number): number =>
  Math.hypot((x - cx) / rx, (z - cz) / rz);
const up = new Vector3(0, 1, 0);

/** Authored stand boundaries; the shared soil mask and elevation decide whether a stem can survive. */
function standAt(x: number, z: number): { region: ForestRegion; density: number } | null {
  const west = ellipse(x, z, 4900, 6100, 1750, 2350);
  const mineward = ellipse(x, z, 6800, 6500, 1650, 1500);
  const south = ellipse(x, z, 5200, 8300, 1500, 1650);
  const edge = Math.min(west, mineward, south);
  if (edge >= 1) return null;
  const fringe = 1 - smooth(0.82, 1, edge);
  // A broken old fire front curves across the eastern woodland, rather than covering a whole biome.
  const scar = ellipse(x, z, 7080, 6350, 950, 970)
    + Math.sin(z / 137) * 0.055 + Math.sin(x / 191 + z / 231) * 0.07;
  if (scar < 0.72) return { region: 'burn', density: 0.38 * fringe };
  if (scar < 1.06) return { region: 'regrowth', density: 0.72 * fringe };
  // Worked compartments flank Pinewatch; rides are kept open between them.
  if (ellipse(x, z, 4730, 5840, 1000, 1000) < 1) return { region: 'managed', density: 0.72 * fringe };
  return { region: 'deep', density: 0.9 * fringe };
}

/** Pure global placements for one terrain cell. No nation-wide mesh or placement array is allocated. */
export function nationalForestCell(ix: number, iz: number): readonly ForestSpot[] {
  if (!Number.isInteger(ix) || !Number.isInteger(iz)) throw new Error('Forest cell indices must be integers');
  if ((ix + 1) * SIZE < 3150 || ix * SIZE > 8500 || (iz + 1) * SIZE < 3700 || iz * SIZE > 10000) return [];
  const rand = seeded(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ 0x51f04);
  const spots: ForestSpot[] = [];
  for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) {
    // Every candidate consumes the same random sequence, even when it is rejected.
    const jitterX = rand(), jitterZ = rand(), chance = rand(), kindRoll = rand(), size = rand(), yaw = rand() * Math.PI * 2;
    const gx = ix * SIZE + (col + 0.5) * 16, gz = iz * SIZE + (row + 0.5) * 16;
    const provisional = standAt(gx, gz);
    if (!provisional) continue;
    const jitter = provisional.region === 'managed' ? 5 : 14;
    const x = gx + (jitterX - 0.5) * jitter, z = gz + (jitterZ - 0.5) * jitter;
    const stand = standAt(x, z);
    if (!stand || chance > stand.density || landDistance(x, z) < 70) continue;
    // Keep crowns, roots and collision out of cart shoulders, building precincts and the river reserve.
    if (mineAt(x, z).distance < 30 || nationalRoadAt(x, z) !== null || riverAt(x, z).distance < 42) continue;
    if (SETTLEMENTS.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + (p.name === 'Sindr' ? 650 : 65))) continue;
    if (SETTLEMENT_PRECINCTS.some(p => Math.hypot(x - p.x, z - p.z) < p.contentReach + 40)) continue;
    // Repeated forestry compartments have narrow extraction rides and staggered open turning glades.
    if (stand.region === 'managed') {
      const ride = ((x - 3700 + 0.14 * (z - 5500)) % 192 + 192) % 192;
      if (ride < 12 || ride > 180 || ellipse(x, z, 4880, 5880, 90, 70) < 1) continue;
    }
    const soil = groundAt(x, z);
    if (soil.height < 450 || soil.height > 1050 || soil.mask[2]! < 0.12 || soil.mask[3]! > 0.38 || soil.mask[4]! > 0.02) continue;
    if (soil.water !== null && soil.water > soil.height - 1.5) continue;
    const slope = Math.hypot(groundHeight(x + 3, z) - groundHeight(x - 3, z), groundHeight(x, z + 3) - groundHeight(x, z - 3)) / 6;
    if (slope > 0.58) continue;
    let kind: ForestKind = 'pine', scale = 0.8 + size * 0.45;
    if (stand.region === 'deep') { kind = kindRoll < 0.07 ? 'snag' : kindRoll < 0.19 ? 'sapling' : 'pine'; scale = kind === 'sapling' ? 0.23 + size * 0.22 : 1 + size * 0.55; }
    if (stand.region === 'managed') { kind = kindRoll < 0.15 ? 'stump' : kindRoll < 0.32 ? 'sapling' : 'pine'; scale = kind === 'sapling' ? 0.2 + size * 0.18 : 0.75 + size * 0.35; }
    if (stand.region === 'burn') { kind = kindRoll < 0.7 ? 'snag' : kindRoll < 0.88 ? 'stump' : 'sapling'; scale = kind === 'sapling' ? 0.11 + size * 0.13 : 0.65 + size * 0.55; }
    if (stand.region === 'regrowth') { kind = kindRoll < 0.12 ? 'snag' : kindRoll < 0.23 ? 'stump' : kindRoll < 0.94 ? 'sapling' : 'pine'; scale = kind === 'sapling' ? 0.18 + size * 0.3 : 0.7 + size * 0.35; }
    spots.push({ id: `ignis:forest:${ix}:${iz}:${row}:${col}`, x, y: soil.height, z, yaw, scale, kind, region: stand.region });
  }
  return spots;
}

/** Painted needle sprays share one cutout texture, following the existing instanced foliage kit. */
function needleMaterial(): MeshStandardMaterial {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rand = seeded(0x912a);
  ctx.lineCap = 'round';
  for (let spray = 0; spray < 7; spray++) {
    const bx = 128 + (rand() - 0.5) * 28, by = 244;
    const ex = 32 + spray * 31, ey = 20 + rand() * 48;
    ctx.strokeStyle = '#514c35'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    for (let n = 0; n < 30; n++) {
      const t = 0.12 + n / 36, x = bx + (ex - bx) * t, y = by + (ey - by) * t;
      const reach = 10 + Math.sin(t * Math.PI) * 20;
      ctx.strokeStyle = `hsl(${94 + rand() * 26}, ${18 + rand() * 18}%, ${16 + rand() * 18}%)`;
      ctx.lineWidth = 1.4 + rand();
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + side * reach, y - 8 - rand() * 13); ctx.stroke();
      }
    }
  }
  const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; map.anisotropy = 4;
  return new MeshStandardMaterial({ map, alphaTest: 0.38, side: DoubleSide, roughness: 0.94, metalness: 0 });
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const plain = parts.map(g => g.index ? g.toNonIndexed() : g);
  const result = mergeGeometries(plain, false)!;
  for (const g of new Set([...parts, ...plain])) g.dispose();
  result.setAttribute('uv1', result.getAttribute('uv')); result.computeBoundingSphere();
  return result;
}

function limb(a: Vector3, b: Vector3, radius: number, end: number, sides: number): BufferGeometry {
  const d = b.clone().sub(a), length = d.length();
  const geometry = new CylinderGeometry(end, radius, length, sides, 1, true);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * radius * Math.PI, uv.getY(i) * length / 2.4);
  geometry.translate(0, length / 2, 0);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(up, d.normalize()));
  geometry.translate(a.x, a.y, a.z);
  return geometry;
}

/** Open branch whorls and needle cards give pines an irregular, legible silhouette without solid cones. */
function pineKit(bark: Material, needles: Material, coarse: boolean): Part[] {
  const rand = seeded(8401), wood: BufferGeometry[] = [], crown: BufferGeometry[] = [];
  wood.push(limb(new Vector3(0, -0.35, 0), new Vector3(0.2, 15, -0.1), 0.3, 0.025, coarse ? 5 : 7));
  wood.push(limb(new Vector3(0, -0.3, 0), new Vector3(0, 0.7, 0), 0.5, 0.28, 6));
  const tiers = coarse ? 6 : 9, branches = coarse ? 4 : 5;
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / (tiers - 1), y = 4 + t * 10, radius = 3.9 * (1 - t * 0.88);
    for (let branch = 0; branch < branches; branch++) {
      const angle = branch / branches * Math.PI * 2 + tier * 1.31 + rand() * 0.35;
      const reach = radius * (0.65 + rand() * 0.35), tip = new Vector3(Math.cos(angle) * reach, y + 0.3 + t * 0.8, Math.sin(angle) * reach);
      wood.push(limb(new Vector3(0, y, 0), tip, 0.065 * (1 - t * 0.6), 0.012, coarse ? 3 : 5));
      const sprays = coarse ? 2 : 4;
      for (let i = 0; i < sprays; i++) {
        const along = 0.4 + i / sprays * 0.6;
        const card = new PlaneGeometry(Math.max(0.6, radius * 0.75), Math.max(0.7, radius * 0.8));
        card.rotateX(-Math.PI * (0.18 + rand() * 0.25)); card.rotateY(angle + (rand() - 0.5) * 1.1);
        card.translate(tip.x * along, y + (tip.y - y) * along + (rand() - 0.5) * 0.4, tip.z * along);
        crown.push(card);
      }
    }
  }
  // Exposed lower limbs distinguish mature managed pines from scaled generic trees.
  if (!coarse) for (let i = 0; i < 4; i++) {
    const a = i * 2.4;
    wood.push(limb(new Vector3(0, 2 + i * 0.42, 0), new Vector3(Math.cos(a) * 0.8, 2.1 + i * 0.42, Math.sin(a) * 0.8), 0.055, 0.018, 4));
  }
  return [
    { geometry: merge(wood), material: bark, castShadow: false, name: 'national-pine-wood' },
    { geometry: merge(crown), material: needles, castShadow: false, name: 'national-pine-needles' },
  ];
}

/** Existing scanned dead wood is baked into one stable, bottom-anchored instance frame. */
async function deadWood(loader: GLTFLoader, id: 'dead_burnt_tree' | 'dead_tree_trunk', height: number,
  ownedGeometries: Set<BufferGeometry>, ownedMaterials: Set<Material>, ownedTextures: Set<Texture>): Promise<Part[]> {
  const gltf = await loader.loadAsync(`/assets/env/ignis/models/${id}_low.glb`);
  gltf.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(gltf.scene), centre = bounds.getCenter(new Vector3());
  const scale = height / Math.max(0.01, bounds.max.y - bounds.min.y);
  const normalize = new Matrix4().makeScale(scale, scale, scale)
    .multiply(new Matrix4().makeTranslation(-centre.x, -bounds.min.y, -centre.z));
  const parts: Part[] = [];
  gltf.scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    ownedGeometries.add(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      ownedMaterials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) ownedTextures.add(value);
    }
    const geometry = mesh.geometry.clone().applyMatrix4(normalize.clone().multiply(mesh.matrixWorld));
    ownedGeometries.add(geometry);
    if (Array.isArray(mesh.material)) {
      // Preserve the model's material groups; InstancedMesh supports material arrays.
      for (let i = 0; i < materials.length; i++) {
        const indices: number[] = [];
        for (const group of geometry.groups) if (group.materialIndex === i) {
          for (let j = group.start; j < group.start + group.count; j++) indices.push(geometry.index ? geometry.index.getX(j) : j);
        }
        if (!indices.length) continue;
        const part = geometry.clone(); part.clearGroups(); part.setIndex(indices); part.computeBoundingSphere();
        ownedGeometries.add(part);
        parts.push({ geometry: part, material: materials[i]!, castShadow: false, name: id });
      }
    } else parts.push({ geometry, material: mesh.material, castShadow: false, name: id });
  });
  return parts;
}

/** Cell meshes and nearby collision share one owner; all positions remain in nation-global metres. */
export async function createNationalForest(options: NationalForestOptions): Promise<NationalForest> {
  const { renderer, bark, low, world, fog } = options;
  const origin = { ...(options.origin ?? LEGACY_SINDR_ORIGIN) };
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  const disposeResources = (): void => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
  };
  const ktx2 = new KTX2Loader().setTranscoderPath('/assets/env/ignis/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  let snag: Part[], stump: Part[];
  try {
    // Sequential ownership keeps a failed load from leaving another allocation in flight.
    snag = await deadWood(loader, 'dead_burnt_tree', 12, geometries, materials, textures);
    stump = await deadWood(loader, 'dead_tree_trunk', 0.9, geometries, materials, textures);
  } catch (error) { disposeResources(); throw error; }
  finally { ktx2.dispose(); }
  const needle = needleMaterial(); materials.add(needle); if (needle.map) textures.add(needle.map);
  let foliage: Material = needle;
  if (fog) { foliage = terrainAir(needle, fog); materials.add(foliage); }
  const nearPine = pineKit(bark, foliage, low), farPine = low ? nearPine : pineKit(bark, foliage, true);
  for (const part of [...nearPine, ...farPine]) geometries.add(part.geometry);
  const group = new Group(); group.name = 'ignis-national-forest';
  const chunks = new Map<string, ForestChunk>(), colliders = new Map<string, RAPIER.Collider>();
  const stats = { cells: 0, stems: 0, colliders: 0, managed: 0, deep: 0, burn: 0, regrowth: 0 };
  let disposed = false;
  const destroyChunk = (chunk: ForestChunk): void => {
    chunk.group.removeFromParent();
    for (const instance of chunk.instances) instance.dispose();
    for (const spot of chunk.spots) {
      const collider = colliders.get(spot.id);
      if (world && collider) world.removeCollider(collider, false);
      colliders.delete(spot.id);
    }
  };
  const build = (ix: number, iz: number, near: boolean, spots: readonly ForestSpot[]): ForestChunk => {
    const owner = new Group(), cx = (ix + 0.5) * SIZE, cz = (iz + 0.5) * SIZE;
    owner.name = `ignis:forest:${ix}:${iz}`; owner.position.set(cx - origin.x, -origin.y, cz - origin.z);
    const instances: InstancedMesh[] = [], matrix = new Matrix4(), rotation = new Quaternion(), scale = new Vector3();
    for (const kind of ['pine', 'sapling', 'snag', 'stump'] as const) {
      const stems = spots.filter(p => p.kind === kind);
      if (!stems.length) continue;
      const parts = kind === 'snag' ? snag : kind === 'stump' ? stump : near ? nearPine : farPine;
      for (const part of parts) {
        const mesh = new InstancedMesh(part.geometry, part.material, stems.length);
        mesh.name = `${kind}:${part.name}`; mesh.castShadow = false; mesh.receiveShadow = true;
        for (let i = 0; i < stems.length; i++) {
          const p = stems[i]!;
          matrix.compose(new Vector3(p.x - cx, p.y, p.z - cz), rotation.setFromAxisAngle(up, p.yaw), scale.set(p.scale, p.scale * (0.9 + (Math.sin(p.x * 0.17) + 1) * 0.1), p.scale));
          mesh.setMatrixAt(i, part.local ? matrix.clone().multiply(part.local) : matrix);
          mesh.setColorAt(i, new Color().setScalar(kind === 'sapling' ? 0.9 + Math.sin(p.z) * 0.08 : 0.82 + (Math.sin(p.x) + 1) * 0.09));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingBox(); mesh.computeBoundingSphere(); owner.add(mesh); instances.push(mesh);
      }
    }
    group.add(owner);
    return { group: owner, spots, near, instances };
  };
  return {
    group, stats,
    update(near, mid = new Map(), localPosition) {
      if (disposed) return;
      const wanted = new Map<string, { cell: ResidentCell; near: boolean }>();
      for (const [key, cell] of mid) wanted.set(key, { cell, near: false });
      for (const [key, cell] of near) wanted.set(key, { cell, near: true });
      for (const [key, chunk] of chunks) if (!wanted.has(key)) { destroyChunk(chunk); chunks.delete(key); }
      for (const [key, entry] of wanted) {
        const old = chunks.get(key);
        if (old?.near === entry.near) continue;
        const spots = old?.spots ?? nationalForestCell(entry.cell.ix, entry.cell.iz);
        if (old) destroyChunk(old);
        chunks.set(key, build(entry.cell.ix, entry.cell.iz, entry.near, spots));
      }
      stats.cells = 0; stats.stems = 0; stats.managed = 0; stats.deep = 0; stats.burn = 0; stats.regrowth = 0;
      for (const chunk of chunks.values()) {
        if (chunk.spots.length) stats.cells++;
        for (const spot of chunk.spots) {
          stats.stems++; stats[spot.region]++;
          const old = colliders.get(spot.id);
          const within = chunk.near && localPosition && Math.hypot(localPosition.x + origin.x - spot.x, localPosition.z + origin.z - spot.z) < 80;
          if (world && within && !old) {
            const height = (spot.kind === 'stump' ? 0.9 : spot.kind === 'snag' ? 8 : 12) * spot.scale;
            const radius = (spot.kind === 'stump' ? 0.4 : 0.3) * spot.scale;
            colliders.set(spot.id, world.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius)
              .setTranslation(spot.x - origin.x, spot.y - origin.y + height / 2, spot.z - origin.z)));
          } else if (world && old && !within) { world.removeCollider(old, false); colliders.delete(spot.id); }
        }
      }
      stats.colliders = colliders.size;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const chunk of chunks.values()) destroyChunk(chunk);
      chunks.clear(); group.removeFromParent(); disposeResources();
      stats.cells = 0; stats.stems = 0; stats.colliders = 0; stats.managed = 0; stats.deep = 0; stats.burn = 0; stats.regrowth = 0;
    },
  };
}
