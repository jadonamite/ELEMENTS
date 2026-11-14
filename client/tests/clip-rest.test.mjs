import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three';
import { fitClip, restOf, retargetBetween } from '../src/body.ts';

const X = new Vector3(1, 0, 0);
const turn = angle => new Quaternion().setFromAxisAngle(X, angle);

/** A three-joint spine whose middle joint rests at `lean`, and whose top rests at `back`. */
function spine(lean, back) {
  const root = new Group(); root.name = 'root';
  const pelvis = new Bone(); pelvis.name = 'pelvis';
  const chest = new Bone(); chest.name = 'spine_03'; chest.quaternion.copy(turn(lean));
  const neck = new Bone(); neck.name = 'neck_01'; neck.quaternion.copy(turn(back));
  root.add(pelvis); pelvis.add(chest); chest.add(neck);
  return root;
}

function play(root, clip) {
  for (const track of clip.tracks) {
    const [name] = track.name.split('.');
    root.getObjectByName(name).quaternion.fromArray(track.values);
  }
  root.updateMatrixWorld(true);
  return name => root.getObjectByName(name).getWorldQuaternion(new Quaternion());
}

const clipOf = pose => new AnimationClip('c', 1, Object.entries(pose).map(([name, q]) => new QuaternionKeyframeTrack(`${name}.quaternion`, [0], q.toArray())));

test('a clip holding its own rest pose becomes the rest pose of the body it is fitted to', () => {
  const made = spine(0.1, 0.2), body = spine(0.35, -0.1);
  const clip = clipOf({ pelvis: new Quaternion(), spine_03: turn(0.1), neck_01: turn(0.2) });
  const fitted = fitClip(clip, 1, retargetBetween(restOf(made), restOf(body)));
  const world = play(spine(0.35, -0.1), fitted);
  const rest = restOf(body);
  for (const name of ['spine_03', 'neck_01']) assert.ok(world(name).angleTo(rest.get(name).own) < 1e-6);
});

test('a bend made on one rest pose is the same bend, seen in the world, on another', () => {
  const made = spine(0.1, 0.2), body = spine(0.35, -0.1);
  const clip = clipOf({ pelvis: turn(0.3), spine_03: turn(0.1 + 0.4), neck_01: turn(0.2 - 0.25) });
  const source = play(spine(0.1, 0.2), clip);
  const target = play(spine(0.35, -0.1), fitClip(clip, 1, retargetBetween(restOf(made), restOf(body))));
  const from = restOf(made), to = restOf(body);
  for (const name of ['pelvis', 'spine_03', 'neck_01']) {
    const bentThere = source(name).multiply(from.get(name).own.clone().invert());
    const bentHere = target(name).multiply(to.get(name).own.clone().invert());
    assert.ok(bentThere.angleTo(bentHere) < 1e-6, name);
  }
});

test('a body resting as the pack does is left exactly as the clip has it', () => {
  const retarget = retargetBetween(restOf(spine(0.1, 0.2)), restOf(spine(0.1, 0.2)));
  assert.equal(retarget.size, 0);
});
