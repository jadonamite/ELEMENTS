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
        float t = uTime * 1.6 + vSeed * 20.0;
        float n = wFbm(vec2(p.x * 3.0 + vSeed * 7.0, p.y * 2.2 - t * 1.4));
        float sway = (wNoise(vec2(t * 0.7, p.y * 2.0)) - 0.5) * 0.18 * p.y;
        float x = (p.x - 0.5 - sway) * 2.0;
        float width = mix(0.95, 0.12, pow(p.y, 0.7)) * (0.75 + 0.6 * n);
        float body = 1.0 - smoothstep(width * 0.4, width, abs(x));
        body *= smoothstep(0.0, 0.08, p.y) * (1.0 - smoothstep(0.55 + 0.35 * n, 1.0, p.y));
        float heat = body * (0.55 + 0.6 * n) * (1.0 - p.y * 0.7);
        vec3 col = mix(vec3(0.55, 0.06, 0.01), vec3(1.0, 0.42, 0.06), smoothstep(0.15, 0.55, heat));
        col = mix(col, vec3(1.0, 0.78, 0.42), smoothstep(0.75, 1.0, heat));
        gl_FragColor = vec4(col * heat * 1.5, 1.0);
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
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', `
        vec2 g = abs(fract(vEmissiveUv * vec2(3.0, 4.0)) - 0.5);
        float bar = step(0.44, max(g.x, g.y));
        float warmth = (0.25 + 0.75 * uNight) * (1.0 - bar) * (0.75 + 0.25 * sin(vEmissiveUv.y * 3.0));
        totalEmissiveRadiance *= warmth * 0.85;`);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEmissiveUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvEmissiveUv = uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vEmissiveUv;');
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
      light.intensity = e.intensity * flick * edge * (0.35 + 0.65 * nightness.value);
    });
  }

  dispose(): void { for (const l of this.lights) l.removeFromParent(); }
}
