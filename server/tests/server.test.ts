import test from 'node:test';
import assert from 'node:assert/strict';
import { getAccount, saveAccount } from '../src/db.js';
import { testBannedWords, redactBannedWords } from '../src/rooms/ZoneRoom.js';
import { ZoneState, PlayerState, MonsterState } from '../src/schema/ZoneState.js';
import { createCombatRules, type CombatBalance } from '@elements/shared';
import fs from 'node:fs';

const balancePath = new URL('../../shared/balance.json', import.meta.url);
const balance = JSON.parse(fs.readFileSync(balancePath, 'utf8'));
const rules = createCombatRules(balance.combat as CombatBalance);

test('Database: saveAccount and getAccount persist player role and element', () => {
  const testId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const saved = saveAccount(testId, 'Shaper', 'AQUES');
  assert.equal(saved.id, testId);
  assert.equal(saved.role, 'Shaper');
  assert.equal(saved.element, 'AQUES');

  const retrieved = getAccount(testId);
  assert.ok(retrieved);
  assert.equal(retrieved.id, testId);
  assert.equal(retrieved.role, 'Shaper');
  assert.equal(retrieved.element, 'AQUES');
});

test('Database: saveAccount is idempotent for existing user', () => {
  const testId = `user_idempotent_${Date.now()}`;
  const first = saveAccount(testId, 'Hush', null);
  const second = saveAccount(testId, 'Shaper', 'IGNIS');
  assert.equal(first.role, 'Hush');
  assert.equal(second.role, 'Hush');
  assert.equal(second.element, null);
});

test('Edict of Unnaming: banned word detection and redaction', () => {
  assert.equal(testBannedWords('I will use fire against them'), true);
  assert.equal(testBannedWords('water magic is strong'), true);
  assert.equal(testBannedWords('earth pillar rising'), true);
  assert.equal(testBannedWords('air currents flow'), true);
  assert.equal(testBannedWords('the wind howls'), true);
  assert.equal(testBannedWords('WIND AND FIRE'), true);

  // Negative checks: substrings in valid words should not trigger boundary match
  assert.equal(testBannedWords('firewall active'), false);
  assert.equal(testBannedWords('waterfall in the distance'), false);
  assert.equal(testBannedWords('aircraft passing'), false);

  // Redaction
  const redacted = redactBannedWords('Control fire and water now');
  assert.equal(redacted, 'Control [REDACTED BY EDICT] and [REDACTED BY EDICT] now');
});

test('ZoneState: MapSchema collections for players and monsters', () => {
  const state = new ZoneState();
  const player = new PlayerState();
  player.id = 'p1';
  player.element = 'AURA';
  player.role = 'Shaper';
  player.health = 120;
  state.players.set(player.id, player);

  assert.equal(state.players.size, 1);
  assert.equal(state.players.get('p1')?.element, 'AURA');

  const monster = new MonsterState();
  monster.id = 'm1';
  monster.health = 60;
  state.monsters.set(monster.id, monster);

  assert.equal(state.monsters.size, 1);
  assert.equal(state.monsters.get('m1')?.health, 60);
});

test('Server Hit Validation: rejects hits out of reach', () => {
  const attacker = {
    element: 'IGNIS' as const,
    position: { x: 0, y: 0, z: 0 },
    health: { current: 120, maximum: 120 },
    armour: 0,
  };
  const target = {
    element: 'TERRA' as const,
    position: { x: 50, y: 0, z: 50 }, // 70 units away!
    health: { current: 60, maximum: 60 },
    armour: 0,
  };
  const actionState = rules.createActionState();

  const result = rules.checkHit({
    attacker,
    target,
    moveId: 'light_1',
    now: 1.0,
    state: actionState,
    swingAt: 1.0,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'out_of_reach');
});

test('Server Hit Validation: accepts valid in-range light combo hit with no fixed elemental counter', () => {
  const attacker = {
    element: 'IGNIS' as const,
    position: { x: 0, y: 0, z: 0 },
    health: { current: 120, maximum: 120 },
    armour: 0,
  };
  const target = {
    element: 'AURA' as const, // IGNIS counters AURA (+25%)
    position: { x: 1.5, y: 0, z: 0 },
    health: { current: 60, maximum: 60 },
    armour: 0,
  };
  const actionState = rules.createActionState();

  const result = rules.checkHit({
    attacker,
    target,
    moveId: 'light_1',
    now: 1.0,
    state: actionState,
    swingAt: 1.0,
  });

  assert.equal(result.accepted, true);
  // IGNIS sword light 1 is 12 against any element; edges are situational, not a fixed cycle
  assert.equal(result.damage, 12);
  assert.equal(result.target.health.current, 60 - result.damage);
});
