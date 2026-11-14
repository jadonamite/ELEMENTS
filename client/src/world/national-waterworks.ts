import RAPIER from '@dimforge/rapier3d-compat';
import { Group, Mesh, type Material } from 'three';
import { LEGACY_SINDR_ORIGIN as ORIGIN, type Point3 } from '../../../shared/src/world/ignis/coordinates.js';
import { riverAt } from '../../../shared/src/world/ignis/ground.js';
import { NATIONAL_WATERWORKS, PUBLIC_CROSSINGS, waterworkCells,
  type NationalWaterwork, type PublicCrossing, type PublicWaterway } from '../../../shared/src/world/ignis/waterworks.js';
import { WorldBuilder, type Bucket } from './builder.js';
import { addShells } from './town-physics.js';

interface Resident { group: Group; colliders: RAPIER.Collider[]; builder: WorldBuilder }

/** Near-cell ownership keeps the same waterwork's drawing and collision resident together. */
export class NationalWaterworksStream {
  readonly group = new Group();
  private readonly resident = new Map<string, Resident>();
  private readonly owners = NATIONAL_WATERWORKS.map(work => ({ work, cells: waterworkCells(work) }));

  constructor(private readonly world: RAPIER.World, private readonly material: (bucket: Bucket) => Material,
    private readonly low: boolean) { this.group.name = 'ignis-waterworks'; }

  update(cells: ReadonlyMap<string, unknown>): void {
    for (const owner of this.owners) {
      const wanted = owner.cells.some(key => cells.has(key));
      if (wanted && !this.resident.has(owner.work.id)) this.load(owner.work);
      if (!wanted) this.unload(owner.work.id);
    }
  }

  private load(work: NationalWaterwork): void {
    const builder = new WorldBuilder({ low: this.low });
    buildNationalWaterwork(builder, work);
    const group = builder.build(this.material);
    group.name = `ignis:waterworks:${work.id}`;
    const colliders = builder.colliders.map(c => this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z)
        .setRotation(c.q ?? { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }),
    ));
    colliders.push(...addShells(this.world, builder.shells));
    this.group.add(group);
    this.resident.set(work.id, { group, colliders, builder });
  }

  private unload(id: string): void {
    const content = this.resident.get(id);
    if (!content) return;
    for (const collider of content.colliders) this.world.removeCollider(collider, false);
    content.group.removeFromParent();
    content.group.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    this.resident.delete(id);
  }

  surfaceAt(x: number, y: number, z: number) {
    for (const content of this.resident.values()) {
      const surface = content.builder.treads.at(x, y, z);
      if (surface) return surface;
    }
    return undefined;
  }
  get places(): readonly string[] { return [...this.resident.keys()]; }
  dispose(): void { for (const id of [...this.resident.keys()]) this.unload(id); this.group.removeFromParent(); }
}

const local = (p: Point3): Point3 => ({ x: p.x - ORIGIN.x, y: p.y - ORIGIN.y, z: p.z - ORIGIN.z });

/** A sloping slab with its upper face exactly on the surveyed line, shared by drawing and physics. */
function slab(b: WorldBuilder, bucket: Bucket, a: Point3, c: Point3, width: number, thickness: number, solid = true): void {
  const length = Math.hypot(c.x - a.x, c.z - a.z), rise = c.y - a.y;
  const pitch = -Math.atan2(rise, length), cos = Math.cos(pitch);
  b.at((a.x + c.x) / 2, (a.z + c.z) / 2, Math.atan2(c.x - a.x, c.z - a.z), (a.y + c.y) / 2);
  b.box(bucket, 0, -thickness / (2 * cos), 0, width, thickness, Math.hypot(length, rise) + 0.04, { x: pitch });
  if (solid) b.solidTilted(0, -thickness / (2 * cos), 0, width, thickness, Math.hypot(length, rise) + 0.04, pitch);
  b.at(0, 0, 0);
}

/** Builds one manifest owner in the established town render frame. No private materials are allocated. */
export function buildNationalWaterwork(b: WorldBuilder, work: NationalWaterwork): void {
  if (work.kind === 'crossing') crossing(b, work.crossing);
  else channel(b, work.channel);
  b.at(0, 0, 0);
}

function channel(b: WorldBuilder, reach: PublicWaterway): void {
  for (let i = 1; i < reach.points.length; i++) {
    const a = reach.points[i - 1]!, c = reach.points[i]!;
    const pa = local({ x: a.x, z: a.z, y: a.surface }), pc = local({ x: c.x, z: c.z, y: c.surface });
    const length = Math.hypot(pc.x - pa.x, pc.z - pa.z), nx = (pc.z - pa.z) / length, nz = -(pc.x - pa.x) / length;
    slab(b, 'fresh_water', pa, pc, reach.width, 0.02, false);
    slab(b, 'basalt_cobblestone', { ...pa, y: a.bed - ORIGIN.y }, { ...pc, y: c.bed - ORIGIN.y }, reach.width, 0.35);
    for (const side of [-1, 1]) {
      const edge = side * (reach.width / 2 + 0.4);
      // Short wall bays follow both bank and bed profiles without hidden full-channel blockers.
      const steps = Math.ceil(length / 4);
      for (let j = 0; j < steps; j++) {
        const t = (j + 0.5) / steps, bed = a.bed + (c.bed - a.bed) * t - ORIGIN.y;
        const bank = a.bank + (c.bank - a.bank) * t - ORIGIN.y;
        b.at(pa.x + (pc.x - pa.x) * t + nx * edge, pa.z + (pc.z - pa.z) * t + nz * edge,
          Math.atan2(pc.x - pa.x, pc.z - pa.z));
        const height = bank - bed + Math.abs(c.bank - a.bank) / steps + 0.4;
        b.box('ashlar_stone_blocks', 0, (bank + bed) / 2 - 0.2, 0, 0.8, height, length / steps + 0.06);
        b.solid(0, (bank + bed) / 2 - 0.2, 0, 0.8, height, length / steps + 0.06);
      }
      const offset = side * (reach.width / 2 + 2);
      const wa = { x: pa.x + nx * offset, z: pa.z + nz * offset, y: a.bank - ORIGIN.y };
      const wc = { x: pc.x + nx * offset, z: pc.z + nz * offset, y: c.bank - ORIGIN.y };
      // Falls have protected maintenance ledges; their continuous overflow is not a walking ramp.
      if (Math.abs(c.bank - a.bank) / length <= 0.18) slab(b, 'worn_flagstones', wa, wc, 3.2, 0.35);
      // Rails are split around the public bridge approaches, rather than blocking their landings.
      const railSteps = Math.ceil(length / 2);
      for (let j = 0; j < railSteps; j++) {
        const t0 = j / railSteps, t1 = (j + 1) / railSteps, tm = (t0 + t1) / 2;
        const x = a.x + (c.x - a.x) * tm + nx * side * (reach.width / 2 + 0.65);
        const z = a.z + (c.z - a.z) * tm + nz * side * (reach.width / 2 + 0.65);
        if (PUBLIC_CROSSINGS.some(br => {
          if (br.river) return false;
          const dx = br.to.x - br.from.x, dz = br.to.z - br.from.z, l = Math.hypot(dx, dz);
          const along = ((x - br.from.x) * dx + (z - br.from.z) * dz) / l;
          return along >= -4 && along <= l + 4 && Math.abs((x - br.from.x) * dz - (z - br.from.z) * dx) / l < br.clear / 2 + 2;
        })) continue;
        const rail = (t: number): Point3 => ({
          x: pa.x + (pc.x - pa.x) * t + nx * side * (reach.width / 2 + 0.65),
          z: pa.z + (pc.z - pa.z) * t + nz * side * (reach.width / 2 + 0.65),
          y: a.bank + (c.bank - a.bank) * t - ORIGIN.y + 1.1,
        });
        slab(b, 'pale_stone', rail(t0), rail(t1), 0.35, 1.1);
      }
    }
  }
}

function crossing(b: WorldBuilder, spec: PublicCrossing): void {
  const a = local(spec.from), c = local(spec.to), length = Math.hypot(c.x - a.x, c.z - a.z);
  const nx = (c.z - a.z) / length, nz = -(c.x - a.x) / length;
  // The port's profile exactly meets the two existing road ends. The waterway below remains open.
  slab(b, 'ashlar_stone_blocks', a, c, spec.clear + 0.8, 0.55);
  slab(b, 'worn_flagstones', { ...a, y: a.y + 0.02 }, { ...c, y: c.y + 0.02 }, spec.clear, 0.04, false);
  for (const side of [-1, 1]) {
    const offset = side * (spec.clear / 2 + 0.25);
    slab(b, 'pale_stone', { x: a.x + nx * offset, z: a.z + nz * offset, y: a.y + 1.2 },
      { x: c.x + nx * offset, z: c.z + nz * offset, y: c.y + 1.2 }, 0.38, 1.2);
  }
  const supports = spec.river ? Math.ceil(length / 24) : 1;
  for (let i = 0; i <= supports; i++) {
    const t = i / supports, x = spec.from.x + (spec.to.x - spec.from.x) * t;
    const z = spec.from.z + (spec.to.z - spec.from.z) * t, deck = spec.from.y + (spec.to.y - spec.from.y) * t;
    const river = riverAt(x, z);
    if (spec.river && i > 0 && i < supports && river.distance < 18) continue;
    const bed = spec.river ? Math.min(deck - 1, river.water - 2) : deck - 4;
    b.at(x - ORIGIN.x, z - ORIGIN.z, Math.atan2(c.x - a.x, c.z - a.z));
    const height = deck - 0.55 - bed;
    b.box('basalt_rock_face', 0, bed + height / 2 - ORIGIN.y, 0, spec.clear + 0.8, height, i === 0 || i === supports ? 3 : 1.8);
    b.solid(0, bed + height / 2 - ORIGIN.y, 0, spec.clear + 0.8, height, i === 0 || i === supports ? 3 : 1.8);
  }
  b.at(0, 0, 0);
}
