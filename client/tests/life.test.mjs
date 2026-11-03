import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SINDR_TOWNSFOLK,
  getTownspersonActivity,
  getTownspersonPosition,
} from '../src/life/townsfolk.js';
import { setTownsfolkBodyFactory } from '../src/life/town-manager.js';
import { Satchel } from '../src/world/satchel.js';

test('Sindr townsfolk roster: 80% Dim and 20% Lit distribution, exactly matching LORE', () => {
  assert.ok(SINDR_TOWNSFOLK.length >= 20, 'Sindr must have a living crowd');

  const dimCount = SINDR_TOWNSFOLK.filter(p => !p.isLit).length;
  const litCount = SINDR_TOWNSFOLK.filter(p => p.isLit).length;
  const total = SINDR_TOWNSFOLK.length;

  const dimPercentage = (dimCount / total) * 100;
  const litPercentage = (litCount / total) * 100;

  assert.equal(dimPercentage, 80, `Expected exactly 80% Dim, got ${dimPercentage}%`);
  assert.equal(litPercentage, 20, `Expected exactly 20% Lit, got ${litPercentage}%`);
  assert.equal(dimCount + litCount, total);
});

test('Townsfolk schedules change by world clock minute (Day, Dusk, Night, Dawn)', () => {
  const smith = SINDR_TOWNSFOLK.find(p => p.role === 'smith');
  assert.ok(smith, 'Smith must exist');

  // Morning (minute 4): at work
  const morningActivity = getTownspersonActivity(4, smith);
  assert.equal(morningActivity, 'work');
  const morningPos = getTownspersonPosition(4, smith);
  assert.deepEqual(morningPos, smith.schedule.work);

  // Dusk (minute 13): wrapping up, heading to inn or home
  const duskActivity = getTownspersonActivity(13, smith);
  assert.ok(duskActivity === 'inn' || duskActivity === 'home', `Dusk activity was ${duskActivity}`);

  // Night (minute 18): inn or home, streets empty
  const nightActivity = getTownspersonActivity(18, smith);
  assert.ok(nightActivity === 'inn' || nightActivity === 'home', `Night activity was ${nightActivity}`);

  // Dawn (minute 23): heading back to work
  const dawnActivity = getTownspersonActivity(23, smith);
  assert.equal(dawnActivity, 'work');
});

test('Dusk crowd thinning: market square empties as night approaches', () => {
  // Sample all townsfolk at morning (min 4), dusk (min 13), and night (min 18)
  const atWorkDay = SINDR_TOWNSFOLK.filter(p => getTownspersonActivity(4, p) === 'work').length;
  const atInnOrHomeDusk = SINDR_TOWNSFOLK.filter(p => {
    const act = getTownspersonActivity(13, p);
    return act === 'inn' || act === 'home';
  }).length;
  const atInnOrHomeNight = SINDR_TOWNSFOLK.filter(p => {
    const act = getTownspersonActivity(18, p);
    return act === 'inn' || act === 'home';
  }).length;

  assert.ok(atWorkDay >= 25, 'Most people work during the day');
  assert.equal(atInnOrHomeDusk, SINDR_TOWNSFOLK.length, 'Everyone moves to inn or home at dusk');
  assert.equal(atInnOrHomeNight, SINDR_TOWNSFOLK.length, 'Streets are empty at night');
});

test('People lane body factory hook is exposed and accepts custom factory', () => {
  let calledWith = null;
  const mockFactory = (npc) => {
    calledWith = npc.name;
    return null;
  };

  setTownsfolkBodyFactory(mockFactory);
  assert.ok(typeof setTownsfolkBodyFactory === 'function');
  setTownsfolkBodyFactory(null); // Reset
});

test('Dying in the world leaves carried materials on the ground and satchel is emptied', () => {
  // Use mock localStorage for node test
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  };

  const satchel = new Satchel();
  satchel.items = [
    { id: 'ash_crystal', name: 'Ash Crystal', count: 5 },
    { id: 'ember_fang', name: 'Ember Fang', count: 2 },
  ];
  satchel.save();

  // Die on the road at x: 45, z: 0
  satchel.dropOnDeath(45, 0);

  // Satchel must now be empty
  assert.equal(satchel.items.length, 0, 'Satchel must be empty after dying');
  assert.ok(satchel.dropped !== null, 'Dropped satchel container must exist');
  assert.equal(satchel.dropped.x, 45);
  assert.equal(satchel.dropped.z, 0);
  assert.equal(satchel.dropped.items.length, 2);

  // Recover materials from ground
  const recovered = satchel.recoverDropped();
  assert.ok(recovered !== null);
  assert.equal(recovered.length, 2);
  assert.equal(satchel.items.length, 2);
  assert.equal(satchel.items.find(i => i.id === 'ash_crystal').count, 5);
  assert.equal(satchel.dropped, null, 'Ground container cleared after recovery');
});
