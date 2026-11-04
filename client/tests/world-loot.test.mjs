import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene, Vector3 } from 'three';
import { WorldLoot } from '../src/economy/world-loot.ts';

const pile = (id, chroma = 60, shards = { IGNIS: 3 }) => ({ id, x: 10, z: 0, contents: { chroma, shards, materials: {} } });

test('loot reuses prepared meshes without changing light count or retaining old contents', () => {
  const scene = new Scene();
  const loot = new WorldLoot(scene, { castRay: () => null }, 'sindr', { picked() {}, satchelChanged() {}, async claim() {} });
  loot.pollServer = false;
  const root = scene.getObjectByName('world-loot');
  const prepared = root.children.filter((o) => o.isGroup);
  const lights = root.children.filter((o) => o.isLight);
  assert.ok(prepared.length > 0); assert.ok(prepared.every((o) => !o.visible));
  loot.add(pile('first'));
  const mesh = prepared.find((o) => o.visible);
  assert.ok(mesh); assert.equal(mesh.getObjectByName('coin-5').visible, true);
  assert.equal(mesh.getObjectByName('shard-2').visible, true);
  loot.update(0.1, new Vector3());
  assert.equal(lights[0].intensity, 1.2);
  loot.remove('first'); loot.remove('first');
  loot.add(pile('second', 1, {}));
  assert.equal(prepared.find((o) => o.visible), mesh);
  assert.equal(mesh.getObjectByName('coin-0').visible, true);
  assert.equal(mesh.getObjectByName('coin-1').visible, false);
  assert.equal(mesh.getObjectByName('shard-0').visible, false);
  for (let i = 0; i < 30; i++) loot.add(pile(`extra-${i}`));
  assert.deepEqual(root.children.filter((o) => o.isLight), lights);
  loot.replace([]); loot.update(0.1, new Vector3());
  assert.ok(root.children.filter((o) => o.isGroup).every((o) => !o.visible));
  assert.ok(lights.every((o) => o.intensity === 0));
  loot.dispose(); assert.equal(scene.children.length, 0);
});
