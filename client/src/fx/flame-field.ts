import {
  AdditiveBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  TextureLoader,
  LinearFilter,
  SRGBColorSpace,
  ShaderMaterial,
  type Blending,
  type Object3D,
} from 'three';
import type { SoftDepth } from './soft-depth.js';
import { SPRITE_FRAGMENT, SPRITE_VERTEX } from './shaders.js';

/** Shading modes understood by the shader; see shaders.ts. */
export const FxMode = { FIRE: 0, HUSH: 1, WATER: 2, ROCK: 3, WIND: 4, SMOKE: 5, MIST: 6, DUST: 7 } as const;
export type FxMode = (typeof FxMode)[keyof typeof FxMode];

const ADDITIVE_MODES: readonly number[] = [FxMode.FIRE, FxMode.HUSH, FxMode.WIND];

export interface TongueSpec {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number;
  w0: number; h0: number;
  w1?: number; h1?: number;
  mode: FxMode;
  alpha?: number;
  delay?: number;
  gravity?: number;
  drag?: number;
  tilt?: number;
  spin?: number;
  atlas?: number;
}

interface Tongue {
  active: boolean;
  age: number;
  life: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  w0: number; h0: number; w1: number; h1: number;
  mode: number;
  alpha: number;
  seed: number;
  gravity: number;
  drag: number;
  tilt: number;
  spin: number;
  atlas: number;
}

/** One draw call worth of quads sharing a blend mode. */
class Batch {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly pos: InstancedBufferAttribute;
  private readonly size: InstancedBufferAttribute;
  private readonly data: InstancedBufferAttribute;
  private readonly animation: InstancedBufferAttribute;
  private readonly motion: InstancedBufferAttribute;
  private count = 0;

  constructor(private readonly capacity: number, material: ShaderMaterial) {
    this.geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.pos = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.size = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.data = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iSize', this.size);
    this.geo.setAttribute('iData', this.data);
    this.animation = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iAnim', this.animation);
    this.motion = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iMotion', this.motion);
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
  }

  begin(): void { this.count = 0; }

  push(x: number, y: number, z: number, w: number, h: number, tilt: number, life: number, seed: number, alpha: number, mode: number, atlas: number, vx: number, vy: number, vz: number): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.pos.array[i * 3] = x; this.pos.array[i * 3 + 1] = y; this.pos.array[i * 3 + 2] = z;
    this.size.array[i * 3] = w; this.size.array[i * 3 + 1] = h; this.size.array[i * 3 + 2] = tilt;
    this.motion.array.set([vx, vy, vz], i * 3);
    this.animation.array.set([atlas, 0.72 + seed * 0.65, 0.82 + seed * 0.32, seed], i * 4);
    this.data.array[i * 4] = life; this.data.array[i * 4 + 1] = seed; this.data.array[i * 4 + 2] = alpha; this.data.array[i * 4 + 3] = mode;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count === 0) return;
    for (const attr of [this.pos, this.size, this.data, this.animation, this.motion]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  dispose(): void { this.geo.dispose(); }
}

function makeMaterial(blending: Blending, time: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: SPRITE_VERTEX,
    fragmentShader: SPRITE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending,
  });
}

/**
 * Shader-drawn flame tongues, smoke, spray and dust. Pooled tongues live and move on their own;
 * `draw` adds a quad for this frame only, for fires that follow something (patches, blade, bodies).
 */
export class FlameField {
  readonly time = { value: 0 };
  private readonly additiveMat = makeMaterial(AdditiveBlending, this.time);
  private readonly normalMat = makeMaterial(NormalBlending, this.time);
  private readonly additive: Batch;
  private readonly normal: Batch;
  private readonly pool: Tongue[] = [];
  private cursor = 0;
  private low = false;
  private drawCount = 0;
  private readonly loader = typeof document === 'undefined' ? null : new TextureLoader();
  private qualityReady = false;
  private textures: import('three').Texture[] = [];
  onTexturesUpdated?: () => void;

  constructor(parent: Object3D, depth?: SoftDepth, poolSize = 420, capacity = 640) {
    if (depth) for (const mat of [this.additiveMat, this.normalMat]) Object.assign(mat.uniforms, depth.uniforms);
    this.setQuality(false);
    this.additive = new Batch(capacity, this.additiveMat);
    this.normal = new Batch(capacity, this.normalMat);
    // Smoke and spray draw before additive fire so flames glow over them.
    this.normal.mesh.renderOrder = 1;
    this.additive.mesh.renderOrder = 2;
    parent.add(this.normal.mesh, this.additive.mesh);
    for (let i = 0; i < poolSize; i++) {
      this.pool.push({
        active: false, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        w0: 1, h0: 1, w1: 1, h1: 1, mode: 0, alpha: 1, seed: 0, gravity: 0, drag: 0, tilt: 0, spin: 0, atlas: 0,
      });
    }
    this.begin();
  }

  emit(s: TongueSpec): void {
    if (this.low && Math.random() > 0.48) return;
    let t: Tongue | undefined;
    for (let k = 0; k < this.pool.length; k++) {
      const c = this.pool[(this.cursor + k) % this.pool.length]!;
      if (!c.active) { t = c; this.cursor = (this.cursor + k + 1) % this.pool.length; break; }
    }
    if (!t) return;
    t.active = true;
    t.age = -(s.delay ?? 0);
    t.life = s.life;
    t.x = s.x; t.y = s.y; t.z = s.z;
    t.vx = s.vx ?? 0; t.vy = s.vy ?? 0; t.vz = s.vz ?? 0;
    t.w0 = s.w0; t.h0 = s.h0; t.w1 = s.w1 ?? s.w0; t.h1 = s.h1 ?? s.h0;
    t.mode = s.mode;
    t.alpha = s.alpha ?? 1;
    t.seed = Math.random();
    t.gravity = s.gravity ?? 0;
    t.drag = s.drag ?? 0;
    t.tilt = s.tilt ?? 0;
    t.spin = s.spin ?? 0;
    t.atlas = s.atlas ?? (s.mode === FxMode.SMOKE ? 2 : 3);
  }

  /** A quad for this frame only. Supports both (..., vx, vz) and (..., vx, vy, vz). */
  draw(x: number, y: number, z: number, w: number, h: number, life: number, seed: number, alpha: number, mode: FxMode, tilt = 0, atlas = 0, vx = 0, vyOrVz = 0, vz = 0): void {
    if (this.low && ++this.drawCount % 2 === 0) return;
    const vy = arguments.length >= 14 ? vyOrVz : 0;
    const realVz = arguments.length >= 14 ? vz : vyOrVz;
    const batch = ADDITIVE_MODES.includes(mode) ? this.additive : this.normal;
    batch.push(x, y, z, w, h, tilt, life, seed, alpha, mode, mode === FxMode.SMOKE ? 2 : atlas, vx, vy, realVz);
  }

  getTexture(index: number): import('three').Texture | undefined {
    return this.textures[index];
  }

  /** Clears last frame's quads; call before any `draw` of the frame. */
  begin(): void {
    this.drawCount = 0;
    this.additive.begin();
    this.normal.begin();
  }

  /** Advances pooled tongues and uploads every quad of the frame. */
  end(delta: number): void {
    this.time.value += delta;
    for (const t of this.pool) {
      if (!t.active) continue;
      t.age += delta;
      if (t.age < 0) continue;
      const k = t.age / t.life;
      if (k >= 1) { t.active = false; continue; }
      const damp = Math.max(0, 1 - t.drag * delta);
      t.vx *= damp; t.vz *= damp;
      t.vy = t.vy * damp + t.gravity * delta;
      t.x += t.vx * delta; t.y += t.vy * delta; t.z += t.vz * delta;
      t.tilt += t.spin * delta;
      const ease = 1 - (1 - k) * (1 - k);
      this.draw(t.x, t.y, t.z, t.w0 + (t.w1 - t.w0) * ease, t.h0 + (t.h1 - t.h0) * ease, k, t.seed, t.alpha, t.mode as FxMode, t.tilt - Math.sin(t.seed * 19) * Math.min(0.65, Math.hypot(t.vx, t.vz) * 0.05), t.atlas, t.vx, t.vy, t.vz);
    }
    this.additive.end();
    this.normal.end();
  }

  setQuality(low: boolean): void {
    if (this.qualityReady && this.low === low) return;
    this.qualityReady = true;
    this.low = low;
    if (!this.loader) return;
    const old = this.textures;
    // Slot order is the shader's: 0 looping flame, 1 burst, 2 smoke, 3 one-shot tongue, 4 projectile.
    // A tongue is the baked flame loop played once over its life, so slots 0 and 3 share one texture.
    const files = ['flame', 'burst', 'smoke', 'flame', 'projectile'];
    const loaded = new Map<string, import('three').Texture>();
    this.textures = files.map((name, i) => {
      let texture = loaded.get(name);
      if (!texture) {
        texture = this.loader!.load(`/assets/fx/fire-${name}${low ? '-low' : ''}.png`);
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = SRGBColorSpace;
        loaded.set(name, texture);
      }
      for (const mat of [this.additiveMat, this.normalMat]) mat.uniforms[`uAtlas${i}`] = { value: texture };
      return texture;
    });
    this.onTexturesUpdated?.();
    new Set(old).forEach(texture => texture.dispose());
  }

  dispose(): void {
    new Set(this.textures).forEach(texture => texture.dispose());
    this.additive.dispose();
    this.normal.dispose();
    this.additiveMat.dispose();
    this.normalMat.dispose();
  }
}
