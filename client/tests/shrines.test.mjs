import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRST_SHRINE, LEGACY_SINDR_ORIGIN, SHRINES, shrineById } from '../../shared/src/index.js';
import { ShrineState } from '../src/shrine-state.ts';

test('ShrineState begins with Shrine of Embers lit', () => {
  const state = new ShrineState();
  assert.ok(state.isLit(FIRST_SHRINE));
  assert.equal(state.lit.size, 1);
});

test('ShrineState: reaching an unlit shrine lights it outside a fight, notices, and updates wake spot', () => {
  const notices = [];
  const state = new ShrineState({
    onNotice: (msg) => notices.push(msg),
  });

  const pinewatch = SHRINES.find(s => s.name === 'Pinewatch Shrine');
  assert.ok(pinewatch);

  // Pinewatch scene position = global minus origin
  const sceneX = pinewatch.x - LEGACY_SINDR_ORIGIN.x;
  const sceneZ = pinewatch.z - LEGACY_SINDR_ORIGIN.z;

  // Mid fight: does not light
  assert.equal(state.checkReach({ x: sceneX, z: sceneZ }, true), null);
  assert.ok(!state.isLit(pinewatch.id));

  // Outside fight: lights it
  const lit = state.checkReach({ x: sceneX, z: sceneZ }, false);
  assert.equal(lit?.id, pinewatch.id);
  assert.ok(state.isLit(pinewatch.id));
  assert.ok(notices.includes('Pinewatch Shrine lit'));

  // Falling near Pinewatch revives at Pinewatch's wake spot
  const wake = state.wakeSpot({ x: sceneX + 2, z: sceneZ + 2 });
  assert.equal(wake.shrine.id, pinewatch.id);
  assert.equal(wake.x, pinewatch.wake.x - LEGACY_SINDR_ORIGIN.x);
  assert.equal(wake.z, pinewatch.wake.z - LEGACY_SINDR_ORIGIN.z);
  assert.equal(wake.facing, pinewatch.wake.facing);
});

test('ShrineState: falling near Sindr with multiple lit shrines still wakes at the nearest lit shrine', () => {
  const state = new ShrineState();
  const pinewatch = SHRINES.find(s => s.name === 'Pinewatch Shrine');
  assert.ok(pinewatch);
  state.setOnlineLit([FIRST_SHRINE, pinewatch.id]);

  // Fall at Sindr origin (0, 0 scene coords)
  const embersWake = state.wakeSpot({ x: 0, z: 0 });
  assert.equal(embersWake.shrine.id, FIRST_SHRINE);

  // Fall near Pinewatch
  const pinewatchScene = {
    x: pinewatch.x - LEGACY_SINDR_ORIGIN.x,
    z: pinewatch.z - LEGACY_SINDR_ORIGIN.z,
  };
  const pwWake = state.wakeSpot(pinewatchScene);
  assert.equal(pwWake.shrine.id, pinewatch.id);
});

test('SettlementStream tracks lit state of precinct shrines', async () => {
  const { SettlementStream } = await import('../src/world/settlements.ts');
  const { SETTLEMENT_PRECINCTS } = await import('../../shared/src/world/ignis/settlements.js');
  const pinewatch = SETTLEMENT_PRECINCTS.find(p => p.name === 'Pinewatch');
  assert.ok(pinewatch);

  const stream = new SettlementStream(null, () => null, false);
  assert.equal(stream.isShrineLit(pinewatch), false);

  stream.setLit('shrine_pinewatch', true);
  assert.equal(stream.isShrineLit(pinewatch), true);

  stream.setLit('shrine_pinewatch', false);
  assert.equal(stream.isShrineLit(pinewatch), false);
});
