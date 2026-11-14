import RAPIER from '@dimforge/rapier3d-compat';
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, type Material } from 'three';
import { IGNIS, LEGACY_SINDR_ORIGIN, type Point3 } from '../../../shared/src/world/ignis/coordinates.js';
import { groundHeight } from '../../../shared/src/world/ignis/ground.js';
import { WorldBuilder, seeded, type Bucket } from './builder.js';
import { addShells } from './town-physics.js';

/** This workplace is separate from Cinderpit's mine and settlement. */
export const NATIONAL_QUARRY = { id: 'ignis:quarry:basalt', x: 10100, z: 8100 } as const;

export interface NationalQuarryOptions {
  world: RAPIER.World;
  /** Materials remain owned by the caller. */
  material: (bucket: Bucket) => Material;
  low: boolean;
  origin?: Point3;
  /** Nation-global ground heights; defaults to the shared terrain sampler. */
  height?: (x: number, z: number) => number;
}

interface Resident { group: Group; builder: WorldBuilder; colliders: RAPIER.Collider[] }
const BOUNDS = { x0: -76, x1: 76, z0: -72, z1: 300 } as const;
const STEP = 2;

function disposeGeometry(group: Group): void {
  group.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
}

/** Quarry geometry and physics share the lifetime of overlapping near terrain cells. */
export class NationalQuarryStream {
  readonly group = new Group();
  private readonly origin: Point3;
  private readonly height: (x: number, z: number) => number;
  private readonly cells: string[] = [];
  private resident: Resident | null = null;
  private disposed = false;

  constructor(private readonly options: NationalQuarryOptions) {
    this.origin = { ...(options.origin ?? LEGACY_SINDR_ORIGIN) };
    this.height = options.height ?? groundHeight;
    this.group.name = NATIONAL_QUARRY.id;
    for (let ix = Math.floor((NATIONAL_QUARRY.x + BOUNDS.x0) / IGNIS.cellSize);
      ix <= Math.floor((NATIONAL_QUARRY.x + BOUNDS.x1) / IGNIS.cellSize); ix++) {
      for (let iz = Math.floor((NATIONAL_QUARRY.z + BOUNDS.z0) / IGNIS.cellSize);
        iz <= Math.floor((NATIONAL_QUARRY.z + BOUNDS.z1) / IGNIS.cellSize); iz++) this.cells.push(`${ix}:${iz}`);
    }
  }

  update(near: ReadonlyMap<string, unknown>): void {
    if (this.disposed) return;
    if (this.cells.some(key => near.has(key))) {
      if (!this.resident) this.load();
    } else this.unload();
  }

  surfaceAt(x: number, y: number, z: number) { return this.resident?.builder.treads.at(x, y, z); }
  get loaded(): boolean { return this.resident !== null; }
  get colliderCount(): number { return this.resident?.colliders.length ?? 0; }

  private load(): void {
    const b = new WorldBuilder({ low: this.options.low });
    buildQuarry(b, this.origin, this.height);
    const group = b.build(this.options.material);
    group.name = `${NATIONAL_QUARRY.id}:works`;
    const colliders: RAPIER.Collider[] = [];
    try {
      for (const c of b.colliders) colliders.push(this.options.world.createCollider(
        RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z)
          .setRotation(c.q ?? { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }),
      ));
      // Add one shell at a time so partial construction can be unwound.
      for (const shell of b.shells) colliders.push(...addShells(this.options.world, [shell]));
      this.group.add(group);
      this.resident = { group, builder: b, colliders };
    } catch (error) {
      for (const collider of colliders) this.options.world.removeCollider(collider, false);
      disposeGeometry(group);
      throw error;
    }
  }

  private unload(): void {
    if (!this.resident) return;
    for (const collider of this.resident.colliders) this.options.world.removeCollider(collider, false);
    this.resident.group.removeFromParent();
    disposeGeometry(this.resident.group);
    this.resident = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unload(); this.group.removeFromParent();
  }
}

function buildQuarry(b: WorldBuilder, origin: Point3, height: (x: number, z: number) => number): void {
  const terrain = (x: number, z: number): number => height(NATIONAL_QUARRY.x + x, NATIONAL_QUARRY.z + z);
  // The worked outcrop sits above unmodified terrain; it never excavates through the heightfield.
  let floor = -Infinity, base = Infinity;
  for (let x = -76; x <= 76; x += STEP) for (let z = -72; z <= 40; z += STEP) {
    const y = terrain(x, z);
    floor = Math.max(floor, y + 0.4); base = Math.min(base, y - 1);
  }
  b.at(NATIONAL_QUARRY.x - origin.x, NATIONAL_QUARRY.z - origin.z, 0, floor - origin.y);
  const block = (bucket: Bucket, x: number, y: number, z: number, w: number, h: number, d: number): void => {
    b.box(bucket, x, y, z, w, h, d); b.solid(x, y, z, w, h, d);
  };
  const footing = floor - base;
  block('basalt_rock_face', 0, -footing / 2, -16, 152, footing, 112);
  b.box('packed_dirt_road', 0, 0.015, 1, 126, 0.03, 76);
  b.box('worn_flagstones', -35, 0.025, 16, 40, 0.05, 32);

  // Three receding cut faces leave six-metre benches above the extraction floor.
  for (let tier = 0; tier < 3; tier++) {
    const front = -24 - tier * 12, back = -70, top = (tier + 1) * 4;
    block('basalt_rock_face', 0, top / 2, (front + back) / 2, 124 - tier * 10, top, front - back);
    // Shallow saw seams break the face without opening gaps in its physical backing.
    for (let x = -52 + tier * 5; x <= 52 - tier * 5; x += 8) {
      b.box('blackened_rusted_iron', x, top - 1.9, front + 0.015, 0.035, 3.6, 0.03);
    }
    const edge = front - 1.5;
    rail(b, -54 + tier * 5, 54 - tier * 5, edge, top);
  }
  // Continuous side fencing separates the yard from the retained edges of the working platform.
  for (const x of [-74, 74]) b.inside(x, -16, Math.PI / 2, 0, () => rail(b, -54, 54, 0, 0));
  rail(b, -74, 74, -71, 12);
  rail(b, -74, -9, 39, 0); rail(b, 9, 74, 39, 0);

  // Sorting bays open south, with a broad carrying aisle to their tables and the cart court.
  const rand = seeded(0x1a615);
  for (const x of [-40, -21, -2]) {
    for (const side of [-1, 1]) block('ashlar_stone_blocks', x + side * 6, 0.6, -9, 0.4, 1.2, 11);
    block('ashlar_stone_blocks', x, 0.6, -14.5, 12, 1.2, 0.4);
    for (let i = 0; i < 5; i++) {
      const h = 0.6 + rand() * 0.55;
      block('basalt_rock_face', x - 4 + i * 2, h / 2, -10 + rand() * 3, 1.5, h, 2);
    }
    block('raw_timber', x, 0.9, 5, 10, 0.18, 1.5);
    for (const dx of [-4, 4]) block('charred_timber_beams', x + dx, 0.4, 5, 0.3, 0.8, 1.2);
  }
  // Open-sided rest and tool shelter stands clear of the sorting and cart lanes.
  for (const x of [-54, -36]) for (const z of [20, 31]) block('charred_timber_beams', x, 1.7, z, 0.35, 3.4, 0.35);
  block('roof_tile_charcoal', -45, 3.6, 25.5, 20, 0.3, 13);
  block('raw_timber', -46, 0.45, 29, 12, 0.9, 1.2);
  for (const x of [17, 31]) b.box('worn_flagstones', x, 0.025, 15, 9, 0.05, 24);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
    block('basalt_rock_face', 17 + col * 4, 0.6, -11 + row * 4, 3, 1.2, 3);
  }

  // Silt is contained on the east side. No water source or river connection is implied.
  for (const z of [7, 23]) {
    block('ash_cinder_ground', 62, 0.15, z, 14, 0.3, 10);
    for (const x of [54.5, 69.5]) block('ashlar_stone_blocks', x, 0.65, z, 0.5, 1.3, 12);
    for (const dz of [-6, 6]) block('ashlar_stone_blocks', 62, 0.65, z + dz, 15.5, 1.3, 0.5);
  }
  // Covered drinking-water casks stay on the western rest pad, away from the silt bays.
  for (const x of [-60, -57]) {
    b.cylinder('raw_timber', x, 0.7, 29, 0.65, 0.65, 1.4, 12);
    b.box('raw_timber', x, 1.43, 29, 1.4, 0.08, 1.4);
    b.solid(x, 0.72, 29, 1.4, 1.44, 1.4);
  }

  // A sampled apron joins the platform to the existing southern ground with matching mesh collision.
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const columns = 8, rows = (BOUNDS.z1 - 40) / STEP;
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const z = 40 + row * STEP, x = -8 + col * 2;
    const natural = terrain(x, z) - floor;
    // The first 208 m can descend at 1:8; the final 52 m blend onto the exact terrain samples.
    const blend = Math.min(1, Math.max(0, (z - 248) / 52));
    const raised = Math.max(natural + 0.04, -(z - 40) / 8);
    const y = row === 0 ? 0 : raised * (1 - blend) + (natural + 0.04) * blend;
    positions.push(x, y, z); uv.push(x / 4, z / 4);
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = row * (columns + 1) + col, c = a + columns + 1;
    indices.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(uv), 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  b.add('packed_dirt_road', geometry, new Matrix4());
  geometry.dispose();
  b.solidSurface(positions, indices);
  // Guard exposed approach edges until the deck has returned to the surrounding ground.
  for (let row = 0; row < rows; row++) for (const col of [0, columns]) {
    const a = (row * (columns + 1) + col) * 3, c = a + (columns + 1) * 3;
    const x = positions[a]!, z = positions[a + 2]!, y = positions[a + 1]!;
    const nextY = positions[c + 1]!;
    if (Math.max(y - (terrain(x, z) - floor), nextY - (terrain(x, z + STEP) - floor)) < 0.6) continue;
    const pitch = -Math.atan2(nextY - y, STEP), length = Math.hypot(STEP, nextY - y);
    for (const offset of [0.5, 1.1]) b.box('charred_timber_beams', x, (y + nextY) / 2 + offset,
      z + STEP / 2, 0.18, 0.15, length, { x: pitch });
    b.box('charred_timber_beams', x, y + 0.65, z, 0.18, 1.3, 0.18);
    b.solidTilted(x, (y + nextY) / 2 + 0.65, z + STEP / 2, 0.22, 1.3, length, pitch);
  }
  b.at(0, 0, 0);
}

function rail(b: WorldBuilder, from: number, to: number, z: number, floor: number): void {
  for (let x = from; x <= to; x += 4) b.box('charred_timber_beams', x, floor + 0.65, z, 0.18, 1.3, 0.18);
  for (const y of [0.5, 1.1]) b.box('charred_timber_beams', (from + to) / 2, floor + y, z, to - from, 0.15, 0.18);
  b.solid((from + to) / 2, floor + 0.65, z, to - from, 1.3, 0.22);
}
