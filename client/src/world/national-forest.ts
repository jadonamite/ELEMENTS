import RAPIER from '@dimforge/rapier3d-compat';
import {
  Box3, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, FogExp2,
  Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion,
  SRGBColorSpace, Texture, Vector3, type Material, type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { IGNIS, LEGACY_SINDR_ORIGIN, type Point3 } from '../../../shared/src/world/ignis/coordinates.js';
import { groundHeight, landDistance, mineAt, riverAt, SETTLEMENTS, waterHeight } from '../../../shared/src/world/ignis/ground.js';
import { LAND_COUNT, landAt, landDraw, type LandType } from '../../../shared/src/world/ignis/land.js';
import { nationalRoadAt } from '../../../shared/src/world/ignis/routes.js';
import { SETTLEMENT_PRECINCTS } from '../../../shared/src/world/ignis/settlements.js';
import { seeded, type Part } from './builder.js';
import { rockHouseClear } from './rock-houses.js';
import { terrainAir } from './national-view.js';
import { existingTree } from './trees.js';

export type ForestKind = 'pine' | 'sapling' | 'snag' | 'stump' | 'ginkgo' | 'maple';
export interface ForestSpot extends Point3 {
  id: string;
  land: LandType;
  kind: ForestKind;
  yaw: number;
  scale: number;
}
interface ResidentCell { ix: number; iz: number }
type Tier = 'near' | 'mid' | 'far';
interface ForestChunk {
  group: Group;
  spots: readonly ForestSpot[];
  tier: Tier;
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
  /** Live totals of what is planted round the hero. */
  stats: { cells: number; stems: number; colliders: number; far: number };
  update(near: ReadonlyMap<string, ResidentCell>, mid?: ReadonlyMap<string, ResidentCell>, localPosition?: Point3): void;
  /** Plants every distant cell round a point ahead of play, a few milliseconds at a time; `update` then only builds them. */
  plantAround(localPosition: Point3): Promise<void>;
  dispose(): void;
}

const SIZE = IGNIS.cellSize;
/** Distant tree cards are kept this many cells from the hero's cell. */
const FAR_REACH = 7;
/** Cells along one side of a block of distant tree cards. */
const BLOCK = 4;
const up = new Vector3(0, 1, 0);

/**
 * The one tree of each land type: stems per 16 m square, then [kind, share, smallest scale, largest scale].
 * Land types not listed grow no trees; their plants are ground cover.
 */
export const GROWTH: Partial<Record<LandType, { density: number; mix: readonly (readonly [ForestKind, number, number, number])[] }>> = {
  ginkgo: { density: 0.8, mix: [['ginkgo', 1, 0.95, 1.7]] },
  maple: { density: 0.75, mix: [['maple', 1, 0.9, 1.5]] },
  pine: { density: 0.85, mix: [['pine', 0.86, 0.9, 1.55], ['sapling', 0.1, 0.2, 0.42], ['snag', 0.04, 0.7, 1.1]] },
  burn: { density: 0.42, mix: [['snag', 0.75, 0.65, 1.2], ['stump', 0.25, 0.65, 1.2]] },
  regrowth: { density: 0.6, mix: [['sapling', 0.72, 0.18, 0.48], ['snag', 0.14, 0.6, 1], ['stump', 0.14, 0.7, 1.05]] },
};
const weights = new Float32Array(LAND_COUNT);

/** Pure global placements for one terrain cell, read from the shared land map so trees stand on their own colour. */
export function nationalForestCell(ix: number, iz: number): readonly ForestSpot[] {
  if (!Number.isInteger(ix) || !Number.isInteger(iz)) throw new Error('Forest cell indices must be integers');
  if (ix < 0 || iz < 0 || ix * SIZE >= IGNIS.width || iz * SIZE >= IGNIS.depth) return [];
  const rand = seeded(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ 0x51f04);
  const spots: ForestSpot[] = [];
  for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) {
    // Every candidate consumes the same random sequence, even when it is rejected.
    const jitterX = rand(), jitterZ = rand(), chance = rand(), typeRoll = rand(), kindRoll = rand(), size = rand(), yaw = rand() * Math.PI * 2;
    const x = ix * SIZE + (col + 0.5) * 16 + (jitterX - 0.5) * 14, z = iz * SIZE + (row + 0.5) * 16 + (jitterZ - 0.5) * 14;
    if (landDistance(x, z) < 70) continue;
    const height = groundHeight(x, z);
    landAt(x, z, height, 0, weights);
    // A spot belongs to one land type, drawn by weight, so woods thin out across a border instead of stopping.
    const land: LandType | null = landDraw(weights, typeRoll);
    const growth = land && GROWTH[land];
    if (!land || !growth || chance > growth.density) continue;
    // Keep crowns, roots and collision out of cart shoulders, building precincts and the river reserve.
    if (mineAt(x, z).distance < 30 || nationalRoadAt(x, z) !== null || riverAt(x, z).distance < 42) continue;
    if (SETTLEMENTS.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + 65)) continue;
    if (SETTLEMENT_PRECINCTS.some(p => Math.hypot(x - p.x, z - p.z) < p.contentReach + 40)) continue;
    if (!rockHouseClear(x, z, 6)) continue;
    const water = waterHeight(x, z);
    if (water !== null && water > height - 1.5) continue;
    if (Math.hypot(groundHeight(x + 3, z) - height, groundHeight(x, z + 3) - height) / 3 > 0.58) continue;
    let pick = growth.mix[0]!, share = kindRoll;
    for (const entry of growth.mix) { pick = entry; share -= entry[1]; if (share < 0) break; }
    spots.push({ id: `ignis:forest:${ix}:${iz}:${row}:${col}`, x, y: height, z, yaw, scale: pick[2] + size * (pick[3] - pick[2]), kind: pick[0], land });
  }
  return spots;
}

/** One painted sheet of four distant trees: ginkgo, maple, pine, burnt trunk. */
function farSheet(): CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!, rand = seeded(0x77a1);
  const cell = (i: number, draw: () => void): void => {
    ctx.save(); ctx.translate((i % 2) * 256, (1 - Math.floor(i / 2)) * 256);
    ctx.beginPath(); ctx.rect(0, 0, 256, 256); ctx.clip(); draw(); ctx.restore();
  };
  const trunk = (colour: string, width: number, top: number): void => {
    ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(128, 256); ctx.lineTo(128, top); ctx.stroke();
  };
  const crown = (cy: number, rx: number, ry: number, hue: number, sat: number, light: number): void => {
    for (let n = 0; n < 420; n++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()), x = 128 + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r;
      // Lit from above: the top of the crown is brighter than its underside.
      ctx.fillStyle = `hsl(${hue + rand() * 14}, ${sat}%, ${light * (0.62 + 0.5 * (1 - (y - cy + ry) / (2 * ry))) + rand() * 6}%)`;
      ctx.beginPath(); ctx.arc(x, y, 7 + rand() * 9, 0, Math.PI * 2); ctx.fill();
    }
  };
  cell(0, () => { trunk('#4a3a2a', 9, 120); crown(100, 78, 84, 44, 70, 46); });
  cell(1, () => { trunk('#3a2a22', 9, 150); crown(120, 104, 62, 4, 66, 36); });
  cell(2, () => {
    trunk('#3b3226', 7, 20);
    for (let tier = 0; tier < 11; tier++) {
      const y = 30 + tier * 19, half = 12 + tier * 7.5;
      ctx.fillStyle = `hsl(${98 + rand() * 18}, 24%, ${17 + rand() * 9}%)`;
      ctx.beginPath(); ctx.moveTo(128, y - 22); ctx.lineTo(128 - half, y + 12 + rand() * 6); ctx.lineTo(128 + half, y + 12 + rand() * 6); ctx.closePath(); ctx.fill();
    }
  });
  cell(3, () => {
    trunk('#1d1917', 10, 16);
    for (let n = 0; n < 7; n++) {
      const y = 60 + n * 24, side = n % 2 ? 1 : -1;
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(128, y); ctx.lineTo(128 + side * (24 + rand() * 30), y - 20 - rand() * 16); ctx.stroke();
    }
  });
  const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; map.anisotropy = 4;
  return map;
}

/** Two crossed cards showing one cell of the far sheet, standing on the ground. */
function farCard(cellIndex: number, width: number, height: number): BufferGeometry {
  const a = new PlaneGeometry(width, height).translate(0, height / 2, 0), b = a.clone().rotateY(Math.PI / 2);
  const card = mergeGeometries([a, b], false)!; a.dispose(); b.dispose();
  const uv = card.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (cellIndex % 2 + uv.getX(i)) * 0.5, (Math.floor(cellIndex / 2) + uv.getY(i)) * 0.5);
  // Cards face the sky for light, so a wood shades as one mass.
  const normal = card.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0);
  return card;
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

/** A fire-killed tree: a charred trunk snapped short of its top with a few bare limbs, about 11 m tall. */
function snagKit(bark: Material, coarse: boolean): Part[] {
  const rand = seeded(5519), wood: BufferGeometry[] = [], sides = coarse ? 4 : 7;
  wood.push(limb(new Vector3(0, -0.4, 0), new Vector3(0, 0.8, 0), 0.52, 0.3, sides));
  wood.push(limb(new Vector3(0, 0.6, 0), new Vector3(0.25, 6.5, -0.1), 0.3, 0.2, sides));
  wood.push(limb(new Vector3(0.25, 6.5, -0.1), new Vector3(0.05, 11, 0.2), 0.2, 0.07, sides));
  for (let i = 0; i < (coarse ? 3 : 6); i++) {
    const y = 3.2 + i * 1.25, a = i * 2.3 + rand(), reach = 1.1 + rand() * 1.9;
    const from = new Vector3(0.12, y, 0), elbow = new Vector3(Math.cos(a) * reach * 0.6, y + 0.5 + rand() * 0.5, Math.sin(a) * reach * 0.6);
    wood.push(limb(from, elbow, 0.085, 0.05, coarse ? 3 : 4));
    wood.push(limb(elbow, new Vector3(Math.cos(a) * reach, y + 0.2 + rand() * 1.5, Math.sin(a) * reach), 0.05, 0.012, coarse ? 3 : 4));
  }
  return [{ geometry: merge(wood), material: bark, castShadow: false, name: 'national-snag' }];
}

/** What is left of a felled or burnt-through tree: a short butt with flared roots. */
function stumpKit(bark: Material): Part[] {
  const wood = [limb(new Vector3(0, -0.3, 0), new Vector3(0, 0.35, 0), 0.62, 0.4, 7), limb(new Vector3(0, 0.3, 0), new Vector3(0.04, 0.9, 0), 0.4, 0.34, 7)];
  const cap = new CylinderGeometry(0.34, 0.34, 0.02, 7).translate(0.04, 0.9, 0);
  return [{ geometry: merge([...wood, cap]), material: bark, castShadow: false, name: 'national-stump' }];
}

/** Cell meshes and nearby collision share one owner; all positions remain in nation-global metres. */
export async function createNationalForest(options: NationalForestOptions): Promise<NationalForest> {
  const { bark, low, world, fog } = options;
  const origin = { ...(options.origin ?? LEGACY_SINDR_ORIGIN) };
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  const disposeResources = (): void => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
  };
  const snag = snagKit(bark, low), midSnag = low ? snag : snagKit(bark, true), stump = stumpKit(bark);
  const needle = needleMaterial(); materials.add(needle); if (needle.map) textures.add(needle.map);
  let foliage: Material = needle;
  if (fog) { foliage = terrainAir(needle, fog); materials.add(foliage); }
  const nearPine = pineKit(bark, foliage, low), midPine = low ? nearPine : pineKit(bark, foliage, true);
  // The town's ginkgo and maple, with fewer leaf cards the farther the cell; one leaf material serves all four.
  let leaves: Material | null = null;
  const broadleaf = (kind: 'ginkgo' | 'maple', share: number): Part[] => {
    const kit = existingTree(kind, share);
    if (leaves) { (kit.leaves as MeshStandardMaterial).map?.dispose(); kit.leaves.dispose(); }
    else { leaves = kit.leaves; materials.add(leaves); const map = (leaves as MeshStandardMaterial).map; if (map) textures.add(map); }
    return [{ geometry: kit.crown, material: leaves, castShadow: false, name: `${kind}-leaves` },
      ...(kit.wood ? [{ geometry: kit.wood, material: bark, castShadow: false, name: `${kind}-wood` }] : [])];
  };
  const sheet = farSheet(); textures.add(sheet);
  let cardMaterial = new MeshStandardMaterial({ map: sheet, alphaTest: 0.4, side: DoubleSide, roughness: 1, metalness: 0 });
  materials.add(cardMaterial);
  if (fog) { cardMaterial = terrainAir(cardMaterial, fog); materials.add(cardMaterial); }
  const card = (cellIndex: number, width: number, height: number): Part[] =>
    [{ geometry: farCard(cellIndex, width, height), material: cardMaterial, castShadow: false, name: 'far-card' }];
  const kits: Record<ForestKind, Record<Tier, Part[] | null>> = {
    ginkgo: { near: broadleaf('ginkgo', low ? 0.1 : 0.45), mid: broadleaf('ginkgo', low ? 0.06 : 0.14), far: card(0, 11, 12.5) },
    maple: { near: broadleaf('maple', low ? 0.1 : 0.45), mid: broadleaf('maple', low ? 0.06 : 0.14), far: card(1, 12, 9) },
    pine: { near: nearPine, mid: midPine, far: card(2, 9, 15.5) },
    sapling: { near: nearPine, mid: midPine, far: null },
    snag: { near: snag, mid: midSnag, far: card(3, 7, 12) },
    stump: { near: stump, mid: null, far: null },
  };
  for (const kit of Object.values(kits)) for (const parts of Object.values(kit)) for (const part of parts ?? []) geometries.add(part.geometry);
  const group = new Group(); group.name = 'ignis-national-forest';
  const chunks = new Map<string, ForestChunk>(), colliders = new Map<string, RAPIER.Collider>();
  const stats = { cells: 0, stems: 0, colliders: 0, far: 0 };
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
  const build = (ix: number, iz: number, tier: Tier, spots: readonly ForestSpot[]): ForestChunk => {
    const owner = new Group(), cx = (ix + 0.5) * SIZE, cz = (iz + 0.5) * SIZE;
    owner.name = `ignis:forest:${ix}:${iz}`; owner.position.set(cx - origin.x, -origin.y, cz - origin.z);
    const instances: InstancedMesh[] = [], matrix = new Matrix4(), rotation = new Quaternion(), scale = new Vector3();
    for (const kind of Object.keys(kits) as ForestKind[]) {
      const parts = kits[kind][tier];
      const stems = parts ? spots.filter(p => p.kind === kind) : [];
      if (!parts || !stems.length) continue;
      for (const part of parts) {
        const mesh = new InstancedMesh(part.geometry, part.material, stems.length);
        mesh.name = `${kind}:${part.name}`; mesh.castShadow = false; mesh.receiveShadow = tier !== 'far';
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
    return { group: owner, spots, tier, instances };
  };
  const COLLIDER: Partial<Record<ForestKind, [number, number]>> = { stump: [0.9, 0.4], snag: [8, 0.3], pine: [12, 0.3], ginkgo: [4, 0.3], maple: [3, 0.26] };
  // Distant trees are painted cards. A cell of cards is too small to be worth its own draw, so cards are drawn in
  // blocks of BLOCK x BLOCK cells: one draw per tree kind per block.
  const farSpots = new Map<string, readonly ForestSpot[]>(), blocks = new Map<string, { signature: string; chunk: ForestChunk }>();
  const farReach = low ? 4 : FAR_REACH;
  return {
    group, stats,
    async plantAround(localPosition) {
      const hx = Math.floor((localPosition.x + origin.x) / SIZE), hz = Math.floor((localPosition.z + origin.z) / SIZE);
      let slice = performance.now();
      for (let dz = -farReach; dz <= farReach; dz++) for (let dx = -farReach; dx <= farReach; dx++) {
        if (disposed) return;
        const key = `${hx + dx}:${hz + dz}`;
        if (!farSpots.has(key)) farSpots.set(key, nationalForestCell(hx + dx, hz + dz));
        if (performance.now() - slice > 8) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          slice = performance.now();
        }
      }
    },
    update(near, mid = new Map(), localPosition) {
      if (disposed) return;
      const wanted = new Map<string, { cell: ResidentCell; tier: Tier }>(), far = new Map<string, ResidentCell>();
      if (localPosition) {
        const hx = Math.floor((localPosition.x + origin.x) / SIZE), hz = Math.floor((localPosition.z + origin.z) / SIZE);
        for (let dz = -farReach; dz <= farReach; dz++) for (let dx = -farReach; dx <= farReach; dx++)
          far.set(`${hx + dx}:${hz + dz}`, { ix: hx + dx, iz: hz + dz });
      }
      // On low quality only the cells round the hero hold modelled trees; the middle ring is cards too.
      for (const [key, cell] of mid) if (low) far.set(key, cell); else { wanted.set(key, { cell, tier: 'mid' }); far.delete(key); }
      for (const [key, cell] of near) { wanted.set(key, { cell, tier: 'near' }); far.delete(key); }
      for (const [key, chunk] of chunks) if (!wanted.has(key)) { destroyChunk(chunk); chunks.delete(key); }
      for (const [key, entry] of wanted) {
        const old = chunks.get(key);
        if (old?.tier === entry.tier) continue;
        const spots = old?.spots ?? farSpots.get(key) ?? nationalForestCell(entry.cell.ix, entry.cell.iz);
        if (old) destroyChunk(old);
        chunks.set(key, build(entry.cell.ix, entry.cell.iz, entry.tier, spots));
      }
      // Distant cells are planted a few at a time.
      let budget = 3;
      for (const key of farSpots.keys()) if (!far.has(key)) farSpots.delete(key);
      const members = new Map<string, string[]>();
      for (const [key, cell] of far) {
        if (!farSpots.has(key)) { if (budget-- <= 0) continue; farSpots.set(key, chunks.get(key)?.spots ?? nationalForestCell(cell.ix, cell.iz)); }
        const block = `${Math.floor(cell.ix / BLOCK)}:${Math.floor(cell.iz / BLOCK)}`, list = members.get(block);
        if (list) list.push(key); else members.set(block, [key]);
      }
      for (const [key, block] of blocks) if (!members.has(key)) { destroyChunk(block.chunk); blocks.delete(key); }
      for (const [key, cells] of members) {
        const signature = cells.join(' '), old = blocks.get(key);
        if (old?.signature === signature) continue;
        if (old) destroyChunk(old.chunk);
        const [bx, bz] = key.split(':').map(Number);
        blocks.set(key, { signature, chunk: build((bx! + 0.5) * BLOCK - 0.5, (bz! + 0.5) * BLOCK - 0.5, 'far', cells.flatMap(cell => farSpots.get(cell)!)) });
      }
      stats.cells = 0; stats.stems = 0; stats.far = 0;
      for (const chunk of chunks.values()) {
        if (chunk.spots.length) stats.cells++;
        stats.stems += chunk.spots.length;
        if (!world || chunk.tier !== 'near' || !localPosition) continue;
        for (const spot of chunk.spots) {
          const solid = COLLIDER[spot.kind];
          if (!solid) continue;
          const old = colliders.get(spot.id);
          const within = Math.hypot(localPosition.x + origin.x - spot.x, localPosition.z + origin.z - spot.z) < 80;
          if (within && !old) {
            const height = solid[0] * spot.scale, radius = solid[1] * spot.scale;
            colliders.set(spot.id, world.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius)
              .setTranslation(spot.x - origin.x, spot.y - origin.y + height / 2, spot.z - origin.z)));
          } else if (old && !within) { world.removeCollider(old, false); colliders.delete(spot.id); }
        }
      }
      for (const spots of farSpots.values()) { if (spots.length) stats.cells++; stats.stems += spots.length; stats.far += spots.length; }
      stats.colliders = colliders.size;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const chunk of chunks.values()) destroyChunk(chunk);
      for (const block of blocks.values()) destroyChunk(block.chunk);
      chunks.clear(); blocks.clear(); farSpots.clear(); group.removeFromParent(); disposeResources();
      stats.cells = 0; stats.stems = 0; stats.colliders = 0; stats.far = 0;
    },
  };
}
