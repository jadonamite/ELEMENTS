import assert from 'node:assert/strict';
import test from 'node:test';
import balance from '../balance.json' with { type: 'json' };
import { nightnessAt, stallsShut, NIGHT_FROM } from '../src/net/clock.js';

const cfg = balance.world.dayNight;

test('the market is open all day and shut all night', () => {
  // The middle of the day is minute half the day length; the middle of the night is past dusk.
  const day = cfg.dayMinutes / 2;
  const night = cfg.dayMinutes + cfg.duskMinutes + cfg.nightMinutes / 2;
  assert.equal(stallsShut(nightnessAt(day, cfg)), false);
  assert.equal(stallsShut(nightnessAt(night, cfg)), true);
});

test('the stalls shut at the same darkness the robbers call night', () => {
  assert.equal(stallsShut(NIGHT_FROM - 0.01), false);
  assert.equal(stallsShut(NIGHT_FROM), true);
  assert.equal(stallsShut(1), true);
});
