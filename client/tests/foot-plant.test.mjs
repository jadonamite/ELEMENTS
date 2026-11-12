import assert from 'node:assert/strict';
import test from 'node:test';
import { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { FootPlant } from '../src/anim/foot-plant.ts';

/** Two legs under a pelvis: each foot bone carries a small sole at floor height. */
function body() {
  const root = new Group();
  const pelvis = new Bone(); pelvis.name = 'pelvis'; pelvis.position.y = 1;
  const feet = ['foot_l', 'foot_r'].map((name, i) => {
    const foot = new Bone(); foot.name = name; foot.position.set(i ? 0.1 : -0.1, -0.9, 0);
    pelvis.add(foot);
    return foot;
  });
  const positions = [];
  const indices = [];
  const weights = [];
  for (const [i, x] of [[1, -0.1], [2, 0.1]]) {
    for (const [dx, dz] of [[-0.05, 0], [0.05, 0], [0, 0.1]]) {
      positions.push(x + dx, 0, dz);
      indices.push(i, 0, 0, 0);
      weights.push(1, 0, 0, 0);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  root.add(pelvis, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([pelvis, ...feet]));
  return { root, pelvis, mesh };
}

function lowest(mesh) {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const p = new Vector3();
  let y = Infinity;
  for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
    y = Math.min(y, mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld).y);
  }
  return y;
}

test('a pose that pushes the soles under the floor is raised back onto it', () => {
  const { root, pelvis, mesh } = body();
  const plant = FootPlant.for(root);
  assert.ok(plant);
  pelvis.position.y = 0.93;
  root.updateMatrixWorld(true);
  assert.ok(lowest(mesh) < -0.06);
  plant.apply();
  assert.ok(Math.abs(lowest(mesh)) < 1e-4);
});

test('a body above the floor is left alone, wherever it stands', () => {
  const { root, pelvis, mesh } = body();
  root.position.y = 3;
  const plant = FootPlant.for(root);
  pelvis.position.y = 1.4;
  plant.apply();
  assert.equal(pelvis.position.y, 1.4);
  pelvis.position.y = 0.95;
  plant.apply();
  assert.ok(Math.abs(lowest(mesh) - 3) < 1e-4);
});

test('a rig without legs gets no plant', () => {
  assert.equal(FootPlant.for(new Group()), null);
});
