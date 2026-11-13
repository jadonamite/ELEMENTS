import { Matrix4, Quaternion, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';

/** Share of the hand's turn about the forearm that the twist bone carries; the wrist takes the rest. */
const SHARE = 0.65;

interface Arm {
  hand: Bone;
  twist: Bone;
  /** The forearm's line, in the forearm bone's own space. */
  axis: Vector3;
  /** The hand's and the twist bone's rotations in the pose the mesh was bound in. */
  handBind: Quaternion;
  twistBind: Quaternion;
}

/**
 * Spreads a turn of the wrist along the forearm. A body built with a twist bone on each forearm
 * (`lowerarm_twist_l`, `lowerarm_twist_r`) has its forearm skin blend from the forearm bone at the
 * elbow to the twist bone at the wrist. No clip moves those bones; after each pose they are given
 * the part of the hand's rotation that is about the forearm's own line, so the turn is shared by
 * the whole forearm and not pinched into one ring at the cuff.
 */
export class ForearmTwist {
  private readonly turn = new Quaternion();
  private readonly part = new Quaternion();

  private constructor(private readonly arms: Arm[]) {}

  /** The twist for a body, or null when it has no twist bones. */
  static for(root: Object3D): ForearmTwist | null {
    const arms: Arm[] = [];
    root.traverse((node) => {
      const mesh = node as SkinnedMesh;
      if (!mesh.isSkinnedMesh || arms.length) return;
      for (const side of ['l', 'r']) {
        const arm = armOf(mesh, side);
        if (arm) arms.push(arm);
      }
    });
    return arms.length ? new ForearmTwist(arms) : null;
  }

  /** Call after the mixer has posed the bones. */
  apply(): void {
    for (const arm of this.arms) {
      // How far the hand has turned from its bind pose, seen from the forearm.
      this.turn.copy(arm.handBind).invert().premultiply(arm.hand.quaternion);
      const along = this.turn.x * arm.axis.x + this.turn.y * arm.axis.y + this.turn.z * arm.axis.z;
      this.part.set(arm.axis.x * along, arm.axis.y * along, arm.axis.z * along, this.turn.w);
      if (this.part.lengthSq() < 1e-8) this.part.identity();
      else this.part.normalize();
      if (this.part.w < 0) this.part.set(-this.part.x, -this.part.y, -this.part.z, -this.part.w);
      arm.twist.quaternion.identity().slerp(this.part, SHARE).multiply(arm.twistBind);
    }
  }
}

function armOf(mesh: SkinnedMesh, side: string): Arm | null {
  const bones = mesh.skeleton.bones;
  const index = (name: string): number => bones.findIndex(bone => bone.name === name);
  const hand = index(`hand_${side}`);
  const twist = index(`lowerarm_twist_${side}`);
  const forearm = index(`lowerarm_${side}`);
  if (hand < 0 || twist < 0 || forearm < 0) return null;
  if (bones[hand]!.parent !== bones[forearm] || bones[twist]!.parent !== bones[forearm]) return null;
  // A bone's bind pose is the inverse of its inverse bind matrix; seen from the forearm it is local.
  const inForearm = (bone: number): Matrix4 =>
    new Matrix4().copy(mesh.skeleton.boneInverses[bone]!).invert().premultiply(mesh.skeleton.boneInverses[forearm]!);
  const handBind = inForearm(hand);
  const axis = new Vector3().setFromMatrixPosition(handBind);
  if (axis.lengthSq() < 1e-10) return null;
  return {
    hand: bones[hand]!,
    twist: bones[twist]!,
    axis: axis.normalize(),
    handBind: rotationOf(handBind),
    twistBind: rotationOf(inForearm(twist)),
  };
}

function rotationOf(matrix: Matrix4): Quaternion {
  const rotation = new Quaternion();
  matrix.decompose(new Vector3(), rotation, new Vector3());
  return rotation;
}
