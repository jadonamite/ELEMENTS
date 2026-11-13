import { Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { crossings, type TorsoFit } from './torso-fit.js';

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

/** Gap from the cloth to the scabbard's centre line: strap, half the sheath's thickness and some air. */
const BACK_CLEARANCE = 0.045;
/** Where the sheath runs on the back: down and toward the left hip, as the hilt clears the right shoulder. */
const BACK_SLOPE = { across: 0.40, down: 0.9165 };
const SHEATH_REACH = 0.8;

/**
 * Back and belt frames, derived from the worn body: the hilt rises beside the right shoulder and the sheath
 * lies along the back surface it measures, so every body, outfit and build gets its own fit.
 */
export function carrySockets(model: Object3D, fit: TorsoFit): { back: Object3D; hip: Object3D } {
  const { up, left, forward, centre, width, main } = fit;
  const create = (name: string, boneName: string, origin: Vector3, direction: Vector3): Object3D => {
    const index = fit.boneIndex.get(boneName);
    const bone = index === undefined ? undefined : main.skeleton.bones[index];
    if (index === undefined || !bone) throw new Error(`Carry rig has no ${boneName} bone.`);
    const heading = direction.clone().normalize();
    const x = left.clone().addScaledVector(heading, -left.dot(heading)).normalize();
    const frame = new Matrix4().makeBasis(x, heading, new Vector3().crossVectors(x, heading)).setPosition(origin);
    const socket = new Object3D(); socket.name = name;
    // Bone space = bone inverse x bind matrix x the frame in the body mesh's own space.
    main.skeleton.boneInverses[index]!.clone().multiply(main.bindMatrix).multiply(frame)
      .decompose(socket.position, socket.quaternion, socket.scale);
    bone.add(socket);
    return socket;
  };

  const hiltLift = fit.bone('neck_01').sub(centre).dot(up) + 0.05;
  const hiltSide = -(width * 0.5 + 0.015);
  const along = (s: number, depth: number): Vector3 => centre.clone()
    .addScaledVector(left, hiltSide + BACK_SLOPE.across * s).addScaledVector(up, hiltLift - BACK_SLOPE.down * s).addScaledVector(forward, depth);
  // Measure the back surface along the sheath's path, looking in from behind.
  const samples: { s: number; surface: number }[] = [];
  for (let s = 0; s <= SHEATH_REACH + 1e-6; s += 0.1) {
    const hits = crossings(fit.soup, along(s, -0.6), forward, 1.2);
    if (hits.length) samples.push({ s, surface: hits[0]! - 0.6 });
  }
  if (samples.length < 3) throw new Error('Carry rig: could not find the back surface to rest the sheath on.');
  // A straight line behind every sample, as close to the back as the clearance allows.
  const mean = (f: (v: { s: number; surface: number }) => number): number => samples.reduce((t, v) => t + f(v), 0) / samples.length;
  const ms = mean(v => v.s), mz = mean(v => v.surface);
  const slope = Math.max(-0.4, Math.min(0.4, samples.reduce((t, v) => t + (v.s - ms) * (v.surface - mz), 0)
    / (samples.reduce((t, v) => t + (v.s - ms) ** 2, 0) || 1)));
  const depth = mz - slope * ms - BACK_CLEARANCE;
  const lowest = Math.max(...samples.map(v => depth + slope * v.s - (v.surface - BACK_CLEARANCE)));
  const hiltDepth = depth - Math.max(0, lowest);

  const direction = left.clone().multiplyScalar(BACK_SLOPE.across).addScaledVector(up, -BACK_SLOPE.down).addScaledVector(forward, slope);
  const back = create('WeaponBackSocket', 'spine_03', along(0, hiltDepth), direction);

  // The belt frame sits at the left hip, scaled from the reference build's shoulder width.
  const scale = width / 0.36;
  const hipOrigin = fit.bone('pelvis').addScaledVector(left, 0.231 * scale).addScaledVector(up, 0.029);
  const hip = create('WeaponHipSocket', 'pelvis', hipOrigin,
    left.clone().multiplyScalar(0.10).addScaledVector(up, -0.99).addScaledVector(forward, -0.08));
  return { back, hip };
}
