import {
  CanvasTexture, Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial,
  PlaneGeometry, Quaternion, SRGBColorSpace, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Point3 } from '../../../shared/src/world/ignis/coordinates.js';
import { mineAt, SETTLEMENTS, waterHeight } from '../../../shared/src/world/ignis/ground.js';
import { LAND_COUNT, landAt, landDraw, type LandType } from '../../../shared/src/world/ignis/land.js';
import { nationalRoadAt } from '../../../shared/src/world/ignis/routes.js';
import { SETTLEMENT_PRECINCTS } from '../../../shared/src/world/ignis/settlements.js';
import { seeded } from './builder.js';
import { worldTime } from './effects.js';
import { rockHouseClear } from './rock-houses.js';

/** Sheet cells: 0 short grass, 1 tall seeded grass, 2 reeds, 3 flower spikes. */
type Sheet = 0 | 1 | 2 | 3;
interface Cover { sheet: Sheet; density: number; colour: number; low: number; high: number; width: number }

/**
 * The small plant of each land type, read from the same land map as the paint and the trees.
 * Land types not listed are bare: lava, slag, sulphur, sand, shingle, rock, snow, clay and worked earth.
 */
export const COVER: Partial<Record<LandType, Cover>> = {
  white_grass: { sheet: 1, density: 0.96, colour: 0xd9cf9c, low: 0.8, high: 1.45, width: 1.1 },
  meadow: { sheet: 0, density: 0.92, colour: 0x7fa64a, low: 0.3, high: 0.6, width: 1.5 },
  marsh: { sheet: 2, density: 0.9, colour: 0x8a9a58, low: 1.4, high: 2.3, width: 0.75 },
  regrowth: { sheet: 3, density: 0.85, colour: 0xd66aa8, low: 0.7, high: 1.25, width: 0.8 },
  terrace: { sheet: 1, density: 0.96, colour: 0xc9b64e, low: 0.55, high: 0.8, width: 1.2 },
  ginkgo: { sheet: 0, density: 0.5, colour: 0xc9a440, low: 0.22, high: 0.4, width: 1.5 },
  maple: { sheet: 0, density: 0.45, colour: 0xa8553a, low: 0.22, high: 0.4, width: 1.5 },
  pine: { sheet: 0, density: 0.5, colour: 0x4f6a3a, low: 0.3, high: 0.55, width: 1.4 },
  ash: { sheet: 0, density: 0.1, colour: 0x9a927c, low: 0.2, high: 0.38, width: 1.3 },
  burn: { sheet: 3, density: 0.05, colour: 0xd66aa8, low: 0.4, high: 0.7, width: 0.8 },
};

export interface GroundCover {
  mesh: InstancedMesh;
  stats: { slots: number; planted: number };
  /** Move the planted square with the hero; only tufts that left it are replanted. */
  update(local: Point3): void;
  dispose(): void;
}

/** White and grey plants on a clear sheet; each tuft is tinted by its land type. */
function coverSheet(): CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!, rand = seeded(0x3c0e);
  const cell = (i: number, draw: () => void): void => {
    ctx.save(); ctx.translate((i % 2) * 256, (1 - Math.floor(i / 2)) * 256);
    ctx.beginPath(); ctx.rect(0, 0, 256, 256); ctx.clip(); draw(); ctx.restore();
  };
  const grey = (light: number): string => `hsl(0, 0%, ${light.toFixed(0)}%)`;
  const blade = (x: number, height: number, lean: number, width: number, light: number): [number, number] => {
    ctx.strokeStyle = grey(light); ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, 256); ctx.quadraticCurveTo(x + lean * 0.2, 256 - height * 0.6, x + lean, 256 - height); ctx.stroke();
    return [x + lean, 256 - height];
  };
  cell(0, () => { for (let i = 0; i < 130; i++) blade(20 + rand() * 216, 90 + rand() * 150, (rand() - 0.5) * 90, 2 + rand() * 2.5, 55 + rand() * 45); });
  cell(1, () => {
    for (let i = 0; i < 80; i++) {
      const [x, y] = blade(24 + rand() * 208, 130 + rand() * 110, (rand() - 0.5) * 70, 1.6 + rand() * 1.8, 55 + rand() * 35);
      if (rand() < 0.6) { ctx.fillStyle = grey(88 + rand() * 12); ctx.beginPath(); ctx.ellipse(x, y + 8, 3.5, 13, (rand() - 0.5) * 0.6, 0, Math.PI * 2); ctx.fill(); }
    }
  });
  cell(2, () => {
    for (let i = 0; i < 16; i++) {
      const [x, y] = blade(24 + rand() * 208, 150 + rand() * 90, (rand() - 0.5) * 30, 5 + rand() * 3, 60 + rand() * 30);
      if (rand() < 0.55) { ctx.fillStyle = grey(30); ctx.beginPath(); ctx.ellipse(x, y + 20, 7, 24, 0, 0, Math.PI * 2); ctx.fill(); }
    }
  });
  cell(3, () => {
    for (let i = 0; i < 9; i++) {
      const x0 = 30 + rand() * 196, height = 150 + rand() * 96, lean = (rand() - 0.5) * 40;
      blade(x0, height, lean, 4, 32);
      for (let n = 0; n < 34; n++) {
        const t = 0.45 + rand() * 0.55;
        ctx.fillStyle = grey(78 + rand() * 22);
        ctx.beginPath(); ctx.arc(x0 + lean * t * t + (rand() - 0.5) * 22 * (1.2 - t), 256 - height * t, 4 + rand() * 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
  const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; map.anisotropy = 4;
  return map;
}

/**
 * Grass, reeds and flowers on a square of ground that travels with the hero. Slots sit on a fixed grid of the
 * nation, so a tuft never moves; when the hero walks, the row of slots left behind is replanted ahead.
 */
export function createGroundCover(options: { ground(x: number, z: number): number; origin: Point3; low: boolean }): GroundCover {
  const { ground, origin, low } = options;
  const spacing = low ? 1.7 : 1.15, side = low ? 44 : 80, reach = spacing * side / 2;
  const cards = [0, 1, 2].map(i => new PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY(i * Math.PI / 3));
  const geometry = mergeGeometries(cards, false)!; for (const c of cards) c.dispose();
  // Blades are lit as the ground they stand on, so a field shades as one surface.
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0);
  const sheet = new Float32Array(side * side);
  geometry.setAttribute('aCell', new InstancedBufferAttribute(sheet, 1));
  const map = coverSheet(), hero = { value: new Vector2() };
  const material = new MeshStandardMaterial({ map, alphaTest: 0.45, side: DoubleSide, roughness: 1, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = worldTime; shader.uniforms.uHero = hero; shader.uniforms.uReach = { value: reach };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell;\nuniform float uTime;\nuniform vec2 uHero;\nuniform float uReach;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
          vMapUv = (vec2(mod(aCell, 2.0), floor(aCell * 0.5)) + uv) * 0.5;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 at = instanceMatrix[3].xz;
        // Tufts shrink into the ground at the edge of the planted square.
        transformed *= 1.0 - smoothstep(uReach * 0.72, uReach * 0.98, distance(at, uHero));
        // Wind: a slow gust front crossing the land, and each tuft's own quiver.
        float gust = sin(uTime * 0.9 + at.x * 0.05 + at.y * 0.035) * 0.5 + 0.5;
        float bend = uv.y * uv.y * (0.1 + 0.3 * gust);
        transformed.x += (sin(uTime * 2.3 + at.x * 0.9 + at.y * 0.7) * 0.35 + 0.8) * bend;
        transformed.z += sin(uTime * 1.9 + at.y * 0.8) * 0.3 * bend;`);
  };
  const mesh = new InstancedMesh(geometry, material, side * side);
  mesh.name = 'ignis-ground-cover'; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
  const cellX = new Int32Array(side * side).fill(0x7fffffff), cellZ = new Int32Array(side * side).fill(0x7fffffff);
  const weights = new Float32Array(LAND_COUNT), matrix = new Matrix4(), turn = new Quaternion(), up = new Vector3(0, 1, 0);
  const none = new Matrix4().makeScale(0, 0, 0), colour = new Color(), place = new Vector3(), size = new Vector3();
  const stats = { slots: side * side, planted: 0 };
  const planted = new Uint8Array(side * side);

  const plant = (slot: number, cx: number, cz: number): void => {
    const rand = seeded(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ 0x2f1b);
    const x = (cx + rand()) * spacing, z = (cz + rand()) * spacing, chance = rand(), typeRoll = rand();
    stats.planted -= planted[slot]!; planted[slot] = 0;
    mesh.setMatrixAt(slot, none);
    const y = ground(x - origin.x, z - origin.z);
    landAt(x, z, y + origin.y, 0, weights);
    const land: LandType | null = landDraw(weights, typeRoll);
    const cover = land && COVER[land];
    if (!cover || chance > cover.density) return;
    if (nationalRoadAt(x, z) !== null || mineAt(x, z).distance < 6) return;
    const town = SETTLEMENTS[0];
    if (Math.hypot(x - town.x, z - town.z) < town.radius + 30) return;
    if (SETTLEMENT_PRECINCTS.some(p => Math.hypot(x - p.x, z - p.z) < p.radius - 8)) return;
    if (!rockHouseClear(x, z, 1)) return;
    const water = waterHeight(x, z);
    if (water !== null && water > y + origin.y + (cover.sheet === 2 ? 0.5 : 0.05)) return;
    const height = cover.low + rand() * (cover.high - cover.low), width = cover.width * (0.8 + rand() * 0.5);
    matrix.compose(place.set(x - origin.x, y - 0.04, z - origin.z), turn.setFromAxisAngle(up, rand() * Math.PI), size.set(width, height, width));
    mesh.setMatrixAt(slot, matrix);
    const shade = 0.78 + rand() * 0.34;
    mesh.setColorAt(slot, colour.setHex(cover.colour).multiplyScalar(shade));
    sheet[slot] = cover.sheet; planted[slot] = 1; stats.planted++;
  };

  return {
    mesh, stats,
    update(local) {
      hero.value.set(local.x, local.z);
      const hx = Math.floor((local.x + origin.x) / spacing), hz = Math.floor((local.z + origin.z) / spacing), half = side / 2;
      let changed = false;
      for (let a = 0; a < side; a++) {
        // The one grid column congruent to `a` that lies inside the square round the hero.
        const cx = a + side * Math.floor((hx + half - a) / side);
        for (let b = 0; b < side; b++) {
          const cz = b + side * Math.floor((hz + half - b) / side), slot = a * side + b;
          if (cellX[slot] === cx && cellZ[slot] === cz) continue;
          cellX[slot] = cx; cellZ[slot] = cz; plant(slot, cx, cz); changed = true;
        }
      }
      if (!changed) return;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      geometry.getAttribute('aCell').needsUpdate = true;
    },
    dispose() { mesh.removeFromParent(); mesh.dispose(); geometry.dispose(); material.dispose(); map.dispose(); },
  };
}
