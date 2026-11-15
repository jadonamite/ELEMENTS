import assert from 'node:assert/strict';
import test from 'node:test';
import { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { ForearmTwist } from '../src/anim/forearm-twist.ts';
import { AnimationPlayer } from '../src/anim/player.ts';

const ALONG = new Vector3(0, 1, 0);

/** One arm: a forearm along +Y with a hand at its end and, when asked, a twist bone halfway. */
function arm(withTwist = true) {
  const root = new Group();
  const forearm = new Bone(); forearm.name = 'lowerarm_l';
  const hand = new Bone(); hand.name = 'hand_l'; hand.position.set(0, 0.25, 0);
  hand.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.3);
  const twist = new Bone(); twist.name = 'lowerarm_twist_l'; twist.position.set(0, 0.125, 0);
  forearm.add(hand);
  if (withTwist) forearm.add(twist);
  const bones = withTwist ? [forearm, hand, twist] : [forearm, hand];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0.1, 0, 0.1, 0, 0], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  root.add(forearm, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  return { root, hand, twist, bind: hand.quaternion.clone() };
}

const angleAbout = (q, axis) => 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w);

test('a turn of the hand about the forearm is shared with the twist bone', () => {
  const { root, hand, twist, bind } = arm();
  const forearmTwist = ForearmTwist.for(root);
  assert.ok(forearmTwist);
  hand.quaternion.copy(bind).premultiply(new Quaternion().setFromAxisAngle(ALONG, 1.2));
  forearmTwist.apply();
  assert.ok(Math.abs(angleAbout(twist.quaternion, ALONG) - 1.2 * 0.65) < 1e-6);
  assert.ok(Math.abs(twist.quaternion.x) < 1e-6 && Math.abs(twist.quaternion.z) < 1e-6);
});

test('bending the wrist without turning it leaves the forearm alone', () => {
  const { root, hand, twist, bind } = arm();
  const forearmTwist = ForearmTwist.for(root);
  hand.quaternion.copy(bind).premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.9));
  forearmTwist.apply();
  assert.ok(Math.abs(twist.quaternion.w - 1) < 1e-6);
});

test('the bind pose gives no twist, and a turn the other way mirrors', () => {
  const { root, hand, twist, bind } = arm();
  const forearmTwist = ForearmTwist.for(root);
  forearmTwist.apply();
  assert.ok(Math.abs(twist.quaternion.w - 1) < 1e-6);
  hand.quaternion.copy(bind).premultiply(new Quaternion().setFromAxisAngle(ALONG, -2.4));
  forearmTwist.apply();
  assert.ok(Math.abs(angleAbout(twist.quaternion, ALONG) + 2.4 * 0.65) < 1e-6);
});

test('a body without twist bones has no twist and its player still updates', () => {
  const { root } = arm(false);
  assert.equal(ForearmTwist.for(root), null);
  new AnimationPlayer(root, []).update(0.016);
});

test('the player turns the twist bone after the mixer', () => {
  const { root, hand, twist, bind } = arm();
  const player = new AnimationPlayer(root, []);
  hand.quaternion.copy(bind).premultiply(new Quaternion().setFromAxisAngle(ALONG, 1));
  player.update(0.016);
  assert.ok(Math.abs(angleAbout(twist.quaternion, ALONG) - 0.65) < 1e-6);
});
