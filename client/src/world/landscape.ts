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

import { groundHeight, waterHeight, smooth } from '../../../shared/src/world/ignis/ground.js';
import { LEGACY_SINDR_ORIGIN } from '../../../shared/src/world/ignis/coordinates.js';

export interface Walkable {
  distance(x: number, z: number): number;
  floorAt?(x: number, z: number): number;
  groundAt?(x: number, z: number): number;
}
export interface Peak { x: number; z: number; radius: number; height: number }

/** The only conversion from national ASL ground into the unchanged town's render frame. */
export function nationalSurface(x: number, z: number): number {
  return groundHeight(x + LEGACY_SINDR_ORIGIN.x, z + LEGACY_SINDR_ORIGIN.z) - LEGACY_SINDR_ORIGIN.y;
}
export function nationalWater(x: number, z: number): number | null {
  const water = waterHeight(x + LEGACY_SINDR_ORIGIN.x, z + LEGACY_SINDR_ORIGIN.z);
  return water === null ? null : water - LEGACY_SINDR_ORIGIN.y;
}
/** Built ground retains canal beds and terrace foundations; its seam ends six metres outside the envelope. */
export function surfaceAt(x: number, z: number, built: Walkable): number {
  const h = nationalSurface(x, z), d = built.distance(x, z);
  if (d >= 6) return h;
  const floor = built.groundAt?.(x, z) ?? built.floorAt?.(x, z) ?? h;
  return floor + (h - floor) * smooth(0, 6, d);
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
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 terrainPoint = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          terrainPoint = batchingMatrix * terrainPoint;
        #endif
        vTerrPos = (modelMatrix * terrainPoint).xyz;
        vTerrNormal = normalize(mat3(modelMatrix) * objectNormal);`);
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
        // Pinned to the far end of the depth range, which is 0 when three reverses depth and 1 otherwise, so the
        // sky draws last and only where nothing else did.
        #ifdef USE_REVERSED_DEPTH_BUFFER
          gl_Position = vec4(p.xy, 0.0, p.w);
        #else
          gl_Position = p.xyww;
        #endif
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
  mesh.renderOrder = 10;
  mesh.name = 'sky';
  return mesh;
}
