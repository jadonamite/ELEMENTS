import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCombatRules, ELEMENTS } from '../src/index.js';
import type { CombatBalance, Combatant, HitInput } from '../src/index.js';

const balance: { combat: CombatBalance } = JSON.parse(await readFile(new URL('../balance.json', import.meta.url), 'utf8'));
const combat = createCombatRules(balance.combat);
const fighter = (element: Combatant['element'] = 'IGNIS'): Combatant => ({
  element, position: { x: 0, y: 0, z: 0 }, health: combat.createHealth(), armour: balance.combat.rules.defaultArmour,
});
const input = (patch: Partial<HitInput> = {}): HitInput => ({
  attacker: fighter(), target: fighter('AURA'), moveId: 'light_1', now: 0, state: combat.createActionState(), ...patch,
});
const accepted = (hit: HitInput) => {
  const result = combat.checkHit(hit);
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error(result.reason);
  return result;
};
const rejects = (hit: HitInput, reason: string) => assert.deepEqual(combat.checkHit(hit), { accepted: false, reason });

test('each counter gains 25%; same, reverse and opposite elements stay neutral', () => {
  const cycle = { AQUES: 'IGNIS', IGNIS: 'AURA', AURA: 'TERRA', TERRA: 'AQUES' } as const;
  for (const attacker of ELEMENTS) for (const target of ELEMENTS) {
    assert.equal(combat.calculateDamage(100, attacker, target, 0), cycle[attacker] === target ? 125 : 100);
  }
  assert.equal(accepted(input()).damage, balance.combat.ignisStarterMoves.light_1.damage * 1.25);
  assert.equal(accepted(input({ target: fighter('TERRA') })).damage, balance.combat.ignisStarterMoves.light_1.damage);
});

test('armour reduces damage and lethal damage clamps health to zero without mutation', () => {
  assert.equal(combat.calculateDamage(100, 'IGNIS', 'TERRA', balance.combat.rules.armourScale), 50);
  const target = { ...fighter(), health: { current: 1, maximum: 100 } };
  const result = accepted(input({ target }));
  assert.equal(result.damage, 1);
  assert.equal(combat.isDead(result.target.health), true);
  assert.equal(target.health.current, 1);
  rejects(input({ target: result.target }), 'target_dead');
  rejects(input({ attacker: { ...fighter(), health: { current: 0, maximum: 100 } } }), 'attacker_dead');
});

test('reach uses all three position axes and accepts the exact boundary', () => {
  const reach = balance.combat.ignisStarterMoves.light_1.reach;
  accepted(input({ target: { ...fighter(), position: { x: 0, y: reach, z: 0 } } }));
  rejects(input({ target: { ...fighter(), position: { x: reach, y: reach, z: 0 } } }), 'out_of_reach');
});

test('accepted hits consume move cooldown at time zero and exact expiry is ready', () => {
  const first = accepted(input());
  const cooldown = balance.combat.ignisStarterMoves.light_1.cooldownSeconds;
  rejects(input({ state: first.state, now: cooldown / 2 }), 'cooldown');
  assert.equal(combat.cooldownRemaining('light_1', first.state, cooldown), 0);
  accepted(input({ state: first.state, now: cooldown }));
  assert.equal(combat.cooldownRemaining('heavy_1', first.state, 0), 0);
  rejects(input({ state: first.state, now: -1 }), 'invalid_input');
  const later = accepted(input({ now: 10 }));
  rejects(input({ state: later.state, now: 9 }), 'clock_reversed');
});

test('rolling damage cap spans moves and targets and expires at the window boundary', () => {
  const first = accepted(input({ moveId: 'dash_strike' }));
  assert.equal(first.state.damageHistory[0]?.damage, 100);
  rejects(input({ target: fighter('TERRA'), moveId: 'heavy_1', state: first.state }), 'damage_cap');
  accepted(input({ state: first.state, now: balance.combat.rules.damageWindowSeconds }));
  // Armour and low remaining health cannot hide damage from the cap.
  const tiny = { ...fighter('AURA'), armour: 1000, health: { current: 1, maximum: 100 } };
  const armoured = accepted(input({ target: tiny, moveId: 'dash_strike' }));
  assert.equal(armoured.state.damageHistory[0]?.damage, 100);
  rejects(input({ state: armoured.state, moveId: 'light_2' }), 'damage_cap');
});

test('expired damage events are removed when the next accepted action records state', () => {
  const first = accepted(input({ moveId: 'dash_strike' }));
  const now = balance.combat.rules.damageWindowSeconds;
  const next = accepted(input({ state: first.state, now, moveId: 'light_1' }));
  assert.deepEqual(next.state.damageHistory, [{ at: now, damage: balance.combat.ignisStarterMoves.light_1.damage * 1.25 }]);
  assert.equal(next.state.lastActionAt, now);
});

test('a single oversized move is rejected using balance, never a damage claim', () => {
  const tuning = structuredClone(balance.combat);
  (tuning.ignisStarterMoves.light_1 as { damage: number }).damage = 1000;
  const result = createCombatRules(tuning).checkHit(input());
  assert.deepEqual(result, { accepted: false, reason: 'damage_cap' });
  const withClaim = { ...input(), claimedDamage: 1000000 };
  assert.equal(accepted(withClaim).damage, 15);
});

test('unknown moves, dodge hits and non-IGNIS attacks are rejected', () => {
  rejects(input({ moveId: 'heavy_2' }), 'unknown_move');
  rejects(input({ moveId: 'toString' }), 'unknown_move');
  rejects(input({ moveId: 'dodge' }), 'not_attack');
  rejects(input({ attacker: fighter('AQUES') }), 'wrong_element');
});

test('nonfinite and invalid values fail before updating health or state', () => {
  for (const number of [NaN, Infinity, -Infinity]) {
    rejects(input({ now: number }), 'invalid_input');
    rejects(input({ target: { ...fighter(), position: { x: number, y: 0, z: 0 } } }), 'invalid_input');
    rejects(input({ target: { ...fighter(), armour: number } }), 'invalid_input');
    rejects(input({ target: { ...fighter(), health: { current: number, maximum: 100 } } }), 'invalid_input');
    rejects(input({ state: { lastActionAt: 0, cooldowns: { light_1: number }, damageHistory: [] } }), 'invalid_input');
    rejects(input({ state: { lastActionAt: 0, cooldowns: {}, damageHistory: [{ at: 0, damage: number }] } }), 'invalid_input');
    assert.throws(() => combat.calculateDamage(number, 'IGNIS', 'AURA', 0), RangeError);
    assert.throws(() => combat.createHealth(number), RangeError);
  }
  rejects(input({ target: { ...fighter(), armour: -1 } }), 'invalid_input');
  rejects(input({ target: { ...fighter(), health: { current: 101, maximum: 100 } } }), 'invalid_input');
  rejects(input({ state: { lastActionAt: 0, cooldowns: {}, damageHistory: [{ at: 1, damage: 5 }] } }), 'invalid_input');
  assert.throws(() => combat.applyDamage(combat.createHealth(), -1), RangeError);
});

test('accepted and rejected checks preserve inputs; tuning is snapshotted', () => {
  const before = input();
  const copy = structuredClone(before);
  const result = accepted(before);
  assert.deepEqual(before, copy);
  assert.notEqual(result.state, before.state);
  assert.notEqual(result.state.cooldowns, before.state.cooldowns);
  assert.notEqual(result.target, before.target);
  const rejectedInput = input({ state: result.state });
  const rejectedCopy = structuredClone(rejectedInput);
  rejects(rejectedInput, 'cooldown');
  assert.deepEqual(rejectedInput, rejectedCopy);
  const tuning = structuredClone(balance.combat);
  const isolated = createCombatRules(tuning);
  (tuning.ignisStarterMoves.light_1 as { damage: number }).damage = 10000;
  assert.equal(isolated.checkHit(before).accepted, true);
});

test('dodge consumes its own cooldown, preserves hit history, rejects reverse clocks', () => {
  const first = accepted(input());
  const dodge = combat.useDodge(first.state, 0);
  assert.equal(dodge.accepted, true);
  if (!dodge.accepted) return;
  assert.deepEqual(dodge.state.damageHistory, first.state.damageHistory);
  assert.deepEqual(combat.useDodge(dodge.state, 0), { accepted: false, reason: 'cooldown' });
  assert.equal(combat.useDodge(dodge.state, balance.combat.ignisStarterMoves.dodge.cooldownSeconds).accepted, true);
  const later = combat.useDodge(combat.createActionState(), 10);
  if (later.accepted) assert.deepEqual(combat.useDodge(later.state, 9), { accepted: false, reason: 'clock_reversed' });
});

test('invalid tuning throws on startup', () => {
  const bad = structuredClone(balance.combat);
  (bad.rules as { damageWindowSeconds: number }).damageWindowSeconds = 0;
  assert.throws(() => createCombatRules(bad), RangeError);
  const badMove = structuredClone(balance.combat);
  (badMove.ignisStarterMoves.light_1 as { cooldownSeconds: number }).cooldownSeconds = Infinity;
  assert.throws(() => createCombatRules(badMove), RangeError);
});
