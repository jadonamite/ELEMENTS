import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  type Texture,
  Vector3,
  type Object3D,
} from 'three';
import { FX_COMMON_GLSL } from './shaders.js';
import { FxMode } from './flame-field.js';

const MAX_SAMPLES = 48;

const VERTEX = /* glsl */ `
attribute float aAge;
attribute float aSide;
attribute float aAlpha;
varying float vAge;
varying float vSide;
varying float vAlpha;
void main() {
  vAge = aAge;
  vSide = aSide;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform int uMode;
uniform sampler2D uAtlas0;
varying float vAge;
varying float vSide;
varying float vAlpha;
${FX_COMMON_GLSL}
void main() {
  if (uMode <= 1) {
    // Ribbon carries the slash: sample flame atlas along the swept arc
    float curl = sin(vAge * 14.0 - uTime * 6.0 + vSide * 8.0 + uSeed * 6.28) * 0.08 * vAge;
    vec2 trailUv = vec2(clamp(vAge * 0.85 + curl, 0.01, 0.99), clamp(1.0 - vSide, 0.01, 0.99));
    
    // Sample atlas frame (looping flame atlas 0)
    float frame = mod(uTime * 22.0 + uSeed * 64.0 + vAge * 16.0, 64.0);
    vec2 cell = vec2(mod(frame, 8.0), 7.0 - floor(frame / 8.0));
    vec2 coords = (cell + clamp(trailUv, 0.008, 0.992)) / 8.0;
    vec4 atlasSample = texture2D(uAtlas0, coords);

    // Tip crest: hot white-gold outer edge along vSide -> 1
    float outerRidge = smoothstep(0.45, 0.96, vSide);
    float tailBurn = pow(1.0 - vAge, 0.85);

    // Turbulence and curls off trailing edge
    float wisp = fxFbm(vec2(vAge * 8.0 - uTime * 2.5, vSide * 5.0 + uSeed * 4.0));
    // Only a ragged band along the tip's path burns; the inner sweep stays clear, so the
    // trail never reads as a solid sheet.
    float band = smoothstep(0.55 + (wisp - 0.5) * 0.3, 0.92, vSide) * (1.0 - smoothstep(0.97, 1.0, vSide));
    float h = clamp((band * (0.55 + 0.6 * atlasSample.r) + wisp * 0.25 * band - 0.15) * tailBurn * vAlpha, 0.0, 1.0);

    vec3 col = fxFireRamp(h, uMode);
    // Outer edge reaches intense white-gold core
    if (h > 0.78) {
      col = mix(col, vec3(1.0, 0.98, 0.92), smoothstep(0.78, 1.0, h) * outerRidge);
    }
    col *= 1.35;
    col = min(col, vec3(2.4, 2.2, 1.9));

    float a = smoothstep(0.04, 0.28, h) * tailBurn * vAlpha * (0.7 + 0.3 * atlasSample.a);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
    return;
  }
  float n = fxFbm(vec2(vAge * 5.0 + uSeed * 7.0 - uTime * 1.5, vSide * 3.0 - uTime * 3.0));
  float n2 = fxFbm(vec2(vAge * 11.0 - uTime * 2.0, vSide * 7.0 + uSeed * 3.0));
  // Hottest along the tip's path, thinning toward the hilt; burns away from the tail.
  float side = vSide + (n - 0.5) * 0.35;
  float edge = smoothstep(0.2, 0.9, side) * (1.0 - smoothstep(0.96, 1.0, vSide));
  float h = vAlpha * edge * (0.45 + 1.1 * n2) * pow(1.0 - vAge, 1.1);
  h -= (1.0 - n) * (0.15 + vAge) * 0.8;
  h = clamp(h * 1.5, 0.0, 1.0);
  vec3 col;
  float a;
  if (uMode == 2) { col = fxWaterRamp(h); a = smoothstep(0.05, 0.3, h) * 0.85; }
  else if (uMode == 4) { col = vec3(0.82, 0.96, 1.0); a = smoothstep(0.08, 0.45, h) * 0.6; }
  else { col = fxDustRamp(h); a = smoothstep(0.05, 0.32, h) * 0.9; }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

interface Sample {
  base: Vector3;
  tip: Vector3;
  time: number;
  alpha: number;
}

/**
 * A ribbon of fire swept by the blade: it records where the base and tip were each frame,
 * draws the band between them, and burns away from the oldest end.
 */
export class BladeTrail {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly geo = new BufferGeometry();
  private readonly positions = new Float32Array(MAX_SAMPLES * 2 * 3);
  private readonly ages = new Float32Array(MAX_SAMPLES * 2);
  private readonly alphas = new Float32Array(MAX_SAMPLES * 2);
  private readonly samples: Sample[] = [];
  private clock = 0;
  private readonly fadeTime = 0.24;

  constructor(parent: Object3D, time: { value: number }, private readonly shed?: (at: Vector3) => void) {
    const sides = new Float32Array(MAX_SAMPLES * 2);
    const index: number[] = [];
    for (let i = 0; i < MAX_SAMPLES; i++) {
      sides[i * 2] = 0;
      sides[i * 2 + 1] = 1;
      if (i < MAX_SAMPLES - 1) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo.setIndex(index);
    this.geo.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aAge', new BufferAttribute(this.ages, 1).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alphas, 1).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aSide', new BufferAttribute(sides, 1));
    this.mat = new ShaderMaterial({
      uniforms: { uTime: time, uSeed: { value: 0 }, uMode: { value: 0 }, uAtlas0: { value: null } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);
  }

  setAtlas(texture: Texture): void {
    this.mat.uniforms.uAtlas0 = { value: texture };
  }

  setMode(mode: FxMode): void {
    if (this.mat.uniforms.uMode!.value === mode) return;
    this.mat.uniforms.uMode!.value = mode;
    this.mat.blending = mode === FxMode.FIRE || mode === FxMode.HUSH || mode === FxMode.WIND ? AdditiveBlending : NormalBlending;
    this.mat.uniforms.uSeed!.value = Math.random();
  }

  /** Adds where the blade is now; `alpha` 0 records the pose without drawing fire there. */
  record(base: Vector3, tip: Vector3, alpha: number): void {
    const last = this.samples[this.samples.length - 1];
    // A jump no swing can make (the weapon changing hands): start a fresh trail.
    if (last && last.tip.distanceTo(tip) > 1.4) this.samples.length = 0;
    if (last && last.time === this.clock) {
      last.base.copy(base); last.tip.copy(tip); last.alpha = Math.max(last.alpha, alpha);
      return;
    }
    const reuse = this.samples.length >= MAX_SAMPLES ? this.samples.shift()! : { base: new Vector3(), tip: new Vector3(), time: 0, alpha: 0 };
    reuse.base.copy(base);
    reuse.tip.copy(tip);
    reuse.time = this.clock;
    reuse.alpha = alpha;
    this.samples.push(reuse);
  }

  update(delta: number): void {
    this.clock += delta;
    while (this.samples.length > 0 && this.clock - this.samples[0]!.time > this.fadeTime) this.samples.shift();
    const n = this.samples.length;
    const lit = this.samples.some(s => s.alpha > 0.01);
    this.mesh.visible = n >= 2 && lit;
    if (!this.mesh.visible) return;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i]!;
      const age = Math.min(1, (this.clock - s.time) / this.fadeTime);
      this.positions.set([s.base.x, s.base.y, s.base.z, s.tip.x, s.tip.y, s.tip.z], i * 6);
      this.ages[i * 2] = age; this.ages[i * 2 + 1] = age;
      this.alphas[i * 2] = s.alpha; this.alphas[i * 2 + 1] = s.alpha;
    }
    this.geo.setDrawRange(0, (n - 1) * 6);
    for (const name of ['position', 'aAge', 'aAlpha']) this.geo.getAttribute(name).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
