import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { BendState } from '../src/bend-state.ts';
import balance from '../../shared/balance.json' with { type: 'json' };

const here = new Vector3();
const far = new Vector3(50, 0, 50);

test('bending works on an empty bar, but weaker; a full bar pays for chains that skip cooldowns', () => {
  const bend = new BendState({ element: 'IGNIS', weapon: 'sword' });
  const weak = bend.begin('bend_palm', true, here);
  assert.equal(weak.go && weak.strength, balance.combat.meter.weakScale);
  for (let i = 0; i < 13; i++) bend.gain('hit');
  bend.tick(2, here);
  const full = bend.begin('uppercut', true, here);
  assert.equal(full.go && full.strength, 1);
  assert.equal(bend.meter, 100 - balance.combat.meter.costs.uppercut);
  const chain = bend.begin('ground_pound', false, here);
  assert.equal(chain.go && chain.chained, true);
  assert.equal(bend.meter, 100 - balance.combat.meter.costs.uppercut - balance.combat.meter.chainCost);
});

test('a chain needs the meter; without it a move on cooldown is refused', () => {
  const bend = new BendState({ element: 'IGNIS', weapon: 'sword' });
  bend.begin('bend_palm', true, here);
  assert.deepEqual(bend.begin('bend_sweep', false, here), { go: false, why: 'cooldown' });
});

test('AQUES bends from water nearby, else from the waterskin, else not at all', () => {
  const bend = new BendState({ element: 'AQUES', weapon: 'spear' }, 7, () => [new Vector3()]);
  const near = bend.begin('bend_palm', true, here);
  assert.equal(near.go && near.fromSkin, false);
  for (let i = 0; i < balance.combat.waterskin.charges; i++) {
    bend.tick(5, far);
    assert.equal(bend.begin('bend_palm', true, far).go, true);
  }
  bend.tick(5, far);
  assert.deepEqual(bend.begin('bend_palm', true, far), { go: false, why: 'no_water' });
  bend.tick(balance.combat.waterskin.refillSeconds + 0.1, here);
  assert.equal(bend.waterskin, balance.combat.waterskin.charges);
});

test('tiers gate moves, the Hush never bend but spend shards on sparks, Wind Step has two charges', () => {
  assert.deepEqual(new BendState({ element: 'TERRA', weapon: 'axe' }, 4).begin('ultimate', true, here), { go: false, why: 'tier' });
  const hush = new BendState({ element: 'TERRA', weapon: 'axe', hush: true });
  assert.deepEqual(hush.begin('bend_palm', true, here), { go: false, why: 'hush' });
  for (let i = 0; i < balance.combat.shardSpark.testShards; i++) assert.equal(hush.spark(true).go, true);
  assert.deepEqual(hush.spark(true), { go: false, why: 'no_shards' });
  const aura = new BendState({ element: 'AURA', weapon: 'twin' });
  assert.equal(aura.begin('dash_strike', false, here).go, true);
  assert.equal(aura.begin('dash_strike', false, here).go, true);
  assert.deepEqual(aura.begin('dash_strike', false, here), { go: false, why: 'cooldown' });
  aura.tick(balance.combat.elements.AURA.dash_strike.cooldownSeconds + 0.1, here);
  assert.equal(aura.begin('dash_strike', false, here).go, true);
});
