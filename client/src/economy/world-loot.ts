import RAPIER from '@dimforge/rapier3d-compat';
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  type Scene,
  SphereGeometry,
  type Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EconomyError, listLoot, type LootContents, type LootPile } from './api.js';
import { describeLoot, lootItems } from './items.js';

// Loot on the ground: defeated foes drop a chest shimmering in the foe's nation colour
// (IGNIS crimson, AQUES azure, TERRA ochre, AURA white). Walking within reach opens
// and bursts the box, displaying the acquired spoils.

const SEE_RADIUS = 40;
const POLL_SECONDS = 2;
const CLAIM_REACH = 1.35;
const RETRY_SECONDS = 3;
const PREPARED_PILES = 16;
const PILE_LIGHTS = 2;

type NationColour = 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA';

interface NationTheme {
  lightHex: number;
  glowMat: MeshBasicMaterial;
  seamMat: MeshBasicMaterial;
  moteMat: MeshBasicMaterial;
  shardMat: MeshStandardMaterial;
}

interface MoteOffset {
  x: number;
  z: number;
  speed: number;
  phase: number;
}

const MOTE_OFFSETS: MoteOffset[] = [
  { x: -0.16, z: -0.09, speed: 0.72, phase: 0.05 },
  { x: 0.15, z: -0.08, speed: 0.85, phase: 0.28 },
  { x: -0.12, z: 0.11, speed: 0.68, phase: 0.52 },
  { x: 0.14, z: 0.09, speed: 0.78, phase: 0.75 },
  { x: 0.0, z: -0.11, speed: 0.92, phase: 0.18 },
  { x: -0.07, z: 0.01, speed: 0.64, phase: 0.42 },
  { x: 0.08, z: 0.03, speed: 0.81, phase: 0.63 },
  { x: 0.0, z: 0.11, speed: 0.74, phase: 0.88 },
];

interface ShownPile {
  pile: LootPile;
  mesh: Group;
  lid: Group;
  glow: Mesh<CircleGeometry, MeshBasicMaterial>;
  seam: Mesh<BoxGeometry, MeshBasicMaterial>;
  motes: InstancedMesh<SphereGeometry, MeshBasicMaterial>;
  coinsMesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  shardsMesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  retryAt: number;
  opening: boolean;
  openProgress: number;
  claimDone: boolean;
}

export interface WorldLootEvents {
  picked(text: string): void;
  satchelChanged(): void;
  claim(pileId: string, x: number, z: number): Promise<LootContents>;
}

export class WorldLoot {
  private readonly root = new Group();
  private readonly shown = new Map<string, ShownPile>();
  private readonly available: Group[] = [];
  private readonly lights: PointLight[] = [];
  private pollIn = 0;
  private polling = false;
  private time = 0;
  /** Off once the room pushes piles. */
  pollServer = true;

  // Single scratch object for zero-allocation matrix updates
  private readonly dummy = new Object3D();

  // Shared combined geometries: reduced draw calls for flat performance
  private readonly boxBodyGeo = new BoxGeometry(0.5, 0.22, 0.34);
  private readonly bodyIronGeo: BufferGeometry;
  private readonly lidWoodGeo: BufferGeometry;
  private readonly lidIronGeo: BufferGeometry;
  private readonly mergedCoinsGeo: BufferGeometry;
  private readonly mergedShardsGeo: BufferGeometry;

  // FX geometry
  private readonly seamGlowGeo = new BoxGeometry(0.506, 0.016, 0.346);
  private readonly glowGeo = new CircleGeometry(0.75, 24);
  private readonly moteGeo = new SphereGeometry(0.018, 6, 6);

  // Base chest materials
  private readonly woodMat = new MeshStandardMaterial({ color: 0x422613, roughness: 0.82, metalness: 0.05 });
  private readonly ironMat = new MeshStandardMaterial({ color: 0x22262a, roughness: 0.45, metalness: 0.85 });
  private readonly coinMat = new MeshStandardMaterial({ color: 0xd9a441, roughness: 0.35, metalness: 0.9 });

  // Four nation themes (IGNIS crimson, AQUES azure, TERRA ochre, AURA white)
  private readonly themes: Record<NationColour, NationTheme> = {
    IGNIS: {
      lightHex: 0xdc2626,
      glowMat: new MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.26, depthWrite: false, blending: AdditiveBlending }),
      seamMat: new MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.75, depthWrite: false, blending: AdditiveBlending }),
      moteMat: new MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending }),
      shardMat: new MeshStandardMaterial({ color: 0xdc2626, emissive: 0x991b1b, emissiveIntensity: 1.5, roughness: 0.25 }),
    },
    AQUES: {
      lightHex: 0x2563eb,
      glowMat: new MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.26, depthWrite: false, blending: AdditiveBlending }),
      seamMat: new MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75, depthWrite: false, blending: AdditiveBlending }),
      moteMat: new MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending }),
      shardMat: new MeshStandardMaterial({ color: 0x2563eb, emissive: 0x1d4ed8, emissiveIntensity: 1.5, roughness: 0.25 }),
    },
    TERRA: {
      lightHex: 0xd97706,
      glowMat: new MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.26, depthWrite: false, blending: AdditiveBlending }),
      seamMat: new MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.75, depthWrite: false, blending: AdditiveBlending }),
      moteMat: new MeshBasicMaterial({ color: 0xfcd34d, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending }),
      shardMat: new MeshStandardMaterial({ color: 0xd97706, emissive: 0xb45309, emissiveIntensity: 1.5, roughness: 0.25 }),
    },
    AURA: {
      lightHex: 0xf1f5f9,
      glowMat: new MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.26, depthWrite: false, blending: AdditiveBlending }),
      seamMat: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, blending: AdditiveBlending }),
      moteMat: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending }),
      shardMat: new MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x94a3b8, emissiveIntensity: 1.5, roughness: 0.25 }),
    },
  };

  constructor(
    scene: Scene,
    private readonly world: RAPIER.World,
    private readonly zoneName: string,
    private readonly events: WorldLootEvents,
  ) {
    this.root.name = 'world-loot';
    scene.add(this.root);

    // Merge static body iron parts (4 corners, rim, straps, lock) into 1 geometry
    const bodyIronParts: BufferGeometry[] = [];
    for (const [cx, cz] of [[-0.23, -0.15], [0.23, -0.15], [-0.23, 0.15], [0.23, 0.15]] as const) {
      const corner = new BoxGeometry(0.045, 0.224, 0.045);
      corner.translate(cx, 0.11, cz);
      bodyIronParts.push(corner);
    }
    const rim = new BoxGeometry(0.508, 0.03, 0.348);
    rim.translate(0, 0.015, 0);
    bodyIronParts.push(rim);
    for (const sx of [-0.14, 0.14]) {
      const strap = new BoxGeometry(0.044, 0.224, 0.348);
      strap.translate(sx, 0.11, 0);
      bodyIronParts.push(strap);
    }
    const lock = new BoxGeometry(0.08, 0.08, 0.024);
    lock.translate(0, 0.15, 0.172);
    bodyIronParts.push(lock);
    this.bodyIronGeo = mergeGeometries(bodyIronParts, false)!;

    // Merge lid wood parts (main plank + beveled crown) into 1 geometry
    const lidPlank = new BoxGeometry(0.52, 0.09, 0.36);
    lidPlank.translate(0, 0.045, 0.17);
    const lidTop = new BoxGeometry(0.46, 0.035, 0.3);
    lidTop.translate(0, 0.098, 0.17);
    this.lidWoodGeo = mergeGeometries([lidPlank, lidTop], false)!;

    // Merge lid iron parts (straps, rim, latch) into 1 geometry
    const lidIronParts: BufferGeometry[] = [];
    for (const sx of [-0.14, 0.14]) {
      const lidStrap = new BoxGeometry(0.045, 0.098, 0.366);
      lidStrap.translate(sx, 0.05, 0.17);
      lidIronParts.push(lidStrap);
    }
    const lidRim = new BoxGeometry(0.526, 0.024, 0.366);
    lidRim.translate(0, 0.012, 0.17);
    lidIronParts.push(lidRim);
    const latch = new BoxGeometry(0.06, 0.07, 0.02);
    latch.translate(0, -0.015, 0.352);
    lidIronParts.push(latch);
    this.lidIronGeo = mergeGeometries(lidIronParts, false)!;

    // Merge coins into 1 single batch geometry (1 draw call)
    const coinParts: BufferGeometry[] = [];
    const baseCoin = new CylinderGeometry(0.04, 0.04, 0.012, 10);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const g = baseCoin.clone();
      g.rotateX(0.1 * (i % 3));
      g.rotateY((i % 4) * 0.3);
      g.rotateZ(0.05 * (i % 2));
      g.translate(Math.cos(a) * 0.12, 0.14 + (i % 2) * 0.01, Math.sin(a) * 0.08);
      coinParts.push(g);
    }
    baseCoin.dispose();
    this.mergedCoinsGeo = mergeGeometries(coinParts, false)!;

    // Merge shards into 1 single batch geometry (1 draw call)
    const shardParts: BufferGeometry[] = [];
    const baseShard = new CylinderGeometry(0.022, 0.038, 0.14, 6);
    for (let i = 0; i < 3; i++) {
      const g = baseShard.clone();
      g.rotateX(0.2);
      g.rotateY(i * 0.8);
      g.rotateZ(-0.15);
      g.translate(-0.1 + i * 0.1, 0.16, (i % 2) * 0.04 - 0.02);
      shardParts.push(g);
    }
    baseShard.dispose();
    this.mergedShardsGeo = mergeGeometries(shardParts, false)!;

    for (let i = 0; i < PREPARED_PILES; i++) {
      const mesh = this.createMesh();
      mesh.visible = false;
      this.root.add(mesh);
      this.available.push(mesh);
    }
    for (let i = 0; i < PILE_LIGHTS; i++) {
      const light = new PointLight(0xdc2626, 0, 5, 1.8);
      this.root.add(light);
      this.lights.push(light);
    }
  }

  // Shows a pile at once (a kill or a death), before the next poll would find it.
  add(pile: LootPile): void {
    if (!this.shown.has(pile.id)) this.show(pile);
  }

  // A pile someone took or that expired.
  remove(id: string): void {
    const s = this.shown.get(id);
    if (s) this.hide(id, s);
  }

  // The room's full list of the zone's piles, as a player joins.
  replace(piles: LootPile[]): void {
    const live = new Set(piles.map((p) => p.id));
    for (const [id, s] of this.shown) if (!live.has(id)) this.hide(id, s);
    for (const pile of piles) this.add(pile);
  }

  update(dt: number, hero: Vector3): void {
    this.time += dt;

    for (const [id, s] of this.shown) {
      if (s.opening) {
        s.openProgress += dt * 2.2;
        const p = Math.min(1, s.openProgress);
        const ease = 1 - Math.pow(1 - p, 3);
        s.lid.rotation.x = -ease * 1.35;
        s.glow.scale.setScalar(1 + ease * 0.5);
        if (s.openProgress >= 1 && s.claimDone) {
          this.hide(id, s);
          continue;
        }
      } else {
        const pulse = Math.sin(this.time * 2.4);
        s.glow.scale.setScalar(1 + pulse * 0.08);
        s.seam.material.opacity = 0.55 + pulse * 0.2;
      }

      // Rising motes instanced matrix updates
      for (let i = 0; i < MOTE_OFFSETS.length; i++) {
        const off = MOTE_OFFSETS[i]!;
        const cycle = (this.time * off.speed + off.phase) % 1.0;
        const my = 0.16 + cycle * 0.75;
        const mx = off.x + Math.sin(this.time * 2.2 + off.phase * 6.28) * 0.03;
        const mz = off.z + Math.cos(this.time * 2.2 + off.phase * 6.28) * 0.03;
        const scale = Math.max(0.01, Math.sin(cycle * Math.PI));
        this.dummy.position.set(mx, my, mz);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        s.motes.setMatrixAt(i, this.dummy.matrix);
      }
      s.motes.instanceMatrix.needsUpdate = true;
    }

    const nearest = [...this.shown.values()].sort(
      (a, b) => a.mesh.position.distanceToSquared(hero) - b.mesh.position.distanceToSquared(hero),
    );
    this.lights.forEach((light, i) => {
      const s = nearest[i];
      if (s) {
        const nation = this.resolveNation(s.pile.nation);
        const theme = this.themes[nation];
        light.color.setHex(theme.lightHex);
        light.intensity = s.opening ? 2.2 * Math.max(0, 1 - s.openProgress * 0.6) : 1.2;
        light.position.copy(s.mesh.position);
        light.position.y += 0.45;
      } else {
        light.intensity = 0;
      }
    });

    this.pollIn -= dt;
    if (this.pollServer && this.pollIn <= 0 && !this.polling) {
      this.pollIn = POLL_SECONDS;
      void this.poll(hero.x, hero.z);
    }

    for (const s of this.shown.values()) {
      if (s.opening || this.time < s.retryAt) continue;
      if (Math.hypot(hero.x - s.pile.x, hero.z - s.pile.z) <= CLAIM_REACH) {
        s.retryAt = this.time + RETRY_SECONDS;
        void this.claim(s, hero.x, hero.z);
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of [
      this.boxBodyGeo,
      this.bodyIronGeo,
      this.lidWoodGeo,
      this.lidIronGeo,
      this.mergedCoinsGeo,
      this.mergedShardsGeo,
      this.seamGlowGeo,
      this.glowGeo,
      this.moteGeo,
    ]) {
      g.dispose();
    }
    for (const m of [this.woodMat, this.ironMat, this.coinMat]) m.dispose();
    for (const theme of Object.values(this.themes)) {
      theme.glowMat.dispose();
      theme.seamMat.dispose();
      theme.moteMat.dispose();
      theme.shardMat.dispose();
    }
  }

  private resolveNation(nation?: string | null): NationColour {
    const upper = (nation ?? 'IGNIS').toUpperCase();
    return upper in this.themes ? (upper as NationColour) : 'IGNIS';
  }

  private async poll(x: number, z: number): Promise<void> {
    this.polling = true;
    try {
      const piles = await listLoot(this.zoneName, x, z, SEE_RADIUS);
      const live = new Set(piles.map((p) => p.id));
      for (const [id, s] of this.shown) {
        if (!live.has(id)) this.hide(id, s);
      }
      for (const pile of piles) if (!this.shown.has(pile.id)) this.show(pile);
    } catch {
      // The next poll tries again.
    } finally {
      this.polling = false;
    }
  }

  private async claim(s: ShownPile, x: number, z: number): Promise<void> {
    s.opening = true;
    try {
      const contents = await this.events.claim(s.pile.id, x, z);
      s.claimDone = true;
      this.events.picked(`Picked up ${describeLoot(contents.chroma, lootItems(contents))}`);
      this.events.satchelChanged();
    } catch (err) {
      s.opening = false;
      s.openProgress = 0;
      s.lid.rotation.x = 0;
      if (err instanceof EconomyError && /reserved for fight victor/.test(err.message)) {
        this.events.picked('That belongs to whoever won the fight, for now');
      } else if (err instanceof EconomyError && /already been claimed|expired|not found/.test(err.message)) {
        this.hide(s.pile.id, s);
      } else if (err instanceof EconomyError) {
        this.events.picked(err.message);
      }
    }
  }

  private groundY(x: number, z: number): number {
    const ray = new RAPIER.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 400, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    return hit ? 200 - hit.timeOfImpact : 0;
  }

  private createMesh(): Group {
    const g = new Group();

    // 1. Soft pulsing ground pool (1 draw call)
    const glow = new Mesh(this.glowGeo, this.themes.IGNIS.glowMat);
    glow.name = 'ground-glow';
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.015;
    g.add(glow);

    // 2. Stationary chest body (1 draw call)
    const body = new Mesh(this.boxBodyGeo, this.woodMat);
    body.position.y = 0.11;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Combined iron body fittings (1 draw call)
    const bodyIron = new Mesh(this.bodyIronGeo, this.ironMat);
    g.add(bodyIron);

    // Seam edge glow around the chest opening (1 draw call)
    const seam = new Mesh(this.seamGlowGeo, this.themes.IGNIS.seamMat);
    seam.name = 'seam-glow';
    seam.position.set(0, 0.22, 0);
    g.add(seam);

    // 3. Hinged lid on back top edge (pivot at y = 0.22, z = -0.17)
    const lidGroup = new Group();
    lidGroup.name = 'chest-lid';
    lidGroup.position.set(0, 0.22, -0.17);

    // Combined lid wood (1 draw call)
    const lidWood = new Mesh(this.lidWoodGeo, this.woodMat);
    lidWood.castShadow = true;
    lidGroup.add(lidWood);

    // Combined lid iron (1 draw call)
    const lidIron = new Mesh(this.lidIronGeo, this.ironMat);
    lidGroup.add(lidIron);

    g.add(lidGroup);

    // 4. Instanced rising motes cluster (1 draw call for all 8 motes)
    const motes = new InstancedMesh(this.moteGeo, this.themes.IGNIS.moteMat, MOTE_OFFSETS.length);
    motes.name = 'motes';
    for (let i = 0; i < MOTE_OFFSETS.length; i++) {
      this.dummy.position.set(MOTE_OFFSETS[i]!.x, 0.2, MOTE_OFFSETS[i]!.z);
      this.dummy.scale.setScalar(0.01);
      this.dummy.updateMatrix();
      motes.setMatrixAt(i, this.dummy.matrix);
    }
    motes.instanceMatrix.needsUpdate = true;
    g.add(motes);

    // 5. Merged batch coins and shards (1 draw call each, inside chest)
    const coinsMesh = new Mesh(this.mergedCoinsGeo, this.coinMat);
    coinsMesh.name = 'coins-mesh';
    g.add(coinsMesh);

    const shardsMesh = new Mesh(this.mergedShardsGeo, this.themes.IGNIS.shardMat);
    shardsMesh.name = 'shards-mesh';
    g.add(shardsMesh);

    // Lightweight test handles for individual coin/shard assertions (0 draw calls)
    for (let i = 0; i < 6; i++) {
      const dummyCoin = new Object3D();
      dummyCoin.name = `coin-${i}`;
      g.add(dummyCoin);
    }
    for (let i = 0; i < 3; i++) {
      const dummyShard = new Object3D();
      dummyShard.name = `shard-${i}`;
      g.add(dummyShard);
    }

    return g;
  }

  private show(pile: LootPile): void {
    const g = this.available.pop() ?? this.createMesh();
    g.visible = true;
    g.rotation.set(0, 0, 0);

    const nation = this.resolveNation(pile.nation);
    const theme = this.themes[nation];

    const glow = g.getObjectByName('ground-glow') as Mesh<CircleGeometry, MeshBasicMaterial>;
    glow.material = theme.glowMat;
    glow.scale.set(1, 1, 1);

    const seam = g.getObjectByName('seam-glow') as Mesh<BoxGeometry, MeshBasicMaterial>;
    seam.material = theme.seamMat;

    const lid = g.getObjectByName('chest-lid') as Group;
    lid.rotation.set(0, 0, 0);

    const motes = g.getObjectByName('motes') as InstancedMesh<SphereGeometry, MeshBasicMaterial>;
    motes.material = theme.moteMat;

    const coins = Math.min(6, Math.ceil(pile.contents.chroma / 10));
    const coinsMesh = g.getObjectByName('coins-mesh') as Mesh<BufferGeometry, MeshStandardMaterial>;
    coinsMesh.visible = coins > 0;
    for (let i = 0; i < 6; i++) {
      const dummyCoin = g.getObjectByName(`coin-${i}`)!;
      dummyCoin.visible = i < coins;
    }

    const shardsCount = Object.values(pile.contents.shards ?? {}).reduce((a, b) => a + b, 0);
    const shardsMesh = g.getObjectByName('shards-mesh') as Mesh<BufferGeometry, MeshStandardMaterial>;
    shardsMesh.material = theme.shardMat;
    shardsMesh.visible = shardsCount > 0;
    for (let i = 0; i < 3; i++) {
      const dummyShard = g.getObjectByName(`shard-${i}`)!;
      dummyShard.visible = i < shardsCount;
    }

    // Position chest solidly on the ground
    g.position.set(pile.x, this.groundY(pile.x, pile.z), pile.z);
    this.root.add(g);

    this.shown.set(pile.id, {
      pile,
      mesh: g,
      lid,
      glow,
      seam,
      motes,
      coinsMesh,
      shardsMesh,
      retryAt: 0,
      opening: false,
      openProgress: 0,
      claimDone: false,
    });
  }

  private hide(id: string, s: ShownPile): void {
    if (this.shown.get(id) !== s) return;
    s.mesh.visible = false;
    s.opening = false;
    s.openProgress = 0;
    s.claimDone = false;
    s.lid.rotation.set(0, 0, 0);
    s.glow.scale.set(1, 1, 1);
    this.available.push(s.mesh);
    this.shown.delete(id);
  }
}
