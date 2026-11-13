import { BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial } from 'three';
import type { Point3 } from '../../../shared/src/world/ignis/coordinates.js';
import { LAND_COUNT, LAND_TYPES, landAt, type LandType } from '../../../shared/src/world/ignis/land.js';
import { seeded } from './builder.js';
import { worldTime } from './effects.js';

/** One kind of drifting puff: colour and opacity, how high it rises (m), cycles a second, width (m), puffs per slot. */
interface Air { rgb: readonly [number, number, number]; alpha: number; rise: number; speed: number; size: number; density: number }

/**
 * What hangs in the air over each land type, read from the same land map as paint and plants:
 * steam on the sulphur flats, smoke over lava and the burn, dust over ash and slag, mist on wet and wooded land.
 */
export const AIR: Partial<Record<LandType, Air>> = {
  sulphur: { rgb: [0.96, 0.96, 0.9], alpha: 0.42, rise: 16, speed: 0.11, size: 10, density: 0.7 },
  lava: { rgb: [0.1, 0.08, 0.08], alpha: 0.5, rise: 34, speed: 0.07, size: 16, density: 0.6 },
  burn: { rgb: [0.3, 0.28, 0.27], alpha: 0.2, rise: 12, speed: 0.05, size: 14, density: 0.2 },
  ash: { rgb: [0.66, 0.6, 0.52], alpha: 0.17, rise: 3, speed: 0.045, size: 22, density: 0.35 },
  slag: { rgb: [0.3, 0.22, 0.18], alpha: 0.22, rise: 5, speed: 0.05, size: 20, density: 0.35 },
  black_sand: { rgb: [0.25, 0.23, 0.22], alpha: 0.16, rise: 4, speed: 0.05, size: 20, density: 0.2 },
  marsh: { rgb: [0.9, 0.93, 0.95], alpha: 0.26, rise: 1.5, speed: 0.03, size: 28, density: 0.8 },
  meadow: { rgb: [0.9, 0.93, 0.95], alpha: 0.16, rise: 1.5, speed: 0.03, size: 28, density: 0.35 },
  terrace: { rgb: [0.9, 0.93, 0.95], alpha: 0.2, rise: 1.5, speed: 0.03, size: 28, density: 0.5 },
  pine: { rgb: [0.82, 0.88, 0.9], alpha: 0.18, rise: 2, speed: 0.03, size: 30, density: 0.4 },
  ginkgo: { rgb: [0.98, 0.9, 0.7], alpha: 0.12, rise: 2, speed: 0.03, size: 30, density: 0.3 },
};

export interface LandAir { points: Points; stats: { slots: number; live: number }; update(local: Point3): void; dispose(): void }

/** Soft puffs on a square of the nation's grid that travels with the hero; each puff rises, drifts downwind and fades. */
export function createLandAir(options: { ground(x: number, z: number): number; origin: Point3; low: boolean }): LandAir {
  const { ground, origin, low } = options;
  const spacing = 22, side = low ? 14 : 24, count = side * side;
  const position = new Float32Array(count * 3), colour = new Float32Array(count * 4), motion = new Float32Array(count * 4);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aColour', new BufferAttribute(colour, 4));
  geometry.setAttribute('aMotion', new BufferAttribute(motion, 4));
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: NormalBlending,
    uniforms: { uTime: worldTime, uReach: { value: spacing * side / 2 } },
    vertexShader: /* glsl */ `
      attribute vec4 aColour; attribute vec4 aMotion; uniform float uTime; uniform float uReach;
      varying vec4 vColour;
      void main() {
        float t = fract(uTime * aMotion.y + aMotion.w);
        vec3 p = position + vec3(t * aMotion.x * 0.8 + sin(uTime * 0.2 + aMotion.w * 40.0) * 2.0, t * aMotion.x, t * aMotion.x * 0.3);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Fade in and out over a puff's life, at the edge of the square, and when it would touch the lens.
        float edge = 1.0 - smoothstep(uReach * 0.7, uReach * 0.97, length(position.xz - cameraPosition.xz));
        vColour = vec4(aColour.rgb, aColour.a * sin(t * 3.14159) * edge * smoothstep(4.0, 18.0, -mv.z));
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(520.0, aMotion.z * (0.7 + t * 0.8) * 1000.0 / max(1.0, -mv.z));
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vColour;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = vColour.a * (1.0 - smoothstep(0.15, 1.0, d));
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColour.rgb, a);
      }`,
  });
  const points = new Points(geometry, material);
  points.name = 'ignis-land-air'; points.frustumCulled = false; points.renderOrder = 5;
  const cellX = new Int32Array(count).fill(0x7fffffff), cellZ = new Int32Array(count).fill(0x7fffffff);
  const weights = new Float32Array(LAND_COUNT), stats = { slots: count, live: 0 }, live = new Uint8Array(count);

  const fill = (slot: number, cx: number, cz: number): void => {
    const rand = seeded(Math.imul(cx, 40503) ^ Math.imul(cz, 92821) ^ 0x61a7);
    const x = (cx + rand()) * spacing, z = (cz + rand()) * spacing, chance = rand(), typeRoll = rand();
    stats.live -= live[slot]!; live[slot] = 0; colour[slot * 4 + 3] = 0;
    const y = ground(x - origin.x, z - origin.z);
    const glow = landAt(x, z, y + origin.y, 0, weights);
    let land: LandType | null = null, left = typeRoll;
    for (let i = 0; i < LAND_COUNT; i++) { left -= weights[i]!; if (left < 0) { land = LAND_TYPES[i]!; break; } }
    const air = land && AIR[land];
    if (!air || chance > air.density) return;
    position.set([x - origin.x, y + air.size * 0.22, z - origin.z], slot * 3);
    // Smoke over an open crack is lit from below.
    const lit = land === 'lava' ? glow : 0;
    colour.set([air.rgb[0] + lit * 0.9, air.rgb[1] + lit * 0.3, air.rgb[2], air.alpha], slot * 4);
    motion.set([air.rise, air.speed * (0.7 + rand() * 0.6), air.size * (0.75 + rand() * 0.5), rand()], slot * 4);
    live[slot] = 1; stats.live++;
  };

  return {
    points, stats,
    update(local) {
      const hx = Math.floor((local.x + origin.x) / spacing), hz = Math.floor((local.z + origin.z) / spacing), half = side / 2;
      let changed = false;
      for (let a = 0; a < side; a++) {
        const cx = a + side * Math.floor((hx + half - a) / side);
        for (let b = 0; b < side; b++) {
          const cz = b + side * Math.floor((hz + half - b) / side), slot = a * side + b;
          if (cellX[slot] === cx && cellZ[slot] === cz) continue;
          cellX[slot] = cx; cellZ[slot] = cz; fill(slot, cx, cz); changed = true;
        }
      }
      if (!changed) return;
      for (const name of ['position', 'aColour', 'aMotion']) geometry.getAttribute(name).needsUpdate = true;
    },
    dispose() { points.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
