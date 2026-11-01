import {
  BackSide,
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
} from 'three';
import { skyUniforms } from './clock.js';
import { nightness, worldTime } from './effects.js';
import { LOOKS } from './materials.js';

const fract = (v: number): number => v - Math.floor(v);
const hash = (x: number, z: number): number => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
function noise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x: number, z: number, octaves = 5): number {
  let v = 0, a = 0.5;
  for (let i = 0; i < octaves; i++) { v += a * noise(x, z); x = x * 2.03 + 17.1; z = z * 2.03 - 9.3; a *= 0.5; }
  return v;
}
/** Sharp crests like eroded basalt ridges. */
function ridged(x: number, z: number, octaves = 5): number {
  let v = 0, a = 0.55, w = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x, z) * 2 - 1);
    n *= n * w;
    w = Math.min(1, n * 1.6);
    v += n * a;
    x = x * 2.1 + 5.3; z = z * 2.1 - 3.7; a *= 0.5;
  }
  return v;
}

export interface Walkable {
  /** Metres from the nearest walkable ground; 0 or less is inside. */
  distance(x: number, z: number): number;
  /** Height of the walking surface; missing means 0. */
  floorAt?(x: number, z: number): number;
  /** Terrain height under built ground, which may sit below the floor; missing means the floor. */
  groundAt?(x: number, z: number): number;
}

export interface Peak { x: number; z: number; radius: number; height: number }

/** Ground height: flat where people walk, a steep basalt bank at the edge, then broken hills. */
export function heightAt(x: number, z: number, walk: Walkable, peaks: Peak[]): number {
  const d = walk.distance(x, z);
  const base = d > 0 ? (walk.floorAt?.(x, z) ?? 0) : (walk.groundAt?.(x, z) ?? walk.floorAt?.(x, z) ?? 0);
  let h = 0;
  if (d > 0) {
    // Warp the edge so banks wander instead of following the town's straight lines.
    const warp = (fbm(x * 0.03, z * 0.03, 3) - 0.5) * 10;
    const e = Math.max(0, d + warp);
    const bank = 5.5 * smoothstep(0, 5, e);
    const hills = smoothstep(4, 60, e) * (ridged(x * 0.012, z * 0.012) * 42 + fbm(x * 0.05, z * 0.05) * 6);
    h = bank + hills + (fbm(x * 0.4, z * 0.4, 2) - 0.5) * 0.8 * smoothstep(0, 4, e);
  }
  h += base;
  const outside = smoothstep(0, 8, d);
  for (const p of peaks) {
    const r = Math.hypot(x - p.x, z - p.z) / p.radius;
    if (r < 1.4 && outside > 0) h = Math.max(h, outside * p.height * Math.pow(Math.max(0, 1 - r / 1.4), 1.6) * (0.75 + 0.5 * ridged(x * 0.03, z * 0.03, 3)));
  }
  return h;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface Field { width: number; depth: number; cx: number; cz: number; nx: number; nz: number; heights: Float32Array }

/** Samples the height function on a grid; the same samples feed the mesh and the physics heightfield. */
export function sampleField(cx: number, cz: number, width: number, depth: number, step: number,
  height: (x: number, z: number) => number): Field {
  const nx = Math.round(width / step), nz = Math.round(depth / step);
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let ix = 0; ix <= nx; ix++) {
    for (let iz = 0; iz <= nz; iz++) {
      heights[iz + ix * (nz + 1)] = height(cx - width / 2 + ix * width / nx, cz - depth / 2 + iz * depth / nz);
    }
  }
  return { width, depth, cx, cz, nx, nz, heights };
}

export function fieldMesh(field: Field, material: MeshStandardMaterial): Mesh {
  const geometry = new PlaneGeometry(field.width, field.depth, field.nx, field.nz).rotateX(-Math.PI / 2);
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const ix = Math.round((pos.getX(i) + field.width / 2) / field.width * field.nx);
    const iz = Math.round((pos.getZ(i) + field.depth / 2) / field.depth * field.nz);
    pos.setY(i, field.heights[iz + ix * (field.nz + 1)]!);
  }
  geometry.translate(field.cx, 0, field.cz);
  geometry.computeVertexNormals();
  const uv = geometry.getAttribute('uv');
  const tile = LOOKS.ash_cinder_ground.tile;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
  geometry.setAttribute('uv1', uv);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/**
 * Ash on gentle ground, basalt rock on steep ground: the rock is projected from three sides
 * so it never stretches down a cliff.
 */
export function slopeBlend(ground: MeshStandardMaterial, rock: MeshStandardMaterial): MeshStandardMaterial {
  const material = ground.clone();
  const uniforms = { tRock: { value: null as Texture | null }, uRockTint: { value: rock.color }, uRockTile: { value: 1 / LOOKS.basalt_rock_face.tile } };
  const watch = (): void => {
    if (rock.map && uniforms.tRock.value !== rock.map) uniforms.tRock.value = rock.map;
    if (ground.map && material.map !== ground.map) { material.map = ground.map; material.normalMap = ground.normalMap; material.aoMap = ground.aoMap; material.roughnessMap = ground.roughnessMap; material.needsUpdate = true; }
  };
  material.onBeforeRender = watch;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrPos;\nvarying vec3 vTerrNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTerrPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tRock;\nuniform vec3 uRockTint;\nuniform float uRockTile;\nvarying vec3 vTerrPos;\nvarying vec3 vTerrNormal;')
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        vec3 bw = pow(abs(vTerrNormal), vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);
        vec3 rockCol = (texture2D(tRock, vTerrPos.zy * uRockTile).rgb * bw.x
          + texture2D(tRock, vTerrPos.xz * uRockTile).rgb * bw.y
          + texture2D(tRock, vTerrPos.xy * uRockTile).rgb * bw.z) * uRockTint;
        float steep = 1.0 - smoothstep(0.62, 0.86, vTerrNormal.y);
        float far = smoothstep(80.0, 260.0, length(vTerrPos.xz - cameraPosition.xz));
        diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, max(steep, far * 0.6));`);
  };
  // Separate program from the ground it was cloned from.
  material.customProgramCacheKey = () => 'slope-blend';
  watch();
  return material;
}

/**
 * The sky over a forge nation at any hour: blue-grey through a broken soot deck by day,
 * a burning horizon at sunrise and sunset, moon and stars through the gaps at night,
 * and always a red glow toward the volcano.
 */
export function createSky(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: worldTime,
      uNight: nightness,
      uSunDir: skyUniforms.uSunDir,
      uMoonDir: skyUniforms.uMoonDir,
      uDusk: skyUniforms.uDusk,
      uGlowDir: { value: new Color(0.45, 0.05, -0.89) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uNight;
      uniform float uDusk;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform vec3 uGlowDir;
      varying vec3 vDir;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
      float fb(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * n2(p); p = p * 2.02 + 3.1; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float y = max(d.y, -0.05);
        float up = pow(smoothstep(-0.02, 0.55, y), 0.7);
        vec3 sunDir = normalize(uSunDir);
        float sunUp = smoothstep(-0.06, 0.04, sunDir.y);
        // Day: blue-grey zenith over a pale ochre haze. Night: blue-black soot over a faint red horizon.
        vec3 day = mix(vec3(0.66, 0.62, 0.55), vec3(0.24, 0.36, 0.56), up);
        vec3 night = mix(vec3(0.09, 0.05, 0.04), vec3(0.010, 0.014, 0.028), up);
        vec3 col = mix(day, night, uNight);
        // Sunrise and sunset: the horizon burns on the sun's side.
        vec2 across = d.xz / max(length(d.xz), 1e-4);
        vec2 sunFlat = sunDir.xz / max(length(sunDir.xz), 1e-4);
        float sunSide = max(0.0, dot(across, sunFlat));
        float low = 1.0 - smoothstep(0.0, 0.5, y);
        col += vec3(0.9, 0.34, 0.1) * uDusk * (0.25 + 0.75 * pow(sunSide, 3.0)) * low * (1.0 - 0.6 * uNight);
        // The volcano's glow on the haze, stronger after dark.
        vec2 glowFlat = normalize(uGlowDir.xz);
        float toward = max(0.0, dot(across, glowFlat));
        col += vec3(0.9, 0.22, 0.04) * pow(toward, 6.0) * (1.0 - smoothstep(0.0, 0.35, y)) * (0.2 + 0.9 * uNight);
        // Sun disc and its halo, warmer and larger near the horizon.
        float sd = max(dot(d, sunDir), 0.0);
        vec3 sunCol = mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.5, 0.2), uDusk);
        vec3 halo = mix(vec3(1.0, 0.8, 0.6), vec3(1.0, 0.42, 0.14), uDusk);
        vec3 sun = (sunCol * smoothstep(0.99955, 0.9997, sd) * 40.0 + halo * (pow(sd, 300.0) * 0.8 + pow(sd, 24.0) * 0.12)) * sunUp;
        // Moon disc at night.
        float md = max(dot(d, normalize(uMoonDir)), 0.0);
        vec3 moon = vec3(0.75, 0.8, 0.95) * (smoothstep(0.99965, 0.9998, md) * 6.0 + pow(md, 120.0) * 0.12) * uNight;
        // Cloud deck, drifting and broken: lit by the sun by day, from below by the town and volcano at night.
        vec2 cp = d.xz / (y + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.002);
        float c = fb(cp + fb(cp * 0.6) * 1.2);
        float cover = smoothstep(0.45, 0.82, c) * smoothstep(0.0, 0.08, y);
        float thick = smoothstep(0.35, 0.9, c);
        vec3 cloudDay = mix(vec3(0.62, 0.6, 0.6), vec3(0.3, 0.3, 0.33), thick) * (0.75 + 0.5 * pow(sd, 4.0) * sunUp);
        cloudDay = mix(cloudDay, vec3(0.95, 0.48, 0.24) * (0.4 + 0.8 * sunSide), uDusk * 0.7);
        float under = low * (0.4 + 0.6 * toward);
        vec3 cloudNight = mix(vec3(0.03, 0.03, 0.04), vec3(0.4, 0.11, 0.035), under * (1.0 - thick));
        vec3 cloud = mix(cloudDay, cloudNight, uNight);
        // Stars only through gaps in the soot.
        vec2 sc = floor(vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 700.0);
        float star = smoothstep(0.9982, 1.0, h2(sc)) * smoothstep(0.15, 0.45, y) * (0.6 + 0.4 * sin(uTime * 2.0 + h2(sc + 7.0) * 30.0));
        col += vec3(0.9, 0.92, 1.0) * star * 2.5 * uNight * (1.0 - smoothstep(0.2, 0.5, c));
        col += (sun + moon) * (1.0 - cover * 0.85);
        col = mix(col, cloud, cover * 0.9);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(1, 48, 24), material);
  mesh.scale.setScalar(1500);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return mesh;
}
