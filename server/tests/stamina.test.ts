import test from 'node:test';
import assert from 'node:assert/strict';
import { ZoneWorld } from '../src/net/world.js';
import { balance } from '../src/net/balance.js';

const shaper = { accountId: 'acct_a', role: 'Shaper' as const, element: 'IGNIS' as const };
const t = balance.combat.stamina;
const blow = { enemy: 'hound_1', target: 'A', damage: 18, fromX: 0, fromZ: 3 };
const at = (world: ZoneWorld, g = false, now = 0) =>
  world.move('A', { t: now, x: 0, y: 0, z: 2, vx: 0, vz: 0, f: 0, a: g ? 'block' : 'idle', r: 1, g }, now);

test('Stamina online: a paid dodge lets a blow pass; a dodge the player cannot afford does not', () => {
  const world = new ZoneWorld('arena', () => 0.5);
  const p = world.join('A', shaper, 0);
  at(world);
  assert.equal(world.act('A', { k: 'move', m: 'dodge', sw: 1, t: 1 }, 1), true);
  assert.equal(p.stamina.current, t.max - t.dodge);
  assert.equal(p.takeStrike(blow, 1.2), null, 'inside the dodge window');
  assert.ok((p.takeStrike(blow, 1 + t.dodgeProtectSeconds + 0.1) ?? 0) > 0, 'after the window');
  // Empty the tank: the next dodge is refused and protects nothing.
  p.stamina.drain(p.stamina.current);
  assert.equal(world.act('A', { k: 'move', m: 'dodge', sw: 2, t: 5 }, 5), false);
  assert.ok((p.takeStrike(blow, 5.1) ?? 0) > 0);
});

test('Stamina online: the same swing is charged once, and an unpaid heavy never lands', () => {
  const world = new ZoneWorld('arena', () => 0.5);
  const p = world.join('A', shaper, 0);
  at(world);
  world.act('A', { k: 'move', m: 'heavy_1', sw: 3, t: 0 }, 0);
  world.act('A', { k: 'move', m: 'heavy_1', sw: 3, t: 0 }, 0);
  assert.equal(p.stamina.current, t.max - t.heavyWeapon);
  p.stamina.drain(p.stamina.current);
  const out = world.hit('A', { e: 'hound_1', m: 'heavy_1', sw: 4, t: 0.1, v: 0.1, lit: false }, 0.1);
  assert.equal(out[0]?.type, 'hit_result');
  assert.equal((out[0] as { reason?: string }).reason, 'winded');
});

test('Stamina online: a guard soaks for stamina, parries refund, and a winded guard breaks', () => {
  const world = new ZoneWorld('arena', () => 0.5);
  const p = world.join('A', shaper, 0);
  at(world, true, 0);
  assert.equal(p.takeStrike(blow, 1), 18 * balance.hero.blockDamageScale);
  assert.ok(p.stamina.current < t.max, 'the soaked blow cost stamina');
  // Raise the guard just as a blow lands: a parry gives stamina back.
  at(world, false, 2);
  p.stamina.drain(30);
  const before = p.stamina.current;
  at(world, true, 3);
  p.takeStrike(blow, 3.05);
  assert.ok(p.stamina.current > before);
  // Winded: the guard breaks and the blow lands in full.
  p.stamina.drain(p.stamina.current);
  assert.equal(p.takeStrike(blow, 4), 18);
});

test('Stamina online: running drains on the server and the player hears their count', () => {
  const world = new ZoneWorld('arena', () => 0.5);
  const p = world.join('A', shaper, 0);
  let heard = 0;
  for (let i = 1; i <= 20; i++) {
    const now = i * 0.05;
    world.move('A', { t: now, x: 0, y: 0, z: 2 + i * 0.3, vx: 0, vz: 6, f: 0, a: 'run', r: 1, g: false }, now);
    for (const e of world.step(0.05, now)) if (e.type === 'stamina' && e.to === 'A') heard++;
  }
  assert.ok(p.stamina.current < t.max);
  assert.ok(heard >= 1);
});
