import RAPIER from '@dimforge/rapier3d-compat';
import { Group, InstancedBufferGeometry, InstancedMesh, Mesh, Points, type Material, type LOD } from 'three';
import { LEGACY_SINDR_ORIGIN as ORIGIN } from '../../../shared/src/world/ignis/coordinates.js';
import { groundHeight } from '../../../shared/src/world/ignis/ground.js';
import {
  ROCK_HOUSE_GROUPS,
  rockGroupCells,
  type RockHouseGroup,
} from '../../../shared/src/world/ignis/rock-houses.js';
import { SETTLEMENT_PRECINCTS, settlementCells, type SettlementPrecinct } from '../../../shared/src/world/ignis/settlements.js';
import { SETTLEMENT_SHRINE, shrineOfPrecinct } from '../../../shared/src/net/places.js';
import { WorldBuilder, seeded, type Bucket, type Emitter } from './builder.js';
import { createEmbers, createFires } from './effects.js';
import { buildRockGroupLOD } from './rock-houses.js';
import { townHouse } from './style-kit.js';
import { addShells } from './town-physics.js';

interface Resident {
  group: Group;
  colliders: RAPIER.Collider[];
  builder: WorldBuilder;
  lit: boolean;
  extraBuilders?: WorldBuilder[] | undefined;
}

type StreamOwner =
  | { kind: 'precinct'; id: string; place: SettlementPrecinct; cells: readonly string[] }
  | { kind: 'rock-group'; id: string; group: RockHouseGroup; cells: readonly string[] };

/** Places a settlement's scanned props (the shrine's brazier) from the zone's shared models. */
export type SettlementProps = (placements: WorldBuilder['props'], into: Group) => Promise<void>;

/** Where a loaded settlement's brazier lights go: the zone's pool of nearest lights. */
export interface SettlementLights { add(emitters: readonly Emitter[]): void; remove(emitters: readonly Emitter[]): void }

/** Inhabited precincts follow the same nation-global cell ownership as near terrain collision. */
export class SettlementStream {
  readonly group = new Group();
  private readonly resident = new Map<string, Resident>();
  private readonly owners: StreamOwner[] = [
    ...SETTLEMENT_PRECINCTS.map(place => ({
      kind: 'precinct' as const,
      id: place.id,
      place,
      cells: settlementCells(place),
    })),
    ...ROCK_HOUSE_GROUPS.filter(g => g.id === 'mine-hamlet').map(group => ({
      kind: 'rock-group' as const,
      id: group.id,
      group,
      cells: rockGroupCells(group),
    })),
  ];
  private lit: ReadonlySet<string> = new Set();

  constructor(
    private readonly world: RAPIER.World,
    private readonly material: (bucket: Bucket) => Material,
    private readonly low: boolean,
    private readonly lights: SettlementLights,
    private readonly props: SettlementProps = async () => {},
  ) {
    this.group.name = 'ignis-settlements';
  }

  /** The shrines the player has lit; a loaded settlement whose shrine changed is rebuilt with its fire. */
  setLit(lit: ReadonlySet<string>): void {
    this.lit = new Set(lit);
    for (const owner of this.owners) {
      if (owner.kind !== 'precinct') continue;
      const content = this.resident.get(owner.place.id);
      if (content && content.lit !== this.shrineLit(owner.place)) {
        this.unload(owner.place.id);
        this.load(owner.place);
      }
    }
  }

  private shrineLit(place: SettlementPrecinct): boolean {
    const shrine = shrineOfPrecinct(place.id);
    return shrine !== undefined && this.lit.has(shrine.id);
  }

  update(cells: ReadonlyMap<string, unknown>): void {
    for (const owner of this.owners) {
      const wanted = owner.cells.some(key => cells.has(key));
      if (wanted && !this.resident.has(owner.id)) {
        if (owner.kind === 'precinct') this.load(owner.place);
        else this.loadRockGroup(owner.group);
      }
      if (!wanted) this.unload(owner.id);
    }
  }

  private load(place: SettlementPrecinct): void {
    const builder = new WorldBuilder({ low: this.low });
    const lit = this.shrineLit(place);
    let cinderpitLod: LOD | null = null;
    let cinderpitRockBuilder: WorldBuilder | null = null;

    if (place.id === 'ignis:settlement:cinderpit') {
      const cinderpitGroup = ROCK_HOUSE_GROUPS.find(g => g.id === 'cinderpit');
      if (cinderpitGroup) {
        const built = buildRockGroupLOD(cinderpitGroup, this.low, this.material);
        cinderpitLod = built.lod;
        cinderpitRockBuilder = built.builder0;
      }
    }

    buildSettlement(builder, place, lit);
    const group = builder.build(this.material);
    group.name = place.id;

    if (cinderpitLod && cinderpitRockBuilder) {
      group.add(cinderpitLod);
      builder.colliders.push(...cinderpitRockBuilder.colliders);
      builder.emitters.push(...cinderpitRockBuilder.emitters);
      builder.shells.push(...cinderpitRockBuilder.shells);
    }

    if (builder.fires.length) group.add(createFires(builder.fires), createEmbers(builder.embers, this.low ? 6 : 14));
    this.lights.add(builder.emitters);
    // Prop models are shared with the town, so they sit apart and are never disposed with the settlement.
    const props = new Group();
    props.name = 'props';
    group.add(props);
    void this.props(builder.props, props);
    const colliders = builder.colliders.map(c => this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z)
        .setRotation(c.q ?? { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }),
    ));
    colliders.push(...addShells(this.world, builder.shells));
    this.group.add(group);
    this.resident.set(place.id, {
      group,
      colliders,
      builder,
      lit,
      extraBuilders: cinderpitRockBuilder ? [cinderpitRockBuilder] : undefined,
    });
  }

  private loadRockGroup(group: RockHouseGroup): void {
    const { lod, builder0 } = buildRockGroupLOD(group, this.low, this.material);
    const container = new Group();
    container.name = group.id;
    container.add(lod);
    this.lights.add(builder0.emitters);
    const colliders = builder0.colliders.map(c => this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z)
        .setRotation(c.q ?? { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }),
    ));
    colliders.push(...addShells(this.world, builder0.shells));
    this.group.add(container);
    this.resident.set(group.id, { group: container, colliders, builder: builder0, lit: false });
  }

  private unload(id: string): void {
    const content = this.resident.get(id);
    if (!content) return;
    for (const collider of content.colliders) this.world.removeCollider(collider, false);
    this.lights.remove(content.builder.emitters);
    if (content.extraBuilders) {
      for (const b of content.extraBuilders) this.lights.remove(b.emitters);
    }
    content.group.removeFromParent();
    const props = content.group.getObjectByName('props');
    // Release each instance buffer; the shared model geometry stays for the next load.
    props?.traverse(object => { if (object instanceof InstancedMesh) object.dispose(); });
    props?.removeFromParent();
    content.group.traverse(object => {
      if (object instanceof Mesh || object instanceof Points) object.geometry.dispose();
      // Fire and ember materials are the settlement's own; surfaces belong to the zone's shared library.
      if ((object instanceof Mesh && object.geometry instanceof InstancedBufferGeometry) || object instanceof Points) (object.material as Material).dispose();
    });
    // Materials belong to the zone's shared surface library.
    this.resident.delete(id);
  }

  surfaceAt(x: number, y: number, z: number) {
    for (const content of this.resident.values()) {
      const surface = content.builder.treads.at(x, y, z);
      if (surface) return surface;
      if (content.extraBuilders) {
        for (const b of content.extraBuilders) {
          const s = b.treads.at(x, y, z);
          if (s) return s;
        }
      }
    }
    return undefined;
  }

  get places(): readonly string[] { return [...this.resident.keys()]; }
  dispose(): void { for (const id of [...this.resident.keys()]) this.unload(id); this.group.removeFromParent(); }
}

function buildSettlement(b: WorldBuilder, place: SettlementPrecinct, lit = false): void {
  const x = place.x - ORIGIN.x, z = place.z - ORIGIN.z, y = place.height - ORIGIN.y;
  const rand = seeded(place.x + place.z + place.height);
  const frame = (): void => { b.at(x, z, 0, y); };
  frame();
  // A six-metre lane joins every doorstep to the yard and the surveyed road end.
  b.box('packed_dirt_road', 0, 0.035, 0, 6, 0.05, 160);
  b.box('packed_dirt_road', 0, 0.035, 38, 112, 0.05, 8);
  for (const h of place.houses) {
    townHouse(b, { x: x + h.x, z: z + h.z, y, yaw: h.yaw, w: h.w, d: h.d,
      floors: 1, rank: 'common', footing: 1.2, door: 0, weeds: false,
      room: { x: 0, w: 4, d: 4.5, kind: 'service' } }, rand);
    frame();
    const side = Math.sign(h.x), from = side * 3, to = h.x - side * h.d / 2;
    b.box('worn_flagstones', (from + to) / 2, 0.025, h.z, Math.abs(to - from), 0.05, 3);
  }
  if (place.id === 'ignis:settlement:cinderpit') {
    const cinderpitGroup = ROCK_HOUSE_GROUPS.find(g => g.id === 'cinderpit');
    if (cinderpitGroup && cinderpitGroup.lane.length > 1) {
      for (let i = 0; i < cinderpitGroup.lane.length - 1; i++) {
        const p0 = cinderpitGroup.lane[i]!;
        const p1 = cinderpitGroup.lane[i + 1]!;
        const dx = p1.x - p0.x;
        const dz = p1.z - p0.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.1) continue;
        const yaw = Math.atan2(dx, dz);
        const midX = (p0.x + p1.x) / 2 - ORIGIN.x;
        const midZ = (p0.z + p1.z) / 2 - ORIGIN.z;
        const midY = (groundHeight(p0.x, p0.z) + groundHeight(p1.x, p1.z)) / 2 - ORIGIN.y;
        b.inside(midX, midZ, yaw, midY + 0.035, () => {
          b.box('packed_dirt_road', 0, 0, 0, 3.5, 0.05, len);
        });
      }
    }
  }
  frame();
  // Walk-in repair room at the end of the lane, with level ground-floor access.
  townHouse(b, { x, z: z - 69, y, yaw: 0, w: 14, d: 11, floors: 1, rank: 'common',
    weeds: false, door: 0, room: { x: 0, w: 6, d: 6, kind: 'service' } }, rand);
  frame();
  buildSettlementShrine(b, lit);
  frame();
  b.box('worn_flagstones', 0, 0.025, -59, 6, 0.05, 9);
  switch (place.industry) {
    case 'mine': mineWorks(b); break;
    case 'forestry': forestryWorks(b); break;
    case 'fishing': fishingWorks(b); break;
    case 'farming': farmingWorks(b); break;
    case 'port': portWorks(b); break;
    case 'station': stationWorks(b); break;
    case 'fort': fortWorks(b); break;
  }
  b.at(0, 0, 0);
}

/**
 * A settlement's shrine, beside the repair room's approach: a stone ring and raised plinth carrying an iron brazier.
 * Cold ash when unlit; glowing coals, flame and a warm light when lit.
 */
function buildSettlementShrine(b: WorldBuilder, lit: boolean): void {
  const { x, z } = SETTLEMENT_SHRINE;
  b.cylinder('ashlar_stone_blocks', x, 0.12, z, 2.8, 3.0, 0.24, 16);
  b.cylinder('basalt_rock_face', x, 0.35, z, 1.4, 1.5, 0.3, 16);
  b.prop('iron_brazier', x, z, 0, 1.1, 0.5);
  b.solid(x, 0.7, z, 1.8, 1.4, 1.8);
  if (lit) {
    b.cylinder('lava', x, 1.32, z, 0.48, 0.48, 0.04, 16);
    b.fire(x, 1.34, z, 0.9);
    b.light(x, 2.4, z, 0xff7428, 28, 14, 0.3);
  } else {
    b.cylinder('ash_cinder_ground', x, 1.28, z, 0.48, 0.48, 0.04, 16);
  }
}

/** Open sorting bays and hoist sit north of the village; the quarry is a separate atlas workplace. */
function mineWorks(b: WorldBuilder): void {
  b.box('packed_dirt_road', 0, 0.035, 60, 100, 0.05, 42);
  for (const x of [-36, -22, -8]) {
    for (const side of [-1, 1]) {
      b.box('basalt_rock_face', x + side * 4, 0.65, 65, 0.5, 1.3, 9);
      b.solid(x + side * 4, 0.65, 65, 0.5, 1.3, 9);
    }
    b.box('basalt_rock_face', x, 0.65, 69.5, 8, 1.3, 0.5);
    b.solid(x, 0.65, 69.5, 8, 1.3, 0.5);
    b.cylinder('basalt_rock_face', x, 0.45, 66, 2.2, 3, 0.9, 9);
    b.solid(x, 0.45, 66, 5, 0.9, 5);
    bench(b, x, 53, 6);
  }
  // Timber headframe with an open loading aisle beneath, backed by a solid rock face.
  for (const x of [18, 30]) for (const z of [62, 74]) {
    b.box('charred_timber_beams', x, 5, z, 0.65, 10, 0.65);
    b.solid(x, 5, z, 0.65, 10, 0.65);
  }
  b.box('charred_timber_beams', 24, 9.5, 68, 13, 0.8, 13);
  b.solid(24, 9.5, 68, 13, 0.8, 13);
  b.box('blackened_rusted_iron', 24, 6.6, 68, 0.08, 5.4, 0.08);
  b.box('basalt_rock_face', 24, 1, 77, 15, 2, 1);
  b.solid(24, 1, 77, 15, 2, 1);
  // Cart siding has two clear standing bays beside the loading aisle.
  for (const x of [42, 48]) b.box('worn_flagstones', x, 0.04, 58, 4, 0.06, 26);
  // Separate settling basins contain tailings below their rims; no freshwater source is implied.
  for (const z of [5, 20]) {
    for (const x of [56, 68]) { b.box('ashlar_stone_blocks', x, 0.5, z, 0.5, 1, 10); b.solid(x, 0.5, z, 0.5, 1, 10); }
    for (const dz of [-5, 5]) { b.box('ashlar_stone_blocks', 62, 0.5, z + dz, 12, 1, 0.5); b.solid(62, 0.5, z + dz, 12, 1, 0.5); }
    b.box('ash_cinder_ground', 62, 0.2, z, 11, 0.4, 9);
    b.solid(62, 0.2, z, 11, 0.4, 9);
  }
  b.box('packed_dirt_road', 40, 0.035, 30, 8, 0.05, 56);
}

function forestryWorks(b: WorldBuilder): void {
  b.box('packed_dirt_road', 0, 0.035, 58, 112, 0.05, 36);
  for (const x of [-34, -18, -2]) {
    bench(b, x, 56, 9);
    // Sawn timber stacks leave a broad east-west carrying aisle.
    for (let row = 0; row < 3; row++) b.box('raw_timber', x, 0.2 + row * 0.25, 69, 10, 0.2, 4);
    b.solid(x, 0.5, 69, 10, 1, 4);
  }
  // Cool charcoal clamps sit apart from the timber stacks and the homes.
  for (const z of [0, 18]) {
    b.cylinder('cooled_lava_crust', -64, 0.9, z, 1.2, 4, 1.8, 12);
    b.solid(-64, 0.9, z, 6, 1.8, 6);
  }
  b.box('packed_dirt_road', -45, 0.035, 20, 6, 0.05, 42);
  b.box('packed_dirt_road', -54, 0.035, 0, 24, 0.05, 4);
  bench(b, 27, 56, 10);
  for (const x of [21, 33]) {
    b.box('charred_timber_beams', x, 1.8, 56, 0.25, 3.6, 0.25);
    b.solid(x, 1.8, 56, 0.25, 3.6, 0.25);
  }
  b.box('charred_timber_beams', 27, 3.5, 56, 12, 0.25, 0.25);
}

function bench(b: WorldBuilder, x: number, z: number, width: number): void {
  b.box('raw_timber', x, 0.95, z, width, 0.2, 1.4);
  for (const side of [-1, 1]) b.box('charred_timber_beams', x + side * (width / 2 - 0.5), 0.45, z, 0.25, 0.9, 1.1);
  b.solid(x, 0.55, z, width, 1.1, 1.4);
}


/** An open-sided working shelter keeps its carrying aisle clear of structural collision. */
function shelter(b: WorldBuilder, x: number, z: number, width: number, depth: number): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('charred_timber_beams', x + sx * width / 2, 1.8, z + sz * depth / 2, 0.3, 3.6, 0.3);
    b.solid(x + sx * width / 2, 1.8, z + sz * depth / 2, 0.3, 3.6, 0.3);
  }
  b.box('roof_tile_charcoal', x, 3.7, z, width + 1.2, 0.3, depth + 1.2);
  b.solid(x, 3.7, z, width + 1.2, 0.3, depth + 1.2);
}

function block(b: WorldBuilder, material: 'basalt_rock_face' | 'raw_timber' | 'ashlar_stone_blocks',
  x: number, y: number, z: number, w: number, h: number, d: number): void {
  b.box(material, x, y, z, w, h, d);
  b.solid(x, y, z, w, h, d);
}

function fishingWorks(b: WorldBuilder): void {
  b.box('packed_dirt_road', -50, 0.035, 38, 104, 0.05, 8);
  shelter(b, -53, 57, 20, 14);
  bench(b, -53, 59, 12);
  // Net-drying frames flank the route to the landing.
  for (const z of [12, 28]) {
    for (const x of [-75, -57]) block(b, 'raw_timber', x, 1.5, z, 0.2, 3, 0.2);
    b.box('raw_timber', -66, 2.8, z, 18, 0.15, 0.15);
    for (let x = -74; x <= -58; x += 1) b.box('charred_timber_beams', x, 1.9, z, 0.035, 1.8, 0.035);
    for (const y of [1.2, 1.8, 2.4]) b.box('charred_timber_beams', -66, y, z, 17, 0.035, 0.035);
  }
  // A collision-backed landing projects over the existing lake water; it does not fill its bed.
  block(b, 'raw_timber', -112, 0.15, 38, 76, 0.3, 5);
  block(b, 'raw_timber', -145, 0.15, 38, 10, 0.3, 24);
  for (const x of [-90, -115, -145]) for (const z of [35.8, 40.2]) block(b, 'raw_timber', x, -1.2, z, 0.3, 3, 0.3);
  // Maintenance benches face the springward path, apart from fish handling.
  shelter(b, 35, 57, 18, 12);
  bench(b, 35, 59, 10);
}

function farmingWorks(b: WorldBuilder): void {
  b.box('packed_dirt_road', 0, 0.035, 58, 110, 0.05, 40);
  // Raised grain stores are open along the yard and leave the central lane clear.
  for (const x of [-37, 36]) {
    shelter(b, x, 63, 22, 16);
    for (let i = 0; i < 5; i++) block(b, 'raw_timber', x - 8 + i * 4, 0.75, 68, 3, 1.5, 4);
  }
  for (const x of [-68, 63]) for (const z of [-24, -6, 12]) {
    block(b, 'ashlar_stone_blocks', x, 0.25, z, 14, 0.5, 11);
    // Recessed dry channels await the shared irrigation network.
    for (const side of [-1, 1]) block(b, 'ashlar_stone_blocks', x + side * 7.5, 0.35, z, 0.4, 0.7, 13);
    for (let row = -4; row <= 4; row += 2) b.box('moss', x, 0.52, z + row, 12, 0.04, 0.35);
  }
  shelter(b, -65, 48, 16, 12);
  block(b, 'basalt_rock_face', -65, 0.45, 48, 3, 0.9, 3);
  b.cylinder('pale_stone', -65, 1.05, 48, 1.6, 1.6, 0.3, 20);
  b.solid(-65, 1.05, 48, 3.2, 0.3, 3.2);
  bench(b, 0, 68, 12);
}

function portWorks(b: WorldBuilder): void {
  b.box('packed_dirt_road', 0, 0.035, 58, 110, 0.05, 40);
  for (const x of [-33, 29]) {
    shelter(b, x, 62, 24, 18);
    bench(b, x, 62, 16);
  }
  // Salt pans remain above the tidal water, with a carrying aisle between them.
  for (const x of [-66, -45]) for (const z of [-24, -3, 18]) {
    block(b, 'ashlar_stone_blocks', x, 0.15, z, 16, 0.3, 16);
    b.box('pale_stone', x, 0.32, z, 14, 0.04, 14);
    for (const side of [-1, 1]) block(b, 'ashlar_stone_blocks', x + side * 8, 0.35, z, 0.4, 0.7, 16);
  }
  // A stone quay runs east from the yard to deep water, with a cross head for mooring.
  block(b, 'ashlar_stone_blocks', 178, -1.4, 0, 200, 3, 7);
  block(b, 'ashlar_stone_blocks', 272, -1.4, 0, 12, 3, 44);
  for (const z of [-18, -6, 6, 18]) block(b, 'raw_timber', 276.5, 0.5, z, 0.5, 1, 0.5);
  b.box('packed_dirt_road', 80, 0.035, 0, 60, 0.05, 6);
  // Basalt columns stand in steps out of the beach north of the quay, tallest at the water.
  const rand = seeded(77);
  for (let i = 0; i < 9; i++) for (let j = 0; j < 14; j++) {
    const cx = 168 + j * 6.2 + (i % 2) * 3.1, cz = -34 - i * 5.4, out = j / 13, back = i / 8;
    const top = 1.5 + out * 9 * (0.45 + 0.55 * Math.sin(back * Math.PI)) + rand() * 2.2;
    b.cylinder('cooled_lava_crust', cx, top / 2 - 3.5, cz, 3.4, 3.5, top + 7, 6);
    b.solid(cx, top / 2 - 3.5, cz, 5.6, top + 7, 5.6);
  }
  // Freight shed is open to the yard; fish-drying racks have a separate approach.
  shelter(b, 65, 48, 20, 24);
  for (const z of [-20, -4, 12]) {
    for (const x of [55, 72]) block(b, 'raw_timber', x, 1.4, z, 0.25, 2.8, 0.25);
    b.box('raw_timber', 63.5, 2.6, z, 17, 0.15, 0.15);
    for (let x = 57; x <= 70; x += 2) b.box('charred_timber_beams', x, 1.8, z, 0.07, 1.2, 0.07);
  }
}

function stationWorks(b: WorldBuilder): void {
  b.box('packed_dirt_road', 0, 0.035, 57, 112, 0.05, 42);
  // Open caravan bays lead to the watering troughs and repair shelter.
  for (const x of [-36, -22, -8]) {
    for (const z of [48, 74]) block(b, 'raw_timber', x, 0.5, z, 0.25, 1, 0.25);
    b.box('worn_flagstones', x, 0.04, 61, 8, 0.06, 22);
  }
  for (const x of [27, 43]) {
    for (const side of [-1, 1]) block(b, 'ashlar_stone_blocks', x + side * 3, 0.5, 68, 0.5, 1, 10);
    for (const dz of [-5, 5]) block(b, 'ashlar_stone_blocks', x, 0.5, 68 + dz, 6, 1, 0.5);
    block(b, 'ashlar_stone_blocks', x, 0.1, 68, 5.5, 0.2, 9);
  }
  shelter(b, 57, 40, 20, 16);
  bench(b, 57, 42, 12);
  // Broken toll roof leaves its through aisle open.
  for (const x of [-7, 7]) block(b, 'basalt_rock_face', x, 2, 87, 1.2, 4, 1.2);
  b.box('charred_timber_beams', -3.5, 4.2, 87, 8, 0.4, 3);
}

function fortWorks(b: WorldBuilder): void {
  // A real twelve-metre opening faces the mapped western border.
  for (const z of [-52, 52]) {
    block(b, 'ashlar_stone_blocks', -80, 3, z, 2, 6, 92);
    block(b, 'ashlar_stone_blocks', -80, 4.5, z > 0 ? 8 : -8, 2, 3, 4);
  }
  block(b, 'ashlar_stone_blocks', -80, 7, 0, 4, 2, 24);
  for (const z of [-18, 18]) {
    block(b, 'basalt_rock_face', -80, 4, z, 10, 8, 10);
    block(b, 'ashlar_stone_blocks', -80, 8.25, z, 11, 0.5, 11);
  }
  // Inspection lanes meet the gate without crossing the barrack entrances.
  b.box('packed_dirt_road', -37, 0.035, 0, 86, 0.05, 12);
  b.box('packed_dirt_road', -44, 0.035, 38, 80, 0.05, 8);
  shelter(b, -47, 58, 26, 16);
  bench(b, -47, 61, 18);
  for (const x of [-62, -45, -28]) block(b, 'raw_timber', x, 0.9, 26, 0.2, 1.8, 0.2);
  // Eastern supply court and open drill space sit inside the national boundary.
  shelter(b, 45, 60, 24, 16);
  for (const x of [36, 46, 56]) block(b, 'raw_timber', x, 0.6, 65, 6, 1.2, 3);
}
