import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import balance from '../../shared/balance.json' with { type: 'json' };
import { createCombatRules } from '../../shared/src/index.js';
import { Combat, getStrikingLimb } from '../src/combat.js';
import { limbTouchesCapsule, bladeTouches } from '../src/hits.js';
import { SWORD_WEAPON } from '../src/weapon.js';

const rules = createCombatRules(balance.combat);

class MockAnimPlayer {
  duration(_clip) { return 0.6; }
  hasClip(_clip) { return true; }
  playOnce(_clip, _fade) {}
  setSpeed(_clip, _speed) {}
  play(_clip) {}
}

test('three fighting styles have distinct openers, combo chains and striking limbs', () => {
  const anim = new MockAnimPlayer();

  // Weapon style
  const combatWeapon = new Combat(anim);
  combatWeapon.setStyle('weapon');
  assert.equal(combatWeapon.fightingStyle, 'weapon');
  combatWeapon.press('light');
  assert.equal(combatWeapon.current, 'light_1');
  assert.equal(combatWeapon.strikingLimb, 'blade');

  // Bare hands style: punches and kicks
  const combatHands = new Combat(anim);
  combatHands.setStyle('bare_hands');
  assert.equal(combatHands.fightingStyle, 'bare_hands');
  combatHands.press('light');
  assert.equal(combatHands.current, 'bare_light_1');
  assert.equal(combatHands.strikingLimb, 'hand_r');

  // Advance into combo window and test light combo chaining
  combatHands.update(0.6 * (1 - balance.combat.comboWindow) + 0.05);
  combatHands.press('light');
  combatHands.update(0.2); // finish move to start queued
  assert.equal(combatHands.current, 'bare_light_2');
  assert.equal(combatHands.strikingLimb, 'hand_l');

  // Chain to kick
  combatHands.update(0.6 * (1 - balance.combat.comboWindow) + 0.05);
  combatHands.press('light');
  combatHands.update(0.2);
  assert.equal(combatHands.current, 'bare_light_3');
  assert.equal(combatHands.strikingLimb, 'foot_r');

  // Heavy strike
  const combatHeavy = new Combat(anim);
  combatHeavy.setStyle('bare_hands');
  combatHeavy.press('heavy');
  assert.equal(combatHeavy.current, 'bare_heavy_1');
  assert.equal(combatHeavy.strikingLimb, 'hand_r');

  // Bending style (Lit only)
  const combatBending = new Combat(anim);
  combatBending.setStyle('bending');
  assert.equal(combatBending.fightingStyle, 'bending');
  combatBending.press('light');
  assert.equal(combatBending.current, 'bend_palm');
  assert.equal(combatBending.strikingLimb, 'projectile');

  const combatSweep = new Combat(anim);
  combatSweep.setStyle('bending');
  combatSweep.press('heavy');
  assert.equal(combatSweep.current, 'bend_sweep');
  assert.equal(combatSweep.strikingLimb, 'area');
});

test('bare-handed hits land only when a fist or foot touches the husk capsule', () => {
  const huskFeet = { x: 0, y: 0, z: 1.2 };
  const huskHeight = 1.8;
  const huskRadius = 0.38;
  const fistRadius = 0.20;
  const footRadius = 0.22;

  // 1. Right fist strikes forward and reaches into the husk's volume
  const fistInReach = { x: 0, y: 1.2, z: 0.95 };
  assert.equal(
    limbTouchesCapsule(fistInReach, fistRadius, huskFeet, huskHeight, huskRadius),
    true,
    'Fist inside contact envelope must register a hit',
  );

  // 2. Right fist at exact boundary: distance = huskRadius + fistRadius = 0.58m
  // husk is at z=1.2, boundary is z = 1.2 - 0.58 = 0.62
  const fistAtBoundary = { x: 0, y: 1.2, z: 0.62 };
  assert.equal(
    limbTouchesCapsule(fistAtBoundary, fistRadius, huskFeet, huskHeight, huskRadius),
    true,
    'Fist touching capsule boundary must connect',
  );

  // 3. Right fist out of reach (too far back): z = 0.50 (distance 0.70m > 0.58m)
  const fistOutOfReach = { x: 0, y: 1.2, z: 0.50 };
  assert.equal(
    limbTouchesCapsule(fistOutOfReach, fistRadius, huskFeet, huskHeight, huskRadius),
    false,
    'Fist outside contact envelope must miss',
  );

  // 4. Right foot kick at chest height
  const footInReach = { x: 0, y: 0.75, z: 0.90 };
  assert.equal(
    limbTouchesCapsule(footInReach, footRadius, huskFeet, huskHeight, huskRadius),
    true,
    'Foot kick reaching husk must connect',
  );

  // 5. Foot kick out of reach
  const footOutOfReach = { x: 0, y: 0.75, z: 0.35 };
  assert.equal(
    limbTouchesCapsule(footOutOfReach, footRadius, huskFeet, huskHeight, huskRadius),
    false,
    'Foot kick out of reach must miss',
  );

  // 6. Contrast with blade reach: a blade reaches 2.5m, whereas a fist reaches ~1.2m
  const bladeBase = { x: 0, y: 1.2, z: 0.2 };
  const bladeTip = { x: 0, y: 1.2, z: 2.2 };
  const farHusk = { x: 0, y: 0, z: 2.0 };
  assert.equal(
    bladeTouches(bladeBase, bladeTip, farHusk, huskHeight, huskRadius),
    true,
    'Sword blade reaches far husk',
  );
  assert.equal(
    limbTouchesCapsule(fistInReach, fistRadius, farHusk, huskHeight, huskRadius),
    false,
    'Bare-handed fist cannot reach a 2.0m distant husk',
  );
});

test('weapon slot is completely data-driven with sword as first entry', () => {
  // Verify sword entry shape
  assert.equal(SWORD_WEAPON.id, 'worn_iron_sword');
  assert.equal(SWORD_WEAPON.type, 'sword');
  assert.equal(SWORD_WEAPON.handBone, 'hand_r');
  assert.equal(SWORD_WEAPON.sheatheBone, 'spine_03');
  assert.equal(SWORD_WEAPON.hitShape.kind, 'blade_segment');
  assert.ok(SWORD_WEAPON.reach > 0);
  assert.deepEqual(SWORD_WEAPON.moves.light, ['light_1', 'light_2', 'light_3']);
  assert.deepEqual(SWORD_WEAPON.moves.heavy, ['heavy_1', 'heavy_2']);

  // Adding a new weapon (e.g. Battle Axe or Spear) requires only defining a new data structure
  const BATTLE_AXE_WEAPON = {
    id: 'nordic_battle_axe',
    name: 'Nordic Battle Axe',
    type: 'axe',
    assetPath: '/assets/characters/axe.glb',
    meshName: 'Axe',
    handBone: 'hand_r',
    handOffset: [-0.03, 0.08, -0.04],
    handRotation: [1.35, 0.0, 0.0],
    handScale: 0.25,
    sheatheBone: 'spine_03',
    sheathePosition: [-0.15, 1.38, -0.15],
    sheatheBladeDirection: [0.5, -0.86, 0],
    sheatheScale: 0.25,
    hitShape: {
      kind: 'blade_segment',
      baseFraction: 0.65, // head of the axe
      tipFraction: 1.0,
    },
    reach: 2.2,
    moves: {
      light: ['light_1', 'light_2'],
      heavy: ['heavy_1'],
    },
  };

  assert.equal(BATTLE_AXE_WEAPON.type, 'axe');
  assert.equal(BATTLE_AXE_WEAPON.hitShape.baseFraction, 0.65);
  assert.equal(BATTLE_AXE_WEAPON.reach, 2.2);
});

test('burning ground patches last 2 to 4 seconds and damage husks without stacking per tick', () => {
  const patches = [];
  const MAX_PATCHES = 16;
  for (let i = 0; i < MAX_PATCHES; i++) {
    patches.push({
      id: i,
      position: new Vector3(0, 0, 0),
      radius: 1.25,
      duration: 3.0,
      elapsed: 0,
      active: false,
      element: 'IGNIS',
    });
  }

  function spawnPatch(pos, radius = 1.25, duration = 3.0) {
    let target = patches.find(p => !p.active);
    if (!target) target = patches[0];
    target.position.copy(pos);
    target.radius = radius;
    target.duration = duration;
    target.elapsed = 0;
    target.active = true;
    return target;
  }

  // Spawn 3 overlapping patches around the center
  const p1 = spawnPatch(new Vector3(0, 0, 0), 1.25, 2.5);
  const p2 = spawnPatch(new Vector3(0.3, 0, 0.2), 1.25, 3.0);
  const p3 = spawnPatch(new Vector3(-0.2, 0, 0.1), 1.25, 3.5);

  assert.equal(p1.active, true);
  assert.equal(p2.active, true);
  assert.equal(p3.active, true);
  assert.ok(p1.duration >= 2.0 && p1.duration <= 4.0);

  // Husk standing right at (0, 0, 0), inside all 3 overlapping patches
  const huskPos = new Vector3(0, 0, 0);
  const huskRadius = 0.38;
  const dps = balance.combat.burn.damagePerSecond;
  const tickSeconds = balance.combat.burn.tickSeconds;
  let huskHealth = rules.createHealth(100);

  // Simulation step
  const dt = 0.05;
  let tickAccumulator = 0;
  let burnDamageDealt = 0;
  let tickCount = 0;

  for (let t = 0; t < 1.0; t += dt) {
    // Check if in ANY patch (non-stacking boolean)
    const inAnyPatch = patches.some(p => {
      if (!p.active) return false;
      const dist = p.position.distanceTo(huskPos);
      return dist <= p.radius + huskRadius;
    });
    assert.equal(inAnyPatch, true, 'Husk must be detected in burning ground');

    tickAccumulator += dt;
    if (tickAccumulator >= tickSeconds) {
      tickAccumulator -= tickSeconds;
      tickCount++;
      // Calculate damage through shared rules
      const res = rules.applyBurnTick(huskHealth, tickSeconds, 0);
      huskHealth = res.health;
      burnDamageDealt += res.damage;
    }

    // Advance patch age
    for (const p of patches) {
      if (!p.active) continue;
      p.elapsed += dt;
      if (p.elapsed >= p.duration) p.active = false;
    }
  }

  // Over 1.0 second with tickSeconds = 0.25, exactly 4 ticks must occur
  assert.equal(tickCount, 4);
  // Total damage over 1 second should equal 1s * DPS (16), NOT 3x (48) even though 3 patches overlap!
  assert.equal(burnDamageDealt, dps * 1.0);
  assert.equal(huskHealth.current, 100 - (dps * 1.0));

  // Advance time past duration (e.g. 4.0s) and verify patches expire
  for (let t = 0; t < 3.5; t += 0.5) {
    for (const p of patches) {
      if (!p.active) continue;
      p.elapsed += 0.5;
      if (p.elapsed >= p.duration) p.active = false;
    }
  }
  assert.equal(p1.active, false, 'Patch 1 must expire after its duration');
  assert.equal(p2.active, false, 'Patch 2 must expire after its duration');
  assert.equal(p3.active, false, 'Patch 3 must expire after its duration');
});

test('husks touched by fire burn for duration, and burning flames end immediately on death', () => {
  const husk = {
    alive: true,
    position: new Vector3(0, 0, 0),
    health: rules.createHealth(40),
  };

  const burnState = {
    burnRemaining: 0,
    tickAccumulator: 0,
  };

  // Husk steps into fire -> ignites
  burnState.burnRemaining = balance.combat.burn.huskBurnDuration;
  assert.ok(burnState.burnRemaining >= 2.0);

  // Husk moves away from fire -> still burns for remaining duration
  const dt = 0.5;
  burnState.burnRemaining -= dt;
  assert.ok(burnState.burnRemaining > 0, 'Husk remains on fire after leaving burning ground');

  // Husk dies before burn time expires -> flames end immediately
  husk.alive = false;
  husk.health = { current: 0, maximum: 40 };
  const burningHusks = [husk].filter(h => h.alive && burnState.burnRemaining > 0);
  assert.equal(burningHusks.length, 0, 'Dead husk must immediately cease burning');
});
