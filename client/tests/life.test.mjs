import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SINDR_TOWNSFOLK,
  getTownspersonActivity,
  getTownspersonPosition,
} from '../src/life/townsfolk.js';

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

test('Sindr town watch guard is named Guard Garrick with no Sentry title', () => {
  const guard = SINDR_TOWNSFOLK.find(p => p.id === 'guard_garrick');
  assert.ok(guard, 'Guard Garrick must exist');
  assert.equal(guard.name, 'Guard Garrick', 'Guard must not be named Sentry');
  assert.ok(!guard.name.toLowerCase().includes('sentry'), 'No Sentry title in Sindr');
});
