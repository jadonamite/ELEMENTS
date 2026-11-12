import { Vector3, type Bone, type BufferGeometry, type Object3D, type SkinnedMesh } from 'three';

/** Most the pelvis is raised to keep the body above the floor, in metres. */
const MAX_LIFT = 0.5;
/** Vertices of the bind pose lower than this above the body's origin count as sole. */
const SOLE_BAND = 0.06;
/** Sole vertices checked each frame, per foot. */
const SOLE_SAMPLES = 48;

/**
 * A foot counts as down below the first height above the floor and as lifted above the second, in metres.
 * The gap is wide so the dip of a toe pushing off is not heard as a second step.
 */
const DOWN = 0.015;
const LIFTED = 0.07;

export const LEFT_FOOT = 1;
export const RIGHT_FOOT = 2;

interface Fit {
  /** Sole vertices of the left foot, then the right, thinned evenly. */
  sole: [number[], number[]];
  /** Flesh around each bone's pivot (by skeleton bone index), in metres. */
  radius: Float32Array;
}

/** Bodies cloned from one model share its geometry, so the measuring is done once. */
const fits = new WeakMap<BufferGeometry, Fit>();

/**
 * Keeps a body on the floor. In the bind pose, where the feet stand flat, the lowest vertices are the
 * soles and every bone has a thickness of flesh around it. After each animation update the soles and
 * the bones (as spheres of that thickness) are tested against the floor at the body's origin, and
 * the pelvis is raised by the deepest shortfall. So a clip made for another leg length, a heavy
 * stance, or a body lying down never goes through the ground. The body is only ever raised, so
 * jumps and kicks play as authored. The same reading tells when a foot lands, which is what a
 * step sound waits for.
 */
export class FootPlant {
  private readonly parts: Array<{ mesh: SkinnedMesh; fit: Fit }> = [];
  private readonly origin = new Vector3();
  private readonly point = new Vector3();
  private readonly shifted = new Vector3();
  private readonly lifted: [boolean, boolean] = [false, false];
  /** Feet that came down in the last pose: LEFT_FOOT, RIGHT_FOOT, both or 0. */
  landed = 0;

  private constructor(private readonly root: Object3D, private readonly pelvis: Bone) {
    root.updateMatrixWorld(true);
    root.getWorldPosition(this.origin);
    root.traverse((node) => {
      const mesh = node as SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      let fit = fits.get(mesh.geometry);
      if (!fit) {
        fit = measure(mesh, this.origin.y);
        fits.set(mesh.geometry, fit);
      }
      this.parts.push({ mesh, fit });
    });
  }

  /** A plant for a rig in its bind pose, or null when it has no humanoid legs. */
  static for(root: Object3D): FootPlant | null {
    const pelvis = root.getObjectByName('pelvis') as Bone | undefined;
    if (!pelvis || !root.getObjectByName('foot_l') || !root.getObjectByName('foot_r')) return null;
    const plant = new FootPlant(root, pelvis);
    return plant.parts.some(part => part.fit.sole[0].length + part.fit.sole[1].length) ? plant : null;
  }

  /** Call after the mixer has posed the bones. */
  apply(): void {
    this.root.updateMatrixWorld(true);
    this.root.getWorldPosition(this.origin);
    let lowest = Infinity;
    const feet: [number, number] = [Infinity, Infinity];
    for (const { mesh, fit } of this.parts) {
      mesh.skeleton.update();
      for (let side = 0; side < 2; side++) {
        for (const i of fit.sole[side]!) {
          mesh.getVertexPosition(i, this.point).applyMatrix4(mesh.matrixWorld);
          if (this.point.y < feet[side]!) feet[side] = this.point.y;
        }
      }
      const bones = mesh.skeleton.bones;
      for (let b = 0; b < bones.length; b++) {
        const y = bones[b]!.matrixWorld.elements[13]! - fit.radius[b]!;
        if (y < lowest) lowest = y;
      }
    }
    lowest = Math.min(lowest, feet[0], feet[1]);
    const raise = Math.max(0, Math.min(MAX_LIFT, this.origin.y - lowest));
    this.landed = 0;
    for (let side = 0; side < 2; side++) {
      const height = feet[side]! + raise - this.origin.y;
      if (height > LIFTED) this.lifted[side] = true;
      else if (height < DOWN && this.lifted[side]) {
        this.lifted[side] = false;
        this.landed |= side === 0 ? LEFT_FOOT : RIGHT_FOOT;
      }
    }
    const lift = raise;
    const parent = this.pelvis.parent;
    if (lift <= 0.0005 || !parent) return;
    this.pelvis.getWorldPosition(this.point);
    this.shifted.copy(this.point);
    this.shifted.y += lift;
    parent.worldToLocal(this.point);
    parent.worldToLocal(this.shifted);
    this.pelvis.position.add(this.shifted.sub(this.point));
    this.pelvis.updateMatrixWorld(true);
  }
}

/** Reads the soles and the flesh around each bone from a mesh standing in its bind pose. */
function measure(mesh: SkinnedMesh, floor: number): Fit {
  mesh.skeleton.update();
  const bones = mesh.skeleton.bones;
  const pivots = bones.map(bone => bone.getWorldPosition(new Vector3()));
  const distances: number[][] = bones.map(() => []);
  const position = mesh.geometry.getAttribute('position');
  const skinIndex = mesh.geometry.getAttribute('skinIndex');
  const skinWeight = mesh.geometry.getAttribute('skinWeight');
  const sides = bones.map(bone => sideOf(bone));
  const sole: [number[], number[]] = [[], []];
  const point = new Vector3();
  const along = new Vector3();
  for (let i = 0; i < position.count; i++) {
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
    let bone = 0;
    let heaviest = 0;
    for (let c = 0; c < 4; c++) {
      const w = skinWeight.getComponent(i, c);
      if (w > heaviest) { heaviest = w; bone = skinIndex.getComponent(i, c); }
    }
    const side = sides[bone]!;
    if (side >= 0 && point.y - floor < SOLE_BAND) sole[side]!.push(i);
    // A bone runs from its pivot to its child's; the flesh is measured from that line.
    const child = bones[bone]!.children.find(node => (node as Bone).isBone);
    const start = pivots[bone]!;
    const end = child ? pivots[bones.indexOf(child as Bone)] : undefined;
    if (end) {
      along.subVectors(end, start);
      const t = Math.min(1, Math.max(0, point.clone().sub(start).dot(along) / Math.max(along.lengthSq(), 1e-9)));
      distances[bone]!.push(point.distanceTo(along.multiplyScalar(t).add(start)));
    } else {
      distances[bone]!.push(point.distanceTo(start));
    }
  }
  const radius = new Float32Array(bones.length);
  for (let b = 0; b < bones.length; b++) {
    const list = distances[b]!.sort((x, y) => x - y);
    const median = list.length ? list[list.length >> 1]! : 0;
    // The bind pose stands on the floor, so no bone's flesh reaches below it.
    radius[b] = Math.max(0, Math.min(median, pivots[b]!.y - floor));
  }
  const thin = (list: number[]): number[] => {
    const step = Math.max(1, Math.ceil(list.length / SOLE_SAMPLES));
    return list.filter((_, n) => n % step === 0);
  };
  return { sole: [thin(sole[0]), thin(sole[1])], radius };
}

/** Which leg a bone belongs to: 0 left, 1 right, -1 neither. */
function sideOf(bone: Object3D): number {
  for (let node: Object3D | null = bone; node; node = node.parent) {
    if (node.name === 'thigh_l' || node.name === 'foot_l') return 0;
    if (node.name === 'thigh_r' || node.name === 'foot_r') return 1;
  }
  return -1;
}
