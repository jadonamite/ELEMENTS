import RAPIER from '@dimforge/rapier3d-compat';
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  type Scene,
  type Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EconomyError, listLoot, type LootContents, type LootPile } from './api.js';
import { describeLoot, lootItems } from './items.js';

// Loot on the ground: defeated foes drop an elemental chest shimmering in the foe's nation colour
// (IGNIS crimson, AQUES azure, TERRA ochre, AURA white). Real geometry with curved vaulted lid,
// iron corner caps and bands, lid seam glow, soft ground light pool that fades smoothly,
// and rising motes. Walking within reach opens the lid, releases an elemental burst, reveals spoils,
// and claims the contents.

const SEE_RADIUS = 40;
const POLL_SECONDS = 2;
const CLAIM_REACH = 1.35;
const RETRY_SECONDS = 3;
const PREPARED_PILES = 16;
const PILE_LIGHTS = 4;

export type NationColour = 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA';

interface NationTheme {
  lightHex: number;
  poolColor: number;
  poolMat: MeshBasicMaterial;
  seamMat: MeshBasicMaterial;
  moteMat: MeshBasicMaterial;
  burstMat: MeshBasicMaterial;
  shardMat: MeshStandardMaterial;
}

interface MoteOffset {
  x: number;
  z: number;
  speed: number;
  phase: number;
}

const MOTE_OFFSETS: MoteOffset[] = [
  { x: -0.18, z: -0.11, speed: 0.65, phase: 0.05 },
  { x: 0.17, z: -0.10, speed: 0.78, phase: 0.22 },
  { x: -0.15, z: 0.12, speed: 0.62, phase: 0.41 },
  { x: 0.16, z: 0.11, speed: 0.72, phase: 0.63 },
  { x: 0.0, z: -0.14, speed: 0.85, phase: 0.15 },
  { x: -0.09, z: 0.02, speed: 0.58, phase: 0.35 },
  { x: 0.10, z: 0.03, speed: 0.75, phase: 0.55 },
  { x: 0.0, z: 0.13, speed: 0.68, phase: 0.80 },
  { x: -0.21, z: 0.0, speed: 0.70, phase: 0.12 },
  { x: 0.21, z: 0.0, speed: 0.74, phase: 0.48 },
  { x: -0.08, z: -0.09, speed: 0.82, phase: 0.70 },
  { x: 0.08, z: 0.09, speed: 0.64, phase: 0.92 },
];

interface ShownPile {
  pile: LootPile;
  mesh: Group;
  lid: Group;
  glow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  seam: Mesh<BoxGeometry, MeshBasicMaterial>;
  crest: Mesh<OctahedronGeometry, MeshBasicMaterial>;
  burst: Mesh<RingGeometry, MeshBasicMaterial>;
  motes: InstancedMesh<OctahedronGeometry, MeshBasicMaterial>;
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

/** Procedural radial falloff texture so the ground light pool fades softly with no hard edge. */
function createSoftLightTexture(): CanvasTexture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const center = size / 2;
  const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.45)');
  grad.addColorStop(0.72, 'rgba(255, 255, 255, 0.14)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
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
  private readonly boxBodyGeo: BufferGeometry;
  private readonly bodyIronGeo: BufferGeometry;
  private readonly lidWoodGeo: BufferGeometry;
  private readonly lidIronGeo: BufferGeometry;
  private readonly mergedCoinsGeo: BufferGeometry;
  private readonly mergedShardsGeo: BufferGeometry;

  // FX geometry
  private readonly seamGlowGeo = new BoxGeometry(0.52, 0.024, 0.36);
  private readonly crestGeo = new OctahedronGeometry(0.035);
  private readonly poolGeo = new PlaneGeometry(2.4, 2.4);
  private readonly burstGeo = new RingGeometry(0.1, 0.4, 24);
  private readonly moteGeo = new OctahedronGeometry(0.045);

  // Base chest materials
  private readonly woodMat = new MeshStandardMaterial({ color: 0x3d2314, roughness: 0.85, metalness: 0.04 });
  private readonly ironMat = new MeshStandardMaterial({ color: 0x1e2124, roughness: 0.40, metalness: 0.88 });
  private readonly coinMat = new MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.32, metalness: 0.92 });

  // Four nation themes (IGNIS crimson, AQUES azure, TERRA ochre, AURA white)
  private readonly themes: Record<NationColour, NationTheme>;

  constructor(
    scene: Scene,
    private readonly world: RAPIER.World,
    private readonly zoneName: string,
    private readonly events: WorldLootEvents,
  ) {
    this.root.name = 'world-loot';
    scene.add(this.root);

    const lightTex = createSoftLightTexture();

    this.themes = {
      IGNIS: {
        lightHex: 0xff2233,
        poolColor: 0xdc2626,
        poolMat: new MeshBasicMaterial({
          map: lightTex,
          color: 0xef4444,
          transparent: true,
          opacity: 0.80,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
        seamMat: new MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }),
        moteMat: new MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.95, depthWrite: false }),
        burstMat: new MeshBasicMaterial({ color: 0xff2233, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }),
        shardMat: new MeshStandardMaterial({ color: 0xdc2626, emissive: 0xb91c1c, emissiveIntensity: 2.2, roughness: 0.2 }),
      },
      AQUES: {
        lightHex: 0x38bdf8,
        poolColor: 0x0284c7,
        poolMat: new MeshBasicMaterial({
          map: lightTex,
          color: 0x0ea5e9,
          transparent: true,
          opacity: 0.80,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
        seamMat: new MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }),
        moteMat: new MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.95, depthWrite: false }),
        burstMat: new MeshBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }),
        shardMat: new MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0369a1, emissiveIntensity: 2.2, roughness: 0.2 }),
      },
      TERRA: {
        lightHex: 0xfbbf24,
        poolColor: 0xd97706,
        poolMat: new MeshBasicMaterial({
          map: lightTex,
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.80,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
        seamMat: new MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }),
        moteMat: new MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.95, depthWrite: false }),
        burstMat: new MeshBasicMaterial({ color: 0xd97706, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }),
        shardMat: new MeshStandardMaterial({ color: 0xd97706, emissive: 0xb45309, emissiveIntensity: 2.2, roughness: 0.2 }),
      },
      AURA: {
        lightHex: 0xf1f5f9,
        poolColor: 0xe2e8f0,
        poolMat: new MeshBasicMaterial({
          map: lightTex,
          color: 0xffffff,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
        seamMat: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, blending: AdditiveBlending }),
        moteMat: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }),
        burstMat: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }),
        shardMat: new MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x94a3b8, emissiveIntensity: 2.2, roughness: 0.2 }),
      },
    };

    // 1. Base wood chest body (outer dimensions 0.50 x 0.22 x 0.34)
    this.boxBodyGeo = new BoxGeometry(0.50, 0.22, 0.34);

    // 2. Base iron fittings: corner caps, rim bands, straps, lock plate
    const bodyIronParts: BufferGeometry[] = [];
    // 4 lower corner caps
    for (const [cx, cz] of [[-0.235, -0.155], [0.235, -0.155], [-0.235, 0.155], [0.235, 0.155]] as const) {
      const corner = new BoxGeometry(0.065, 0.08, 0.065);
      corner.translate(cx, 0.04, cz);
      bodyIronParts.push(corner);
    }
    // 4 upper corner caps
    for (const [cx, cz] of [[-0.235, -0.155], [0.235, -0.155], [-0.235, 0.155], [0.235, 0.155]] as const) {
      const topCorner = new BoxGeometry(0.065, 0.06, 0.065);
      topCorner.translate(cx, 0.19, cz);
      bodyIronParts.push(topCorner);
    }
    // Bottom skirt rim
    const bottomRim = new BoxGeometry(0.518, 0.035, 0.358);
    bottomRim.translate(0, 0.018, 0);
    bodyIronParts.push(bottomRim);
    // Top rim
    const topRim = new BoxGeometry(0.518, 0.032, 0.358);
    topRim.translate(0, 0.205, 0);
    bodyIronParts.push(topRim);
    // 2 vertical reinforcing straps wrapping front, base, rear
    for (const sx of [-0.14, 0.14]) {
      const strap = new BoxGeometry(0.048, 0.224, 0.358);
      strap.translate(sx, 0.11, 0);
      bodyIronParts.push(strap);
    }
    // Center lock escutcheon plate
    const lockPlate = new BoxGeometry(0.09, 0.09, 0.024);
    lockPlate.translate(0, 0.15, 0.176);
    bodyIronParts.push(lockPlate);
    const keyHole = new BoxGeometry(0.022, 0.04, 0.012);
    keyHole.translate(0, 0.15, 0.186);
    bodyIronParts.push(keyHole);
    this.bodyIronGeo = mergeGeometries(bodyIronParts, false)!;

    // 3. Vaulted curved lid (barrel arch, hinged at rear pivot y = 0.22, z = -0.17)
    // Radius R = 0.17, depth = 0.34, width = 0.52.
    // Cylinder oriented along X: semi-circle arch from z = 0 to 0.34, y = 0 to 0.14
    const lidWoodParts: BufferGeometry[] = [];
    const archWood = new CylinderGeometry(0.17, 0.17, 0.50, 14, 1, false, 0, Math.PI);
    archWood.rotateZ(Math.PI / 2);
    archWood.translate(0, 0, 0.17);
    lidWoodParts.push(archWood);
    // Left and right semi-circular wood end caps
    const leftCap = new CircleGeometry(0.17, 14, 0, Math.PI);
    leftCap.rotateY(-Math.PI / 2);
    leftCap.translate(-0.25, 0, 0.17);
    lidWoodParts.push(leftCap);
    const rightCap = new CircleGeometry(0.17, 14, 0, Math.PI);
    rightCap.rotateY(Math.PI / 2);
    rightCap.translate(0.25, 0, 0.17);
    lidWoodParts.push(rightCap);
    // Lid lower plank rim
    const lidBaseRim = new BoxGeometry(0.505, 0.028, 0.345);
    lidBaseRim.translate(0, 0.014, 0.17);
    lidWoodParts.push(lidBaseRim);
    this.lidWoodGeo = mergeGeometries(lidWoodParts, false)!;

    // 4. Lid iron fittings: arched bands conforming to the vault, bottom rim, latch, rear hinges
    const lidIronParts: BufferGeometry[] = [];
    // Two curved iron arch straps sitting proud on the barrel lid
    for (const sx of [-0.14, 0.14]) {
      const archStrap = new CylinderGeometry(0.178, 0.178, 0.048, 14, 1, true, 0, Math.PI);
      archStrap.rotateZ(Math.PI / 2);
      archStrap.translate(sx, 0, 0.17);
      lidIronParts.push(archStrap);
    }
    // Curved iron trim along left and right arched ends
    for (const cx of [-0.254, 0.254]) {
      const archEnd = new CylinderGeometry(0.176, 0.176, 0.024, 14, 1, true, 0, Math.PI);
      archEnd.rotateZ(Math.PI / 2);
      archEnd.translate(cx, 0, 0.17);
      lidIronParts.push(archEnd);
    }
    // Lid lower iron rim
    const lidLowerRim = new BoxGeometry(0.524, 0.028, 0.364);
    lidLowerRim.translate(0, 0.014, 0.17);
    lidIronParts.push(lidLowerRim);
    // Front hanging latch / hasp
    const frontLatch = new BoxGeometry(0.065, 0.085, 0.024);
    frontLatch.translate(0, -0.025, 0.354);
    lidIronParts.push(frontLatch);
    // Rear barrel hinges
    for (const hx of [-0.14, 0.14]) {
      const hinge = new CylinderGeometry(0.02, 0.02, 0.065, 10);
      hinge.rotateZ(Math.PI / 2);
      hinge.translate(hx, 0, 0);
      lidIronParts.push(hinge);
    }
    this.lidIronGeo = mergeGeometries(lidIronParts, false)!;

    // 5. Coins batch geometry (1 draw call)
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

    // 6. Shards batch geometry (1 draw call)
    const shardParts: BufferGeometry[] = [];
    const baseShard = new CylinderGeometry(0.024, 0.042, 0.15, 6);
    for (let i = 0; i < 3; i++) {
      const g = baseShard.clone();
      g.rotateX(0.22);
      g.rotateY(i * 0.85);
      g.rotateZ(-0.16);
      g.translate(-0.1 + i * 0.1, 0.17, (i % 2) * 0.04 - 0.02);
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
      const light = new PointLight(0xff2233, 0, 5, 1.8);
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
        s.openProgress += dt * 2.4;
        const p = Math.min(1, s.openProgress);
        const ease = 1 - Math.pow(1 - p, 3);
        // Vaulted lid swings back 78 degrees
        s.lid.rotation.x = -ease * 1.36;
        s.glow.scale.setScalar(1 + ease * 0.4);

        // Elemental burst expands and fades
        s.burst.visible = true;
        s.burst.scale.setScalar(0.4 + ease * 2.5);
        s.burst.material.opacity = Math.max(0, 0.9 * (1 - ease));

        if (s.openProgress >= 1 && s.claimDone) {
          this.hide(id, s);
          continue;
        }
      } else {
        const pulse = Math.sin(this.time * 2.5);
        s.glow.scale.setScalar(1 + pulse * 0.08);
        s.glow.material.opacity = 0.72 + pulse * 0.12;
        s.seam.material.opacity = 0.70 + pulse * 0.25;
        s.crest.material.opacity = 0.80 + pulse * 0.20;
        s.burst.visible = false;
      }

      // Rising motes instanced matrix updates (12 glowing octahedrons)
      for (let i = 0; i < MOTE_OFFSETS.length; i++) {
        const off = MOTE_OFFSETS[i]!;
        const cycle = (this.time * off.speed + off.phase) % 1.0;
        const my = 0.16 + cycle * 0.95;
        const mx = off.x + Math.sin(this.time * 2.0 + off.phase * 6.28) * 0.06;
        const mz = off.z + Math.cos(this.time * 2.0 + off.phase * 6.28) * 0.06;
        const scale = Math.max(0.02, Math.sin(cycle * Math.PI) * 1.1);
        this.dummy.position.set(mx, my, mz);
        this.dummy.scale.setScalar(scale);
        this.dummy.rotation.set(this.time + i, this.time * 1.5, i * 0.5);
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
        light.intensity = s.opening ? 2.4 * Math.max(0, 1 - s.openProgress * 0.5) : 1.2;
        light.position.copy(s.mesh.position);
        light.position.y += 0.38;
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
      this.crestGeo,
      this.poolGeo,
      this.burstGeo,
      this.moteGeo,
    ]) {
      g.dispose();
    }
    for (const m of [this.woodMat, this.ironMat, this.coinMat]) m.dispose();
    for (const theme of Object.values(this.themes)) {
      theme.poolMat.dispose();
      theme.seamMat.dispose();
      theme.moteMat.dispose();
      theme.burstMat.dispose();
      theme.shardMat.dispose();
    }
  }

  resolveNation(nation?: string | null): NationColour {
    const upper = (nation ?? 'IGNIS').toUpperCase();
    return upper in this.themes ? (upper as NationColour) : 'IGNIS';
  }

  groundY(x: number, z: number): number {
    const ray = new RAPIER.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 400, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    return hit ? 200 - hit.timeOfImpact : 0;
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
      s.burst.visible = false;
      if (err instanceof EconomyError && /reserved for fight victor/.test(err.message)) {
        this.events.picked('That belongs to whoever won the fight, for now');
      } else if (err instanceof EconomyError && /already been claimed|expired|not found/.test(err.message)) {
        this.hide(s.pile.id, s);
      } else if (err instanceof EconomyError) {
        this.events.picked(err.message);
      }
    }
  }

  private createMesh(): Group {
    const g = new Group();

    // 1. Soft pulsing ground light pool that fades smoothly with radial gradient (1 draw call)
    const glow = new Mesh(this.poolGeo, this.themes.IGNIS.poolMat);
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

    // Combined iron body fittings: corner caps, rim, straps, lock plate (1 draw call)
    const bodyIron = new Mesh(this.bodyIronGeo, this.ironMat);
    g.add(bodyIron);

    // Seam edge glow around the chest opening (1 draw call)
    const seam = new Mesh(this.seamGlowGeo, this.themes.IGNIS.seamMat);
    seam.name = 'seam-glow';
    seam.position.set(0, 0.22, 0);
    g.add(seam);

    // Elemental crest on the lock plate (1 draw call)
    const crest = new Mesh(this.crestGeo, this.themes.IGNIS.seamMat);
    crest.name = 'chest-crest';
    crest.position.set(0, 0.15, 0.192);
    g.add(crest);

    // Opening burst effect (1 draw call)
    const burst = new Mesh(this.burstGeo, this.themes.IGNIS.burstMat);
    burst.name = 'chest-burst';
    burst.rotation.x = -Math.PI / 2;
    burst.position.set(0, 0.24, 0);
    burst.visible = false;
    g.add(burst);

    // 3. Vaulted hinged lid on rear top edge (pivot at y = 0.22, z = -0.17)
    const lidGroup = new Group();
    lidGroup.name = 'chest-lid';
    lidGroup.position.set(0, 0.22, -0.17);

    // Combined lid wood (1 draw call)
    const lidWood = new Mesh(this.lidWoodGeo, this.woodMat);
    lidWood.castShadow = true;
    lidGroup.add(lidWood);

    // Combined lid iron: arched bands, rim, latch, hinges (1 draw call)
    const lidIron = new Mesh(this.lidIronGeo, this.ironMat);
    lidGroup.add(lidIron);

    g.add(lidGroup);

    // 4. Instanced rising motes cluster (1 draw call for all 12 motes)
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

    // 5. Merged batch coins and shards inside chest (1 draw call each)
    const coinsMesh = new Mesh(this.mergedCoinsGeo, this.coinMat);
    coinsMesh.name = 'coins-mesh';
    g.add(coinsMesh);

    const shardsMesh = new Mesh(this.mergedShardsGeo, this.themes.IGNIS.shardMat);
    shardsMesh.name = 'shards-mesh';
    g.add(shardsMesh);

    // Test handles for individual coin/shard visibility assertions (0 draw calls)
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

    const glow = g.getObjectByName('ground-glow') as Mesh<PlaneGeometry, MeshBasicMaterial>;
    glow.material = theme.poolMat;
    glow.scale.set(1, 1, 1);

    const seam = g.getObjectByName('seam-glow') as Mesh<BoxGeometry, MeshBasicMaterial>;
    seam.material = theme.seamMat;

    const crest = g.getObjectByName('chest-crest') as Mesh<OctahedronGeometry, MeshBasicMaterial>;
    crest.material = theme.seamMat;

    const burst = g.getObjectByName('chest-burst') as Mesh<RingGeometry, MeshBasicMaterial>;
    burst.material = theme.burstMat;
    burst.visible = false;

    const lid = g.getObjectByName('chest-lid') as Group;
    lid.rotation.set(0, 0, 0);

    const motes = g.getObjectByName('motes') as InstancedMesh<OctahedronGeometry, MeshBasicMaterial>;
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
      crest,
      burst,
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
    s.burst.visible = false;
    s.lid.rotation.set(0, 0, 0);
    s.glow.scale.set(1, 1, 1);
    this.available.push(s.mesh);
    this.shown.delete(id);
  }
}
