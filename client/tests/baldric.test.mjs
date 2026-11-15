import assert from 'node:assert/strict';
import test from 'node:test';
import { Bone, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, MeshStandardMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { fitBaldric, STRAP } from '../src/baldric.ts';
import { fitTorso } from '../src/torso-fit.ts';
import { carrySockets } from '../src/weapon-mount.ts';

const HALF_WIDTH = 0.2;
const HALF_DEPTH = 0.17;

/** A torso-shaped tube on a spine: left is +x, up is +y, forward is +z, all weight on the chest bone. */
function body() {
  const root = new Group();
  const armature = new Group(); armature.name = 'Armature';
  root.add(armature);
  const make = (name, x, y, z, parent) => {
    const bone = new Bone(); bone.name = name; bone.position.set(x, y, z); parent.add(bone); return bone;
  };
  const pelvis = make('pelvis', 0, 0.95, 0, armature);
  const spine02 = make('spine_02', 0, 0.23, 0, pelvis);
  const spine03 = make('spine_03', 0, 0.13, 0, spine02);
  const neck = make('neck_01', 0, 0.21, 0, spine03);
  make('upperarm_l', 0.18, -0.1, 0, spine03);
  make('upperarm_r', -0.18, -0.1, 0, spine03);
  const bones = [pelvis, spine02, spine03, neck, ...['upperarm_l', 'upperarm_r'].map(n => armature.getObjectByName(n))];
  const tube = new CylinderGeometry(1, 1, 1.0, 32, 8, true);
  const p = tube.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * HALF_WIDTH, p.getY(i) + 1.25, p.getZ(i) * HALF_DEPTH);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', p);
  geometry.setIndex(tube.getIndex());
  const joints = [], weights = [];
  for (let i = 0; i < p.count; i++) joints.push(2, 0, 0, 0), weights.push(1, 0, 0, 0);
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.name = 'torso';
  armature.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  return { root, spine03, mesh };
}

test('the fit reads the body frame and size from the rig', () => {
  const { root } = body();
  const fit = fitTorso(root);
  assert.ok(fit);
  assert.ok(fit.left.dot(new Vector3(1, 0, 0)) > 0.99);
  assert.ok(fit.up.dot(new Vector3(0, 1, 0)) > 0.99);
  assert.ok(fit.forward.dot(new Vector3(0, 0, 1)) > 0.99);
  assert.ok(Math.abs(fit.width - 0.36) < 0.01);
});

test('the strap is cut to the body and skinned to its bones', () => {
  const { root, spine03 } = body();
  const fit = fitTorso(root);
  const strap = fitBaldric(fit, new MeshStandardMaterial());
  assert.equal(strap.name, 'Baldric');
  assert.equal(strap.parent.name, 'Armature');
  assert.equal(strap.geometry.getAttribute('position').count, 4 * (STRAP.steps + 1) * 2);
  const chest = fit.boneIndex.get('spine_03');
  const index = strap.geometry.getAttribute('skinIndex');
  const weight = strap.geometry.getAttribute('skinWeight');
  for (let i = 0; i < index.count; i++) {
    assert.equal(index.getX(i), chest);
    assert.ok(Math.abs(weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i) - 1) < 1e-4);
  }
  // Every outer vertex sits just outside the tube, never inside it and never far off.
  const position = strap.geometry.getAttribute('position');
  for (let i = 0; i < (STRAP.steps + 1) * 2; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const radius = Math.hypot(x / HALF_WIDTH, z / HALF_DEPTH);
    assert.ok(radius > 0.95 && radius < 1.4, `vertex ${i} at ${radius.toFixed(2)} of the body radius`);
    assert.ok(y > 0.9 && y < 1.75);
  }
  spine03.rotation.x = 0.6;
  root.updateMatrixWorld(true);
  assert.ok(Number.isFinite(strap.getVertexPosition(10, new Vector3()).x));
});

test('the sheath rests on the back, not on a fixed distance behind the spine', () => {
  const { root } = body();
  const fit = fitTorso(root);
  const { back } = carrySockets(root, fit);
  root.updateMatrixWorld(true);
  for (let s = 0; s <= 0.8; s += 0.1) {
    const point = new Vector3(0, s, 0).applyMatrix4(back.matrixWorld);
    const surface = HALF_DEPTH * Math.sqrt(Math.max(0, 1 - (point.x / HALF_WIDTH) ** 2));
    const behind = -point.z - surface;
    assert.ok(behind > 0.01 && behind < 0.2, `sheath ${behind.toFixed(3)} m behind the back at ${s} m`);
  }
});

test('a rig without a torso is refused', () => {
  assert.equal(fitTorso(new Group()), null);
});
