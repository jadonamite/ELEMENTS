import { AdditiveBlending, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, type Object3D } from 'three';
import { FX_COMMON_GLSL } from './shaders.js';
import { FxMode } from './flame-field.js';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uWidth;
uniform float uFade;
uniform float uSeed;
uniform int uMode;
varying vec2 vUv;
${FX_COMMON_GLSL}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  vec2 dir = p / max(r, 1e-4);
  float n = fxFbm(dir * 2.6 + vec2(r * 5.0 - uTime * 3.5, uSeed * 9.0));
  float n2 = fxFbm(dir * 6.0 + vec2(r * 9.0 - uTime * 5.0, uSeed * 3.0));
  float d = (r - uRadius) / uWidth;
  // Bright leading edge, a burning wake behind it, nothing ahead.
  float front = 1.0 - smoothstep(0.0, 1.0, abs(d) + (n - 0.5) * 0.9);
  float wake = smoothstep(-3.5, -0.2, d) * (1.0 - step(0.6, d)) * 0.45;
  float h = max(front, wake * n2) * (0.45 + 0.85 * n2) * uFade;
  h *= 1.0 - smoothstep(0.92, 1.0, r);
  h = clamp(h * 1.3, 0.0, 1.0);
  vec3 col;
  float a;
  if (uMode <= 1) { col = fxFireRamp(h, uMode) * 1.1; a = smoothstep(0.06, 0.32, h); }
  else if (uMode == 2) { col = fxWaterRamp(h); a = smoothstep(0.05, 0.3, h) * 0.85; }
  else if (uMode == 4) { col = vec3(0.8, 0.95, 1.0); a = smoothstep(0.1, 0.5, h) * 0.5; }
  else { col = fxDustRamp(h); a = smoothstep(0.05, 0.35, h) * 0.85; }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

interface Ring {
  mesh: Mesh;
  mat: ShaderMaterial;
  active: boolean;
  age: number;
  life: number;
  maxRadius: number;
}

/** Shockwave rings that run outward along the floor. */
export class GroundRings {
  private readonly rings: Ring[] = [];

  constructor(parent: Object3D, private readonly time: { value: number }, count = 4) {
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const mat = new ShaderMaterial({
        uniforms: {
          uTime: time,
          uRadius: { value: 0 },
          uWidth: { value: 0.08 },
          uFade: { value: 0 },
          uSeed: { value: 0 },
          uMode: { value: 0 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -6,
      });
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 1;
      parent.add(mesh);
      this.rings.push({ mesh, mat, active: false, age: 0, life: 0.8, maxRadius: 4 });
    }
  }

  spawn(x: number, z: number, maxRadius: number, life: number, mode: FxMode): void {
    const ring = this.rings.find(r => !r.active) ?? this.rings[0]!;
    ring.active = true;
    ring.age = 0;
    ring.life = life;
    ring.maxRadius = maxRadius;
    ring.mesh.position.set(x, 0.03, z);
    ring.mesh.scale.setScalar(maxRadius * 2);
    ring.mat.uniforms.uMode!.value = mode;
    ring.mat.uniforms.uSeed!.value = Math.random();
    ring.mat.blending = mode === FxMode.FIRE || mode === FxMode.HUSH || mode === FxMode.WIND ? AdditiveBlending : NormalBlending;
    ring.mesh.visible = true;
  }

  update(delta: number): void {
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += delta;
      const k = ring.age / ring.life;
      if (k >= 1) { ring.active = false; ring.mesh.visible = false; continue; }
      // Fast out, then slows; radius is a fraction of the mesh's half size.
      const travel = 1 - Math.pow(1 - Math.min(1, k / 0.7), 2.4);
      ring.mat.uniforms.uRadius!.value = 0.08 + travel * 0.8;
      ring.mat.uniforms.uWidth!.value = 0.07 + 0.07 * travel;
      ring.mat.uniforms.uFade!.value = Math.min(1, ring.age / 0.05) * (1 - Math.pow(k, 2.2));
    }
  }

  dispose(): void {
    this.rings[0]?.mesh.geometry.dispose();
    for (const ring of this.rings) ring.mat.dispose();
  }
}
