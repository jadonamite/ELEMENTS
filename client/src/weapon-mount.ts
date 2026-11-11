import { Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';

/** A rig's palm frame, measured from its own metacarpals in the rest pose. */
export function palmSocket(model: Object3D): Object3D {
  const hand = model.getObjectByName('hand_r');
  if (!hand) throw new Error('Weapon rig has no hand_r bone.');
  const existing = hand.getObjectByName('WeaponPalmSocket');
  if (existing) return existing;
  const index = hand.getObjectByName('index_01_r');
  const pinky = hand.getObjectByName('pinky_01_r');
  if (!index || !pinky) throw new Error('Weapon rig needs index and pinky metacarpals to locate its palm.');
  model.updateMatrixWorld(true);
  const a = hand.worldToLocal(index.getWorldPosition(new Vector3()));
  const b = hand.worldToLocal(pinky.getWorldPosition(new Vector3()));
  const forward = a.clone().sub(b).normalize();
  const palm = a.clone().add(b).multiplyScalar(0.5);
  const across = new Vector3().crossVectors(palm, forward).normalize();
  const normal = new Vector3().crossVectors(across, forward).normalize();
  const socket = new Object3D();
  socket.name = 'WeaponPalmSocket';
  // The socket lies inside the palm rather than at the distal knuckles.
  socket.position.copy(palm).multiplyScalar(0.70).addScaledVector(across, -a.distanceTo(b) * 0.22);
  socket.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(across, forward, normal));
  hand.add(socket);
  return socket;
}

const targetFrame = new Matrix4();
const socketPosition = new Vector3();
const socketRotation = new Quaternion();
const unitScale = new Vector3(1, 1, 1);

/** Strip inherited body scaling while preserving the socket's world pose. */
export function snapToSocket(holder: Object3D, socket: Object3D): void {
  socket.updateWorldMatrix(true, false);
  if (holder.parent !== socket) socket.add(holder);
  targetFrame.compose(socket.getWorldPosition(socketPosition), socket.getWorldQuaternion(socketRotation).normalize(), unitScale);
  holder.matrix.copy(socket.matrixWorld).invert().multiply(targetFrame);
  holder.matrix.decompose(holder.position, holder.quaternion, holder.scale);
  // Keep the exact matrix when a body preset introduces nonuniform scaling.
  holder.matrixAutoUpdate = false;
  holder.updateMatrixWorld(true);
}

/** Preserve the full asset hierarchy; Grip may be under a transformed root. */
export function gripAligned(asset: Object3D): Group {
  const holder = new Group();
  holder.name = 'WeaponHolder';
  holder.add(asset);
  asset.updateMatrixWorld(true);
  const grip = asset.getObjectByName('Grip');
  if (!grip) throw new Error(`Weapon ${asset.name} has no Grip marker.`);
  const inverse = new Matrix4().copy(holder.matrixWorld).invert().multiply(grip.matrixWorld).invert();
  asset.applyMatrix4(inverse);
  holder.updateMatrixWorld(true);
  return holder;
}

export function hitSegment(holder: Object3D, base: Vector3, tip: Vector3): void {
  holder.updateWorldMatrix(true, true);
  const grip = holder.getObjectByName('Grip');
  const end = holder.getObjectByName('Tip');
  if (!grip || !end) throw new Error('Weapon needs Grip and Tip markers.');
  holder.worldToLocal(grip.getWorldPosition(base));
  holder.worldToLocal(end.getWorldPosition(tip));
}

/** Back and belt frames are rig properties shared by every weapon. */
export function carrySockets(model: Object3D): { back: Object3D; hip: Object3D } {
  model.updateMatrixWorld(true);
  const create = (name: string, boneName: string, position: Vector3, direction: Vector3): Object3D => {
    const bone = model.getObjectByName(boneName);
    if (!bone) throw new Error(`Carry rig has no ${boneName} bone.`);
    const socket = new Object3D(); socket.name = name;
    const modelFrame = new Matrix4().compose(position,
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()), new Vector3(1, 1, 1));
    const local = new Matrix4().copy(bone.matrixWorld).invert().multiply(model.matrixWorld).multiply(modelFrame);
    local.decompose(socket.position, socket.quaternion, socket.scale);
    bone.add(socket);
    return socket;
  };
  // The grip clears the right shoulder; the shell ends above the left belt line.
  const back = create('WeaponBackSocket', 'spine_03', new Vector3(-0.20, 1.57, -0.23), new Vector3(0.40, -0.9165, 0));
  const hip = create('WeaponHipSocket', 'pelvis', new Vector3(0.23, 0.98, -0.04), new Vector3(0.10, -0.99, -0.08));
  return { back, hip };
}
