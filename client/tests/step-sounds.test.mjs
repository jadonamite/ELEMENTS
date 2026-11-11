import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Vector3 } from 'three';
import { SoundManager, stepFamily } from '../src/audio.ts';
import { Treads } from '../src/world/treads.ts';

class Heard extends SoundManager {
  steps = [];
  playFootstep(isRun, pitch, family) { this.steps.push({ who: 'hero', isRun, pitch, family }); }
  playVillainFootstep(position, isRun, pitch, family) { this.steps.push({ who: 'foe', isRun, pitch, family }); }
  playVillainSwing() {}
}

test('a tracked body steps when its feet land, not by distance covered', () => {
  const sound = new Heard();
  const controller = { position: { x: 0, y: 3, z: 0 }, speed: 1.2, grounded: true };
  // A long walk with no foot landing is silent, even on a raised street.
  for (let i = 0; i < 60; i++) sound.update(0.05, undefined, controller, undefined, undefined, { heroSteps: 0 });
  assert.equal(sound.steps.length, 0);
  sound.update(0.016, undefined, controller, undefined, undefined, { heroSteps: 1 });
  sound.update(0.016, undefined, controller, undefined, undefined, { heroSteps: 2 });
  assert.equal(sound.steps.length, 2);
  assert.notEqual(sound.steps[0].pitch, sound.steps[1].pitch);
});

test('no step sounds in the air or standing still', () => {
  const sound = new Heard();
  sound.update(0.016, undefined, { position: { x: 0, y: 0, z: 0 }, speed: 3, grounded: false }, undefined, undefined, { heroSteps: 3 });
  sound.update(0.016, undefined, { position: { x: 0, y: 0, z: 0 }, speed: 0, grounded: true }, undefined, undefined, { heroSteps: 3 });
  assert.equal(sound.steps.length, 0);
});

test('hero and foes sound the ground the world reports under them', () => {
  const sound = new Heard();
  const surfaceAt = p => (p.x < 5 ? 'packed_dirt_road' : 'roof_tile_red');
  const foe = { controller: { position: { x: 9, y: 6, z: 0 }, speed: 4, grounded: true }, alive: true, steps: 2 };
  sound.update(0.016, undefined, { position: { x: 0, y: 0, z: 0 }, speed: 1, grounded: true }, [foe], undefined, { heroSteps: 1, surfaceAt });
  assert.deepEqual(sound.steps.map(s => [s.who, s.family, s.isRun]), [['hero', 'dirt', false], ['foe', 'tile', true]]);
});

test('every kind of built ground has a sound family', () => {
  assert.equal(stepFamily('worn_flagstones'), 'slab');
  assert.equal(stepFamily('river_cobbles'), 'stone');
  assert.equal(stepFamily('ash_cinder_ground'), 'gravel');
  assert.equal(stepFamily('raw_timber'), 'wood');
  assert.equal(stepFamily('moss'), 'grass');
  assert.equal(stepFamily(null), 'stone');
});

test('the piece whose top is nearest under the feet names the ground', () => {
  const treads = new Treads();
  const box = (x0, y0, z0, x1, y1, z1) => new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
  treads.add('basalt_cobblestone', box(0, -0.2, 0, 40, 0, 10));
  treads.add('worn_flagstones', box(10, 0, 2, 30, 0.01, 8));
  treads.add('lime_plaster', box(18, 0, 4, 22, 6, 9));
  treads.add('roof_tile_red', box(17, 6, 3, 23, 7.5, 10));
  assert.equal(treads.at(5, 0, 5), 'basalt_cobblestone');
  assert.equal(treads.at(15, 0.01, 5), 'worn_flagstones');
  assert.equal(treads.at(20, 7.2, 6), 'roof_tile_red');
  assert.equal(treads.at(200, 0, 5), null);
});

test('a place is heard by how many of its sources are in earshot', async () => {
  const { nearness } = await import('../src/audio.ts');
  const stalls = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }, { x: 300, y: 0, z: 0 }];
  assert.equal(nearness({ x: 1, y: 0, z: 1 }, stalls, 8, 45, 3), 1);
  assert.equal(nearness({ x: 150, y: 0, z: 0 }, stalls, 8, 45, 3), 0);
  const edge = nearness({ x: 30, y: 0, z: 0 }, stalls, 8, 45, 3);
  assert.ok(edge > 0.2 && edge < 0.6);
  assert.equal(nearness({ x: 0, y: 0, z: 0 }, undefined, 8, 45, 3), 0);
});
