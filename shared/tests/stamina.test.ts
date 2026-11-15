import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Stamina, moveStaminaCost, actStaminaCost, type StaminaTuning } from '../src/index.js';

const balance = JSON.parse(await readFile(new URL('../balance.json', import.meta.url), 'utf8')) as { combat: { stamina: StaminaTuning } };
const t = balance.combat.stamina;
const calm = { running: false, inFight: true, guarding: false };

test('stamina costs: dodge and heavies cost, light attacks and bending do not', () => {
  assert.equal(moveStaminaCost('dodge', t), t.dodge);
  assert.equal(moveStaminaCost('heavy_1', t), t.heavyWeapon);
  assert.equal(moveStaminaCost('heavy_2', t), t.heavyWeapon);
  assert.equal(moveStaminaCost('bare_heavy_1', t), t.heavyBody);
  assert.equal(moveStaminaCost('leg_heavy_1', t), t.heavyBody);
  for (const free of ['light_1', 'bare_light_2', 'leg_light_1', 'bend_palm', 'bend_sweep', 'ultimate', 'uppercut', 'hit', 'death']) {
    assert.equal(moveStaminaCost(free, t), 0, free);
  }
  assert.equal(actStaminaCost('jump', t), t.jump);
  assert.equal(actStaminaCost('super_jump', t), t.superJump);
});

test('stamina: six foes cannot be dodged forever', () => {
  const s = new Stamina(t);
  let dodges = 0;
  // Dodge as fast as the move allows (about 0.6 s) for 20 s.
  for (let time = 0; time < 20; time += 0.6) {
    if (s.spend(moveStaminaCost('dodge', t))) dodges++;
    s.tick(0.6, calm);
  }
  assert.ok(dodges < 20 / 0.6, `dodged ${dodges} times`);
  assert.ok(dodges >= 4);
});

test('stamina: reaching zero winds; winded refuses dodge and running', () => {
  const s = new Stamina(t);
  s.drain(s.cap);
  assert.equal(s.current, 0);
  assert.ok(s.winded);
  assert.equal(s.can(t.dodge), false);
  assert.equal(s.canRun, false);
  assert.ok(s.can(0), 'free moves still start');
  s.tick(t.windedSeconds + 0.01, calm);
  assert.equal(s.winded, false);
});

test('stamina: not enough for the move means it does not start and nothing is paid', () => {
  const s = new Stamina(t);
  s.current = t.dodge - 1;
  assert.equal(s.spend(t.dodge), false);
  assert.equal(s.current, t.dodge - 1);
});

test('stamina: a winded guard breaks; a fresh one soaks half the blow', () => {
  const s = new Stamina(t);
  assert.equal(s.soak(20), 'held');
  assert.equal(s.current, t.max - 20 * t.guardSoakScale);
  s.drain(s.cap);
  assert.equal(s.soak(20), 'broken');
});

test('stamina: parry refunds; regen waits for the pause and is halved under guard', () => {
  const s = new Stamina(t);
  s.drain(50);
  s.refund();
  assert.equal(s.current, t.max - 50 + t.parryRefund);
  const before = s.current;
  s.tick(t.regenDelay / 2, calm);
  assert.equal(s.current, before, 'no regen inside the pause');
  s.tick(t.regenDelay / 2, calm);
  const resumed = s.current;
  s.tick(1, calm);
  const open = s.current - resumed;
  assert.ok(Math.abs(open - t.regenPerSecond) < 1e-6);
  const g = new Stamina(t);
  g.drain(50);
  g.tick(t.regenDelay, { ...calm, guarding: true });
  const start = g.current;
  g.tick(1, { ...calm, guarding: true });
  assert.ok(Math.abs(g.current - start - t.regenPerSecond * t.guardRegenScale) < 1e-6);
});

test('stamina: running drains, half price out of fight stance, and stops at zero', () => {
  const a = new Stamina(t);
  a.tick(1, { ...calm, running: true });
  assert.equal(a.current, t.max - t.runPerSecond);
  const b = new Stamina(t);
  b.tick(1, { ...calm, running: true, inFight: false });
  assert.equal(b.current, t.max - t.runPerSecond * t.runCalmScale);
  const c = new Stamina(t);
  for (let i = 0; i < 200; i++) c.tick(0.1, { ...calm, running: true });
  assert.ok(c.current < t.max, 'never stays full while running');
});

test('stamina: the cap shrinks what is held', () => {
  const s = new Stamina(t);
  s.setCap(60);
  assert.equal(s.current, 60);
  s.drain(30);
  s.tick(10, calm);
  assert.equal(s.current, 60);
});
