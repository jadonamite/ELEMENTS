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

test('loot applies nation colours and light hex for all four nations', () => {
  const scene = new Scene();
  const loot = new WorldLoot(scene, { castRay: () => null }, 'sindr', { picked() {}, satchelChanged() {}, async claim() {} });
  loot.pollServer = false;
  const root = scene.getObjectByName('world-loot');
  const lights = root.children.filter((o) => o.isLight);

  for (const nation of ['IGNIS', 'AQUES', 'TERRA', 'AURA']) {
    loot.add({ id: `p-${nation}`, x: 5, z: 5, contents: { chroma: 30, shards: {}, materials: {} }, nation });
    loot.update(0.1, new Vector3(5, 0, 5));
    assert.ok(lights[0].intensity > 0);
    loot.remove(`p-${nation}`);
  }

  loot.dispose();
});

test('walking into a loot box triggers opening animation and claims contents', async () => {
  const scene = new Scene();
  let pickedNotice = '';
  let satchelRefreshed = false;
  const loot = new WorldLoot(scene, { castRay: () => null }, 'sindr', {
    picked(text) { pickedNotice = text; },
    satchelChanged() { satchelRefreshed = true; },
    async claim(id) {
      return { chroma: 50, shards: { IGNIS: 2 }, materials: { iron_ore: 1 } };
    },
  });
  loot.pollServer = false;
  loot.add({ id: 'box-claim', x: 2, z: 2, contents: { chroma: 50, shards: { IGNIS: 2 }, materials: { iron_ore: 1 } }, nation: 'IGNIS' });

  // Update standing outside claim reach (dist ~ 2.82 m)
  loot.update(0.1, new Vector3(0, 0, 0));
  assert.equal(pickedNotice, '');

  // Move within CLAIM_REACH (1.35 m): standing at (2, 0, 1.5), dist = 0.5 m
  loot.update(0.1, new Vector3(2, 0, 1.5));
  // Allow claim promise to resolve
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(pickedNotice.includes('50 CHROMA'));
  assert.equal(satchelRefreshed, true);

  // Animate through opening duration
  for (let i = 0; i < 5; i++) loot.update(0.15, new Vector3(2, 0, 1.5));

  // The box is now collected and hidden
  const root = scene.getObjectByName('world-loot');
  assert.ok(root.children.filter((o) => o.isGroup).every((o) => !o.visible));

  loot.dispose();
});
