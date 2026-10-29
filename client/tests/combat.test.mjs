import assert from 'node:assert/strict';
import test from 'node:test';
import { Combat } from '../src/combat.ts';

function fakeAnim() {
  const played = [];
  return {
    played,
    playOnce(name) { played.push(name); return true; },
    setSpeed() {},
    duration() { return 1; },
  };
}

test('light presses chain only inside the combo window', () => {
  const anim = fakeAnim();
  const combat = new Combat(anim);
  assert.ok(combat.press('light'));
  assert.equal(combat.current, 'light_1');
  combat.update(0.1);
  assert.equal(combat.press('light'), false, 'too early to chain');
  combat.update(0.6);
  assert.ok(combat.press('light'));
  combat.update(0.4);
  assert.equal(combat.current, 'light_2');
  assert.deepEqual(anim.played, ['light_1', 'light_2']);
});

test('a move ends back in free movement, and dodge cancels a recovery', () => {
  const combat = new Combat(fakeAnim());
  combat.press('heavy');
  combat.update(1.2);
  assert.equal(combat.current, null);
  combat.press('uppercut');
  combat.update(0.8);
  assert.ok(combat.press('dodge'));
  combat.update(0.3);
  assert.equal(combat.current, 'dodge');
  assert.ok(combat.lunge > 0, 'dodge carries the hero');
});

test('blocking refuses attacks', () => {
  const combat = new Combat(fakeAnim());
  combat.blocking = true;
  assert.equal(combat.press('light'), false);
  assert.equal(combat.current, null);
});
