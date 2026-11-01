import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  Vector3,
  type Camera,
  type Scene,
} from 'three';
import type { Emitter } from './builder.js';

const NOISE = /* glsl */ `
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
}
float wFbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * wNoise(p); p *= 2.03; a *= 0.5; } return v; }
`;

/** Shared clock for every town shader. */
export const worldTime = { value: 0 };
/** 0 at noon, 1 at full night: windows and forges glow harder after dark. */
export const nightness = { value: 0.6 };

/** Billboarded noise flames, one draw call for every brazier and hearth. */
export function createFires(fires: Array<{ position: Vector3; scale: number }>): Mesh {
  const geometry = new InstancedBufferGeometry();
  const quad = new PlaneGeometry(1, 1.6).translate(0, 0.8, 0);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  const offsets = new Float32Array(fires.length * 4);
  fires.forEach((f, i) => { offsets.set([f.position.x, f.position.y, f.position.z, f.scale], i * 4); });
  geometry.setAttribute('aFire', new InstancedBufferAttribute(offsets, 4));
  geometry.instanceCount = fires.length;
  const material = new ShaderMaterial({
    uniforms: { uTime: worldTime },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aFire;
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        vUv = uv;
        vSeed = fract(aFire.x * 0.37 + aFire.z * 0.71);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 world = aFire.xyz + right * position.x * aFire.w + vec3(0.0, position.y * aFire.w, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      ${NOISE}
      void main() {
        vec2 p = vUv;
        float t = uTime + vSeed * 20.0;
        // Two scales of turbulence scroll upward; the fine one runs faster, like real flame.
        float turb = wFbm(vec2(p.x * 4.0 + vSeed * 7.0, p.y * 3.0 - t * 2.4)) * 0.65
          + wFbm(vec2(p.x * 9.0 - vSeed * 3.0, p.y * 6.0 - t * 4.2)) * 0.35;
        float sway = (wNoise(vec2(t * 0.8, p.y * 1.5 + vSeed * 5.0)) - 0.5) * 0.25 * p.y;
        float x = (p.x - 0.5 - sway - (turb - 0.5) * 0.35 * p.y) * 2.0;
        // A cone that thins and cools with height; the noise eats its edges into separate tongues.
        float f = 1.0 - abs(x) / mix(0.9, 0.25, p.y) - p.y * 0.85;
        f += (turb - 0.5) * 1.1 * (0.3 + p.y);
        f *= smoothstep(0.0, 0.06, p.y);
        float heat = smoothstep(0.0, 0.45, f);
        float core = smoothstep(0.5, 0.95, f);
        vec3 col = mix(vec3(0.5, 0.05, 0.01), vec3(1.0, 0.38, 0.05), smoothstep(0.0, 0.6, heat));
        col = mix(col, vec3(1.0, 0.8, 0.45), core);
        gl_FragColor = vec4(col * (heat * 0.85 + core * 0.35), 1.0);
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'fires';
  return mesh;
}

/** Soft smoke columns rising from chimneys; each puff loops up and fades. */
export function createSmoke(sources: Vector3[], puffsEach: number): Mesh {
  const geometry = new InstancedBufferGeometry();
  const quad = new PlaneGeometry(1, 1);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  const data = new Float32Array(sources.length * puffsEach * 4);
  let k = 0;
  for (const s of sources) for (let i = 0; i < puffsEach; i++) { data.set([s.x, s.y, s.z, i / puffsEach + Math.random() * 0.05], k); k += 4; }
  geometry.setAttribute('aPuff', new InstancedBufferAttribute(data, 4));
  geometry.instanceCount = sources.length * puffsEach;
  const material = new ShaderMaterial({
    uniforms: { uTime: worldTime, uColor: { value: new Color(0x2a2522) }, uLit: { value: new Color(0x7a3a1a) } },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aPuff;
      uniform float uTime;
      varying vec2 vUv;
      varying float vLife;
      varying float vSeed;
      void main() {
        vUv = uv;
        vSeed = fract(aPuff.x * 0.13 + aPuff.z * 0.29 + aPuff.w * 3.1);
        float life = fract(uTime * 0.045 + aPuff.w);
        vLife = life;
        float size = mix(0.9, 6.5, life);
        vec3 drift = vec3(life * life * 14.0, life * 22.0, life * life * 5.0);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = aPuff.xyz + drift + (right * position.x + upv * position.y) * size;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uLit;
      varying vec2 vUv;
      varying float vLife;
      varying float vSeed;
      ${NOISE}
      void main() {
        vec2 c = vUv - 0.5;
        float n = wFbm(vUv * 3.0 + vec2(vSeed * 9.0, -uTime * 0.12));
        float a = (1.0 - smoothstep(0.15, 0.5, length(c) + (n - 0.5) * 0.35));
        a *= smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife)) * 0.32;
        vec3 col = mix(uLit, uColor, smoothstep(0.0, 0.35, vLife));
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'smoke';
  return mesh;
}

/** Sparks lifting off every fire, drifting and winking out. */
export function createEmbers(sources: Vector3[], perSource: number): Points {
  const positions = new Float32Array(sources.length * perSource * 3);
  const seeds = new Float32Array(sources.length * perSource);
  let k = 0;
  for (const s of sources) for (let i = 0; i < perSource; i++) { positions.set([s.x, s.y, s.z], k * 3); seeds[k] = Math.random(); k++; }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
  const material = new ShaderMaterial({
    uniforms: { uTime: worldTime, uScale: { value: 360 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uScale;
      varying float vGlow;
      void main() {
        float life = fract(uTime * (0.22 + aSeed * 0.2) + aSeed * 17.0);
        float a = aSeed * 40.0 + uTime * 0.8;
        vec3 p = position + vec3(sin(a) * life * 1.4 + life * life * 2.0, life * (4.0 + aSeed * 5.0), cos(a * 1.3) * life * 1.4);
        vGlow = (1.0 - life) * smoothstep(0.0, 0.05, life) * (0.6 + 0.4 * sin(uTime * 13.0 + aSeed * 50.0));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * (0.035 + aSeed * 0.03) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.2, 0.5, d)) * vGlow;
        gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a * 3.0, 1.0);
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'embers';
  return points;
}

/** Molten slag: slow-crawling crust over a white-hot glow, for gutters, the well and the crater. */
export function createLavaMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLavaPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLavaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vLavaPos;\n${NOISE}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        vec2 lp = vLavaPos.xz * 0.6 + vec2(uTime * 0.05, uTime * 0.02);
        float n = wFbm(lp + wFbm(lp * 1.7 - uTime * 0.03) * 1.5);
        float crack = smoothstep(0.34, 0.56, n);
        vec3 crust = vec3(0.05, 0.025, 0.02);
        vec3 hot = mix(vec3(1.2, 0.22, 0.02), vec3(2.6, 1.1, 0.25), smoothstep(0.6, 0.85, n));
        vec4 diffuseColor = vec4(mix(crust, hot, crack), opacity);`);
  };
  return material;
}

/** Window glass lit from inside: a warm lattice that brightens toward night. */
export function createWindowMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0x0c0806, roughness: 0.35, metalness: 0, emissive: 0xff8a3a });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightness;
    shader.uniforms.uTime = worldTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uTime;')
      .replace('#include <emissivemap_fragment>', `
        // Leaded diamond lattice, lit from a hearth low in the room that flickers slowly.
        vec2 q = vEmissiveUv * vec2(3.0, 4.0);
        vec2 dia = abs(fract(vec2(q.x + q.y, q.x - q.y) * 0.5) - 0.5);
        float lead = smoothstep(0.43, 0.47, max(dia.x, dia.y));
        float edge = smoothstep(0.0, 0.06, min(min(vEmissiveUv.x, 1.0 - vEmissiveUv.x), min(vEmissiveUv.y, 1.0 - vEmissiveUv.y)));
        float flick = 0.85 + 0.15 * sin(uTime * 2.3 + vEmissiveUv.x * 5.0) * sin(uTime * 3.7 + 1.3);
        float room = mix(1.0, 0.45, vEmissiveUv.y) * flick;
        // Each window lights at its own moment through dusk and goes dark through dawn.
        float lit = smoothstep(vWinSeed * 0.75, vWinSeed * 0.75 + 0.1, uNight);
        float warmth = (0.08 + 0.92 * lit) * (1.0 - lead) * edge * room;
        totalEmissiveRadiance *= warmth * 1.1;`);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEmissiveUv;\nvarying float vWinSeed;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvEmissiveUv = uv;\nvWinSeed = fract(sin(dot(floor(position.xz / 2.5), vec2(12.9898, 78.233))) * 43758.5453);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vEmissiveUv;\nvarying float vWinSeed;');
  };
  return material;
}

/** The back of a forge mouth: a deep glow that breathes like a worked hearth. */
export function createForgeMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vForgeUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvForgeUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec2 vForgeUv;\n${NOISE}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float n = wFbm(vForgeUv * vec2(4.0, 3.0) + vec2(0.0, -uTime * 0.4));
        float breathe = 0.8 + 0.2 * sin(uTime * 1.3 + vForgeUv.x * 4.0);
        float fall = 1.0 - smoothstep(0.1, 0.95, vForgeUv.y);
        vec3 col = mix(vec3(0.35, 0.05, 0.0), vec3(1.6, 0.5, 0.1), fall * (0.5 + 0.6 * n)) * breathe;
        vec4 diffuseColor = vec4(col, opacity);`);
  };
  return material;
}

/** A fixed set of point lights handed to the emitters nearest the hero each frame. */
export class LightPool {
  private readonly lights: PointLight[] = [];
  private readonly order: Emitter[];
  constructor(scene: Scene, private readonly emitters: Emitter[], count: number) {
    this.order = [...emitters];
    for (let i = 0; i < count; i++) {
      const light = new PointLight(0xff7a30, 0, 10, 2);
      scene.add(light);
      this.lights.push(light);
    }
  }

  update(focus: Vector3, time: number, camera: Camera): void {
    void camera;
    this.order.sort((a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus));
    this.lights.forEach((light, i) => {
      const e = this.order[i];
      if (!e) { light.intensity = 0; return; }
      light.position.copy(e.position);
      light.color.setHex(e.color);
      light.distance = e.range;
      const seed = e.position.x * 0.7 + e.position.z * 1.3;
      const flick = 1 - e.flicker * (0.5 + 0.5 * Math.sin(time * 9 + seed) * Math.sin(time * 5.3 + seed * 2));
      // Fade the farthest light of the pool so swaps never pop.
      const edge = i === this.lights.length - 1 ? 0.5 : 1;
      // Braziers burn all day but only read after dark; each catches at its own moment through dusk.
      const stagger = Math.abs(Math.sin(seed * 12.9898)) * 0.6;
      const dark = Math.min(1, Math.max(0, (nightness.value - stagger) / 0.25));
      light.intensity = e.intensity * flick * edge * (0.3 + 0.7 * dark);
    });
  }

  dispose(): void { for (const l of this.lights) l.removeFromParent(); }
}
