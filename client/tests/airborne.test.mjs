import test from 'node:test';
import assert from 'node:assert/strict';
import { Airborne, AIR_CLIPS } from '../src/anim/airborne.ts';

const timing = { landSeconds: 0.35, getUpSeconds: 3.6, duration: () => 0.25, gravity: 9.81, runSpeed: 3.5 };
const read = (grounded, rising, speed = 0) => ({ grounded, rising, moving: speed > 0.5, speed });

test('a standing jump rises, falls and lands with the standing set, timed to the flight', () => {
  const air = new Airborne(timing);
  assert.equal(air.update(read(true, 0), 0.016), null);
  const rise = air.update(read(false, 5.2), 0.016);
  assert.equal(rise.name, AIR_CLIPS.rise);
  assert.ok(Math.abs(rise.speed - 0.25 / (5.2 / 9.81)) < 1e-6, 'the take-off fills the climb to the top');
  assert.equal(air.update(read(false, -0.1), 0.016).name, AIR_CLIPS.fall);
  assert.equal(air.update(read(true, 0), 0.016).name, AIR_CLIPS.land);
  assert.equal(air.update(read(true, 0, 2), 0.016), null, 'moving off ends the touchdown at once');
});

test('a running take-off uses the running set', () => {
  const air = new Airborne(timing);
  assert.equal(air.update(read(false, 5.2, 6), 0.016).name, AIR_CLIPS.runRise);
  assert.equal(air.update(read(false, -1, 6), 0.016).name, AIR_CLIPS.runFall);
  assert.equal(air.update(read(true, 0, 6), 0.016).name, AIR_CLIPS.runLand);
});

test('a hard fall leaves the body down, holding, until it is raised', () => {
  const air = new Airborne(timing);
  air.fallHard();
  air.update(read(false, -3), 0.016);
  const down = air.update(read(true, 0), 0.016);
  assert.equal(air.phase, 'down');
  assert.equal(down.speed, 0);
  assert.equal(air.holding, true);
  air.update(read(true, 0), 10);
  assert.equal(air.phase, 'down', 'it waits however long until told');
  air.getUp();
  air.update(read(true, 0), 3.7);
  assert.equal(air.phase, 'ground');
  assert.equal(air.holding, false);
});
