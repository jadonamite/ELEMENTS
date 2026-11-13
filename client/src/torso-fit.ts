import { Matrix4, Object3D, Vector3, type SkinnedMesh } from 'three';

/** Meshes that sit on the head and are never part of the torso's outline. */
const NOT_BODY = /hair|beard|brow|lash|eye|teeth|tongue/i;

/** The outer surface of the worn body, in the main body mesh's bind-pose space, with its bone weights. */
export interface Soup {
  position: Float32Array;
  index: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

/** What a carried weapon needs to know about whoever carries it: the torso's frame, size and surface. */
export interface TorsoFit {
  main: SkinnedMesh;
  /** Bind-pose position of a bone in the main mesh's space. */
  bone(name: string): Vector3;
  boneIndex: ReadonlyMap<string, number>;
  up: Vector3;
  /** Toward the character's left. */
  left: Vector3;
  forward: Vector3;
  /** Shoulder joint to shoulder joint. */
  width: number;
  /** Pelvis to neck. */
  length: number;
  /** On the spine, at mid chest. */
  centre: Vector3;
  soup: Soup;
}

const LANDMARKS = ['pelvis', 'spine_02', 'spine_03', 'neck_01', 'upperarm_l', 'upperarm_r'] as const;
/** Triangles farther than this from mid chest cannot touch a carried weapon or its strap. */
const REACH = 1.0;

/** Reads the torso from the worn body in its bind pose, so the result does not depend on the current animation pose. */
export function fitTorso(model: Object3D): TorsoFit | null {
  model.updateMatrixWorld(true);
  const meshes: SkinnedMesh[] = [];
  model.traverse((node) => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh || mesh.userData.baldric) return;
    if (NOT_BODY.test(`${mesh.name} ${(mesh.material as { name?: string }).name ?? ''}`)) return;
    meshes.push(mesh);
  });
  const main = meshes
    .filter(mesh => mesh.skeleton.bones.some(bone => bone.name === 'spine_03'))
    .sort((a, b) => b.geometry.getAttribute('position').count - a.geometry.getAttribute('position').count)[0];
  if (!main) return null;

  const boneIndex = new Map(main.skeleton.bones.map((bone, i) => [bone.name, i] as const));
  // Not main.bindMatrixInverse: three re-derives that from the mesh's current world matrix once it is placed.
  const bindInverse = main.bindMatrix.clone().invert();
  const bone = (name: string): Vector3 => {
    const i = boneIndex.get(name);
    if (i === undefined) throw new Error(`Torso fit: rig has no ${name} bone.`);
    return new Vector3().setFromMatrixPosition(main.skeleton.boneInverses[i]!.clone().invert()).applyMatrix4(bindInverse);
  };
  if (LANDMARKS.some(name => !boneIndex.has(name))) return null;

  const pelvis = bone('pelvis');
  const neck = bone('neck_01');
  const armL = bone('upperarm_l');
  const armR = bone('upperarm_r');
  const up = neck.clone().sub(pelvis).normalize();
  const side = armL.clone().sub(armR);
  const left = side.clone().addScaledVector(up, -side.dot(up)).normalize();
  const forward = new Vector3().crossVectors(left, up).normalize();
  const centre = bone('spine_02').add(bone('spine_03')).multiplyScalar(0.5);

  const fit: TorsoFit = {
    main, bone, boneIndex, up, left, forward, centre,
    width: armL.distanceTo(armR),
    length: neck.distanceTo(pelvis),
    soup: collect(meshes, bindInverse, boneIndex, centre),
  };
  return fit;
}

/** Every body mesh's triangles within reach of the chest, in the main mesh's space, weights mapped to the main rig. */
function collect(meshes: SkinnedMesh[], bindInverse: Matrix4, boneIndex: ReadonlyMap<string, number>, centre: Vector3): Soup {
  const position: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const index: number[] = [];
  const point = new Vector3();
  for (const mesh of meshes) {
    const toMain = bindInverse.clone().multiply(mesh.bindMatrix);
    const source = mesh.geometry.getAttribute('position');
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    const map = mesh.skeleton.bones.map(bone => boneIndex.get(bone.name) ?? 0);
    const first = position.length / 3;
    for (let i = 0; i < source.count; i++) {
      point.fromBufferAttribute(source, i).applyMatrix4(toMain);
      position.push(point.x, point.y, point.z);
      for (let k = 0; k < 4; k++) {
        skinIndex.push(map[joints.getComponent(i, k)]!);
        skinWeight.push(weights.getComponent(i, k));
      }
    }
    const triangles = mesh.geometry.index;
    const count = triangles ? triangles.count : source.count;
    const near = (v: number): boolean => Math.hypot(position[v * 3]! - centre.x, position[v * 3 + 1]! - centre.y, position[v * 3 + 2]! - centre.z) < REACH;
    for (let t = 0; t < count; t += 3) {
      const a = first + (triangles ? triangles.getX(t) : t);
      const b = first + (triangles ? triangles.getX(t + 1) : t + 1);
      const c = first + (triangles ? triangles.getX(t + 2) : t + 2);
      if (near(a) || near(b) || near(c)) index.push(a, b, c);
    }
  }
  return {
    position: new Float32Array(position),
    index: new Uint32Array(index),
    skinIndex: new Uint16Array(skinIndex),
    skinWeight: new Float32Array(skinWeight),
  };
}

/**
 * Distances along a ray at which it crosses the body's surface, nearest first (two-sided Moller-Trumbore).
 */
export function crossings(soup: Soup, origin: Vector3, direction: Vector3, limit: number): number[] {
  const { position: p, index } = soup;
  const hits: number[] = [];
  const dx = direction.x, dy = direction.y, dz = direction.z;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    const e1x = p[b]! - p[a]!, e1y = p[b + 1]! - p[a + 1]!, e1z = p[b + 2]! - p[a + 2]!;
    const e2x = p[c]! - p[a]!, e2y = p[c + 1]! - p[a + 1]!, e2z = p[c + 2]! - p[a + 2]!;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const sx = origin.x - p[a]!, sy = origin.y - p[a + 1]!, sz = origin.z - p[a + 2]!;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (d > 1e-5 && d <= limit) hits.push(d);
  }
  return hits.sort((x, y) => x - y);
}
