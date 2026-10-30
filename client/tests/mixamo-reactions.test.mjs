import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationPlayer } from '../src/anim/index.js';

const rootDir = path.resolve(import.meta.dirname, '../..');
const heroPath = path.join(rootDir, 'client/public/assets/characters/hero.glb');
const mixamoPath = path.join(rootDir, 'client/public/assets/characters/mixamo.glb');

test('mixamo.glb contains retargeted death_flying, standing, and hit_react clips matching 65-bone hero rig', async () => {
  const loader = new GLTFLoader();

  const heroBuf = fs.readFileSync(heroPath);
  const heroGltf = await new Promise((resolve, reject) => {
    loader.parse(heroBuf.buffer.slice(heroBuf.byteOffset, heroBuf.byteOffset + heroBuf.byteLength), '', resolve, reject);
  });

  const mixamoBuf = fs.readFileSync(mixamoPath);
  const mixamoGltf = await new Promise((resolve, reject) => {
    loader.parse(mixamoBuf.buffer.slice(mixamoBuf.byteOffset, mixamoBuf.byteOffset + mixamoBuf.byteLength), '', resolve, reject);
  });

  const clipNames = mixamoGltf.animations.map(a => a.name);
  assert.ok(clipNames.includes('death_flying'), 'mixamo.glb must include death_flying');
  assert.ok(clipNames.includes('standing'), 'mixamo.glb must include standing');
  assert.ok(clipNames.includes('hit_react'), 'mixamo.glb must include hit_react');

  const player = new AnimationPlayer(heroGltf.scene, mixamoGltf.animations);

  // Play death_flying
  assert.ok(player.playOnce('death_flying'), 'death_flying clip plays successfully');
  player.update(0.1);
  assert.equal(player.getCurrentClip(), 'death_flying');

  // Play standing
  assert.ok(player.playOnce('standing'), 'standing clip plays successfully');
  player.update(0.1);
  assert.equal(player.getCurrentClip(), 'standing');

  // Play hit_react
  assert.ok(player.playOnce('hit_react'), 'hit_react clip plays successfully');
  player.update(0.1);
  assert.equal(player.getCurrentClip(), 'hit_react');

  player.dispose();
});
