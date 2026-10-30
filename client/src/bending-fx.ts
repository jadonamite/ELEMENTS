import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  PointLight,
  Quaternion,
  type Camera,
  type Scene,
  Vector3,
} from 'three';
import type { Element } from '../../shared/src/index.js';
import { BladeTrail } from './fx/blade-trail.js';
import { FlameField, FxMode } from './fx/flame-field.js';
import { SoftDepth } from './fx/soft-depth.js';
import { GroundRings } from './fx/ground-ring.js';
import { FireWalls } from './fx/fire-wall.js';

export type BendingType = Element | 'HUSH';

export interface ElementStyle {
  core: string;
  primary: string;
  secondary: string;
  smoke: string;
  lightHex: number;
  edgeHex: number;
}

export const ELEMENT_STYLES: Record<BendingType, ElementStyle> = {
  IGNIS: {
    core: '#fff3c0',
    primary: '#ff7a1a',
    secondary: '#ffae25',
    smoke: '#280800',
    lightHex: 0xff9b29,
    edgeHex: 0xff6a00,
  },
  AQUES: {
    core: '#f0ffff',
    primary: '#7fd4ff',
    secondary: '#2a7fd0',
    smoke: '#002040',
    lightHex: 0x0099ff,
    edgeHex: 0x48f0ff,
  },
  TERRA: {
    core: '#fff4b8',
    primary: '#d88e18',
    secondary: '#885518',
    smoke: '#3a2612',
    lightHex: 0xd89524,
    edgeHex: 0xffcc44,
  },
  AURA: {
    core: '#ffffff',
    primary: '#c8f0ff',
    secondary: '#80c8e8',
    smoke: '#183040',
    lightHex: 0x88ddff,
    edgeHex: 0xc8f0ff,
  },
  HUSH: {
    core: '#faeeff',
    primary: '#aa44ff',
    secondary: '#551188',
    smoke: '#150524',
    lightHex: 0x9955ee,
    edgeHex: 0xdd88ff,
  },
};

/** Shader look for an element's flames. */
function flameMode(element: BendingType): FxMode {
  switch (element) {
    case 'AQUES': return FxMode.WATER;
    case 'TERRA': return FxMode.ROCK;
    case 'AURA': return FxMode.WIND;
    case 'HUSH': return FxMode.HUSH;
    default: return FxMode.FIRE;
  }
}

/** Shader look for what rises off an element: smoke, mist or dust. */
function smokeMode(element: BendingType): FxMode {
  switch (element) {
    case 'AQUES':
    case 'AURA': return FxMode.MIST;
    case 'TERRA': return FxMode.DUST;
    default: return FxMode.SMOKE;
  }
}

/** Canvas textures for sparks, stone chips and scorch decals. */
function createProceduralTexture(type: 'spark' | 'chip' | 'scorch'): CanvasTexture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const size = type === 'scorch' ? 256 : 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const center = size / 2;

  if (type === 'spark') {
    const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  } else if (type === 'chip') {
    // An irregular stone fragment, lit from the top left.
    ctx.beginPath();
    const points = 7;
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const r = center * (0.55 + ((i * 37) % 10) / 25);
      ctx.lineTo(center + Math.cos(a) * r, center + Math.sin(a) * r);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(120, 120, 120, 1)');
    ctx.fillStyle = grad;
    ctx.fill();
  } else {
    const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
    grad.addColorStop(0, 'rgba(12, 10, 8, 0.9)');
    grad.addColorStop(0.35, 'rgba(20, 16, 12, 0.78)');
    grad.addColorStop(0.7, 'rgba(24, 18, 14, 0.4)');
    grad.addColorStop(1, 'rgba(24, 18, 14, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Radial scorch cracks and glowing embers left in them.
    ctx.strokeStyle = 'rgba(10, 8, 6, 0.75)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + Math.sin(i * 3) * 0.2;
      const len = center * (0.6 + (i % 3) * 0.16);
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.quadraticCurveTo(
        center + Math.cos(angle + 0.1) * len * 0.5, center + Math.sin(angle + 0.1) * len * 0.5,
        center + Math.cos(angle) * len, center + Math.sin(angle) * len,
      );
      ctx.stroke();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

type SpriteKind = 'spark' | 'chip';

interface Particle {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  active: boolean;
  kind: SpriteKind;
  position: Vector3;
  velocity: Vector3;
  gravity: number;
  drag: number;
  elapsed: number;
  duration: number;
  startSize: number;
  endSize: number;
  rotation: number;
  rotationSpeed: number;
  colorCore: Color;
  colorMid: Color;
  baseOpacity: number;
}

interface ScorchMark {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  active: boolean;
  elapsed: number;
  duration: number;
  fadeIn: number;
  maxOpacity: number;
}

export interface ActiveFirePatch {
  readonly id: number;
  readonly position: Vector3;
  readonly radius: number;
  readonly duration: number;
  readonly elapsed: number;
  readonly element?: BendingType;
}

export interface BurningHuskInfo {
  readonly position: Vector3;
  readonly alive: boolean;
}

interface FireballProjectile {
  active: boolean;
  position: Vector3;
  velocity: Vector3;
  element: BendingType;
  duration: number;
  elapsed: number;
  /** Thrown by a villain: no burning ground is left where it lands. */
  hostile: boolean;
}

const POOL_SPARKS = 220;
const POOL_CHIPS = 60;
const POOL_SCORCH = 24;
const POOL_PATCH_LIGHTS = 2;
const MAX_FIRE_PATCHES = 16;
const BLADE_EDGE_NODES = 11;
const SLASH_CAPTURE = 0.9;
const HEAVY_SLASH_CAPTURE = 1.0;
/** A blade that has not swept by now is not swinging (the move is bare-handed). */
const SLASH_FALLBACK_AFTER = 0.55;
const GOLDEN_ANGLE = 2.39996;

const tmpQuat = new Quaternion();
const tmpVec = new Vector3();

/**
 * Elemental bending visuals:
 * - Fire and smoke use baked fluid flipbooks; spray and dust retain their element shaders
 * - Fire slams roll outward in clustered flames; slash particles follow sampled blade poses
 * - Sparks, embers and stone chips are pooled sprites, streaked along their motion
 * - Scorch decals and flickering lights ground every hit
 */
export class BendingEffects {
  private readonly root = new Group();
  private readonly particles: Particle[] = [];
  private readonly scorchPool: ScorchMark[] = [];
  private readonly field: FlameField;
  private readonly depth: SoftDepth;
  private lowQuality = false;
  private readonly bladeMotion = new Vector3();
  private readonly waves: { x: number; y: number; z: number; age: number; seed: number; mode: FxMode; wall: number }[] = [];
  private readonly walls: FireWalls;
  private readonly scorchedPatches = new Set<number>();
  private readonly rings: GroundRings;
  private readonly trail: BladeTrail;

  private readonly texSpark = createProceduralTexture('spark');
  private readonly texChip = createProceduralTexture('chip');
  private readonly texScorch = createProceduralTexture('scorch');

  // Lit sword
  private isLit = false;
  private currentElement: BendingType = 'IGNIS';
  private auraClock = 0;
  private lastDelta = 1 / 60;
  private readonly bladeLight: PointLight;
  private hasBlade = false;
  private readonly bladeBase = new Vector3();
  private readonly bladeTip = new Vector3();
  private readonly prevTip = new Vector3();
  private tipSpeed = 0;
  private lastTipAt = 0;
  private emberDebt = 0;

  // Slash capture: the trail records the blade while a slash is live.
  private slashTimer = 0;
  private slashSweep = 0;
  private slashElement: BendingType = 'IGNIS';
  private slashHeavy = false;
  private synthetic = { active: false, t: 0, origin: new Vector3(), facing: 0 };
  private slashTongueTimer = 0;

  // Flash light for uppercut / slam
  private readonly flashLight: PointLight;
  private flashDuration = 0;
  private flashElapsed = 0;
  private flashIntensity = 0;
  private flashFlicker = false;

  // Living fire patches & burning husks
  private activePatches: ActiveFirePatch[] = [];
  private burningHusks: BurningHuskInfo[] = [];
  private readonly patchLights: PointLight[] = [];
  private readonly fireballs: FireballProjectile[] = [];
  private patchSmokeClock = 0;

  onFireballImpact?: (pos: Vector3, element: BendingType, hostile: boolean) => void;

  constructor(private readonly scene: Scene) {
    this.root.name = 'BendingEffects';
    this.scene.add(this.root);

    this.depth = new SoftDepth(scene, this.root);
    this.field = new FlameField(this.root, this.depth);
    this.rings = new GroundRings(this.root, this.field.time);
    this.walls = new FireWalls(this.root, this.field.time);
    this.trail = new BladeTrail(this.root, this.field.time);
    const syncAtlas = () => {
      const tex = this.field.getTexture(0);
      if (tex) this.trail.setAtlas(tex);
    };
    this.field.onTexturesUpdated = syncAtlas;
    syncAtlas();
    this.setQuality(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fxQuality') === 'low' ? 'low' : 'high');

    const quadGeo = new PlaneGeometry(1, 1);
    const addSprites = (kind: SpriteKind, count: number): void => {
      for (let i = 0; i < count; i++) {
        const mat = new MeshBasicMaterial({
          map: kind === 'spark' ? this.texSpark : this.texChip,
          transparent: true,
          blending: kind === 'spark' ? AdditiveBlending : NormalBlending,
          depthWrite: false,
          side: DoubleSide,
          opacity: 0,
          fog: false,
        });
        const mesh = new Mesh(quadGeo, mat);
        mesh.visible = false;
        mesh.renderOrder = 3;
        this.root.add(mesh);
        this.particles.push({
          mesh, mat, active: false, kind,
          position: new Vector3(), velocity: new Vector3(),
          gravity: 0, drag: 0.98, elapsed: 0, duration: 1,
          startSize: 0.1, endSize: 0.05, rotation: 0, rotationSpeed: 0,
          colorCore: new Color(), colorMid: new Color(), baseOpacity: 1,
        });
      }
    };
    addSprites('spark', POOL_SPARKS);
    addSprites('chip', POOL_CHIPS);

    const scorchGeo = new PlaneGeometry(1, 1);
    scorchGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < POOL_SCORCH; i++) {
      const mat = new MeshBasicMaterial({
        map: this.texScorch,
        transparent: true,
        blending: NormalBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1.0,
        polygonOffsetUnits: -4.0,
        opacity: 0,
      });
      const mesh = new Mesh(scorchGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.scorchPool.push({ mesh, mat, active: false, elapsed: 0, duration: 2.0, fadeIn: 0.15, maxOpacity: 0.85 });
    }

    this.bladeLight = new PointLight(0xff5511, 0, 4.5, 1.8);
    this.bladeLight.castShadow = false;
    this.root.add(this.bladeLight);

    this.flashLight = new PointLight(0xff5511, 0, 9.0, 1.6);
    this.flashLight.castShadow = false;
    this.root.add(this.flashLight);

    for (let i = 0; i < POOL_PATCH_LIGHTS; i++) {
      const pl = new PointLight(0xff4d00, 0, 4.5, 1.8);
      pl.castShadow = false;
      this.root.add(pl);
      this.patchLights.push(pl);
    }

    for (let i = 0; i < 6; i++) {
      this.fireballs.push({ active: false, position: new Vector3(), velocity: new Vector3(), element: 'IGNIS', duration: 0, elapsed: 0, hostile: false });
    }
  }

  /**
   * Updates lit bending mode state and where the blade is this frame.
   */
  setLit(
    lit: boolean,
    element: BendingType = 'IGNIS',
    _heroPos?: Vector3,
    _facing = 0,
    bladeBase?: Vector3,
    bladeTip?: Vector3,
  ): void {
    this.isLit = lit;
    this.currentElement = element;
    this.hasBlade = !!bladeBase && !!bladeTip;
    if (!bladeBase || !bladeTip) return;

    // Speed on the wall clock, so slow motion still reads as a swing.
    const now = performance.now();
    const wall = Math.max(1e-3, (now - this.lastTipAt) / 1000);
    this.lastTipAt = now;
    const moved = this.prevTip.distanceTo(bladeTip);
    // A jump no swing can make (the weapon changing hands) is not speed.
    this.tipSpeed = this.prevTip.lengthSq() > 0 && moved < 1.4 && wall < 0.2 ? moved / wall : 0;
    this.bladeMotion.subVectors(bladeTip, this.prevTip).divideScalar(wall);
    if (this.tipSpeed === 0) this.bladeMotion.set(0, 0, 0);
    this.prevTip.copy(bladeTip);
    this.bladeBase.copy(bladeBase);
    this.bladeTip.copy(bladeTip);

    if (this.slashTimer > 0 && !this.synthetic.active) {
      // Only the fast part of the swing burns; the wind-up and recovery leave no fire.
      const alpha = Math.min(1, Math.max(0, (this.tipSpeed - 2.5) / 5.0)) * (this.slashHeavy ? 1 : 0.85);
      if (alpha > 0) this.slashSweep += moved;
      this.trail.record(bladeBase, bladeTip, alpha);
    }
  }

  /**
   * Uppercut: a column of flame about 2.5 m tall with sparks, smoke above, a scorch and a flickering light.
   */
  spawnUppercutPillar(origin: Vector3, element: BendingType = 'IGNIS'): void {
    const style = ELEMENT_STYLES[element] ?? ELEMENT_STYLES.IGNIS;
    const mode = flameMode(element);
    const { x, y, z } = origin;

    if (element === 'IGNIS' || element === 'HUSH') this.spawnScorch(new Vector3(x, 0.02, z), 1.7, 3.0);
    this.triggerFlash(new Vector3(x, 1.3, z), style.lightHex, 4.2, 1.0, true);

    // The column: two tall tongues that shoot up, then burn down.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const off = i === 0 ? 0 : 0.22;
      this.field.emit({
        x: x + Math.cos(a) * off, y, z: z + Math.sin(a) * off, life: 0.9 + Math.random() * 0.25,
        w0: 1.1, h0: 0.9, w1: i === 0 ? 1.7 : 1.3, h1: i === 0 ? 2.6 : 1.65 + Math.random() * 0.65, mode, alpha: mode <= FxMode.HUSH ? 0.52 : 0.9, atlas: mode <= FxMode.HUSH ? 0 : 3,
      });
    }
    // Tongues licking up the column.
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.3;
      this.field.emit({
        x: x + Math.cos(a) * r, y: y + Math.random() * 0.4, z: z + Math.sin(a) * r,
        vy: 2.6 + Math.random() * 1.6, drag: 1.2,
        life: 0.45 + Math.random() * 0.3, w0: 0.35, h0: 0.7, w1: 0.25, h1: 0.9 + Math.random() * 0.4,
        mode, alpha: 0.9, delay: Math.random() * 0.35, tilt: (Math.random() - 0.5) * 0.3,
      });
    }
    // Low fire around the foot of the column.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.field.emit({
        x: x + Math.cos(a) * 0.45, y, z: z + Math.sin(a) * 0.45,
        life: 0.8 + Math.random() * 0.3, w0: 0.5, h0: 0.35, w1: 0.45, h1: 0.75, mode, alpha: 0.9, delay: Math.random() * 0.1,
      });
    }
    // Smoke gathering at the top and rising slowly.
    const smoke = smokeMode(element);
    for (let i = 0; i < 3; i++) {
      this.field.emit({
        x: x + (Math.random() - 0.5) * 0.6, y: y + 2.1 + Math.random() * 0.5, z: z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 0.3, vy: 0.5 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.3,
        life: 1.6 + Math.random() * 0.6, w0: 0.6, h0: 0.6, w1: 1.5, h1: 1.5,
        mode: smoke, alpha: 0.22, delay: 0.2 + Math.random() * 0.35, spin: (Math.random() - 0.5) * 0.6,
      });
    }
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 2.0;
      this.spawnParticle('spark', new Vector3(x, y + 0.2 + Math.random() * 1.2, z),
        new Vector3(Math.cos(a) * s, 4.5 + Math.random() * 4.5, Math.sin(a) * s),
        0.7 + Math.random() * 0.5, 0.06, 0.02, element, 1.0);
    }
  }

  /**
   * Slam: a ring of flame running outward along the floor, dust and stone chips thrown up, then a scorch.
   */
  spawnGroundPound(origin: Vector3, element: BendingType = 'IGNIS'): void {
    const style = ELEMENT_STYLES[element] ?? ELEMENT_STYLES.IGNIS;
    const mode = flameMode(element);
    const { x, y, z } = origin;

    if (element === 'IGNIS' || element === 'HUSH') this.spawnScorch(new Vector3(x, 0.02, z), 2.6, 3.0);
    this.triggerFlash(new Vector3(x, 1.2, z), style.lightHex, 1.2, 0.7, true);
    if (this.waves.length >= 4) this.walls.stop(this.waves.shift()!.wall);
    if (mode <= FxMode.HUSH) {
      const seed = Math.random();
      this.waves.push({ x, y, z, age: 0, seed, mode, wall: this.walls.start(x, y, z, seed, mode) });
      // The blast itself: one burst rising from the point of impact, then smoke rolling off the ring.
      this.field.emit({ x, y, z, vy: 1.2, life: 0.6, w0: 1.4, h0: 1.2, w1: 3.2, h1: 2.8, mode, atlas: 1, alpha: 0.85 });
      for (let i = 0; i < (this.lowQuality ? 3 : 6); i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random() * 0.8;
        this.field.emit({
          x: x + Math.cos(a) * 1.6, y: y + 0.4, z: z + Math.sin(a) * 1.6,
          vx: Math.cos(a) * 1.4, vy: 0.9, vz: Math.sin(a) * 1.4, drag: 1.2,
          life: 1.5 + Math.random() * 0.5, w0: 1.0, h0: 1.0, w1: 2.4, h1: 2.2,
          mode: FxMode.SMOKE, alpha: 0.35, spin: (Math.random() - 0.5) * 0.6,
        });
      }
    }
    else this.rings.spawn(x, z, 4.2, 0.85, mode);

    // Flames riding the ring outward.
    const count = mode <= FxMode.HUSH ? 0 : 26;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const s = 6.0 + Math.random() * 1.5;
      this.field.emit({
        x: x + Math.cos(a) * 0.4, y, z: z + Math.sin(a) * 0.4,
        vx: Math.cos(a) * s, vz: Math.sin(a) * s, drag: 2.6,
        life: 0.55 + Math.random() * 0.2, w0: 0.6, h0: 0.95, w1: 0.5, h1: 0.45,
        mode, alpha: 0.95,
      });
    }
    // Dust kicked up off the stone.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const s = 2.2 + Math.random() * 1.6;
      this.field.emit({
        x: x + Math.cos(a) * 0.8, y: y + 0.35, z: z + Math.sin(a) * 0.8,
        vx: Math.cos(a) * s, vy: 0.5 + Math.random() * 0.5, vz: Math.sin(a) * s, drag: 2.0,
        life: 1.1 + Math.random() * 0.5, w0: 0.6, h0: 0.6, w1: 1.6, h1: 1.4,
        mode: element === 'AQUES' ? FxMode.MIST : FxMode.DUST, alpha: 0.55, spin: (Math.random() - 0.5) * 0.8,
      });
    }
    // Stone chips.
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2.0 + Math.random() * 4.0;
      this.spawnParticle('chip', new Vector3(x + Math.cos(a) * 0.3, y + 0.1, z + Math.sin(a) * 0.3),
        new Vector3(Math.cos(a) * s, 2.5 + Math.random() * 3.5, Math.sin(a) * s),
        0.7 + Math.random() * 0.4, 0.06 + Math.random() * 0.07, 0.06, element, 1.0);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3.5 + Math.random() * 4.0;
      this.spawnParticle('spark', new Vector3(x, y + 0.1, z),
        new Vector3(Math.cos(a) * s, 1.5 + Math.random() * 2.5, Math.sin(a) * s),
        0.5 + Math.random() * 0.3, 0.06, 0.02, element, 1.0);
    }
  }

  /**
   * Slash: a crescent of flame that follows the blade's real arc and burns away from its tail.
   * With no blade in motion (a bare-handed dash), a crescent is swept in front of the hero instead.
   */
  spawnSlashWave(origin: Vector3, facing: number, element: BendingType = 'IGNIS', isHeavy = false): void {
    this.slashElement = element;
    this.slashHeavy = isHeavy;
    this.slashTimer = isHeavy ? HEAVY_SLASH_CAPTURE : SLASH_CAPTURE;
    this.slashSweep = 0;
    this.synthetic.active = false;
    this.synthetic.origin.copy(origin);
    this.synthetic.facing = facing;
    this.trail.setMode(flameMode(element));
  }

  /**
   * Spawns an impact burst of sparks and a flare of the element on hit.
   */
  spawnHitBurst(origin: Vector3, element: BendingType = 'IGNIS'): void {
    const y = origin.y + 0.9;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const s = 2.4 + Math.random() * 3.6;
      this.spawnParticle('spark', tmpVec.set(origin.x, y + (Math.random() - 0.5) * 0.3, origin.z),
        new Vector3(Math.cos(a) * s, 1.2 + (Math.random() - 0.3) * 2.5, Math.sin(a) * s),
        0.35 + Math.random() * 0.2, 0.06, 0.02, element, 1.0);
    }
    this.field.emit({ x: origin.x, y: y - 0.25, z: origin.z, vy: 0.6, life: 0.35, w0: 0.45, h0: 0.55, w1: 0.3, h1: 0.8, mode: flameMode(element), alpha: 0.9 });
  }

  /**
   * Synchronizes active arena fire patches from the fight simulation.
   */
  syncBurnPatches(patches: readonly ActiveFirePatch[]): void {
    this.activePatches = patches.slice(0, MAX_FIRE_PATCHES);
  }

  /**
   * Updates list of husks currently on fire.
   */
  setBurningHusks(husks: readonly BurningHuskInfo[]): void {
    this.burningHusks = husks.filter(h => h.alive);
  }

  /**
   * Bare-handed bending: palm thrust throws an elemental projectile (fireball).
   */
  spawnFireball(origin: Vector3, facing: number, element: BendingType = 'IGNIS', hostile = false): void {
    const fb = this.fireballs.find(f => !f.active);
    if (!fb) return;
    const dir = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    fb.active = true;
    fb.position.copy(origin).setY(origin.y + 1.15).addScaledVector(dir, 1.0);
    fb.velocity.copy(dir).multiplyScalar(14.0).setY(-0.4);
    fb.element = element;
    fb.hostile = hostile;
    fb.duration = 0.55;
    fb.elapsed = 0;

    const style = ELEMENT_STYLES[element] ?? ELEMENT_STYLES.IGNIS;
    this.triggerFlash(fb.position, style.lightHex, 2.8, 0.35);
    for (let i = 0; i < 8; i++) {
      const pvel = dir.clone().multiplyScalar(4.5).add(new Vector3(
        (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2,
      ));
      this.spawnParticle('spark', fb.position, pvel, 0.28, 0.06, 0.02, element, 1.0);
    }
  }

  /**
   * Bare-handed bending: sweep along the ground throws a fan of flame forward.
   */
  spawnFlameSweep(origin: Vector3, facing: number, element: BendingType = 'IGNIS'): void {
    const dir = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    const side = new Vector3(Math.cos(facing), 0, -Math.sin(facing));
    const style = ELEMENT_STYLES[element] ?? ELEMENT_STYLES.IGNIS;
    const mode = flameMode(element);
    this.triggerFlash(origin.clone().setY(0.5), style.lightHex, 3.6, 0.6, true);

    const count = 20;
    for (let i = 0; i < count; i++) {
      const arcT = (i / (count - 1) - 0.5) * 1.8;
      const pos = origin.clone().addScaledVector(dir, 0.8 + (1 - Math.abs(arcT)) * 0.4).addScaledVector(side, arcT * 1.2);
      const vel = dir.clone().multiplyScalar(6.0 + (1 - Math.abs(arcT)) * 2.0).addScaledVector(side, arcT * 1.4);
      this.field.emit({
        x: pos.x, y: 0, z: pos.z, vx: vel.x, vz: vel.z, drag: 2.2,
        life: 0.6 + Math.random() * 0.25, w0: 0.55, h0: 0.6, w1: 0.6, h1: 1.1,
        mode, alpha: 0.95, delay: Math.abs(arcT) * 0.05,
      });
    }
    for (let i = 0; i < 6; i++) {
      const pos = origin.clone().addScaledVector(dir, 2.0 + Math.random()).addScaledVector(side, (Math.random() - 0.5) * 2);
      this.field.emit({
        x: pos.x, y: 1.0, z: pos.z, vx: dir.x * 1.5, vy: 0.6, vz: dir.z * 1.5,
        life: 1.4, w0: 0.6, h0: 0.6, w1: 1.4, h1: 1.4, mode: smokeMode(element), alpha: 0.55, delay: 0.25,
      });
    }
    for (let i = 0; i < 12; i++) {
      const arcT = (Math.random() - 0.5) * 1.6;
      const pos = origin.clone().addScaledVector(dir, 1.0).addScaledVector(side, arcT * 1.4).setY(0.1);
      const vel = dir.clone().multiplyScalar(9.5).addScaledVector(side, arcT * 1.5);
      vel.y += 1.0 + Math.random() * 1.5;
      this.spawnParticle('spark', pos, vel, 0.45, 0.06, 0.02, element, 1.0);
    }
  }

  /**
   * Armed bending: a weapon swing spews fire onto the floor where the swing arcs.
   */
  spawnSwingFireSpew(origin: Vector3, facing: number, element: BendingType = 'IGNIS', isHeavy = false): void {
    if (element !== 'IGNIS') return;
    const dir = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    const side = new Vector3(Math.cos(facing), 0, -Math.sin(facing));
    const count = isHeavy ? 12 : 8;
    for (let i = 0; i < count; i++) {
      const t = (i / (count - 1) - 0.5) * 1.3;
      const pos = origin.clone().addScaledVector(dir, 1.2 + Math.random() * 0.9).addScaledVector(side, t * 1.3);
      this.field.emit({
        x: pos.x, y: 0, z: pos.z, vx: dir.x * 1.2, vz: dir.z * 1.2, drag: 3,
        life: 0.55 + Math.random() * 0.3, w0: 0.35, h0: 0.4, w1: 0.45, h1: 0.85 + Math.random() * 0.3,
        mode: FxMode.FIRE, alpha: 0.95, delay: i * 0.015,
      });
      if (Math.random() < 0.35) {
        this.field.emit({
          x: pos.x, y: 0.9, z: pos.z, vy: 0.5, life: 1.2, w0: 0.4, h0: 0.4, w1: 1.0, h1: 1.0,
          mode: FxMode.SMOKE, alpha: 0.5, delay: 0.2,
        });
      }
    }
  }

  /** Per frame update: advance every effect and upload this frame's quads. */
  update(delta: number, heroPos?: Vector3, camera?: Camera): void {
    this.auraClock += delta;
    this.lastDelta = Math.max(1e-3, delta);
    this.field.begin();

    this.updateFlash();
    this.updateSlash(delta);
    this.updateLitBlade(delta);
    this.updateWaves(delta);
    this.updateFireballs(delta);
    this.updatePatches(delta);
    this.updateBurningBodies();
    void heroPos;

    this.field.end(delta);
    this.rings.update(delta);
    this.trail.update(delta);
    this.updateSprites(delta, camera);
    this.updateScorch(delta);
  }

  /** Low quality reduces atlas memory, particles, depth resolution and active lights. */
  setQuality(level: 'high' | 'low'): void {
    this.lowQuality = level === 'low';
    this.field.setQuality(this.lowQuality);
    this.depth.setQuality(this.lowQuality);
  }

  private updateWaves(delta: number): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wave = this.waves[i]!;
      wave.age += delta;
      if (wave.age >= 1.05) { this.walls.stop(wave.wall); this.waves.splice(i, 1); continue; }
      const progress = Math.min(1, wave.age / 0.78);
      // Ring starts at radius 0.8 m, not 0.3 m
      const radius = 0.8 + 3.4 * (1 - Math.pow(1 - progress, 1.6));
      // Fade every sheet in over its first 0.08 s (alpha from 0)
      const fadeIn = Math.min(1.0, wave.age / 0.08);

      // The wall leaps up in the first fifth of its run, then sinks as it spreads.
      const swell = Math.min(1, progress / 0.18) * (1 - 0.65 * Math.max(0, (progress - 0.18) / 0.82));
      const fade = fadeIn * (1 - Math.max(0, (wave.age - 0.75) / 0.3));
      this.walls.set(wave.wall, radius, 2.2, swell, Math.max(0, fade));

      // Burning wake: low flames (0.3 to 0.6 m tall, ratio 0.45-0.9) scattered at random, fading over 0.6 s
      const wakeEmitCount = this.lowQuality ? 2 : 4;
      for (let w = 0; w < wakeEmitCount; w++) {
        if (Math.random() < delta * 18) {
          const wakeR = Math.sqrt(Math.random()) * radius * 0.75;
          const wakeA = Math.random() * Math.PI * 2;
          const wakeH = 0.3 + Math.random() * 0.3;
          const wakeRatio = 0.45 + Math.random() * 0.4;
          const wakeW = wakeH * wakeRatio;
          this.field.emit({
            x: wave.x + Math.cos(wakeA) * wakeR, y: wave.y, z: wave.z + Math.sin(wakeA) * wakeR,
            life: 0.45 + Math.random() * 0.15,
            w0: wakeW, h0: wakeH, w1: wakeW * 0.6, h1: wakeH * 0.4,
            mode: wave.mode, atlas: 0, alpha: 0.6 * fadeIn,
          });
        }
      }
    }
  }

  private hash(value: number): number {
    const n = Math.sin(value * 127.1 + 31.7) * 43758.5453;
    return n - Math.floor(n);
  }

  private updateFlash(): void {
    if (this.flashDuration <= 0) return;
    this.flashElapsed += this.lastDelta;
    const t = Math.min(1, this.flashElapsed / this.flashDuration);
    const flicker = this.flashFlicker ? 0.75 + Math.sin(this.auraClock * 31) * 0.15 + Math.sin(this.auraClock * 57) * 0.1 : 1;
    this.flashLight.intensity = this.flashIntensity * Math.pow(1 - t, 1.6) * flicker;
    if (t >= 1) {
      this.flashDuration = 0;
      this.flashLight.intensity = 0;
    }
  }

  private updateSlash(delta: number): void {
    if (this.slashTimer <= 0) return;
    const capture = this.slashHeavy ? HEAVY_SLASH_CAPTURE : SLASH_CAPTURE;
    const elapsed = capture - this.slashTimer;
    this.slashTimer -= delta;

    // No blade sweeping by now: the move is bare-handed or the blade is on the back.
    if (!this.synthetic.active && (!this.hasBlade || (elapsed > SLASH_FALLBACK_AFTER && this.slashSweep < 0.35))) {
      this.synthetic.active = true;
      this.synthetic.t = 0;
    }

    if (this.synthetic.active) {
      const s = this.synthetic;
      s.t += delta;
      const k = Math.min(1, s.t / 0.16);
      const theta = 2.5 - k * 3.3 * (this.slashHeavy ? 1.1 : 1);
      const fx = Math.sin(s.facing);
      const fz = Math.cos(s.facing);
      const sx = Math.cos(s.facing);
      const sz = -Math.sin(s.facing);
      const cx = s.origin.x + fx * 1.3;
      const cy = s.origin.y + 1.1;
      const cz = s.origin.z + fz * 1.3;
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      const base = tmpVec.set(cx + sx * c * 0.45, cy + sn * 0.45, cz + sz * c * 0.45);
      const tip = new Vector3(cx + sx * c * 1.25, cy + sn * 1.0, cz + sz * c * 1.25);
      this.trail.record(base, tip, k < 1 ? 1 : 0);

      this.slashTongueTimer -= delta;
      if (this.slashTongueTimer <= 0 && k < 1) {
        this.slashTongueTimer = 0.04 + Math.random() * 0.07;
        const t = 0.3 + Math.random() * 0.7;
        this.emitSlashTongue(tmpVec.lerpVectors(base, tip, t));
      }
      if (k >= 1) this.slashTimer = 0;
      return;
    }

    if (this.hasBlade && this.tipSpeed > 3) {
      this.slashTongueTimer -= delta;
      if (this.slashTongueTimer <= 0) {
        this.slashTongueTimer = 0.04 + Math.random() * 0.07;
        const t = 0.3 + Math.random() * 0.7;
        this.emitSlashTongue(tmpVec.lerpVectors(this.bladeBase, this.bladeTip, t));
      }
    }
  }

  private emitSlashTongue(at: Vector3): void {
    const element = this.slashElement;
    const big = this.slashHeavy ? 1.25 : 1;
    const size = (0.25 + Math.random() * 0.45) * big;
    const ratio = 0.5 + Math.random() * 0.5;
    const w = size * ratio;
    const h = size;
    const leanX = -this.bladeMotion.x * 0.35;
    const leanZ = -this.bladeMotion.z * 0.35;
    const tilt = (Math.random() - 0.5) * 0.5;
    this.field.emit({
      x: at.x, y: at.y, z: at.z,
      vx: leanX, vy: 0.3 + Math.random() * 0.3, vz: leanZ,
      drag: 1.8,
      life: 0.18 + Math.random() * 0.12,
      w0: w, h0: h, w1: w * 0.4, h1: h * 0.5,
      mode: flameMode(element),
      alpha: 0.75,
      atlas: 3,
      tilt,
    });
    if (Math.random() < 0.4) {
      this.spawnParticle('spark', at, new Vector3((Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2),
        0.35 + Math.random() * 0.2, 0.05, 0.02, element, 1.0);
    }
  }

  private updateLitBlade(delta: number): void {
    const style = ELEMENT_STYLES[this.currentElement] ?? ELEMENT_STYLES.IGNIS;
    if (!this.isLit || !this.hasBlade) {
      this.bladeLight.intensity = 0;
      return;
    }
    const mode = flameMode(this.currentElement);
    // Overlapping flames licking up off the edge, uneven in height and always moving.
    for (let i = 0; i < BLADE_EDGE_NODES; i++) {
      const jitter = Math.sin(i * 12.9898) * 0.04;
      const seed = this.hash(i * 7.3);
      const t = mode <= FxMode.HUSH ? 0.08 + seed * 0.9 : Math.min(0.99, 0.16 + (i / (BLADE_EDGE_NODES - 1)) * 0.82 + jitter);
      tmpVec.lerpVectors(this.bladeBase, this.bladeTip, t);
      const flicker = 0.7 + 0.3 * Math.sin(this.auraClock * (9 + (i % 4) * 3) + i * 2.3) + 0.15 * Math.sin(this.auraClock * 23 + i);
      const h = (mode <= FxMode.HUSH ? 0.18 + seed * 0.39 : 0.12 + ((i * 5) % 7) * 0.025) * flicker * (mode === FxMode.WIND ? 1.6 : 1);
      this.field.draw(tmpVec.x + Math.sin(i * 7) * 0.025, tmpVec.y - h * 0.2, tmpVec.z + Math.cos(i * 11) * 0.025,
        h * 0.95, h, 0.32, seed, mode <= FxMode.HUSH ? 0.85 : 0.7, mode,
        Math.sin(i * 4) * 0.25, 0, this.bladeMotion.x * 0.5, this.bladeMotion.z * 0.5);
      if (mode <= FxMode.HUSH && Math.random() < delta * (8 + Math.min(45, this.tipSpeed * 4))) {
        this.field.emit({ x: tmpVec.x, y: tmpVec.y, z: tmpVec.z,
          vx: -this.bladeMotion.x * 0.13, vy: 0.6 - this.bladeMotion.y * 0.08, vz: -this.bladeMotion.z * 0.13,
          life: 0.22 + seed * 0.2, w0: h * 0.7, h0: h, w1: 0.08, h1: h * 0.7, mode });
      }
    }

    tmpVec.addVectors(this.bladeBase, this.bladeTip).multiplyScalar(0.5);
    const flicker = Math.sin(this.auraClock * 24) * 0.25 + Math.sin(this.auraClock * 47) * 0.15;
    this.bladeLight.position.copy(tmpVec);
    this.bladeLight.color.setHex(style.lightHex);
    this.bladeLight.intensity = Math.max(2, 7 + flicker * 3);

    // Embers trail the blade, more of them the faster it moves.
    this.emberDebt += delta * (6 + Math.min(80, this.tipSpeed * 8));
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      tmpVec.lerpVectors(this.bladeBase, this.bladeTip, 0.25 + Math.random() * 0.75);
      const vel = new Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.9, (Math.random() - 0.5) * 0.4);
      this.spawnParticle('spark', tmpVec, vel, 0.35 + Math.random() * 0.35, 0.035, 0.012, this.currentElement, 0.95);
    }
  }

  private updateFireballs(delta: number): void {
    for (const fb of this.fireballs) {
      if (!fb.active) continue;
      fb.elapsed += delta;
      fb.position.addScaledVector(fb.velocity, delta);
      const mode = flameMode(fb.element);
      const p = fb.position;
      if (mode <= FxMode.HUSH) {
        // A round hot head (0.7m across) with trailing ribbons (total length with tail 2.2m)
        this.field.draw(
          p.x, p.y, p.z,
          2.2, 0.7,
          0.2, 0.35, 1.0, mode, 0, 4,
          fb.velocity.x, fb.velocity.y, fb.velocity.z
        );
        // Trail: 2 or 3 small atlas: 0 flame licks per frame just behind head, drifting back and up
        const backDir = fb.velocity.clone().normalize().negate();
        const lickCount = this.lowQuality ? 1 : (2 + (Math.random() < 0.5 ? 1 : 0));
        for (let l = 0; l < lickCount; l++) {
          const offsetDist = 0.15 + Math.random() * 0.35;
          const lickPos = p.clone().addScaledVector(backDir, offsetDist);
          const lickSize = 0.2 + Math.random() * 0.25; // 0.2 to 0.45 m
          this.field.emit({
            x: lickPos.x, y: lickPos.y, z: lickPos.z,
            vx: backDir.x * (1.5 + Math.random() * 2.0) + (Math.random() - 0.5) * 0.4,
            vy: 0.6 + Math.random() * 0.6,
            vz: backDir.z * (1.5 + Math.random() * 2.0) + (Math.random() - 0.5) * 0.4,
            drag: 1.8,
            life: 0.15 + Math.random() * 0.10, // 0.15 to 0.25 s
            w0: lickSize, h0: lickSize * 1.3, w1: lickSize * 0.4, h1: lickSize * 0.5,
            mode, atlas: 0, alpha: 0.7,
          });
        }
      } else {
        this.field.draw(p.x, p.y - 0.5, p.z, 1.15, 1.15, 0.14 + (fb.elapsed % 0.1), 0.31, 1, mode, 0, 1, fb.velocity.x, fb.velocity.z);
        this.field.draw(p.x, p.y - 0.3, p.z, 0.7, 0.9, 0.3, 0.77, 1, mode);
        this.field.emit({ x: p.x, y: p.y - 0.2, z: p.z, vy: 0.5, life: 0.25, w0: 0.35, h0: 0.5, w1: 0.2, h1: 0.4, mode, alpha: 0.85 });
        if (Math.random() < 0.3) this.field.emit({ x: p.x, y: p.y, z: p.z, vy: 0.4, life: 0.9, w0: 0.3, h0: 0.3, w1: 0.8, h1: 0.8, mode: smokeMode(fb.element), alpha: 0.45 });
      }
      if (Math.random() < 0.6) {
        const pvel = new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8);
        this.spawnParticle('spark', fb.position, pvel, 0.25, 0.05, 0.015, fb.element, 1.0);
      }
      if (fb.elapsed >= fb.duration || fb.position.y <= 0.06) {
        fb.active = false;
        const impactPos = fb.position.clone().setY(0.04);
        this.spawnHitBurst(impactPos, fb.element);
        if (mode <= FxMode.HUSH) {
          this.field.emit({ x: impactPos.x, y: 0.08, z: impactPos.z, life: 0.8,
            w0: 1.6, h0: 1.6, w1: 2.1, h1: 2.1, mode, atlas: 1, alpha: 1 });
          this.spawnScorch(impactPos, 1.8, 3);
        }
        const style = ELEMENT_STYLES[fb.element] ?? ELEMENT_STYLES.IGNIS;
        this.triggerFlash(impactPos.clone().setY(0.65), style.lightHex, 3.2, 0.4);
        this.onFireballImpact?.(impactPos, fb.element, fb.hostile);
      }
    }
  }

  /** Burning ground: standing tongues spread over each patch, the same fire as the moves. */
  private updatePatches(delta: number): void {
    this.patchSmokeClock += delta;
    const emitSmoke = this.patchSmokeClock > 0.12;
    if (emitSmoke) this.patchSmokeClock = 0;

    for (const patch of this.activePatches) {
      const elem = patch.element ?? 'IGNIS';
      const mode = flameMode(elem);
      const grow = Math.min(1, patch.elapsed / 0.25);
      const left = patch.duration - patch.elapsed;
      const dying = 1 - Math.min(1, Math.max(0, left / 0.7));
      if (!this.scorchedPatches.has(patch.id) && mode <= FxMode.HUSH) {
        this.scorchedPatches.add(patch.id);
        this.spawnScorch(patch.position.clone().setY(0.025), patch.radius * 2.3, patch.duration + 1);
      }
      const tongues = Math.max(5, Math.min(13, Math.round(patch.radius * 9)));
      for (let k = 0; k < tongues; k++) {
        const seed = this.hash(patch.id * 3.19 + k * 7.13);
        const a = k * GOLDEN_ANGLE + patch.id + seed * 1.8;
        const r = patch.radius * 0.7 * Math.sqrt(seed);
        const sway = 0.85 + Math.sin(this.auraClock * (5 + k) + patch.id) * 0.15;
        const h = (0.35 + seed * 1.1) * Math.min(1.3, patch.radius) * grow * sway * (1 - dying * 0.6);
        this.field.draw(
          patch.position.x + Math.cos(a) * r, 0, patch.position.z + Math.sin(a) * r,
          h * 0.75, h, 0.3 + dying * 0.55, seed, 0.95, mode,
        );
      }
      if (emitSmoke && Math.random() < 0.6) {
        this.field.emit({
          x: patch.position.x + (Math.random() - 0.5) * patch.radius, y: 0.9, z: patch.position.z + (Math.random() - 0.5) * patch.radius,
          vx: (Math.random() - 0.5) * 0.2, vy: 0.55 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.2,
          life: 1.5 + Math.random() * 0.5, w0: 0.45, h0: 0.45, w1: 1.2, h1: 1.2, mode: smokeMode(elem), alpha: 0.18,
          spin: (Math.random() - 0.5) * 0.5,
        });
      }
      if (Math.random() < 0.3) {
        const epos = new Vector3(patch.position.x + (Math.random() - 0.5) * patch.radius, 0.2, patch.position.z + (Math.random() - 0.5) * patch.radius);
        const evel = new Vector3((Math.random() - 0.5) * 1.0, 1.8 + Math.random() * 2.0, (Math.random() - 0.5) * 1.0);
        this.spawnParticle('spark', epos, evel, 0.6, 0.04, 0.015, elem, 1.0);
      }
    }

    for (const id of this.scorchedPatches) if (!this.activePatches.some(p => p.id === id)) this.scorchedPatches.delete(id);
    const strongest = [...this.activePatches].sort((a, b) => b.radius - a.radius);
    const projectile = this.fireballs.find(f => f.active);
    for (let i = 0; i < POOL_PATCH_LIGHTS; i++) {
      const pl = this.patchLights[i]!;
      if (this.lowQuality) { pl.intensity = 0; continue; }
      if (i === 0 && projectile) {
        pl.position.copy(projectile.position);
        pl.color.setHex(ELEMENT_STYLES[projectile.element].lightHex);
        pl.intensity = 22;
        continue;
      }
      const patch = strongest[i - (projectile ? 1 : 0)];
      if (!patch) { pl.intensity = 0; continue; }
      pl.position.copy(patch.position).setY(0.45);
      pl.color.setHex(ELEMENT_STYLES[patch.element ?? 'IGNIS']?.lightHex ?? 0xff4d00);
      const flicker = 1.3 + Math.sin(this.auraClock * 24 + i * 2.1) * 0.35 + Math.sin(this.auraClock * 47 + i) * 0.18;
      pl.intensity = Math.max(2, flicker * 7);
    }
  }

  /** Enemies on fire: tongues standing on the body, smoke and embers off it. */
  private updateBurningBodies(): void {
    for (let i = 0; i < this.burningHusks.length; i++) {
      const husk = this.burningHusks[i]!;
      const p = husk.position;
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + i;
        this.field.draw(p.x + Math.cos(a) * 0.18, p.y + 0.35 + k * 0.3, p.z + Math.sin(a) * 0.18, 0.45, 0.8 - k * 0.12, 0.32, ((i * 7 + k) % 23) / 23, 0.9, FxMode.FIRE);
      }
      if (Math.random() < 0.15) {
        this.field.emit({ x: p.x, y: p.y + 1.6, z: p.z, vy: 0.6, life: 1.2, w0: 0.35, h0: 0.35, w1: 0.9, h1: 0.9, mode: FxMode.SMOKE, alpha: 0.45 });
      }
      if (Math.random() < 0.3) {
        this.spawnParticle('spark', tmpVec.set(p.x, p.y + 1.0, p.z), new Vector3((Math.random() - 0.5), 1.5 + Math.random() * 1.5, (Math.random() - 0.5)), 0.4, 0.04, 0.015, 'IGNIS', 1.0);
      }
    }
  }

  private updateSprites(delta: number, camera?: Camera): void {
    const camQuat = camera?.quaternion;
    if (camQuat) tmpQuat.copy(camQuat).invert();
    for (const p of this.particles) {
      if (!p.active) continue;
      p.elapsed += delta;
      const t = p.elapsed / p.duration;
      if (t >= 1) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.velocity.y += p.gravity * delta;
      const damp = Math.pow(p.drag, delta * 60);
      p.velocity.x *= damp;
      p.velocity.z *= damp;
      p.position.addScaledVector(p.velocity, delta);
      if (p.kind === 'chip' && p.position.y < 0.03) {
        p.position.y = 0.03;
        p.velocity.set(p.velocity.x * 0.4, Math.abs(p.velocity.y) * 0.25, p.velocity.z * 0.4);
        p.rotationSpeed *= 0.5;
      }
      p.mesh.position.copy(p.position);

      const size = p.startSize + t * (p.endSize - p.startSize);
      if (camQuat) {
        p.mesh.quaternion.copy(camQuat);
        if (p.kind === 'spark') {
          // Streak along the screen-space direction of travel.
          const v = tmpVec.copy(p.velocity).applyQuaternion(tmpQuat);
          p.mesh.rotateZ(Math.atan2(v.y, v.x));
          const stretch = 1 + Math.min(3, Math.hypot(v.x, v.y) * 0.5);
          p.mesh.scale.set(size * stretch, size, 1);
        } else {
          p.rotation += p.rotationSpeed * delta;
          p.mesh.rotateZ(p.rotation);
          p.mesh.scale.setScalar(size);
        }
      } else {
        p.mesh.scale.setScalar(size);
      }

      if (p.kind === 'spark') {
        p.mat.color.copy(p.colorCore).lerp(p.colorMid, Math.min(1, t * 1.5));
        p.mat.opacity = p.baseOpacity * (1 - t * t);
      } else {
        p.mat.opacity = p.baseOpacity * (1 - Math.pow(t, 4));
      }
    }
  }

  private updateScorch(delta: number): void {
    for (const s of this.scorchPool) {
      if (!s.active) continue;
      s.elapsed += delta;
      const t = s.elapsed / s.duration;
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      if (s.elapsed < s.fadeIn) {
        s.mat.opacity = (s.elapsed / s.fadeIn) * s.maxOpacity;
      } else {
        s.mat.opacity = (1 - Math.pow((s.elapsed - s.fadeIn) / (s.duration - s.fadeIn), 2)) * s.maxOpacity;
      }
    }
  }

  private spawnParticle(
    kind: SpriteKind,
    pos: Vector3,
    vel: Vector3,
    duration: number,
    startSize: number,
    endSize: number,
    element: BendingType,
    baseOpacity: number,
  ): void {
    if (this.lowQuality && Math.random() > 0.5) return;
    // Earth throws grit instead of sparks.
    if (kind === 'spark' && element === 'TERRA') kind = 'chip';
    const p = this.particles.find(part => !part.active && part.kind === kind);
    if (!p) return;

    const style = ELEMENT_STYLES[element] ?? ELEMENT_STYLES.IGNIS;
    p.active = true;
    p.position.copy(pos);
    p.velocity.copy(vel);
    p.elapsed = 0;
    p.duration = duration;
    p.startSize = startSize;
    p.endSize = endSize;
    p.rotation = Math.random() * Math.PI * 2;
    p.rotationSpeed = (Math.random() - 0.5) * 12.0;
    p.baseOpacity = baseOpacity;

    if (kind === 'spark') {
      p.gravity = element === 'AQUES' ? -9.0 : element === 'AURA' ? 0 : -4.0;
      p.drag = element === 'AURA' ? 0.93 : 0.975;
      p.colorCore.set(style.core);
      p.colorMid.set(style.primary);
    } else {
      p.gravity = -11.0;
      p.drag = 0.985;
      const shade = 0.22 + Math.random() * 0.18;
      p.colorCore.setRGB(shade * 1.1, shade, shade * 0.85);
      p.mat.color.copy(p.colorCore);
    }

    p.mat.color.copy(p.colorCore);
    p.mat.opacity = baseOpacity;
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(startSize);
    p.mesh.visible = true;
  }

  private spawnScorch(pos: Vector3, scale: number, duration: number): void {
    const s = this.scorchPool.find(sc => !sc.active);
    if (!s) return;
    s.active = true;
    s.elapsed = 0;
    s.duration = duration;
    s.maxOpacity = 0.82;
    s.mesh.position.copy(pos);
    s.mesh.scale.setScalar(scale);
    s.mesh.rotation.y = Math.random() * Math.PI * 2;
    s.mat.opacity = 0;
    s.mesh.visible = true;
  }

  private triggerFlash(pos: Vector3, hex: number, intensity: number, duration: number, flicker = false): void {
    this.flashLight.position.copy(pos);
    this.flashLight.color.setHex(hex);
    this.flashLight.intensity = intensity;
    this.flashIntensity = intensity * 5;
    this.flashDuration = duration;
    this.flashElapsed = 0;
    this.flashFlicker = flicker;
  }

  dispose(): void {
    this.particles[0]?.mesh.geometry.dispose();
    for (const p of this.particles) p.mat.dispose();
    this.scorchPool[0]?.mesh.geometry.dispose();
    for (const s of this.scorchPool) s.mat.dispose();
    this.depth.dispose();
    this.field.dispose();
    this.rings.dispose();
    this.walls.dispose();
    this.trail.dispose();
    this.bladeLight.dispose();
    this.flashLight.dispose();
    for (const pl of this.patchLights) pl.dispose();
    this.texSpark?.dispose();
    this.texChip?.dispose();
    this.texScorch?.dispose();
    this.scene.remove(this.root);
  }
}
