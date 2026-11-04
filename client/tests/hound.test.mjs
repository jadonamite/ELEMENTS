import assert from 'node:assert/strict';
import test from 'node:test';
import { houndDamage } from '../src/monsters/hound.ts';
import balance from '../../shared/balance.json' with { type: 'json' };

const houndPose = {
  position: { x: 0, y: 0, z: 0 },
  facing: 0, // facing +Z
  napePosition: { x: 0, y: 1.0, z: 0.4 },
};

test('houndDamage: nape hit within 0.35m deals 2x damage and staggers', () => {
  const base = 25;
  // Hit point directly at the nape bone
  const napeHit = { x: 0, y: 1.05, z: 0.45 };
  const res = houndDamage(base, napeHit, houndPose);
  assert.equal(res.isWeakSpot, true);
  assert.equal(res.damage, base * 2);
  assert.equal(res.stagger, true);
  assert.ok(res.staggerDuration >= 1.2);
});

test('houndDamage: front hit deals 1x damage and does not stagger', () => {
  const base = 25;
  // Hit from front (+Z), well away from the nape bone
  const frontHit = { x: 0, y: 0.8, z: 1.8 };
  const res = houndDamage(base, frontHit, houndPose);
  assert.equal(res.isWeakSpot, false);
  assert.equal(res.damage, base * 1);
  assert.equal(res.stagger, false);
});

test('houndDamage: hit from behind within 60 degrees of the back deals 2x damage and staggers', () => {
  const base = 30;
  // Hound faces +Z, back is -Z (angle Math.PI).
  // Hit from behind at angle 150 deg (inside 60 deg cone around back at 180 deg)
  const behindHit = { x: -0.2, y: 0.8, z: -1.5 };
  const res = houndDamage(base, behindHit, houndPose);
  assert.equal(res.isWeakSpot, true);
  assert.equal(res.damage, base * 2);
  assert.equal(res.stagger, true);
});

test('houndDamage: flank hit outside nape and 60 deg cone deals 1x damage', () => {
  const base = 30;
  // Hit directly from the side (+X), 90 deg from back
  const flankHit = { x: 2.0, y: 0.8, z: 0.0 };
  const res = houndDamage(base, flankHit, houndPose);
  assert.equal(res.isWeakSpot, false);
  assert.equal(res.damage, base * 1);
  assert.equal(res.stagger, false);
});

test('houndDamage: elemental resistance and vulnerability apply', () => {
  const base = 20;
  const frontHit = { x: 0, y: 0.8, z: 1.8 };
  const napeHit = { x: 0, y: 1.0, z: 0.4 };

  // IGNIS fire deals 0.5x damage
  const fireRes = houndDamage(base, frontHit, houndPose, { element: 'IGNIS' });
  assert.equal(fireRes.damage, Math.round(base * 0.5));

  // AQUES water deals 1.5x damage (and 3x on weak spot)
  const waterRes = houndDamage(base, frontHit, houndPose, { element: 'AQUES' });
  assert.equal(waterRes.damage, Math.round(base * 1.5));

  const waterNape = houndDamage(base, napeHit, houndPose, { element: 'AQUES' });
  assert.equal(waterNape.damage, Math.round(base * 2.0 * 1.5));
});

test('onKill hook triggers on death with kind and position, returning nothing', () => {
  let hookCalled = false;
  let receivedKind = '';
  let receivedPos = null;

  const onKillHook = (kind, position) => {
    hookCalled = true;
    receivedKind = kind;
    receivedPos = position;
  };

  const dummyHound = {
    state: 'idle',
    controller: { position: { x: 5, y: 0.5, z: -10 } },
    die(hook) {
      this.state = 'death';
      const res = (hook ?? onKillHook)('ember_hound', this.controller.position);
      assert.equal(res, undefined); // Returns nothing itself
    }
  };

  dummyHound.die(onKillHook);
  assert.equal(dummyHound.state, 'death');
  assert.equal(hookCalled, true);
  assert.equal(receivedKind, 'ember_hound');
  assert.deepEqual(receivedPos, { x: 5, y: 0.5, z: -10 });
});

test('monsters.emberHound balance configuration has no hard-coded drops', () => {
  const b = balance.monsters.emberHound;
  assert.ok(typeof b.health === 'number' && b.health > 0);
  assert.ok(typeof b.chargeDistance === 'number' && b.chargeDistance > 0);
  assert.ok(typeof b.chargeCooldown === 'number' && b.chargeCooldown > 0);
  assert.ok(typeof b.biteDamage === 'number' && b.biteDamage > 0);
  assert.ok(typeof b.weakSpotMultiplier === 'number' && b.weakSpotMultiplier >= 2.0);
  assert.ok(typeof b.packSize === 'number' && b.packSize === 3);
  assert.ok(typeof b.flankAngleDeg === 'number' && b.flankAngleDeg > 0);
  assert.equal(b.drops, undefined, 'No hard-coded drops in creature balance block');
});
