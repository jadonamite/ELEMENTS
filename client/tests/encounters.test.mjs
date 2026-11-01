import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { buildGorge, GORGE } from '../src/world/gorge.ts';
import { AMBUSH_SPOTS, EncounterManager } from '../src/world/encounters.ts';
import { WorldBuilder } from '../src/world/builder.ts';

test('buildGorge constructs canyon road, walls, choke point, and colliders', () => {
  const b = new WorldBuilder();
  buildGorge(b);

  // Gorge bounds
  assert.equal(GORGE.x0, 224);
  assert.equal(GORGE.x1, 450);
  assert.equal(GORGE.halfW, 6.5);

  // Colliders created for canyon walls and choke points
  assert.ok(b.colliders.length > 20, `Must generate canyon colliders (got ${b.colliders.length})`);

  // Collapsed arch at x=310
  const archColliders = b.colliders.filter(c => Math.abs(c.x - 310) < 5);
  assert.ok(archColliders.length >= 3, 'Must have colliders for collapsed arch piers and fallen block');

  // Overturned wagon at x=390
  const wagonColliders = b.colliders.filter(c => Math.abs(c.x - 390) < 5);
  assert.ok(wagonColliders.length >= 1, 'Must have collider for overturned wagon');

  // Road braziers with fire and light emitters
  assert.ok(b.emitters.length >= 5, 'Must have light emitters along the canyon road');
  assert.ok(b.fires.length >= 5, 'Must have fire positions for road braziers');
});

test('EncounterManager spawns ambush when hero enters trigger radius', () => {
  const spawned = [];
  const fakeFight = {
    enemies: [],
    spawnVillain(pt, kind) {
      const e = { alive: true, pt, kind };
      spawned.push(e);
      fakeFight.enemies.push(e);
      return e;
    },
  };

  const encounters = new EncounterManager(fakeFight);

  // Initial update far away (x=0, z=0)
  encounters.update(new Vector3(0, 0, 0), 0);
  assert.equal(spawned.length, 0, 'No ambushes spawned in town center');

  // Move hero into collapsed arch ambush (x=305, z=0, radius=15)
  // Nightness = 1.0 guarantees chance = 0.9, but let's test repeated or controlled triggers
  let triggered = false;
  for (let i = 0; i < 20; i++) {
    encounters.reset();
    spawned.length = 0;
    fakeFight.enemies.length = 0;
    encounters.update(new Vector3(305, 0, 0), 1.0);
    if (spawned.length > 0) {
      triggered = true;
      break;
    }
  }
  assert.ok(triggered, 'Ambush must trigger near collapsed arch');
  assert.ok(encounters.isTriggered('collapsed-arch'), 'collapsed-arch marked as triggered');

  // While enemies are alive, subsequent triggers do not fire
  const countBefore = spawned.length;
  encounters.update(new Vector3(306, 0, 0), 1.0);
  assert.equal(spawned.length, countBefore, 'No duplicate ambush while enemies are alive');

  // Defeat enemies and walk far away (>80m) to reset trigger
  fakeFight.enemies.forEach(e => { e.alive = false; });
  fakeFight.enemies.length = 0;
  encounters.update(new Vector3(100, 0, 0), 0);
  assert.equal(encounters.isTriggered('collapsed-arch'), false, 'Trigger resets after hero moves >80m away');
});
