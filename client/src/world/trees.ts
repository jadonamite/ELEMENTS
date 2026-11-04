import {
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cellLods, seeded, type Part, type PlantKind } from './builder.js';
import { nightness, worldTime } from './effects.js';

/**
 * Sindr's planting, drawn as instances: ginkgo (gold in autumn, the tree that survives fire), rust-red maple,
 * and the grass and broad weeds that grow at wall feet. Every leaf comes from one painted atlas of four cells,
 * so all foliage shares one material; crowns are cards whose normals point out from the crown's centre,
 * which lights them as one soft mass instead of as flat planes.
 */

interface Form {
  /** Atlas cell: 0 ginkgo, 1 maple, 2 grass, 3 broad weed. */
  cell: number;
  trunk: number;
  /** Crown centre height, radii across and up. */
  crownY: number; crownR: number; crownH: number;
  cards: number; card: [number, number];
  limbs: number; radius: number;
  /** Lean of the whole tree, for a less planted look. */
  lean: number;
}

const FORMS: Record<PlantKind, Form> = {
  ginkgo: { cell: 0, trunk: 3.6, crownY: 7.2, crownR: 3.6, crownH: 4.4, cards: 260, card: [1.7, 2.6], limbs: 7, radius: 0.24, lean: 0.04 },
  maple: { cell: 1, trunk: 2.4, crownY: 5.0, crownR: 4.4, crownH: 2.8, cards: 230, card: [1.6, 2.4], limbs: 6, radius: 0.2, lean: 0.1 },
  weed: { cell: 2, trunk: 0, crownY: 0.25, crownR: 0.35, crownH: 0.2, cards: 5, card: [0.55, 0.75], limbs: 0, radius: 0, lean: 0 },
  fern: { cell: 3, trunk: 0, crownY: 0.35, crownR: 0.45, crownH: 0.3, cards: 5, card: [0.7, 0.95], limbs: 0, radius: 0, lean: 0 },
};

/**
 * Builds the instanced trees and weeds per ground cell: full crowns near, a crown of a third the cards past
 * 80 m, weeds gone past 60 m, trees kept to 500 m where the haze has them.
 */
export function createPlants(spots: Array<{ kind: PlantKind; x: number; y: number; z: number; yaw: number; scale: number }>,
  bark: Material, low: boolean): Group {
  const group = new Group();
  group.name = 'plants';
  const leaves = leafMaterial();
  for (const kind of Object.keys(FORMS) as PlantKind[]) {
    const list = spots.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const form = FORMS[kind];
    const seed = kind === 'ginkgo' ? 3 : kind === 'maple' ? 5 : 9;
    const small = kind === 'weed' || kind === 'fern';
    const parts = (cards: number): Part[] => {
      const { wood, crown } = plantGeometry(form, cards, seed);
      return [
        { geometry: crown, material: leaves, castShadow: !small && !low, name: `${kind}-leaves` },
        ...(wood ? [{ geometry: wood, material: bark, castShadow: true, name: `${kind}-wood` }] : []),
      ];
    };
    const levels = small ? [{ from: 0, parts: parts(1) }] : [{ from: 0, parts: parts(low ? 0.6 : 1) }, { from: 80, parts: parts(0.33) }];
    for (const lod of cellLods(list, levels, small ? 60 : 500)) group.add(lod);
  }
  return group;
}

/** A plant's wood and crown; `share` is the fraction of the form's leaf cards drawn. */
function plantGeometry(f: Form, share: number, seed: number): { wood: BufferGeometry | null; crown: BufferGeometry } {
  const rand = seeded(seed);
  const centre = new Vector3(Math.sin(f.lean) * f.crownY * 0.5, f.crownY, 0);
  let wood: BufferGeometry | null = null;
  const tips: Vector3[] = [];
  if (f.trunk > 0) {
    const parts: BufferGeometry[] = [];
    const top = new Vector3(Math.sin(f.lean) * f.trunk, f.trunk, 0);
    parts.push(limb(new Vector3(), top, f.radius, f.radius * 0.75));
    // A root flare, so the trunk grows out of the ground instead of standing on it.
    parts.push(limb(new Vector3(0, -0.2, 0), new Vector3(0, 0.6, 0), f.radius * 1.7, f.radius));
    for (let i = 0; i < f.limbs; i++) {
      const a = (i / f.limbs) * Math.PI * 2 + rand() * 0.6;
      const reach = 0.55 + rand() * 0.35;
      const end = centre.clone().add(new Vector3(Math.cos(a) * f.crownR * reach, (rand() - 0.25) * f.crownH * 0.8, Math.sin(a) * f.crownR * reach));
      const start = top.clone().lerp(centre, rand() * 0.45);
      const mid = start.clone().lerp(end, 0.5).add(new Vector3(0, 0.5 + rand() * 0.6, 0));
      parts.push(limb(start, mid, f.radius * 0.6, f.radius * 0.38));
      parts.push(limb(mid, end, f.radius * 0.38, f.radius * 0.12));
      tips.push(end);
    }
    parts.push(limb(top, centre.clone().add(new Vector3(0, f.crownH * 0.6, 0)), f.radius * 0.7, f.radius * 0.1));
    wood = mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g), false);
  }
  // Cards: mostly on the crown's shell, clustered around the limb tips, each facing roughly outward.
  const cards: BufferGeometry[] = [];
  const count = Math.max(3, Math.round(f.cards * share));
  const cellU = (f.cell % 2) * 0.5, cellV = Math.floor(f.cell / 2) * 0.5;
  const small = f.trunk === 0;
  for (let i = 0; i < count; i++) {
    let p: Vector3;
    if (small) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.8;
      p = new Vector3(Math.cos(a) * f.crownR * 0.25 * rand(), f.card[1] * 0.42, Math.sin(a) * f.crownR * 0.25 * rand());
    } else if (tips.length && rand() < 0.55) {
      const t = tips[Math.floor(rand() * tips.length)]!;
      p = t.clone().add(new Vector3((rand() - 0.5) * 2.2, (rand() - 0.3) * 1.6, (rand() - 0.5) * 2.2));
    } else {
      const u = rand() * Math.PI * 2, v = Math.acos(rand() * 1.7 - 0.7), r = 0.6 + 0.4 * Math.sqrt(rand());
      p = centre.clone().add(new Vector3(Math.sin(v) * Math.cos(u) * f.crownR * r, Math.cos(v) * f.crownH * r, Math.sin(v) * Math.sin(u) * f.crownR * r));
    }
    const s = f.card[0] + rand() * (f.card[1] - f.card[0]);
    const g = new PlaneGeometry(s, s);
    if (small) {
      // Weeds stand upright, crossed around their middle.
      g.rotateY((i / count) * Math.PI + rand() * 0.3);
      g.rotateX((rand() - 0.5) * 0.3);
    } else {
      g.rotateZ(rand() * Math.PI * 2);
      const out = p.clone().sub(centre).normalize();
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), out.lerp(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5), 0.6).normalize());
      g.applyQuaternion(q);
    }
    g.translate(p.x, p.y, p.z);
    // Normals from the crown's centre (weeds: mostly up), so the mass shades like a volume.
    const nor = g.getAttribute('normal'), pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const n = small ? new Vector3(pos.getX(k) - 0, 0.9, pos.getZ(k)).normalize()
        : new Vector3(pos.getX(k) - centre.x, (pos.getY(k) - centre.y) * 1.4 + f.crownH * 0.3, pos.getZ(k) - centre.z).normalize();
      nor.setXYZ(k, n.x, n.y, n.z);
    }
    const uv = g.getAttribute('uv');
    const flip = rand() < 0.5;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, cellU + (flip ? 1 - uv.getX(k) : uv.getX(k)) * 0.5, cellV + uv.getY(k) * 0.5);
    cards.push(g.toNonIndexed());
  }
  return { wood, crown: mergeGeometries(cards, false)! };
}

/** A tapered limb from p0 to p1, with its bark uvs scaled to metres. */
function limb(p0: Vector3, p1: Vector3, r0: number, r1: number): BufferGeometry {
  const dir = p1.clone().sub(p0), len = dir.length();
  const g = new CylinderGeometry(r1, r0, len, 7, 1, true);
  const uv = g.getAttribute('uv');
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (Math.PI * 2 * r0) / 1.2, uv.getY(k) * len / 1.2);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
  g.translate(p0.x, p0.y, p0.z);
  g.setAttribute('uv1', g.getAttribute('uv'));
  return g;
}

/** The shared foliage material: alpha-cut leaves, a little light through them by day, swaying in the wind. */
function leafMaterial(): MeshStandardMaterial {
  const map = new CanvasTexture(paintAtlas(1024));
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const material = new MeshStandardMaterial({ map, alphaTest: 0.42, side: DoubleSide, roughness: 0.78, metalness: 0, emissive: 0xffffff, emissiveMap: map });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldTime;
    shader.uniforms.uNight = nightness;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 swayAt = instanceMatrix[3].xz;
        #else
          vec2 swayAt = vec2(0.0);
        #endif
        float swayK = max(0.0, position.y - 1.5) * 0.02 + position.y * 0.01;
        float swayT = uTime * 1.3 + swayAt.x * 0.21 + swayAt.y * 0.17;
        transformed.x += sin(swayT + position.z * 0.6) * swayK;
        transformed.z += sin(swayT * 0.8 + position.x * 0.6 + 1.7) * swayK * 0.7;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.1 * (1.0 - uNight);');
  };
  return material;
}

/** Paints the four leaf cells: ginkgo fans, five-lobed maple leaves, grass blades, broad weed leaves. */
function paintAtlas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = seeded(91);
  const half = size / 2;
  const cell = (index: number, draw: (cx: number, cy: number, r: number) => void): void => {
    const ox = (index % 2) * half, oy = (1 - Math.floor(index / 2)) * half;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, half, half); ctx.clip();
    draw(ox + half / 2, oy + half / 2, half / 2);
    ctx.restore();
  };
  const twigs = (cx: number, cy: number, r: number, n: number, colour: string, leaf: (x: number, y: number, a: number, t: number) => void, density: number): void => {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (rand() - 0.5) * 2.6;
      const len = r * (0.55 + rand() * 0.35);
      ctx.strokeStyle = colour; ctx.lineWidth = 2.2; ctx.beginPath();
      const bx = cx + (rand() - 0.5) * r * 0.3, by = cy + r * 0.55;
      ctx.moveTo(bx, by);
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      ctx.quadraticCurveTo((bx + ex) / 2 + (rand() - 0.5) * 30, (by + ey) / 2, ex, ey);
      ctx.stroke();
      const leaves = Math.round(density * (0.7 + rand() * 0.6));
      for (let k = 0; k < leaves; k++) {
        const t = 0.25 + rand() * 0.8;
        leaf(bx + (ex - bx) * t + (rand() - 0.5) * 34, by + (ey - by) * t + (rand() - 0.5) * 34, a + (rand() - 0.5) * 1.8, Math.hypot(ex - cx, ey - cy) / r);
      }
    }
  };
  const shade = (h: number, s: number, l: number, depth: number): string =>
    `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${(l * (0.62 + 0.38 * depth)).toFixed(0)}%)`;

  // Ginkgo: fan-shaped leaves, gold through yellow-green.
  cell(0, (cx, cy, r) => twigs(cx, cy, r, 9, '#4a3a2a', (x, y, a, d) => {
    const s = 13 + rand() * 9;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = shade(rand() < 0.3 ? 70 + rand() * 18 : 46 + rand() * 12, 62 + rand() * 20, 48 + rand() * 14, d);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(-s * 0.95, -s * 0.95); ctx.quadraticCurveTo(-s * 0.4, -s * 1.35, -0.06 * s, -s * 1.02);
    ctx.lineTo(0, -s * 0.8); ctx.lineTo(0.06 * s, -s * 1.02); ctx.quadraticCurveTo(s * 0.4, -s * 1.35, s * 0.95, -s * 0.95);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }, 22));
  // Maple: five-lobed, rust red to ember orange, a few still dark green.
  cell(1, (cx, cy, r) => twigs(cx, cy, r, 9, '#3a2a22', (x, y, a, d) => {
    const s = 12 + rand() * 8;
    const g = rand();
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = g < 0.12 ? shade(95, 30, 30, d) : shade(4 + rand() * 26, 62 + rand() * 22, 34 + rand() * 16, d);
    ctx.beginPath();
    for (let k = 0; k <= 10; k++) {
      const ang = -Math.PI / 2 + (k / 10) * Math.PI * 2 - Math.PI * 0.5;
      const rr = k % 2 ? s * 0.45 : s * (k === 0 || k === 10 ? 0.2 : 1);
      ctx.lineTo(Math.cos(ang + Math.PI / 2) * rr, Math.sin(ang + Math.PI / 2) * rr - s * 0.5);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }, 24));
  // Grass: thin curved blades from a base, green going to straw.
  cell(2, (cx, cy, r) => {
    for (let i = 0; i < 90; i++) {
      const bx = cx + (rand() - 0.5) * r * 0.9, by = cy + r * 0.98;
      const h = r * (0.6 + rand() * 0.9), lean = (rand() - 0.5) * r * 0.7;
      ctx.strokeStyle = shade(rand() < 0.35 ? 46 + rand() * 10 : 70 + rand() * 25, 35 + rand() * 25, 30 + rand() * 22, 0.6 + rand() * 0.4);
      ctx.lineWidth = 2 + rand() * 3;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + lean * 0.2, by - h * 0.6, bx + lean, by - h); ctx.stroke();
    }
  });
  // Broad weeds: dock and plantain leaves on short stalks, deep green.
  cell(3, (cx, cy, r) => {
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (rand() - 0.5) * 2.4, len = r * (0.35 + rand() * 0.55), w = len * (0.22 + rand() * 0.12);
      const bx = cx + (rand() - 0.5) * r * 0.25, by = cy + r * 0.95;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = shade(80 + rand() * 30, 30 + rand() * 25, 24 + rand() * 18, 0.55 + rand() * 0.45);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-w, -len * 0.5, 0, -len); ctx.quadraticCurveTo(w, -len * 0.5, 0, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(20,30,10,0.5)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len); ctx.stroke();
      ctx.restore();
    }
  });
  return canvas;
}
