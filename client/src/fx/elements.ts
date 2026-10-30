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
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Element } from '../../../shared/src/index.js';

type Updater = (age: number, delta: number) => boolean;
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
function rockGeometry(radius: number, seed: number): BufferGeometry {
  const geo = new IcosahedronGeometry(radius, 1);
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 7.1 + seed) * Math.cos(v.y * 5.3 - seed) * Math.sin(v.z * 6.7 + seed * 2);
    v.multiplyScalar(1 + n * 0.28);
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
  private readonly wind: MeshBasicMaterial;
  private readonly textures: Texture[] = [];
  /** Pools and floods AQUES made; they count as water to bend from while they last. */
  readonly pools: Array<{ position: Vector3; until: number }> = [];
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

  /** Draws one bending move. `strength` below 1 means a weaker move from an empty meter. */
  cast(element: Element, move: string, origin: Vector3, facing: number, strength = 1): void {
    const forward = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    const at = origin.clone().setY(0);
    const s = Math.max(0.55, Math.min(1.4, strength));
    const key = `${element}:${move}`;
    switch (key) {
      case 'AQUES:bend_palm': this.lash(at, forward, 6, s); break;
      case 'AQUES:bend_sweep': this.tide(at, facing, 4.5, s); break;
      case 'AQUES:uppercut': this.geyser(at.clone().addScaledVector(forward, 1.3), s); break;
      case 'AQUES:ground_pound': this.freeze(at, 4 * s); break;
      case 'AQUES:dash_strike': this.mend(at); break;
      case 'AQUES:ultimate': this.deluge(at, forward, facing); break;
      case 'TERRA:bend_palm': this.stoneShot(at, forward, 8, s); break;
      case 'TERRA:bend_sweep': this.rockWave(at, forward, 5, s); break;
      case 'TERRA:uppercut': this.spire(at.clone().addScaledVector(forward, 1.3), s); break;
      case 'TERRA:ground_pound': this.wall(at.clone().addScaledVector(forward, 1.6), facing, s); break;
      case 'TERRA:dash_strike': this.dust(at, 1.6, 14); break;
      case 'TERRA:ultimate': this.landfall(at, facing); break;
      case 'AURA:bend_palm': this.airBlade(at, forward, facing, 10, s); break;
      case 'AURA:bend_sweep': this.gust(at, facing, 5, s); break;
      case 'AURA:uppercut': this.updraft(at.clone().addScaledVector(forward, 1.0), s); break;
      case 'AURA:ground_pound': this.cyclone(at.clone().addScaledVector(forward, 1.8), 1.5, 1.4 * s); break;
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

  /** A weak spark of any element thrown by a Hush. */
  spark(element: Element, origin: Vector3, facing: number): void {
    const forward = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    const at = origin.clone().setY(0);
    if (element === 'AQUES') this.lash(at, forward, 5, 0.55);
    else if (element === 'TERRA') this.stoneShot(at, forward, 6, 0.55);
    else this.airBlade(at, forward, facing, 7, 0.55);
  }

  update(delta: number): void {
    this.clock += delta;
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
        d.m.position.addScaledVector(d.v, dt);
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
    this.add(m, (age) => {
      mat.opacity = 0.62 * Math.min(1, age / 0.25) * Math.min(1, (seconds - age) / 0.8);
      m.scale.setScalar(0.6 + 0.4 * ease(age / 0.3));
      return age < seconds;
    }, [geo, mat]);
  }

  // AQUES

  private lash(at: Vector3, forward: Vector3, reach: number, s: number): void {
    const side = new Vector3().crossVectors(UP, forward);
    const pts = [0, 0.25, 0.5, 0.75, 1].map((t, i) =>
      at.clone().addScaledVector(forward, 0.5 + t * reach * s).addScaledVector(side, Math.sin(t * Math.PI * 1.5) * 0.45).setY(1.25 + Math.sin(t * Math.PI) * 0.35 - t * 0.4 + (i === 0 ? 0.1 : 0)));
    const curve = new CatmullRomCurve3(pts);
    const geo = new TubeGeometry(curve, 64, 0.13 * s + 0.05, 10, false);
    const mat = this.water.clone();
    const m = this.mesh(geo, mat, false);
    geo.setDrawRange(0, 0);
    const total = geo.index!.count;
    const tip = curve.getPoint(1);
    let splashed = false;
    this.add(m, (age) => {
      const out = ease(age / 0.18);
      const back = age > 0.5 ? ease((age - 0.5) / 0.25) : 0;
      const start = Math.floor(total * back / 6) * 6;
      geo.setDrawRange(start, Math.max(0, Math.floor(total * out / 6) * 6 - start));
      if (!splashed && age > 0.2) { splashed = true; this.droplets(tip, 18, 2.2, 2.4, 0.8); this.foamColumn(tip.clone().setY(0.6), 1.2, 0.3, 10, 0.5); }
      return age < 0.78;
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
    this.add(m, (age) => {
      const t = age / 0.8;
      const grow = 0.45 + 0.65 * ease(t);
      m.scale.set(grow, Math.max(0.05, bump(Math.min(1, t * 1.15))), grow);
      mat.opacity = 0.95 * (1 - Math.max(0, (t - 0.65) / 0.35));
      return t < 1;
    }, [m.geometry, mat]);
    const forward = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    this.pool(at.clone().addScaledVector(forward, reach * 0.65), 1.6 * s, 3);
    this.droplets(at.clone().addScaledVector(forward, reach * 0.7).setY(0.4), 18, 3, 2, 0.8);
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
    const shardMat = this.ice.clone();
    const shards: Mesh[] = [];
    const disposables: Array<BufferGeometry | Material> = [discGeo, discMat, shardMat];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + Math.random() * 0.2;
      const r = radius * (0.35 + Math.random() * 0.6);
      const g = crystalGeometry(0.1 + Math.random() * 0.1, 0.35 + Math.random() * 0.6, i * 1.7);
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
      shards.forEach((m, i) => {
        const grow = ease((age - i * 0.008) / 0.18);
        const melt = age > hold - 0.5 ? 1 - ease((age - (hold - 0.5)) / 0.5) : 1;
        m.scale.setScalar(Math.max(0.01, grow * melt));
      });
      return age < hold;
    }, disposables);
  }

  private mend(at: Vector3): void {
    const group = new Group();
    group.position.copy(at);
    const geo = new CylinderGeometry(0.7, 0.75, 0.3, 40, 1, true, 0, Math.PI * 1.2);
    const mat = this.wind.clone();
    mat.color.setRGB(0.45, 0.85, 1);
    const rings: Mesh[] = [];
    for (let i = 0; i < 4; i++) { const m = new Mesh(geo, mat); rings.push(m); group.add(m); }
    this.add(group, (age) => {
      rings.forEach((m, i) => {
        const t = ((age * 0.7 + i / 4) % 1);
        m.position.y = 0.1 + t * 2.0;
        m.scale.setScalar(1 - t * 0.45);
        m.rotation.y = age * 5 + i * 1.6;
      });
      mat.opacity = 0.75 * Math.min(1, age / 0.2) * Math.min(1, (2 - age) / 0.3);
      return age < 2;
    }, [geo, mat]);
    this.droplets(at.clone().setY(1.6), 12, 0.6, 0.8, 1.2);
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
    this.add(new Group(), (age) => {
      const t = age / 1.0;
      const lift = bump(Math.min(1, t * 1.15));
      const r = 4 * (1 + t * 0.3) + height * 0.45;
      for (const f of foam) {
        crestTop.set(Math.sin(f.theta) * r, height * 0.85 * lift + f.jitter * 0.3, Math.cos(f.theta) * r).applyAxisAngle(UP, facing).add(m.position);
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
      mat.opacity = 0.95 * (1 - Math.max(0, (t - 0.75) / 0.25));
      return t < 1;
    }, [m.geometry, mat]);
    for (let k = 0; k < 5; k++) {
      const side = new Vector3().crossVectors(UP, forward).multiplyScalar((k - 2) * 1.3);
      this.foamColumn(at.clone().addScaledVector(forward, 3).add(side), 2.2, 0.6, 12, 1.1);
    }
    this.pool(at.clone().addScaledVector(forward, 4), 5, 6);
    this.droplets(at.clone().addScaledVector(forward, 4).setY(1.8), 40, 4, 3, 1.2);
  }

  // TERRA

  private stoneShot(at: Vector3, forward: Vector3, reach: number, s: number): void {
    const geo = rockGeometry(0.42 * (0.7 + s * 0.3), Math.random() * 10);
    const m = this.mesh(geo, this.stone);
    const right = new Vector3().crossVectors(forward, UP);
    const start = at.clone().addScaledVector(forward, 1.1).addScaledVector(right, 0.7);
    let burst = false;
    this.add(m, (age) => {
      if (age < 0.22) {
        m.position.copy(start).setY(-0.3 + ease(age / 0.22) * 1.9);
      } else {
        const t = (age - 0.22) / 0.4;
        m.position.copy(start).addScaledVector(forward, t * reach * s).addScaledVector(right, -t * 0.7).setY(1.6 - t * 0.5);
        m.rotation.x += 0.35;
        m.rotation.z += 0.2;
        if (t >= 1 && !burst) { burst = true; this.chips(m.position.clone(), 10, 0.12); this.dust(m.position.clone().setY(0), 0.8, 6); }
        if (t >= 1) return false;
      }
      return true;
    }, [geo]);
    this.chips(start.clone().setY(0.05), 6, 0.08);
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
        p.m.position.addScaledVector(p.v, dt);
        if (p.m.position.y < size) { p.m.position.y = size; p.v.multiplyScalar(0.4); p.v.y = Math.abs(p.v.y) * 0.3; }
        p.m.rotation.x += p.spin;
        if (age > 1.2) p.m.scale.multiplyScalar(0.9);
      }
      return age < 1.6;
    }, geos);
  }

  private dust(at: Vector3, radius: number, count: number): void {
    const group = new Group();
    const geo = new PlaneGeometry(1, 1);
    const mat = this.spray.clone();
    mat.color.setRGB(0.62, 0.53, 0.42);
    const puffs: Array<{ m: Mesh; v: Vector3 }> = [];
    for (let i = 0; i < count; i++) {
      const m = new Mesh(geo, mat);
      const a = (i / count) * Math.PI * 2;
      m.position.copy(at).add(new Vector3(Math.cos(a) * radius * 0.4, 0.3, Math.sin(a) * radius * 0.4));
      puffs.push({ m, v: new Vector3(Math.cos(a) * radius * 1.5, 0.4 + Math.random() * 0.5, Math.sin(a) * radius * 1.5) });
      group.add(m);
    }
    this.add(group, (age, dt) => {
      for (const p of puffs) {
        p.m.position.addScaledVector(p.v, dt);
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
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / count;
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
    this.dust(at.clone().addScaledVector(forward, reach * 0.6), 1.2, 10);
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
      const target = at.clone().add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      const size = 0.5 + Math.random() * 0.45;
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

  private airBlade(at: Vector3, forward: Vector3, facing: number, reach: number, s: number): void {
    const group = new Group();
    const geo = new RingGeometry(0.75 * s + 0.2, 0.95 * s + 0.25, 32, 1, Math.PI * 0.15, Math.PI * 0.7);
    const blades: Mesh[] = [];
    const mat = this.wind.clone();
    mat.map = this.soft;
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(geo, mat);
      m.rotation.set(0, facing, Math.PI / 2);
      blades.push(m);
      group.add(m);
    }
    this.add(group, (age) => {
      const t = age / 0.55;
      blades.forEach((m, i) => {
        const lag = Math.max(0, t - i * 0.05);
        m.position.copy(at).addScaledVector(forward, 0.8 + lag * reach).setY(1.2);
        m.scale.setScalar(1 - i * 0.12);
      });
      mat.opacity = 0.75 * (1 - Math.max(0, (t - 0.75) / 0.25));
      return t < 1;
    }, [geo, mat]);
  }

  /** Streaks fanning out from a point inside an arc. */
  private streaks(at: Vector3, facing: number, arc: number, reach: number, count: number, height: number, life: number): void {
    const group = new Group();
    const geo = new PlaneGeometry(1.6, 0.12);
    const mat = this.wind.clone();
    const lines: Array<{ m: Mesh; dir: Vector3; delay: number; y: number }> = [];
    for (let i = 0; i < count; i++) {
      const a = facing + (Math.random() - 0.5) * arc;
      const dir = new Vector3(Math.sin(a), 0, Math.cos(a));
      const m = new Mesh(geo, mat);
      m.rotation.y = a - Math.PI / 2;
      lines.push({ m, dir, delay: Math.random() * 0.12, y: 0.3 + Math.random() * height });
      group.add(m);
    }
    this.add(group, (age) => {
      for (const l of lines) {
        const t = Math.max(0, age - l.delay) / life;
        l.m.position.copy(at).addScaledVector(l.dir, 0.6 + ease(t) * reach).setY(l.y);
        l.m.scale.set(0.6 + t * 1.6, 1, 1);
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
    this.add(group, (age, dt) => {
      rings.forEach((m, i) => { m.rotation.y += dt * (9 - i * 0.8); });
      group.scale.setScalar(0.3 + 0.7 * ease(age / 0.2));
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
