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
}

export interface Peak { x: number; z: number; radius: number; height: number }

/** Ground height: flat where people walk, a steep basalt bank at the edge, then broken hills. */
export function heightAt(x: number, z: number, walk: Walkable, peaks: Peak[]): number {
  const d = walk.distance(x, z);
  let h = 0;
  if (d > 0) {
    // Warp the edge so banks wander instead of following the town's straight lines.
    const warp = (fbm(x * 0.03, z * 0.03, 3) - 0.5) * 10;
    const e = Math.max(0, d + warp);
    const bank = 5.5 * smoothstep(0, 5, e);
    const hills = smoothstep(4, 60, e) * (ridged(x * 0.012, z * 0.012) * 42 + fbm(x * 0.05, z * 0.05) * 6);
    h = bank + hills + (fbm(x * 0.4, z * 0.4, 2) - 0.5) * 0.8 * smoothstep(0, 4, e);
  }
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

/** Dusk over a forge nation: soot cloud lit orange from below, a red glow toward the volcano. */
export function createSky(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: worldTime,
      uNight: nightness,
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
      uniform vec3 uGlowDir;
      varying vec3 vDir;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
      float fb(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * n2(p); p = p * 2.02 + 3.1; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float y = max(d.y, -0.05);
        // Day: pale ochre haze under the plume. Night: soot black.
        vec3 dayZen = vec3(0.30, 0.27, 0.25), dayHor = vec3(0.78, 0.58, 0.38);
        vec3 nightZen = vec3(0.025, 0.022, 0.028), nightHor = vec3(0.30, 0.10, 0.04);
        vec3 zen = mix(dayZen, nightZen, uNight), hor = mix(dayHor, nightHor, uNight);
        vec3 col = mix(hor, zen, pow(smoothstep(-0.02, 0.55, y), 0.7));
        vec3 glowDir = normalize(uGlowDir);
        float toward = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(glowDir.x, 0.0, glowDir.z))));
        float glow = pow(toward, 6.0) * (1.0 - smoothstep(0.0, 0.35, y));
        col += vec3(0.9, 0.22, 0.04) * glow * (0.5 + 0.8 * uNight);
        // Cloud deck, drifting; lit underneath by the town and the volcano.
        vec2 cp = d.xz / (y + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.002);
        float c = fb(cp + fb(cp * 0.6) * 1.2);
        float cover = smoothstep(0.38, 0.78, c) * smoothstep(0.0, 0.08, y);
        vec3 cloudDark = mix(vec3(0.20, 0.17, 0.16), vec3(0.03, 0.025, 0.025), uNight);
        vec3 cloudLit = mix(vec3(0.85, 0.55, 0.32), vec3(0.42, 0.12, 0.04), uNight);
        float under = (1.0 - smoothstep(0.0, 0.4, y)) * (0.4 + 0.6 * toward);
        vec3 cloud = mix(cloudDark, cloudLit, under * smoothstep(0.35, 0.9, 1.0 - c));
        col = mix(col, cloud, cover * 0.92);
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
