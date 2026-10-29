import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AnimationClip, NumberKeyframeTrack, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationPlayer } from '../src/anim/player.ts';

const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} != ${expected}`);
const weight = action => action.isScheduled() ? action.getEffectiveWeight() : 0;

function fixture() {
  const root = new Object3D();
  const clips = ['idle', 'walk', 'run'].map((name, index) =>
    new AnimationClip(name, 10, [
      new NumberKeyframeTrack('.position[x]', [0, 10], [index * 10, index * 10 + 10]),
    ]),
  );
  const player = new AnimationPlayer(root, clips);
  const actions = Object.fromEntries(clips.map(clip => [clip.name, player.mixer.clipAction(clip)]));
  player.play('idle', 0);
  player.update(0.7);
  return { root, player, actions };
}

function interrupt(f, target) {
  const pose = f.root.position.x;
  const weights = Object.values(f.actions).map(weight);
  const targetAction = f.actions[target];
  const time = targetAction.time;
  f.player.play(target);
  f.player.update(0);
  close(f.root.position.x, pose, `pose on interruption to ${target}`);
  Object.values(f.actions).forEach((action, index) =>
    close(weight(action), weights[index], `weight of ${action.getClip().name}`),
  );
  if (weights[Object.keys(f.actions).indexOf(target)] > 0) {
    close(targetAction.time, time, `playback time of ${target}`);
  }
}

test('idle → walk → idle after 0.05 seconds preserves pose, weights and playback time', () => {
  const f = fixture();
  f.player.play('walk');
  f.player.update(0.05);
  close(f.actions.idle.getEffectiveWeight(), 0.8, 'idle before reversal');
  close(f.actions.walk.getEffectiveWeight(), 0.2, 'walk before reversal');
  interrupt(f, 'idle');
  f.player.update(0.125);
  close(f.actions.idle.getEffectiveWeight(), 0.9, 'idle halfway through reversal');
  close(f.actions.walk.getEffectiveWeight(), 0.1, 'walk halfway through reversal');
  f.player.update(0.125);
  close(f.actions.idle.getEffectiveWeight(), 1, 'idle at completion');
  close(f.actions.walk.getEffectiveWeight(), 0, 'walk at completion');
  assert.equal(f.actions.walk.isScheduled(), false);
  f.player.dispose();
});

test('third clips and repeated interruptions retain every contributing action', () => {
  const f = fixture();
  f.player.play('walk');
  f.player.update(0.05);
  interrupt(f, 'run');
  f.player.update(0.05);
  close(f.actions.idle.getEffectiveWeight(), 0.64, 'idle in three-way blend');
  close(f.actions.walk.getEffectiveWeight(), 0.16, 'walk in three-way blend');
  close(f.actions.run.getEffectiveWeight(), 0.2, 'run in three-way blend');
  interrupt(f, 'walk');
  f.player.update(0.04);
  interrupt(f, 'idle');
  f.player.update(0.03);
  interrupt(f, 'run');
  f.player.update(0.3);
  close(f.actions.run.getEffectiveWeight(), 1, 'run at completion');
  for (const name of ['idle', 'walk']) {
    close(f.actions[name].getEffectiveWeight(), 0, `${name} at completion`);
    assert.equal(f.actions[name].isScheduled(), false);
  }
  close(f.root.position.x, 20 + f.actions.run.time, 'final animated pose');
  f.player.dispose();
});

test('immediate switches, first fade, completed clips and disposal stay usable', () => {
  const f = fixture();
  f.player.play('walk');
  f.player.update(0.05);
  f.player.play('run', 0);
  f.player.update(0);
  close(f.root.position.x, 20, 'immediate switch');
  assert.equal(f.actions.idle.isScheduled(), false);
  assert.equal(f.actions.walk.isScheduled(), false);
  f.player.play('idle', 0.25, false);
  f.player.update(11);
  assert.equal(f.actions.idle.paused, true);
  interrupt(f, 'walk');
  f.player.update(0.25);
  assert.equal(f.actions.idle.isScheduled(), false);
  f.player.dispose();
  assert.equal(f.player.play('run'), false);
  f.player.update(1);
  const clip = new AnimationClip('first', 1, []);
  const first = new AnimationPlayer(new Object3D(), [clip]);
  first.play('first');
  first.update(0.125);
  close(first.mixer.clipAction(clip).getEffectiveWeight(), 0.5, 'first clip halfway');
  first.dispose();
});

test('hero GLB bone poses remain continuous through reversals and third-clip interruptions', async () => {
  const buffer = await readFile(new URL('../public/assets/characters/hero.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '',
  );
  const player = new AnimationPlayer(gltf.scene, gltf.animations);
  const bones = [];
  gltf.scene.traverse(node => { if (node.isBone) bones.push(node); });
  assert.ok(bones.length > 0);
  player.play('idle', 0);
  player.update(0.7);
  player.play('walk');
  player.update(0.05);
  for (const target of ['idle', 'run', 'walk', 'idle']) {
    gltf.scene.updateMatrixWorld(true);
    const before = bones.map(bone => bone.matrixWorld.elements.slice());
    player.play(target);
    player.update(0);
    gltf.scene.updateMatrixWorld(true);
    bones.forEach((bone, index) => bone.matrixWorld.elements.forEach((value, element) =>
      close(value, before[index][element], `${bone.name} matrix element ${element}`),
    ));
    player.update(0.05);
  }
  player.dispose();
});
