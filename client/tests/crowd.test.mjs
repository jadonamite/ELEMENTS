import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Group, Scene, Vector3 } from 'three';
import { makeCrowd } from '../src/life/crowd.ts';
import { TownManager } from '../src/life/town-manager.ts';
import { CombatSpace } from '../src/attacks/space.ts';

test('a crowd of 150 wears 30 looks, every person named once, about one in five Lit', () => {
  const { looks, people } = makeCrowd(150, 30);
  assert.equal(people.length, 150);
  assert.equal(new Set(looks.map(l => l.id)).size, 30);
  assert.equal(new Set(people.map(p => p.look)).size, 30);
  assert.equal(new Set(people.map(p => p.name)).size, 150, 'no two people share a name');
  assert.ok(people.every(p => !/\d/.test(p.name)), 'names carry no numbers');
  const lit = people.filter(p => p.isLit).length;
  assert.ok(lit > 15 && lit < 45, `lit ${lit}`);
  assert.deepEqual(makeCrowd(150, 30).people.map(p => p.name), people.map(p => p.name), 'same seed, same crowd');
});

test('wanderers stand and walk only on open street, and step aside for the hero', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  // A house in the middle of the street.
  world.createCollider(RAPIER.ColliderDesc.cuboid(3, 3, 3).setTranslation(10, 3, 0));
  world.step();
  const space = new CombatSpace(world);
  const { looks, people } = makeCrowd(40, 8);
  const bodies = new Map(looks.map(l => [l.id, { model: new Group(), clips: [] }]));
  let seed = 1; const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const town = new TownManager(new Scene(), space, random);
  await town.init(bodies, people, [{ x0: 0, x1: 20, z0: -6, z1: 6, y: 0 }], { seeds: [new Vector3(2, 0, 0)], bounds: { x0: 0, x1: 20, z0: -6, z1: 6 } });
  assert.ok(town.spots.length > 20);
  const inHouse = (p) => Math.abs(p.x - 10) < 3.2 && Math.abs(p.z) < 3.2;
  assert.ok(!town.spots.some(inHouse), 'no spot inside the house');
  const hero = new Vector3(2, 0, 0);
  let inside = 0, crowding = 0;
  for (let f = 0; f < 60 * 40; f++) {
    town.update(1 / 60, 600, hero);
    for (const p of town.townsfolk) {
      if (inHouse(p.position)) inside++;
    }
    if (f > 120) for (const p of town.townsfolk) if (p.position.distanceTo(hero) < 0.6) crowding++;
  }
  assert.equal(inside, 0, 'nobody walks through the house');
  assert.ok(town.townsfolk.some(p => p.walking) || town.townsfolk.some(p => p.rest > 0));
  assert.equal(crowding, 0, 'nobody stands inside the hero');
  world.free();
});

test('a person on a schedule walks round a house to reach the far side, never through it', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(3, 3, 6).setTranslation(10, 3, 0));
  // A raised yard reached by a ramp of steps, and a house wall closing it on one side.
  for (let k = 0; k < 6; k++) world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.15 * (k + 1), 2).setTranslation(-3 - k, 0.15 * (k + 1), 12));
  world.createCollider(RAPIER.ColliderDesc.cuboid(6, 0.9, 6).setTranslation(-15, 0.9, 12));
  world.step();
  const space = new CombatSpace(world);
  const at = (x, z) => ({ x, y: 0, z, facing: 0 });
  const walker = { id: 'walker', name: 'Walker', role: 'porter', dialogueRole: 'porter_sindr', isLit: false, element: 'DIM', sex: 'male',
    schedule: { work: at(18, 0), market: at(18, 0), inn: at(-15, 12), home: at(18, 0) } };
  const town = new TownManager(new Scene(), space, () => 0.5);
  await town.init(new Map([['walker', { model: new Group(), clips: [] }]]), [walker], [], { seeds: [new Vector3(2, 0, 0)], bounds: { x0: -25, x1: 25, z0: -12, z1: 20 } });
  const p = town.townsfolk[0];
  const hero = new Vector3(0, 0, -40);
  let inside = 0;
  for (const minute of [6, 13]) {
    for (let f = 0; f < 60 * 60; f++) {
      town.update(1 / 60, minute, hero);
      if (Math.abs(p.position.x - 10) < 3 + 0.2 && Math.abs(p.position.z) < 6 + 0.2) inside++;
    }
  }
  assert.equal(inside, 0, 'never inside the house');
  assert.ok(p.position.x < -9 && p.position.y > 1.5, `climbed the steps to the yard: ${p.position.toArray().map(v => v.toFixed(2))}`);
});
