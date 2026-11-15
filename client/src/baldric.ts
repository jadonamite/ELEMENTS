import { BufferGeometry, Float32BufferAttribute, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, type Material } from 'three';
import { crossings, type TorsoFit } from './torso-fit.js';

/** Thickest cloth, armour or leather the strap may lie over the body's first surface, in metres. */
const CLOTH = 0.06;

export const STRAP = {
  /** Band width across the chest, in metres. */
  width: 0.05,
  thickness: 0.004,
  /** Air between the cloth and the band's inner face. */
  lift: 0.013,
  /** The sash rises toward the right shoulder at this angle from the horizontal (rise 0.75 per unit across). */
  tilt: Math.atan(0.75),
  steps: 72,
} as const;

/** The leather strip reserved in the scabbard's texture, in glTF UV space. */
export const STRAP_UV = { u0: 0.02, u1: 0.98, v0: 0.812, v1: 0.988 } as const;

/** The sash plane's directions: toward the right shoulder, and its normal (across the band's width, pointing up). */
export function sashAxes(fit: TorsoFit): { axis: Vector3; normal: Vector3 } {
  const axis = fit.left.clone().multiplyScalar(-Math.cos(STRAP.tilt)).addScaledVector(fit.up, Math.sin(STRAP.tilt)).normalize();
  const normal = new Vector3().crossVectors(axis, fit.forward).normalize();
  if (normal.dot(fit.up) < 0) normal.negate();
  return { axis, normal };
}

/** The body's outline round the chest in the sash plane: a distance from mid chest for each step. */
export function sashOutline(fit: TorsoFit): number[] {
  const { axis } = sashAxes(fit);
  const n = STRAP.steps;
  // Beyond these reaches along the sash and front to back is an arm, not the torso.
  const along = fit.width * 0.7;
  const through = fit.width * 0.6;
  const direction = new Vector3();
  const raw: number[] = [];
  for (let k = 0; k < n; k++) {
    const theta = (2 * Math.PI * k) / n;
    const c = Math.cos(theta), s = Math.sin(theta);
    direction.copy(axis).multiplyScalar(c).addScaledVector(fit.forward, s);
    const cap = 1 / Math.hypot(c / along, s / through);
    const hits = crossings(fit.soup, fit.centre, direction, cap);
    // The first surface is the body (or the cloth, if the body is one piece); the strap lies on the outermost
    // layer within a cloth's thickness of it, so shreds and a flared hem cannot pull the outline outward.
    const first = hits[0];
    raw.push(first === undefined ? cap * 0.85 : Math.max(...hits.filter(h => h <= first + CLOTH)));
  }
  // Bridge the hollows (armpit, collar) rather than sinking into them, then round the outline off.
  let r = raw.map((_, i) => Math.max(...[-2, -1, 0, 1, 2].map(d => raw[(i + d + n) % n]!)));
  for (let pass = 0; pass < 2; pass++) {
    const prev = r;
    r = prev.map((v, i) => (prev[(i - 1 + n) % n]! + 2 * v + prev[(i + 1) % n]!) / 4);
  }
  return r;
}

interface Weighted { index: number; weight: number }

/** The bones that move the cloth nearest to a point: its three nearest body vertices' weights, blended by distance. */
function skinFor(fit: TorsoFit, nearby: Int32Array, point: Vector3): Weighted[] {
  const { position, skinIndex, skinWeight } = fit.soup;
  const best: { v: number; d: number }[] = [];
  for (const v of nearby) {
    const dx = position[v * 3]! - point.x, dy = position[v * 3 + 1]! - point.y, dz = position[v * 3 + 2]! - point.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (best.length < 3 || d < best[best.length - 1]!.d) {
      best.push({ v, d });
      best.sort((a, b) => a.d - b.d);
      if (best.length > 3) best.pop();
    }
  }
  const sum = new Map<number, number>();
  for (const { v, d } of best) {
    const blend = 1 / (Math.sqrt(d) + 0.004);
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[v * 4 + k]!;
      if (w > 0) sum.set(skinIndex[v * 4 + k]!, (sum.get(skinIndex[v * 4 + k]!) ?? 0) + w * blend);
    }
  }
  const top = [...sum].map(([index, weight]) => ({ index, weight })).sort((a, b) => b.weight - a.weight).slice(0, 4);
  const total = top.reduce((t, w) => t + w.weight, 0) || 1;
  return top.map(w => ({ index: w.index, weight: w.weight / total }));
}

/**
 * A leather baldric across the chest, cut to the worn body's own outline and skinned to the same bones, so it
 * follows the torso when it bends. Needs the carrier's body at its bind pose; works for any body and outfit.
 */
export function fitBaldric(fit: TorsoFit, material: Material): SkinnedMesh {
  const n = STRAP.steps;
  const outline = sashOutline(fit);
  const { axis, normal } = sashAxes(fit);
  const half = STRAP.width / 2;
  const radial = new Vector3();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const facingOf = (group: number, out: Vector3, dir: Vector3): Vector3 =>
    group === 0 ? out.copy(dir) : group === 1 ? out.copy(dir).negate() : group === 2 ? out.copy(normal) : out.copy(normal).negate();

  // Four faces round the band: outer, inner, top edge, bottom edge; two vertices per column each.
  for (let group = 0; group < 4; group++) {
    for (let k = 0; k <= n; k++) {
      const j = k % n;
      const theta = (2 * Math.PI * j) / n;
      radial.copy(axis).multiplyScalar(Math.cos(theta)).addScaledVector(fit.forward, Math.sin(theta));
      const middle = outline[j]! + STRAP.lift + STRAP.thickness / 2;
      const outer = middle + STRAP.thickness / 2;
      const inner = middle - STRAP.thickness / 2;
      const u = STRAP_UV.u0 + ((STRAP_UV.u1 - STRAP_UV.u0) * k) / n;
      const pair = group === 0 ? [[outer, half], [outer, -half]]
        : group === 1 ? [[inner, half], [inner, -half]]
          : group === 2 ? [[outer, half], [inner, half]] : [[outer, -half], [inner, -half]];
      pair.forEach(([reach, across], side) => {
        const p = fit.centre.clone().addScaledVector(radial, reach!).addScaledVector(normal, across!);
        positions.push(p.x, p.y, p.z);
        const face = facingOf(group, new Vector3(), radial);
        normals.push(face.x, face.y, face.z);
        const v = group < 2 ? (side === 0 ? STRAP_UV.v1 : STRAP_UV.v0) : (STRAP_UV.v0 + STRAP_UV.v1) / 2;
        uvs.push(u, v);
      });
    }
  }
  const columns = n + 1;
  for (let group = 0; group < 4; group++) {
    const base = group * columns * 2;
    for (let k = 0; k < n; k++) {
      const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Wind each face to look the way it faces: test the first triangle of each against its intended side.
  const flipped = indices.slice();
  const p = positions;
  for (let group = 0; group < 4; group++) {
    const t = group * n * 6;
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const e1 = new Vector3(p[b * 3]! - p[a * 3]!, p[b * 3 + 1]! - p[a * 3 + 1]!, p[b * 3 + 2]! - p[a * 3 + 2]!);
    const e2 = new Vector3(p[c * 3]! - p[a * 3]!, p[c * 3 + 1]! - p[a * 3 + 1]!, p[c * 3 + 2]! - p[a * 3 + 2]!);
    const theta0 = 0;
    radial.copy(axis).multiplyScalar(Math.cos(theta0)).addScaledVector(fit.forward, Math.sin(theta0));
    const want = facingOf(group, new Vector3(), radial);
    if (e1.cross(e2).dot(want) < 0) {
      for (let i = group * n * 6; i < (group + 1) * n * 6; i += 3) {
        flipped[i + 1] = indices[i + 2]!;
        flipped[i + 2] = indices[i + 1]!;
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(flipped);

  // Bones: whichever the cloth under each point is bound to.
  const reachable = new Set<number>();
  for (const v of fit.soup.index) reachable.add(v);
  const nearby = Int32Array.from(reachable);
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const point = new Vector3();
  for (let i = 0; i < positions.length / 3; i++) {
    point.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
    const bones = skinFor(fit, nearby, point);
    for (let k = 0; k < 4; k++) {
      skinIndices.push(bones[k]?.index ?? 0);
      skinWeights.push(bones[k]?.weight ?? 0);
    }
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeights, 4));

  const main = fit.main;
  const strap = new SkinnedMesh(geometry, material);
  strap.name = 'Baldric';
  strap.userData.baldric = true;
  strap.castShadow = true;
  strap.receiveShadow = true;
  strap.frustumCulled = false;
  main.matrix.decompose(strap.position, strap.quaternion, strap.scale);
  main.parent!.add(strap);
  strap.bind(new Skeleton(main.skeleton.bones, main.skeleton.boneInverses), main.bindMatrix.clone());
  return strap;
}

export function removeBaldric(strap: SkinnedMesh | null): void {
  if (!strap) return;
  strap.removeFromParent();
  strap.geometry.dispose();
  (strap.material as Material).dispose();
}
