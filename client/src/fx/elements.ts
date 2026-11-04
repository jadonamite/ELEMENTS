/**
 * AQUES, TERRA and AURA bending, drawn with real geometry: water that whips, pools and
 * freezes, stone torn from the floor, and wind as blades and streaks. IGNIS stays in
 * bending-fx.ts. Every effect is short-lived and cleans up after itself.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Material,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  type Scene,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Element } from '../../../shared/src/index.js';
import type { Projectile } from '../attacks/projectile.js';
import type { CombatSpace } from '../attacks/space.js';

type Updater = (age: number, delta: number) => boolean;
/**
 * The head a shot picture is drawn at. A thrown move's head is the fight's own Projectile, so the
 * picture stops exactly where the hit is judged; a kick's head is a short reach the effects move.
 */
interface Flight {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly origin: Vector3;
  readonly done: boolean;
  readonly end?: { at: Vector3; reason: 'world' | 'body' | 'spent' };
}
/** A kick's head: it runs out to the kick's reach, or to the first wall, and ends there. */
interface Reach extends Flight { done: boolean; end?: { at: Vector3; reason: 'world' | 'body' | 'spent' }; left: number; radius: number }
/** How big a thrown boulder is at bending strength `s`. */
const stoneRadius = (s: number): number => 0.42 * (0.7 + s * 0.3);
/** Back along the head's path, off the face it stopped on. */
function backFrom(head: Flight): Vector3 {
  return head.velocity.clone().setY(0).normalize().negate();
}
const stepFrom = new Vector3();
const stepTo = new Vector3();
/** Height at which ground effects ask the world what stands in their way. */
const PROBE_Y = 0.5;
const FAN_RAYS = 48;
const toWorld = new Vector3();

/**
 * How far is open around a point, measured once in every direction. A wave, ice sheet, pool or
 * whirlwind is held inside it, so it breaks against a wall instead of passing through.
 */
class Fan {
  constructor(readonly centre: Vector3, private readonly open: Float32Array) {}
  /** Open distance toward a world heading (atan2 of x over z); the nearer of the two samples around it. */
  at(heading: number): number {
    const n = this.open.length;
    const f = (((heading / (Math.PI * 2)) % 1) + 1) % 1 * n;
    const i = Math.floor(f) % n;
    return Math.min(this.open[i]!, this.open[(i + 1) % n]!);
  }
  /** Holds every vertex of `mesh` inside the open outline; `base` is the mesh's own unclamped shape. */
  hold(mesh: Mesh, base: Float32Array): void {
    // Parents first: a whirlwind's group grows this frame before its rings are held.
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.getAttribute('position');
    const inverse = mesh.matrixWorld.clone().invert();
    for (let i = 0; i < pos.count; i++) {
      toWorld.set(base[i * 3]!, base[i * 3 + 1]!, base[i * 3 + 2]!).applyMatrix4(mesh.matrixWorld);
      const dx = toWorld.x - this.centre.x, dz = toWorld.z - this.centre.z;
      const d = Math.hypot(dx, dz);
      const limit = this.at(Math.atan2(dx, dz));
      if (d > limit) {
        toWorld.x = this.centre.x + dx / d * limit;
        toWorld.z = this.centre.z + dz / d * limit;
      }
      toWorld.applyMatrix4(inverse);
      pos.setXYZ(i, toWorld.x, toWorld.y, toWorld.z);
    }
    pos.needsUpdate = true;
  }
}
/** A mesh's own vertex positions, kept so a Fan can clamp them afresh each frame. */
const shapeOf = (mesh: Mesh): Float32Array => Float32Array.from(mesh.geometry.getAttribute('position').array as Float32Array);
interface Live { root: Object3D; age: number; update: Updater; dispose: Array<BufferGeometry | Material> }

const UP = new Vector3(0, 1, 0);
const ease = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const bump = (t: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));

/** A soft round falloff, used by wind streaks and spray. */
function softTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** A streak that is bright in the middle and fades at both ends and edges. */
function streakTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const g = c.getContext('2d')!;
  const along = g.createLinearGradient(0, 0, 128, 0);
  along.addColorStop(0, 'rgba(255,255,255,0)');
  along.addColorStop(0.35, 'rgba(255,255,255,0.9)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = along;
  g.fillRect(0, 0, 128, 16);
  g.globalCompositeOperation = 'destination-in';
  const across = g.createLinearGradient(0, 0, 0, 16);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = across;
  g.fillRect(0, 0, 128, 16);
  return new CanvasTexture(c);
}

/** Box-projected UVs in metres, so stone keeps its real grain on any shape. */
function boxUV(geo: BufferGeometry, metresPerTile = 1.2): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [pos.getX(i), pos.getZ(i)] : ax >= az ? [pos.getZ(i), pos.getY(i)] : [pos.getX(i), pos.getY(i)];
    uv[i * 2] = u / metresPerTile;
    uv[i * 2 + 1] = v / metresPerTile;
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

/** A sharp ice crystal: a stretched, twisted octahedron. */
function crystalGeometry(width: number, height: number, seed: number): BufferGeometry {
  const geo = new OctahedronGeometry(width, 0);
  geo.scale(1, height / width, 0.7 + Math.sin(seed) * 0.25);
  geo.rotateY(seed);
  geo.translate(0, height * 0.55, 0);
  return geo;
}

/** Rough rock: an icosahedron pushed in and out so no two look alike. */
/** How far a rock's bumps reach past its radius. */
const ROCK_BULGE = 1.28;
function rockGeometry(radius: number, seed: number): BufferGeometry {
  const geo = new IcosahedronGeometry(radius, 1);
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 7.1 + seed) * Math.cos(v.y * 5.3 - seed) * Math.sin(v.z * 6.7 + seed * 2);
    v.multiplyScalar(1 + n * (ROCK_BULGE - 1));
    v.y *= 0.8;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return boxUV(geo, 0.8);
}

/** Jagged spike: a cone with its tip pushed off-centre. */
function spikeGeometry(radius: number, height: number, seed: number): BufferGeometry {
  const geo = new ConeGeometry(radius, height, 6, 3);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const lean = (y / height + 0.5) * 0.25;
    pos.setX(i, pos.getX(i) * (1 + Math.sin(i * 1.7 + seed) * 0.18) + Math.sin(seed) * lean);
    pos.setZ(i, pos.getZ(i) * (1 + Math.cos(i * 2.3 + seed) * 0.18) + Math.cos(seed) * lean);
  }
  geo.translate(0, height / 2, 0);
  return boxUV(geo, 1);
}

/** A thin, wide stone slab with a broken top edge. */
function wallGeometry(width: number, height: number, depth: number): BufferGeometry {
  const geo = new CylinderGeometry(1, 1, 1, 4, 6, false);
  geo.rotateY(Math.PI / 4);
  geo.scale(width / Math.SQRT2, height, depth / Math.SQRT2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const top = y > height * 0.45 ? Math.sin(x * 4.1) * 0.22 + Math.sin(x * 9.3) * 0.08 : 0;
    pos.setY(i, y + top);
    pos.setZ(i, pos.getZ(i) * (1 + Math.sin(x * 3 + y * 5) * 0.15));
  }
  geo.translate(0, height / 2, 0);
  return boxUV(geo, 1.4);
}

export class ElementEffects {
  private readonly live: Live[] = [];
  private readonly soft = softTexture();
  private readonly streak = streakTexture();
  private readonly stone: MeshStandardMaterial;
  private readonly water: MeshPhysicalMaterial;
  private readonly ice: MeshPhysicalMaterial;
  private readonly spray: MeshBasicMaterial;
  private readonly foam: MeshBasicMaterial;
  /** A raised TERRA wall: the scene gives it a solid body for its lifetime. */
  onWall?: (center: Vector3, facing: number, size: Vector3, seconds: number) => void;
  /** Wind and water extinguishing fire: douses flame patches and fireballs in range. */
  onExtinguish?: (at: Vector3, radius: number) => void;
  private readonly wind: MeshBasicMaterial;
  private readonly textures: Texture[] = [];
  /** Pools and floods AQUES made; they count as water to bend from while they last. */
  readonly pools: Array<{ position: Vector3; until: number }> = [];
  readonly wellspringPools: Array<{ position: Vector3; until: number }> = [];
  private readonly reaches: Reach[] = [];
  /** The fight's world query; kicks ask it so their picture stops at the same wall the judge sees. */
  space?: Pick<CombatSpace, 'obstruction'>;
  private windskiffGroup: Group | null = null;
  private windskiffSphere: Mesh | null = null;
  private windskiffTorus1: Mesh | null = null;
  private windskiffTorus2: Mesh | null = null;
  private windskiffTorus3: Mesh | null = null;
  private windskiffDust: Mesh | null = null;
  private clock = 0;

  constructor(private readonly scene: Scene, quality: 'high' | 'low' = 'high') {
    const loader = new TextureLoader();
    const tex = (name: string, srgb = false): Texture => {
      const t = loader.load(`/assets/textures/rock_wall_08_${name}_1k.webp`);
      t.wrapS = t.wrapT = RepeatWrapping;
      if (srgb) t.colorSpace = SRGBColorSpace;
      this.textures.push(t);
      return t;
    };
    this.stone = new MeshStandardMaterial({
      map: tex('diff', true), normalMap: tex('nor_gl'), roughnessMap: tex('arm'), roughness: 1, metalness: 0,
      color: new Color(0.82, 0.74, 0.62),
    });
    const glassy = quality === 'high';
    this.water = new MeshPhysicalMaterial({
      color: new Color(0.62, 0.86, 0.95), roughness: 0.04, metalness: 0, ior: 1.33,
      transmission: glassy ? 1 : 0, thickness: 0.6, attenuationColor: new Color(0.05, 0.4, 0.55), attenuationDistance: 1.2,
      clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: glassy ? 0.95 : 0.55, envMapIntensity: 1.6,
      side: DoubleSide, depthWrite: false,
    });
    this.ice = new MeshPhysicalMaterial({
      color: new Color(0.78, 0.92, 1), roughness: 0.08, metalness: 0, ior: 1.31,
      transmission: glassy ? 0.85 : 0, thickness: 0.8, attenuationColor: new Color(0.3, 0.65, 0.85), attenuationDistance: 0.9,
      clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: glassy ? 0.97 : 0.75, envMapIntensity: 1.8, flatShading: true,
    });
    this.foam = new MeshBasicMaterial({ map: this.soft, color: new Color(0.94, 0.98, 1), transparent: true, depthWrite: false, opacity: 0.9 });
    this.spray = new MeshBasicMaterial({ map: this.soft, color: new Color(0.75, 0.9, 1), transparent: true, depthWrite: false, opacity: 0.8 });
    this.wind = new MeshBasicMaterial({
      map: this.streak, color: new Color(0.92, 0.96, 1), transparent: true, depthWrite: false, blending: AdditiveBlending,
      side: DoubleSide, opacity: quality === 'low' ? 0.45 : 0.6,
    });
  }

  /** Water sources from effects that are still on the ground. */
  get waterSources(): Vector3[] { return this.pools.filter(p => p.until > this.clock).map(p => p.position); }
  /** Sacred wellspring water sources in the world. */
  get wellspringSources(): Vector3[] { return this.wellspringPools.filter(p => p.until > this.clock).map(p => p.position); }

  /**
   * Toggle the AURA Windskiff (Air Scooter) technique.
   * Spawns a glowing sphere of compressed air, spinning wind rings, and ground vortex beneath the sitting hero.
   */
  setWindskiff(active: boolean, at?: Vector3): void {
    if (!this.windskiffGroup) {
      this.windskiffGroup = new Group();
      this.windskiffGroup.name = 'Windskiff';

      // 1. Central glowing sphere of compressed spinning air
      const sGeo = new SphereGeometry(0.68, 24, 24);
      const airSphereMat = new MeshBasicMaterial({
        color: 0xe6f4ff,
        transparent: true,
        opacity: 0.65,
        blending: AdditiveBlending,
      });
      this.windskiffSphere = new Mesh(sGeo, airSphereMat);

      // 2. High-speed equator and oblique wind vortex rings
      const tGeo1 = new TorusGeometry(0.76, 0.06, 12, 32);
      this.windskiffTorus1 = new Mesh(tGeo1, this.wind);

      const tGeo2 = new TorusGeometry(0.72, 0.05, 12, 32);
      this.windskiffTorus2 = new Mesh(tGeo2, this.wind);
      this.windskiffTorus2.rotation.x = Math.PI / 3;

      const tGeo3 = new TorusGeometry(0.74, 0.04, 12, 32);
      this.windskiffTorus3 = new Mesh(tGeo3, this.wind);
      this.windskiffTorus3.rotation.z = Math.PI / 4;

      // 3. Ground vortex ring lifting air dust
      const dGeo = new RingGeometry(0.3, 1.2, 32);
      dGeo.rotateX(-Math.PI / 2);
      this.windskiffDust = new Mesh(dGeo, this.spray);
      this.windskiffDust.position.y = -0.66;

      this.windskiffGroup.add(this.windskiffSphere, this.windskiffTorus1, this.windskiffTorus2, this.windskiffTorus3, this.windskiffDust);
      this.scene.add(this.windskiffGroup);
    }
    this.windskiffGroup.visible = active;
    if (active && at) {
      this.windskiffGroup.position.copy(at).setY(at.y + 0.68);
    }
  }

  /** Update the spinning windskiff under the hero while riding. */
  updateWindskiff(at: Vector3, delta: number, speed: number, facing: number): void {
    if (!this.windskiffGroup || !this.windskiffGroup.visible) return;
    this.windskiffGroup.position.set(at.x, at.y + 0.68, at.z);
    this.windskiffGroup.rotation.y = facing;
    const spin = delta * (14 + speed * 6);
    if (this.windskiffSphere) {
      this.windskiffSphere.rotation.x += spin * 0.8;
      this.windskiffSphere.rotation.y += spin;
    }
    if (this.windskiffTorus1) this.windskiffTorus1.rotation.y += spin * 1.2;
    if (this.windskiffTorus2) this.windskiffTorus2.rotation.z += spin * 1.4;
    if (this.windskiffTorus3) this.windskiffTorus3.rotation.x += spin * 1.1;
    if (this.windskiffDust) this.windskiffDust.rotation.y -= spin * 0.6;
    if (speed > 0.5 && Math.random() < 0.35) {
      this.dust(at.clone().setY(0.05), 0.7, 2);
    }
  }

  /**
   * Stonehearing for TERRA benders:
   * Radiates expanding ground sonar waves and highlights enemy footfalls through bedrock and walls.
   * Uses depthTest=false so vibrational beacons project directly through solid obstacles.
   */
  spawnStonehearingPulse(origin: Vector3, maxRadius = 32.0, enemies: readonly Vector3[] = []): void {
    const group = new Group();
    group.position.copy(origin).setY(0.04);
    const disposables: Array<BufferGeometry | Material> = [];

    // 1. Concentric high-contrast ground vibrational sonar ripples
    const ringGeo1 = new RingGeometry(0.35, 1.15, 64);
    ringGeo1.rotateX(-Math.PI / 2);
    const ringMat1 = new MeshBasicMaterial({
      color: new Color(0x35ff75), // Vibrant emerald vibrational resonance
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      opacity: 0.95,
    });
    const ringMesh1 = new Mesh(ringGeo1, ringMat1);
    group.add(ringMesh1);
    disposables.push(ringGeo1, ringMat1);

    const ringGeo2 = new RingGeometry(0.4, 0.85, 64);
    ringGeo2.rotateX(-Math.PI / 2);
    const ringMat2 = new MeshBasicMaterial({
      color: new Color(0xffdf55), // Secondary earth harmonic golden vibration
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      opacity: 0.85,
    });
    const ringMesh2 = new Mesh(ringGeo2, ringMat2);
    group.add(ringMesh2);
    disposables.push(ringGeo2, ringMat2);

    const ringGeo3 = new RingGeometry(0.3, 0.65, 48);
    ringGeo3.rotateX(-Math.PI / 2);
    const ringMesh3 = new Mesh(ringGeo3, ringMat1);
    group.add(ringMesh3);
    disposables.push(ringGeo3);

    // 2. Vibrational Sonar Beacons tracking each detected enemy through bedrock
    const enemyMarkers: Array<{
      pillar: Mesh;
      diamond: Mesh;
      footRings: Mesh[];
      x: number;
      z: number;
    }> = [];

    for (const e of enemies) {
      const d = Math.hypot(e.x - origin.x, e.z - origin.z);
      if (d <= maxRadius) {
        // Holographic cylindrical sonar column through bedrock (depthTest: false penetrates walls)
        const pillarGeo = new CylinderGeometry(0.75, 0.85, 2.8, 32, 1, true);
        const pillarMat = new MeshBasicMaterial({
          color: new Color(0x40ff80),
          transparent: true,
          opacity: 0.75,
          side: DoubleSide,
          blending: AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        });
        const pillarMesh = new Mesh(pillarGeo, pillarMat);
        pillarMesh.position.set(e.x - origin.x, 1.4, e.z - origin.z);
        pillarMesh.renderOrder = 999;
        group.add(pillarMesh);
        disposables.push(pillarGeo, pillarMat);

        // Hovering diamond / octahedron sonar beacon above head (depthTest: false)
        const diamondGeo = new OctahedronGeometry(0.35, 0);
        const diamondMat = new MeshBasicMaterial({
          color: new Color(0x70ffaa),
          transparent: true,
          opacity: 0.95,
          blending: AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        });
        const diamondMesh = new Mesh(diamondGeo, diamondMat);
        diamondMesh.position.set(e.x - origin.x, 2.9, e.z - origin.z);
        diamondMesh.renderOrder = 1000;
        group.add(diamondMesh);
        disposables.push(diamondGeo, diamondMat);

        // Ground vibrational footfall resonance rings
        const footGeo = new RingGeometry(0.35, 1.1, 32);
        footGeo.rotateX(-Math.PI / 2);
        const footMesh = new Mesh(footGeo, pillarMat);
        footMesh.position.set(e.x - origin.x, 0.05, e.z - origin.z);
        footMesh.renderOrder = 998;
        group.add(footMesh);
        disposables.push(footGeo);

        enemyMarkers.push({
          pillar: pillarMesh,
          diamond: diamondMesh,
          footRings: [footMesh],
          x: e.x - origin.x,
          z: e.z - origin.z,
        });
      }
    }

    this.add(group, (age) => {
      const duration = 3.6;
      const t = age / duration;
      const r1 = Math.min(maxRadius, (age / 1.3) * maxRadius);
      const r2 = Math.min(maxRadius, Math.max(0, ((age - 0.22) / 1.3) * maxRadius));
      const r3 = Math.min(maxRadius, Math.max(0, ((age - 0.45) / 1.3) * maxRadius));

      ringMesh1.scale.setScalar(r1);
      ringMesh2.scale.setScalar(r2);
      ringMesh3.scale.setScalar(r3);

      const fade = Math.max(0, 1.0 - t);
      ringMat1.opacity = 0.95 * fade;
      ringMat2.opacity = 0.85 * fade;

      // Animate enemy vibrational beacons
      enemyMarkers.forEach((m, idx) => {
        const pulse = Math.sin(age * 12 + idx * 1.5);
        m.diamond.rotation.y += 0.08;
        m.diamond.position.y = 2.9 + pulse * 0.12;
        (m.diamond.material as MeshBasicMaterial).opacity = Math.max(0, 0.95 * fade * (0.75 + pulse * 0.25));

        m.pillar.scale.set(1.0 + pulse * 0.08, 1.0, 1.0 + pulse * 0.08);
        (m.pillar.material as MeshBasicMaterial).opacity = Math.max(0, 0.75 * fade * (0.8 + pulse * 0.2));

        for (const f of m.footRings) {
          const footPulse = ((age * 3.0 + idx) % 1.0);
          f.scale.setScalar(0.7 + footPulse * 1.4);
        }
      });

      return t < 1;
    }, disposables);
  }

  /**
   * Foot and leg bending strikes: projects crescent arcs of water, wind scythes, or stone
   * ruptures originating directly from the kicking foot/limb.
   */
  castKick(
    element: Element,
    action: string,
    origin: Vector3,
    footPos: Vector3,
    facing: number,
    isHeavy = false,
    strength = 1,
    reach = 2.2,
  ): void {
    const forward = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    const at = origin.clone().setY(0);
    const foot = footPos.clone();
    const s = Math.max(0.6, Math.min(1.5, strength));
    // A kick is judged at the foot, so its shot runs only as far as the kick reaches.
    // The head starts clear of the floor, which is part of the world it asks.
    const kicked = (y: number, radius: number): Flight => this.kick(foot.clone().setY(Math.max(y, foot.y, radius + 0.08)), forward, Math.max(0.6, reach - 0.4), radius);

    if (element === 'AQUES' || element === 'AURA') {
      this.onExtinguish?.(origin.clone().addScaledVector(forward, 2.5), 4.2);
    }

    if (element === 'AQUES') {
      if (isHeavy) {
        // Heavy kick: sweeping crescent water scythe and crashing tidal surge along the ground
        this.tide(at, facing, 5.0 * s, s);
        this.droplets(foot, 16, 4.5 * s, 2.0 * s, 0.7);
        this.pool(this.placed(at, at.clone().addScaledVector(forward, 2.5)), 1.8 * s, 5);
      } else {
        // Light kick: snapping water whip arc launched directly from the foot
        this.lash(kicked(0.3, 0.13 * s + 0.05), s, 1.2 * s, 4);
        this.droplets(foot, 10, 3.5 * s, 1.5 * s, 0.5);
      }
    } else if (element === 'AURA') {
      if (isHeavy) {
        // Heavy kick: sweeping 180-degree cyclone gale and vacuum burst
        this.gust(at, facing, 6.0 * s, s);
        this.cyclone(this.placed(at, at.clone().addScaledVector(forward, 1.8)), 0.9, 1.2 * s);
      } else {
        // Light kick: high-velocity crescent air blade sliced directly from the kicking foot
        this.airBlade(kicked(0.4, 0.1), s);
        this.streaks(foot, facing, 0.6, reach, 12, 1.2, 0.35);
      }
    } else if (element === 'TERRA') {
      if (isHeavy) {
        // Heavy kick: tearing stone rupture wave churned up along the kicking line
        this.rockWave(at, forward, 5.5 * s, s);
        this.spire(this.placed(at, at.clone().addScaledVector(forward, 2.8), 0.45), s);
        this.dust(foot, 1.5, 12);
      } else {
        // Light kick: rock shard kicked from the floor at high velocity
        this.stoneShot(kicked(0.4, stoneRadius(s) * ROCK_BULGE), s);
        this.dust(foot, 1.0, 8);
      }
    }
  }

  /** Draws one bending move. `strength` below 1 means a weaker move from an empty meter. */
  cast(
    element: Element,
    move: string,
    origin: Vector3,
    facing: number,
    strength = 1,
    quality: 'waterskin' | 'natural' | 'wellspring' = 'waterskin'
  ): void {
    const forward = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    const at = origin.clone().setY(0);
    const s = Math.max(0.55, Math.min(1.4, strength));

    // Wind and water extinguish fire in front of them
    if (element === 'AQUES' || element === 'AURA') {
      this.onExtinguish?.(origin.clone().addScaledVector(forward, 2.5), 4.2);
    }

    const key = `${element}:${move}`;
    switch (key) {
      case 'AQUES:bend_sweep':
        this.tide(at, facing, 4.5, s);
        break;
      case 'AQUES:uppercut':
        const spout = this.placed(at, at.clone().addScaledVector(forward, 1.3), 0.42);
        this.geyser(spout, s);
        this.pool(spout, 1.8 * s, 6);
        break;
      case 'AQUES:ground_pound':
        this.freeze(at, 4 * s);
        break;
      case 'AQUES:dash_strike':
        this.mend(at, quality);
        break;
      case 'AQUES:ultimate':
        this.deluge(at, forward, facing);
        this.pool(this.placed(at, at.clone().addScaledVector(forward, 4.0)), 4.5, 8);
        break;
      case 'TERRA:bend_sweep': this.rockWave(at, forward, 5, s); break;
      case 'TERRA:uppercut': this.spire(this.placed(at, at.clone().addScaledVector(forward, 1.3), 0.45), s); break;
      case 'TERRA:ground_pound': this.wall(this.placed(at, at.clone().addScaledVector(forward, 1.6), 0.4), facing, s); break;
      case 'TERRA:dash_strike': this.dust(at, 1.6, 14); break;
      case 'TERRA:ultimate': this.landfall(at, facing); break;
      case 'AURA:bend_sweep': this.gust(at, facing, 5, s); break;
      case 'AURA:uppercut': this.updraft(this.placed(at, at.clone().addScaledVector(forward, 1.0), 0.6), s); break;
      case 'AURA:ground_pound': this.cyclone(this.placed(at, at.clone().addScaledVector(forward, 1.8)), 1.5, 1.4 * s); break;
      case 'AURA:dash_strike': this.windStep(at, forward, facing); break;
      case 'AURA:ultimate': this.tempest(at, 4); break;
      default: break;
    }
  }

  /** A permanent stone basin of water: a source AQUES can always bend from. */
  basin(at: Vector3, radius = 1.3): void {
    const group = new Group();
    group.position.copy(at).setY(0);
    const rimGeo = new TorusGeometry(radius, 0.22, 10, 40);
    rimGeo.rotateX(Math.PI / 2);
    const rim = this.mesh(rimGeo, this.stone);
    rim.position.y = 0.12;
    rim.scale.set(1, 1, 0.7);
    const surfaceGeo = new CircleGeometry(radius - 0.05, 40);
    surfaceGeo.rotateX(-Math.PI / 2);
    const surfaceMat = this.water.clone();
    surfaceMat.opacity = 0.85;
    surfaceMat.depthWrite = true;
    const surface = this.mesh(surfaceGeo, surfaceMat, false);
    surface.position.y = 0.2;
    group.add(rim, surface);
    this.pools.push({ position: at.clone().setY(0), until: Infinity });
    this.add(group, (age) => { surface.position.y = 0.2 + Math.sin(age * 1.3) * 0.006; return true; }, [rimGeo, surfaceGeo, surfaceMat]);
  }

  /**
   * The Wellspring basin in the AQUES delta.
   * Grants Wellspring water for purest healing.
   */
  wellspring(at: Vector3, radius = 2.4): void {
    const group = new Group();
    group.position.copy(at).setY(0);
    const rimGeo = new TorusGeometry(radius, 0.32, 12, 48);
    rimGeo.rotateX(Math.PI / 2);
    const rim = this.mesh(rimGeo, this.stone);
    rim.position.y = 0.16;
    const surfaceGeo = new CircleGeometry(radius - 0.05, 48);
    surfaceGeo.rotateX(-Math.PI / 2);
    const surfaceMat = this.water.clone();
    surfaceMat.color.setRGB(0.3, 0.95, 1.0);
    surfaceMat.opacity = 0.92;
    surfaceMat.depthWrite = true;
    const surface = this.mesh(surfaceGeo, surfaceMat, false);
    surface.position.y = 0.22;
    group.add(rim, surface);
    this.pools.push({ position: at.clone().setY(0), until: Infinity });
    this.wellspringPools.push({ position: at.clone().setY(0), until: Infinity });
    this.add(group, (age) => {
      surface.position.y = 0.22 + Math.sin(age * 1.8) * 0.01;
      return true;
    }, [rimGeo, surfaceGeo, surfaceMat]);
  }

  /**
   * Draws a thrown move on the fight's projectile: water lash, boulder or air blade. It flies
   * with the projectile and breaks where the projectile ends. A Hush's spark is the same, weaker.
   */
  thrown(element: Element, p: Projectile, strength = 1): void {
    const s = Math.max(0.55, Math.min(1.4, strength));
    if (element === 'AQUES' || element === 'AURA') {
      this.onExtinguish?.(p.origin.clone().addScaledVector(p.velocity.clone().setY(0).normalize(), 2.5), 4.2);
    }
    if (element === 'AQUES') this.lash(p, s, 1.5 * s);
    else if (element === 'TERRA') this.stoneShot(p, s);
    else if (element === 'AURA') this.airBlade(p, s);
  }

  update(delta: number): void {
    this.clock += delta;
    // Kick heads move first, so every picture riding one draws at this frame's place.
    for (let i = this.reaches.length - 1; i >= 0; i--) {
      const r = this.reaches[i]!;
      const speed = Math.max(r.velocity.length(), 1e-6);
      let step = Math.min(r.left, speed * delta);
      const to = r.position.clone().addScaledVector(r.velocity, step / speed);
      const blocked = this.space?.obstruction(r.position, to, r.radius) ?? null;
      if (blocked !== null) step = blocked;
      r.position.addScaledVector(r.velocity, step / speed);
      r.left -= step;
      if (blocked !== null || r.left <= 0) {
        r.done = true;
        r.end = { at: r.position.clone(), reason: blocked !== null ? 'world' : 'spent' };
        this.reaches.splice(i, 1);
      }
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const fx = this.live[i]!;
      fx.age += delta;
      if (fx.update(fx.age, delta)) continue;
      this.scene.remove(fx.root);
      for (const d of fx.dispose) d.dispose();
      this.live.splice(i, 1);
    }
    for (let i = this.pools.length - 1; i >= 0; i--) if (this.pools[i]!.until <= this.clock) this.pools.splice(i, 1);
  }

  dispose(): void {
    for (const fx of this.live) { this.scene.remove(fx.root); for (const d of fx.dispose) d.dispose(); }
    this.live.length = 0;
    for (const m of [this.stone, this.water, this.ice, this.spray, this.foam, this.wind]) m.dispose();
    for (const t of [this.soft, this.streak, ...this.textures]) t.dispose();
  }

  private add(root: Object3D, update: Updater, dispose: Array<BufferGeometry | Material> = []): void {
    this.scene.add(root);
    this.live.push({ root, age: 0, update, dispose });
  }

  /** The point toward `to` that something sent from `from` can reach; at `to`'s height. */
  private placed(from: Vector3, to: Vector3, radius = 0.3): Vector3 {
    if (!this.space) return to.clone();
    // The probe rides clear of the floor, which is part of the world it asks.
    const y = Math.max(PROBE_Y, radius + 0.05);
    stepFrom.copy(from).setY(y);
    stepTo.copy(to).setY(y);
    const hit = this.space.obstruction(stepFrom, stepTo, radius);
    if (hit === null) return to.clone();
    return stepTo.clone().sub(stepFrom).normalize().multiplyScalar(hit).add(stepFrom).setY(to.y);
  }

  /** Measures how far is open around `centre`, out to `reach`. */
  private fan(centre: Vector3, reach: number): Fan {
    const open = new Float32Array(FAN_RAYS).fill(Infinity);
    if (this.space) {
      stepFrom.copy(centre).setY(PROBE_Y);
      for (let i = 0; i < FAN_RAYS; i++) {
        const a = (i / FAN_RAYS) * Math.PI * 2;
        stepTo.copy(stepFrom).add(toWorld.set(Math.sin(a) * reach, 0, Math.cos(a) * reach));
        open[i] = this.space.obstruction(stepFrom, stepTo, 0.1) ?? Infinity;
      }
    }
    return new Fan(centre.clone().setY(0), open);
  }

  /**
   * Moves a loose piece (chip, droplet, dust) one step. Sideways motion asks the world first, and a
   * piece that would go into a wall, pillar or raised TERRA wall bounces back off it instead.
   */
  private carry(position: Vector3, velocity: Vector3, dt: number, size: number): void {
    stepFrom.copy(position).setY(Math.max(position.y, size + 0.05));
    stepTo.copy(stepFrom).set(stepFrom.x + velocity.x * dt, stepFrom.y, stepFrom.z + velocity.z * dt);
    if (this.space?.obstruction(stepFrom, stepTo, size) != null) {
      velocity.x *= -0.4;
      velocity.z *= -0.4;
      position.y += velocity.y * dt;
      return;
    }
    position.addScaledVector(velocity, dt);
  }

  private mesh(geo: BufferGeometry, mat: Material, cast = true): Mesh {
    const m = new Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }

  /** Droplets thrown out from a point; they arc and fall. */
  private droplets(at: Vector3, count: number, speed: number, up: number, life = 0.9): void {
    const group = new Group();
    const geo = new PlaneGeometry(0.16, 0.16);
    const mat = this.spray.clone();
    const drops: Array<{ m: Mesh; v: Vector3 }> = [];
    for (let i = 0; i < count; i++) {
      const m = new Mesh(geo, mat);
      m.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      drops.push({ m, v: new Vector3(Math.cos(a) * speed * Math.random(), up * (0.5 + Math.random()), Math.sin(a) * speed * Math.random()) });
      m.scale.setScalar(0.6 + Math.random() * 1.2);
      group.add(m);
    }
    this.add(group, (age, dt) => {
      for (const d of drops) {
        d.v.y -= 9.8 * dt;
        this.carry(d.m.position, d.v, dt, 0.08);
        if (d.m.position.y < 0.03) { d.m.position.y = 0.03; d.v.set(0, 0, 0); }
        d.m.quaternion.copy(this.scene.userData.cameraQuaternion ?? d.m.quaternion);
      }
      mat.opacity = 0.8 * (1 - age / life);
      return age < life;
    }, [geo, mat]);
  }

  /** A flat disc of water that stays on the floor and counts as a source. */
  private pool(at: Vector3, radius: number, seconds: number): void {
    const geo = new CircleGeometry(radius, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = this.water.clone();
    mat.opacity = 0;
    const m = this.mesh(geo, mat, false);
    m.position.copy(at).setY(0.025);
    this.pools.push({ position: at.clone(), until: this.clock + seconds });
    // Water spreads up to a wall and stops there.
    const open = this.fan(at, radius + 0.5);
    const shape = shapeOf(m);
    this.add(m, (age) => {
      mat.opacity = 0.62 * Math.min(1, age / 0.25) * Math.min(1, (seconds - age) / 0.8);
      m.scale.setScalar(0.6 + 0.4 * ease(age / 0.3));
      if (age < 0.35) open.hold(m, shape);
      return age < seconds;
    }, [geo, mat]);
  }

  // AQUES

  /** A kick's head, as thick as the picture it carries, starting at the foot and running `reach` metres forward. */
  private kick(at: Vector3, forward: Vector3, reach: number, radius: number): Flight {
    const r: Reach = { position: at.clone(), origin: at.clone(), velocity: forward.clone().multiplyScalar(12), done: false, left: reach, radius };
    this.reaches.push(r);
    return r;
  }

  /**
   * A whip of water from where it left the hand to the head. Its tip is the head; when the head
   * ends the tip splashes there and the whip draws back into the splash.
   */
  private lash(head: Flight, s: number, poolRadius = 0, poolSeconds = 6): void {
    // Built once along +Z from 0 to 1, then stretched from the origin to the head each frame. The
    // wiggle runs flat into the tip, so the stretched tube ends at the head and not past it.
    const pts = [0, 0.2, 0.4, 0.6, 0.8, 1].map(t => new Vector3(Math.sin(t * Math.PI * 2) * (1 - t) * 0.45, Math.sin(t * Math.PI) * (1 - t) * 0.4, t));
    const geo = new TubeGeometry(new CatmullRomCurve3(pts), 64, 0.13 * s + 0.05, 10, false);
    const mat = this.water.clone();
    const m = this.mesh(geo, mat, false);
    const group = new Group();
    group.add(m);
    group.position.copy(head.origin);
    const total = geo.index!.count;
    let endedAt = -1;
    const tip = new Vector3();
    this.add(group, (age) => {
      if (endedAt < 0) {
        tip.copy(head.position);
        const length = Math.max(0.01, tip.distanceTo(head.origin));
        group.lookAt(tip);
        m.scale.set(1, 1, length);
        if (head.done) {
          endedAt = age;
          const at = head.end?.at ?? tip;
          this.droplets(at, 18, 2.2, 2.4, 0.8);
          // The foam column is wider than the whip, so it stands back off whatever the tip met.
          const foamAt = at.clone().setY(Math.max(0.3, at.y - 0.6));
          if (head.end?.reason === 'world') foamAt.addScaledVector(backFrom(head), 0.45);
          this.foamColumn(foamAt, 1.2, 0.3, 10, 0.5);
          if (poolRadius > 0) this.pool(at.clone().setY(0), poolRadius, poolSeconds);
        }
        return true;
      }
      const back = ease((age - endedAt) / 0.25);
      const start = Math.floor(total * back / 6) * 6;
      geo.setDrawRange(start, total - start);
      return back < 1;
    }, [geo, mat]);
  }

  /** A curling wave crest along an arc in front of the hero. */
  /** A curved sheet of water whose top curls forward, like a breaking wave. */
  private crest(at: Vector3, facing: number, radius: number, arc: number, height: number): Mesh {
    const geo = new CylinderGeometry(radius, radius, height, 48, 10, true, -arc / 2, arc);
    geo.translate(0, height / 2, 0);
    const pos = geo.getAttribute('position');
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const k = (v.y / height) ** 2;
      const len = Math.hypot(v.x, v.z) || 1;
      const theta = Math.atan2(v.x, v.z);
      const ripple = Math.sin(theta * 14 + v.y * 3) * 0.06 + Math.sin(theta * 31) * 0.03;
      const push = 1 + (k * height * 0.45 + ripple) / len;
      pos.setXYZ(i, v.x * push, v.y - k * height * 0.15, v.z * push);
    }
    geo.computeVertexNormals();
    const m = this.mesh(geo, this.water.clone(), false);
    m.position.copy(at);
    m.rotation.y = facing;
    return m;
  }

  private tide(at: Vector3, facing: number, reach: number, s: number): void {
    const m = this.crest(at, facing, reach * 0.55, 2.2, 0.9 * s);
    const mat = m.material as MeshPhysicalMaterial;
    const open = this.fan(at, reach * 1.2);
    const shape = shapeOf(m);
    this.add(m, (age) => {
      const t = age / 0.8;
      const grow = 0.45 + 0.65 * ease(t);
      m.scale.set(grow, Math.max(0.05, bump(Math.min(1, t * 1.15))), grow);
      open.hold(m, shape);
      mat.opacity = 0.95 * (1 - Math.max(0, (t - 0.65) / 0.35));
      return t < 1;
    }, [m.geometry, mat]);
    const forward = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    this.pool(this.placed(at, at.clone().addScaledVector(forward, reach * 0.65)), 1.6 * s, 3);
    this.droplets(this.placed(at, at.clone().addScaledVector(forward, reach * 0.7).setY(0.4)), 18, 3, 2, 0.8);
  }

  /** White water rushing upward: soft foam puffs that rise, swell and fade. */
  private foamColumn(at: Vector3, height: number, radius: number, count: number, life: number): void {
    const group = new Group();
    const geo = new PlaneGeometry(1, 1);
    const mat = this.foam.clone();
    const puffs: Array<{ m: Mesh; speed: number; phase: number; r: number; a: number }> = [];
    for (let i = 0; i < count; i++) {
      const m = new Mesh(geo, mat);
      puffs.push({ m, speed: height / (0.35 + Math.random() * 0.3), phase: Math.random() * 0.25, r: radius * Math.random(), a: Math.random() * Math.PI * 2 });
      group.add(m);
    }
    this.add(group, (age) => {
      for (const p of puffs) {
        const t = Math.max(0, age - p.phase);
        const y = Math.min(height, t * p.speed) - Math.max(0, t - 0.5) ** 2 * 6;
        p.m.position.set(at.x + Math.cos(p.a + t * 3) * p.r, Math.max(0.05, y), at.z + Math.sin(p.a + t * 3) * p.r);
        p.m.scale.setScalar(0.28 + t * 0.6);
        p.m.quaternion.copy(this.scene.userData.cameraQuaternion ?? p.m.quaternion);
      }
      mat.opacity = 0.7 * Math.min(1, (life - age) / 0.35);
      return age < life;
    }, [geo, mat]);
  }

  private geyser(at: Vector3, s: number): void {
    const height = 3.4 * s;
    const geo = new CylinderGeometry(0.22, 0.42, 1, 24, 8, true);
    geo.translate(0, 0.5, 0);
    const pos = geo.getAttribute('position');
    const base = Float32Array.from(pos.array as Float32Array);
    const mat = this.water.clone();
    const m = this.mesh(geo, mat, false);
    m.position.copy(at);
    this.add(m, (age) => {
      const t = age / 1.3;
      // The sheath ripples as it climbs, so it reads as moving water rather than a tube.
      for (let i = 0; i < pos.count; i++) {
        const y = base[i * 3 + 1]!;
        const w = 1 + Math.sin(y * 9 - age * 24 + i) * 0.12;
        pos.setXYZ(i, base[i * 3]! * w, y, base[i * 3 + 2]! * w);
      }
      pos.needsUpdate = true;
      m.scale.set(1 + bump(t) * 0.25, Math.max(0.01, height * (t < 0.25 ? ease(t / 0.25) : 1 - ease((t - 0.55) / 0.45))), 1 + bump(t) * 0.25);
      return t < 1;
    }, [geo, mat]);
    this.foamColumn(at, height, 0.4, 40, 1.3);
    this.droplets(at.clone().setY(height * 0.9), 30, 2.6, 3, 1.1);
    this.pool(at, 1.2, 2.5);
  }

  private freeze(at: Vector3, radius: number): void {
    const group = new Group();
    group.position.copy(at);
    const discGeo = new CircleGeometry(radius, 48);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = this.ice.clone();
    discMat.flatShading = false;
    discMat.transmission = 0;
    discMat.opacity = 0;
    const disc = this.mesh(discGeo, discMat, false);
    disc.position.y = 0.03;
    group.add(disc);
    // Ice spreads over the open ground and stops at walls.
    const open = this.fan(at, radius + 0.5);
    const discShape = shapeOf(disc);
    const shardMat = this.ice.clone();
    const shards: Mesh[] = [];
    const disposables: Array<BufferGeometry | Material> = [discGeo, discMat, shardMat];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + Math.random() * 0.2;
      const width = 0.1 + Math.random() * 0.1, height = 0.35 + Math.random() * 0.6;
      // A shard stands back from a wall by its width and by how far its tilt can lean it.
      const r = Math.min(radius * (0.35 + Math.random() * 0.6), open.at(Math.atan2(Math.cos(a), Math.sin(a))) - width - height * Math.sin(0.3));
      if (r <= 0) continue;
      const g = crystalGeometry(width, height, i * 1.7);
      disposables.push(g);
      const m = this.mesh(g, shardMat);
      m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      m.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * 3, (Math.random() - 0.5) * 0.6);
      m.scale.setScalar(0.01);
      shards.push(m);
      group.add(m);
    }
    const hold = 2.2;
    this.add(group, (age) => {
      discMat.opacity = 0.55 * ease(age / 0.2) * Math.min(1, (hold - age) / 0.5);
      disc.scale.setScalar(0.2 + 0.8 * ease(age / 0.25));
      if (age < 0.3) open.hold(disc, discShape);
      shards.forEach((m, i) => {
        const grow = ease((age - i * 0.008) / 0.18);
        const melt = age > hold - 0.5 ? 1 - ease((age - (hold - 0.5)) / 0.5) : 1;
        m.scale.setScalar(Math.max(0.01, grow * melt));
      });
      return age < hold;
    }, disposables);
  }

  private mend(at: Vector3, quality: 'waterskin' | 'natural' | 'wellspring' = 'waterskin'): void {
    const group = new Group();
    group.position.copy(at);
    const geo = new CylinderGeometry(0.7, 0.75, 0.3, 40, 1, true, 0, Math.PI * 1.2);
    const mat = this.wind.clone();
    if (quality === 'wellspring') {
      mat.color.setRGB(0.55, 0.98, 1.0);
    } else if (quality === 'natural') {
      mat.color.setRGB(0.25, 0.75, 1.0);
    } else {
      mat.color.setRGB(0.45, 0.85, 1.0);
    }
    const rings: Mesh[] = [];
    const ringCount = quality === 'wellspring' ? 6 : 4;
    for (let i = 0; i < ringCount; i++) { const m = new Mesh(geo, mat); rings.push(m); group.add(m); }
    this.add(group, (age) => {
      rings.forEach((m, i) => {
        const t = ((age * 0.7 + i / ringCount) % 1);
        m.position.y = 0.1 + t * 2.2;
        m.scale.setScalar(1 - t * 0.45);
        m.rotation.y = age * 5 + i * 1.6;
      });
      mat.opacity = 0.85 * Math.min(1, age / 0.2) * Math.min(1, (2 - age) / 0.3);
      return age < 2;
    }, [geo, mat]);
    const dropCount = quality === 'wellspring' ? 24 : 12;
    this.droplets(at.clone().setY(1.6), dropCount, 0.7, 0.9, 1.3);
  }

  private deluge(at: Vector3, forward: Vector3, facing: number): void {
    const back = at.clone().addScaledVector(forward, -3);
    const height = 2.4;
    const m = this.crest(back, facing, 4, 1.9, height);
    const mat = m.material as MeshPhysicalMaterial;
    // White water along the top of the wave, riding with it.
    const foamGeo = new PlaneGeometry(1, 1);
    const foamMat = this.foam.clone();
    const foam: Array<{ mesh: Mesh; theta: number; jitter: number }> = [];
    for (let i = 0; i < 34; i++) {
      const mesh = new Mesh(foamGeo, foamMat);
      foam.push({ mesh, theta: -0.95 + (i / 33) * 1.9, jitter: Math.random() });
      this.scene.add(mesh);
    }
    const crestTop = new Vector3();
    // The wave rises and rolls out from the caster; it breaks on any wall in its way.
    const open = this.fan(at, 11);
    const shape = shapeOf(m);
    this.add(new Group(), (age) => {
      const t = age / 1.0;
      const lift = bump(Math.min(1, t * 1.15));
      const r = 4 * (1 + t * 0.3) + height * 0.45;
      for (const f of foam) {
        crestTop.set(Math.sin(f.theta) * r, height * 0.85 * lift + f.jitter * 0.3, Math.cos(f.theta) * r).applyAxisAngle(UP, facing).add(m.position);
        const dx = crestTop.x - open.centre.x, dz = crestTop.z - open.centre.z, d = Math.hypot(dx, dz);
        const limit = open.at(Math.atan2(dx, dz));
        if (d > limit) { crestTop.x = open.centre.x + dx / d * limit; crestTop.z = open.centre.z + dz / d * limit; }
        f.mesh.position.copy(crestTop);
        f.mesh.scale.setScalar(0.5 + f.jitter * 0.5 + t * 0.4);
        f.mesh.quaternion.copy(this.scene.userData.cameraQuaternion ?? f.mesh.quaternion);
      }
      foamMat.opacity = 0.85 * (1 - Math.max(0, (t - 0.75) / 0.25));
      if (t >= 1) for (const f of foam) this.scene.remove(f.mesh);
      return t < 1;
    }, [foamGeo, foamMat]);
    this.add(m, (age) => {
      const t = age / 1.0;
      m.position.copy(back).addScaledVector(forward, t * 6);
      m.scale.set(1 + t * 0.3, Math.max(0.05, bump(Math.min(1, t * 1.15))), 1 + t * 0.3);
      open.hold(m, shape);
      mat.opacity = 0.95 * (1 - Math.max(0, (t - 0.75) / 0.25));
      return t < 1;
    }, [m.geometry, mat]);
    for (let k = 0; k < 5; k++) {
      const side = new Vector3().crossVectors(UP, forward).multiplyScalar((k - 2) * 1.3);
      this.foamColumn(this.placed(at, at.clone().addScaledVector(forward, 3).add(side), 0.6 + 0.3), 2.2, 0.6, 12, 1.1); // puffs orbit 0.6 m out and are 0.3 m across
    }
    this.pool(this.placed(at, at.clone().addScaledVector(forward, 4)), 5, 6);
    this.droplets(this.placed(at, at.clone().addScaledVector(forward, 4).setY(1.8)), 40, 4, 3, 1.2);
  }

  // TERRA

  /** A boulder torn from the floor under the throw; it rides the head and breaks where it ends. */
  private stoneShot(head: Flight, s: number): void {
    const geo = rockGeometry(stoneRadius(s), Math.random() * 10);
    const m = this.mesh(geo, this.stone);
    const ground = head.origin.clone().setY(-0.3);
    this.add(m, (age) => {
      // It comes up out of the ground and joins the head over the first moments.
      m.position.lerpVectors(ground, head.position, ease(age / 0.12));
      m.rotation.x += 0.35;
      m.rotation.z += 0.2;
      if (!head.done) return true;
      const at = head.end?.at ?? head.position;
      this.chips(at.clone(), 10, 0.12);
      this.dust(at.clone().setY(0), 0.8, 6);
      return false;
    }, [geo]);
    this.chips(ground.clone().setY(0.05), 6, 0.08);
  }

  private chips(at: Vector3, count: number, size: number): void {
    const group = new Group();
    const parts: Array<{ m: Mesh; v: Vector3; spin: number }> = [];
    const geos: BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const g = rockGeometry(size * (0.6 + Math.random()), i * 3.1);
      geos.push(g);
      const m = this.mesh(g, this.stone);
      m.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      parts.push({ m, v: new Vector3(Math.cos(a) * (1 + Math.random() * 2.5), 2 + Math.random() * 3, Math.sin(a) * (1 + Math.random() * 2.5)), spin: (Math.random() - 0.5) * 0.6 });
      group.add(m);
    }
    this.add(group, (age, dt) => {
      for (const p of parts) {
        p.v.y -= 9.8 * dt;
        this.carry(p.m.position, p.v, dt, size * 1.6); // the largest chip
        if (p.m.position.y < size) { p.m.position.y = size; p.v.multiplyScalar(0.4); p.v.y = Math.abs(p.v.y) * 0.3; }
        p.m.rotation.x += p.spin;
        if (age > 1.2) p.m.scale.multiplyScalar(0.9);
      }
      return age < 1.6;
    }, geos);
  }

  dust(at: Vector3, radius: number, count: number): void {
    const group = new Group();
    const geo = new PlaneGeometry(1, 1);
    const mat = this.spray.clone();
    mat.color.setRGB(0.62, 0.53, 0.42);
    const puffs: Array<{ m: Mesh; v: Vector3 }> = [];
    for (let i = 0; i < count; i++) {
      const m = new Mesh(geo, mat);
      const a = (i / count) * Math.PI * 2;
      // Spread out from the centre the same way it moves, so no puff starts inside a wall.
      m.position.copy(at).setY(at.y + 0.3);
      this.carry(m.position, new Vector3(Math.cos(a) * radius * 0.4, 0, Math.sin(a) * radius * 0.4), 1, 0.1);
      puffs.push({ m, v: new Vector3(Math.cos(a) * radius * 1.5, 0.4 + Math.random() * 0.5, Math.sin(a) * radius * 1.5) });
      group.add(m);
    }
    this.add(group, (age, dt) => {
      for (const p of puffs) {
        this.carry(p.m.position, p.v, dt, 0.1);
        p.v.multiplyScalar(0.92);
        p.m.scale.setScalar(0.6 + age * 2.2);
        p.m.quaternion.copy(this.scene.userData.cameraQuaternion ?? p.m.quaternion);
      }
      mat.opacity = 0.55 * (1 - age / 1.1);
      return age < 1.1;
    }, [geo, mat]);
  }

  private rockWave(at: Vector3, forward: Vector3, reach: number, s: number): void {
    const side = new Vector3().crossVectors(UP, forward);
    const group = new Group();
    const spikes: Array<{ m: Mesh; delay: number }> = [];
    const geos: BufferGeometry[] = [];
    const count = Math.round(9 * s);
    // Spikes break out of the floor only as far as the ground runs before a wall.
    const open = this.placed(at, at.clone().addScaledVector(forward, 0.8 + reach), 0.35).distanceTo(at);
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / count;
      if (0.8 + t * reach > open) break;
      const g = spikeGeometry(0.22 + t * 0.12, 0.7 + t * 0.9, i * 1.3);
      geos.push(g);
      const m = this.mesh(g, this.stone);
      m.position.copy(at).addScaledVector(forward, 0.8 + t * reach).addScaledVector(side, (i % 2 ? 1 : -1) * 0.25);
      m.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 3, (Math.random() - 0.5) * 0.4);
      m.scale.setScalar(0.01);
      spikes.push({ m, delay: i * 0.045 });
      group.add(m);
    }
    this.add(group, (age) => {
      for (const sp of spikes) {
        const t = age - sp.delay;
        const up = ease(t / 0.12);
        const down = t > 0.9 ? ease((t - 0.9) / 0.35) : 0;
        sp.m.scale.setScalar(Math.max(0.01, up));
        sp.m.position.y = -down * 1.6;
      }
      return age < 1.4;
    }, geos);
    this.dust(this.placed(at, at.clone().addScaledVector(forward, reach * 0.6)), 1.2, 10);
  }

  private spire(at: Vector3, s: number): void {
    const geo = spikeGeometry(0.45, 2.8 * s, 2.1);
    const m = this.mesh(geo, this.stone);
    m.position.copy(at);
    this.add(m, (age) => {
      const up = ease(age / 0.14);
      const down = age > 0.8 ? ease((age - 0.8) / 0.4) : 0;
      m.position.y = -2.8 * s * (1 - up) - down * 3;
      return age < 1.2;
    }, [geo]);
    this.chips(at.clone().setY(0.1), 8, 0.1);
    this.dust(at, 1, 8);
  }

  private wall(at: Vector3, facing: number, s: number): void {
    const height = 2.2 * Math.min(1, s);
    const geo = wallGeometry(3, height, 0.7);
    const m = this.mesh(geo, this.stone);
    m.position.copy(at);
    m.rotation.y = facing;
    const hold = 5;
    this.onWall?.(at.clone().setY(height / 2), facing, new Vector3(3, height, 0.7), hold - 0.4);
    this.add(m, (age) => {
      const up = ease(age / 0.25);
      const down = age > hold - 0.5 ? ease((age - (hold - 0.5)) / 0.5) : 0;
      m.position.y = -height * (1 - up) - height * down;
      return age < hold;
    }, [geo]);
    this.chips(at.clone().setY(0.1), 12, 0.1);
    this.dust(at, 1.8, 14);
  }

  private landfall(at: Vector3, facing: number): void {
    for (let i = 0; i < 7; i++) {
      // Spread over the 240 degrees in front, so nothing lands on the camera behind.
      const a = Math.PI / 2 - facing + ((i / 6) - 0.5) * (Math.PI * 4 / 3) + (Math.random() - 0.5) * 0.3;
      const r = 2 + Math.random() * 2.8;
      const size = 0.5 + Math.random() * 0.45;
      const target = this.placed(at, at.clone().add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), size * ROCK_BULGE);
      const geo = rockGeometry(size, i * 5.7);
      const m = this.mesh(geo, this.stone);
      const delay = 0.15 + i * 0.07;
      let landed = false;
      this.add(m, (age) => {
        const t = (age - delay) / 0.35;
        m.visible = t > 0;
        m.position.copy(target).setY(size * 0.7 + Math.max(0, 1 - t) * 9);
        m.rotation.x = t * 2;
        if (t >= 1 && !landed) { landed = true; this.dust(target, 1.4, 10); this.chips(target.clone().setY(0.2), 5, 0.12); }
        const sink = age > 2.6 ? ease((age - 2.6) / 0.6) : 0;
        m.position.y -= sink * size * 2;
        return age < 3.2;
      }, [geo]);
    }
    this.dust(at, 3, 18);
  }

  // AURA

  /** Crescents of wind, the first at the head and the rest trailing behind it towards the hand. */
  private airBlade(head: Flight, s: number): void {
    const group = new Group();
    const geo = new RingGeometry(0.75 * s + 0.2, 0.95 * s + 0.25, 32, 1, Math.PI * 0.15, Math.PI * 0.7);
    const blades: Mesh[] = [];
    const mat = this.wind.clone();
    mat.map = this.soft;
    const facing = Math.atan2(head.velocity.x, head.velocity.z);
    const back = head.velocity.clone().normalize().negate();
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(geo, mat);
      m.rotation.set(0, facing, Math.PI / 2);
      m.scale.setScalar(1 - i * 0.12);
      blades.push(m);
      group.add(m);
    }
    let endedAt = -1;
    this.add(group, (age) => {
      const flown = head.position.distanceTo(head.origin);
      // Each trailing blade sits behind the head, never behind the hand, so none is ever past it.
      blades.forEach((m, i) => m.position.copy(head.position).addScaledVector(back, Math.min(flown, i * 0.35)));
      if (endedAt < 0 && head.done) { endedAt = age; this.dust((head.end?.at ?? head.position).clone().setY(0), 0.6, 5); }
      const fade = endedAt < 0 ? 0 : (age - endedAt) / 0.15;
      mat.opacity = 0.75 * Math.max(0, 1 - fade);
      return fade < 1;
    }, [geo, mat]);
  }

  /** Streaks fanning out from a point inside an arc. */
  private streaks(at: Vector3, facing: number, arc: number, reach: number, count: number, height: number, life: number): void {
    const group = new Group();
    const geo = new PlaneGeometry(1.6, 0.12);
    const mat = this.wind.clone();
    const lines: Array<{ m: Mesh; dir: Vector3; delay: number; y: number; open: number }> = [];
    for (let i = 0; i < count; i++) {
      const a = facing + (Math.random() - 0.5) * arc;
      const dir = new Vector3(Math.sin(a), 0, Math.cos(a));
      const m = new Mesh(geo, mat);
      m.rotation.y = a - Math.PI / 2;
      const y = 0.3 + Math.random() * height;
      // How far this line can run before the world stops it.
      stepFrom.copy(at).setY(y);
      stepTo.copy(stepFrom).addScaledVector(dir, 0.6 + reach + 3);
      const open = this.space?.obstruction(stepFrom, stepTo, 0.06) ?? Infinity;
      lines.push({ m, dir, delay: Math.random() * 0.12, y, open });
      group.add(m);
    }
    this.add(group, (age) => {
      for (const l of lines) {
        const t = Math.max(0, age - l.delay) / life;
        // The line's front edge (centre plus half its 1.6 m length) never passes the open distance.
        const centre = Math.min(0.6 + ease(t) * reach, l.open - 0.05);
        const length = Math.max(0, Math.min(0.6 + t * 1.6, (l.open - centre) / 0.8));
        l.m.position.copy(at).addScaledVector(l.dir, centre).setY(l.y);
        l.m.scale.set(Math.max(1e-3, length), 1, 1);
      }
      mat.opacity = 0.7 * (1 - age / (life + 0.12));
      return age < life + 0.12;
    }, [geo, mat]);
  }

  private gust(at: Vector3, facing: number, reach: number, s: number): void {
    this.streaks(at, facing, 1.3, reach * s, 22, 1.8, 0.45);
    this.dust(at.clone().add(new Vector3(Math.sin(facing), 0, Math.cos(facing)).multiplyScalar(2)), 1.2, 8);
  }

  private updraft(at: Vector3, s: number): void {
    this.cyclone(at, 0.8, 0.8 * s);
    const group = new Group();
    const geo = new PlaneGeometry(0.08, 1.6);
    const mat = this.wind.clone();
    const lines: Mesh[] = [];
    for (let i = 0; i < 12; i++) {
      const m = new Mesh(geo, mat);
      const a = (i / 12) * Math.PI * 2;
      m.position.set(at.x + Math.cos(a) * 0.6, 0, at.z + Math.sin(a) * 0.6);
      m.rotation.y = -a;
      lines.push(m);
      group.add(m);
    }
    this.add(group, (age) => {
      lines.forEach((m, i) => { m.position.y = 0.5 + ((age * 6 + i * 0.3) % 3.5); });
      mat.opacity = 0.7 * (1 - age / 0.8);
      return age < 0.8;
    }, [geo, mat]);
  }

  private cyclone(at: Vector3, seconds: number, scale: number): void {
    const group = new Group();
    group.position.copy(at);
    const mat = this.wind.clone();
    const rings: Mesh[] = [];
    const geos: BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const r = (0.5 + i * 0.32) * scale;
      // An open band with the streak running round it: wind, not a hoop.
      const g = new CylinderGeometry(r, r * 1.08, 0.22 + i * 0.03, 48, 1, true, Math.random() * 6, Math.PI * 1.3);
      geos.push(g);
      const m = new Mesh(g, mat);
      m.position.y = 0.2 + i * 0.42;
      rings.push(m);
      group.add(m);
    }
    // Wind turns along walls instead of through them.
    const open = this.fan(at, (0.5 + 5 * 0.32) * scale * 1.1 + 0.5);
    const shapes = rings.map(shapeOf);
    this.add(group, (age, dt) => {
      rings.forEach((m, i) => { m.rotation.y += dt * (9 - i * 0.8); });
      group.scale.setScalar(0.3 + 0.7 * ease(age / 0.2));
      rings.forEach((m, i) => open.hold(m, shapes[i]!));
      mat.opacity = 0.55 * Math.min(1, (seconds - age) / 0.3);
      return age < seconds;
    }, [...geos, mat]);
    this.dust(at, 1.2, 8);
  }

  private windStep(at: Vector3, forward: Vector3, facing: number): void {
    this.streaks(at.clone().addScaledVector(forward, -1), facing + Math.PI, 0.3, 3, 14, 1.7, 0.35);
  }

  private tempest(at: Vector3, seconds: number): void {
    this.cyclone(at, seconds, 2.6);
    for (let k = 0; k < 4; k++) {
      const delay = k * 0.9;
      this.add(new Group(), (age) => {
        if (age >= delay && age - 0.05 < delay) this.streaks(at, Math.random() * Math.PI * 2, Math.PI * 2, 7, 26, 2.4, 0.6);
        return age < delay + 0.06;
      });
    }
  }
}
