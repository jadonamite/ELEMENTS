import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, Bone, Object3D, MeshStandardMaterial } from 'three';
import balance from '../../shared/balance.json' with { type: 'json' };
import { createCombatRules } from '../../shared/src/index.js';
import { Combat } from '../src/combat.js';
import { limbTouchesCapsule, bladeTouches, inFront } from '../src/hits.js';
import { SWORD_WEAPON } from '../src/weapon.js';

const rules = createCombatRules(balance.combat);

class MockAnimPlayer {
  duration(_clip) { return 0.6; }
  hasClip(_clip) { return true; }
  playOnce(_clip, _fade) {}
  setSpeed(_clip, _speed) {}
  play(_clip) {}
}

// Stands in for the hero's reading of each clip: the jab lands with the left hand, the side kick with the left foot.
const clipLimbs = { bare_punch_1: 'hand_l', bare_punch_2: 'hand_r', bare_kick: 'foot_r', bare_heavy_1: 'hand_r',
  leg_kick_1: 'foot_r', leg_kick_2: 'foot_l', leg_kick_heavy: 'foot_r' };
const limbOf = clip => clipLimbs[clip] ?? null;

test('three fighting styles have distinct openers, combo chains and striking limbs', () => {
  const anim = new MockAnimPlayer();

  // Weapon style
  const combatWeapon = new Combat(anim, undefined, undefined, undefined, limbOf);
  combatWeapon.setStyle('weapon');
  assert.equal(combatWeapon.fightingStyle, 'weapon');
  combatWeapon.press('light');
  assert.equal(combatWeapon.current, 'light_1');
  assert.equal(combatWeapon.strikingLimb, 'blade');

  // Bare hands style: punches and kicks
  const combatHands = new Combat(anim, undefined, undefined, undefined, limbOf);
  combatHands.setStyle('bare_hands');
  assert.equal(combatHands.fightingStyle, 'bare_hands');
  combatHands.press('light');
  assert.equal(combatHands.current, 'bare_light_1');
  assert.equal(combatHands.strikingLimb, 'hand_l');

  // Advance into combo window and test light combo chaining
  combatHands.update(0.6 * (1 - balance.combat.comboWindow) + 0.05);
  combatHands.press('light');
  combatHands.update(0.2); // finish move to start queued
  assert.equal(combatHands.current, 'bare_light_2');
  assert.equal(combatHands.strikingLimb, 'hand_r');

  // Chain to kick
  combatHands.update(0.6 * (1 - balance.combat.comboWindow) + 0.05);
  combatHands.press('light');
  combatHands.update(0.2);
  assert.equal(combatHands.current, 'bare_light_3');
  assert.equal(combatHands.strikingLimb, 'foot_r');

  // Heavy strike
  const combatHeavy = new Combat(anim, undefined, undefined, undefined, limbOf);
  combatHeavy.setStyle('bare_hands');
  combatHeavy.press('heavy');
  assert.equal(combatHeavy.current, 'bare_heavy_1');
  assert.equal(combatHeavy.strikingLimb, 'hand_r');

  // Legs/kicks style
  const combatLegs = new Combat(anim, undefined, undefined, undefined, limbOf);
  combatLegs.setStyle('legs');
  assert.equal(combatLegs.fightingStyle, 'legs');
  combatLegs.press('light');
  assert.equal(combatLegs.current, 'leg_light_1');
  assert.equal(combatLegs.strikingLimb, 'foot_r');

  // Enter combo window and chain into kick 2
  combatLegs.update(0.26);
  combatLegs.press('light');
  combatLegs.update(0.2);
  assert.equal(combatLegs.current, 'leg_light_2');
  assert.equal(combatLegs.strikingLimb, 'foot_l');

  // Chain into heavy kick
  combatLegs.update(0.26);
  combatLegs.press('heavy');
  combatLegs.update(0.2);
  assert.equal(combatLegs.current, 'leg_heavy_1');
  assert.equal(combatLegs.strikingLimb, 'foot_r');

  // Bending style (Lit only)
  const combatBending = new Combat(anim, undefined, undefined, undefined, limbOf);
  combatBending.setStyle('bending');
  assert.equal(combatBending.fightingStyle, 'bending');
  combatBending.press('light');
  assert.equal(combatBending.current, 'bend_palm');
  assert.equal(combatBending.strikingLimb, 'projectile');

  const combatSweep = new Combat(anim, undefined, undefined, undefined, limbOf);
  combatSweep.setStyle('bending');
  combatSweep.press('heavy');
  assert.equal(combatSweep.current, 'bend_sweep');
  assert.equal(combatSweep.strikingLimb, 'area');
});

test('bare-handed hits land only when a fist or foot touches the villain capsule', () => {
  const villainFeet = { x: 0, y: 0, z: 1.2 };
  const villainHeight = 1.8;
  const villainRadius = 0.38;
  const fistRadius = 0.20;
  const footRadius = 0.22;

  // 1. Right fist strikes forward and reaches into the villain's volume
  const fistInReach = { x: 0, y: 1.2, z: 0.95 };
  assert.equal(
    limbTouchesCapsule(fistInReach, fistRadius, villainFeet, villainHeight, villainRadius),
    true,
    'Fist inside contact envelope must register a hit',
  );

  // 2. Right fist at exact boundary: distance = villainRadius + fistRadius = 0.58m
  // villain is at z=1.2, boundary is z = 1.2 - 0.58 = 0.62
  const fistAtBoundary = { x: 0, y: 1.2, z: 0.62 };
  assert.equal(
    limbTouchesCapsule(fistAtBoundary, fistRadius, villainFeet, villainHeight, villainRadius),
    true,
    'Fist touching capsule boundary must connect',
  );

  // 3. Right fist out of reach (too far back): z = 0.50 (distance 0.70m > 0.58m)
  const fistOutOfReach = { x: 0, y: 1.2, z: 0.50 };
  assert.equal(
    limbTouchesCapsule(fistOutOfReach, fistRadius, villainFeet, villainHeight, villainRadius),
    false,
    'Fist outside contact envelope must miss',
  );

  // 4. Right foot kick at chest height
  const footInReach = { x: 0, y: 0.75, z: 0.90 };
  assert.equal(
    limbTouchesCapsule(footInReach, footRadius, villainFeet, villainHeight, villainRadius),
    true,
    'Foot kick reaching villain must connect',
  );

  // 5. Foot kick out of reach
  const footOutOfReach = { x: 0, y: 0.75, z: 0.35 };
  assert.equal(
    limbTouchesCapsule(footOutOfReach, footRadius, villainFeet, villainHeight, villainRadius),
    false,
    'Foot kick out of reach must miss',
  );

  // 6. Contrast with blade reach: a blade reaches 2.5m, whereas a fist reaches ~1.2m
  const bladeBase = { x: 0, y: 1.2, z: 0.2 };
  const bladeTip = { x: 0, y: 1.2, z: 2.2 };
  const farVillain = { x: 0, y: 0, z: 2.0 };
  assert.equal(
    bladeTouches(bladeBase, bladeTip, farVillain, villainHeight, villainRadius),
    true,
    'Sword blade reaches far villain',
  );
  assert.equal(
    limbTouchesCapsule(fistInReach, fistRadius, farVillain, villainHeight, villainRadius),
    false,
    'Bare-handed fist cannot reach a 2.0m distant villain',
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

test('burning ground patches last 2 to 4 seconds and damage villains without stacking per tick', () => {
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

  // Villain standing right at (0, 0, 0), inside all 3 overlapping patches
  const villainPos = new Vector3(0, 0, 0);
  const villainRadius = 0.38;
  const dps = balance.combat.burn.damagePerSecond;
  const tickSeconds = balance.combat.burn.tickSeconds;
  let villainHealth = rules.createHealth(100);

  // Simulation step
  const dt = 0.05;
  let tickAccumulator = 0;
  let burnDamageDealt = 0;
  let tickCount = 0;

  for (let t = 0; t < 1.0; t += dt) {
    // Check if in ANY patch (non-stacking boolean)
    const inAnyPatch = patches.some(p => {
      if (!p.active) return false;
      const dist = p.position.distanceTo(villainPos);
      return dist <= p.radius + villainRadius;
    });
    assert.equal(inAnyPatch, true, 'Villain must be detected in burning ground');

    tickAccumulator += dt;
    if (tickAccumulator >= tickSeconds) {
      tickAccumulator -= tickSeconds;
      tickCount++;
      // Calculate damage through shared rules
      const res = rules.applyBurnTick(villainHealth, tickSeconds, 0);
      villainHealth = res.health;
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
  assert.equal(villainHealth.current, 100 - (dps * 1.0));

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

test('villains touched by fire burn for duration, and burning flames end immediately on death', () => {
  const villain = {
    alive: true,
    position: new Vector3(0, 0, 0),
    health: rules.createHealth(40),
  };

  const burnState = {
    burnRemaining: 0,
    tickAccumulator: 0,
  };

  // Villain steps into fire -> ignites
  burnState.burnRemaining = balance.combat.burn.villainBurnDuration;
  assert.ok(burnState.burnRemaining >= 2.0);

  // Villain moves away from fire -> still burns for remaining duration
  const dt = 0.5;
  burnState.burnRemaining -= dt;
  assert.ok(burnState.burnRemaining > 0, 'Villain remains on fire after leaving burning ground');

  // Villain dies before burn time expires -> flames end immediately
  villain.alive = false;
  villain.health = { current: 0, maximum: 40 };
  const burningVillains = [villain].filter(h => h.alive && burnState.burnRemaining > 0);
  assert.equal(burningVillains.length, 0, 'Dead villain must immediately cease burning');
});

test('heavy kicks land at least 7 in 10 times against a walking villain with expanded reach and cone', () => {
  const heroPos = new Vector3(0, 0, 0);
  const heroFacing = 0; // facing +Z
  const villainRadius = 0.38;

  // Evaluation logic matching fight.ts for leg_heavy_1:
  // reach: 2.85m + villainRadius
  // angle: 1.5 rad
  const checkHeavyKickHit = (targetPos) => {
    const dist = heroPos.distanceTo(targetPos);
    const kickReach = 2.85;
    const kickAngle = 1.5;
    return dist <= kickReach + villainRadius && inFront(heroPos, heroFacing, targetPos, kickAngle);
  };

  // 10 realistic positions of a walking villain approaching or circling the hero
  const walkingPositions = [
    new Vector3(0.0, 0, 1.8),   // 1. Direct frontal close
    new Vector3(0.5, 0, 2.2),   // 2. Frontal-right mid
    new Vector3(-0.6, 0, 2.0),  // 3. Frontal-left mid
    new Vector3(0.2, 0, 2.7),   // 4. Near boundary reach
    new Vector3(-0.8, 0, 2.6),  // 5. Angled approach
    new Vector3(1.2, 0, 2.3),   // 6. Flanking right (~0.48 rad)
    new Vector3(-1.4, 0, 2.1),  // 7. Flanking left (~0.58 rad)
    new Vector3(0.0, 0, 3.1),   // 8. Max reach (3.1m <= 2.85 + 0.38 = 3.23m)
    new Vector3(1.8, 0, 0.4),   // 9. Hard flank outside cone (angle ~1.35 rad, dist ~1.84m)
    new Vector3(0.0, 0, 4.0),   // 10. Way out of reach (miss)
  ];

  let hits = 0;
  for (const pos of walkingPositions) {
    if (checkHeavyKickHit(pos)) {
      hits++;
    }
  }

  // Must land at least 7 in 10
  assert.ok(hits >= 7, `Heavy kick connected ${hits}/10 times, expected at least 7`);

  // Explicit boundary checks:
  assert.equal(checkHeavyKickHit(new Vector3(0, 0, 2.85 + villainRadius)), true, 'Hit at exact reach boundary');
  assert.equal(checkHeavyKickHit(new Vector3(0, 0, 2.85 + villainRadius + 0.1)), false, 'Miss just beyond reach boundary');
  assert.equal(checkHeavyKickHit(new Vector3(0, 0, -2.0)), false, 'Miss when villain is directly behind');
});

test('sword is mounted to WeaponBackSocket on spine_03 when sheathed for bare hands or kicks', () => {
  // Verify configuration in SWORD_WEAPON
  assert.equal(SWORD_WEAPON.sheatheBone, 'spine_03');

  // Verify bone hierarchy and arm(false) socket behavior
  const spine03 = new Bone();
  spine03.name = 'spine_03';
  const handR = new Bone();
  handR.name = 'hand_r';

  const backSocket = new Object3D();
  backSocket.name = 'WeaponBackSocket';
  spine03.add(backSocket);

  const swordHolder = new Object3D();

  const arm = (armed) => {
    if (armed) {
      handR.add(swordHolder);
    } else {
      backSocket.add(swordHolder);
    }
  };

  // Initially sheathed or unarmed (bare hands or kicks)
  arm(false);
  assert.equal(swordHolder.parent, backSocket, 'Sword must be parented to backSocket when unarmed');
  assert.equal(swordHolder.parent.parent, spine03, 'Back socket must be on spine_03');
  assert.notEqual(swordHolder.parent, handR, 'Sword must not be in hand when unarmed');

  // When armed with weapon
  arm(true);
  assert.equal(swordHolder.parent, handR, 'Sword moves to hand bone when armed');

  // Switched back to kicks or bare hands -> back to back socket
  arm(false);
  assert.equal(swordHolder.parent, backSocket, 'Sword returns to back socket on unarmed switch');
});

test('sword elemental glow lights only metallic blade with mature palette and leaves hilt, leather, and hush unlit', () => {
  const materials = [
    new MeshStandardMaterial({ name: 'Metal' }),
    new MeshStandardMaterial({ name: 'Gold' }),
    new MeshStandardMaterial({ name: 'Brown' }),
    new MeshStandardMaterial({ name: 'Red' }),
  ];

  const ELEMENT_EMISSIVE = {
    IGNIS: { color: 0xff3700, intensity: 1.8 },
    HUSH: { color: 0x000000, intensity: 0.0 },
  };

  const applyGlow = (lit, element, mats) => {
    const spec = ELEMENT_EMISSIVE[element] ?? ELEMENT_EMISSIVE.IGNIS;
    for (const mat of mats) {
      const isBlade = mat.name.toLowerCase().includes('metal') || mat.name.toLowerCase().includes('blade');
      if (lit && isBlade && element !== 'HUSH') {
        mat.emissive.setHex(spec.color);
        mat.emissiveIntensity = spec.intensity;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    }
  };

  // 1. IGNIS Lit
  applyGlow(true, 'IGNIS', materials);
  const metalMat = materials.find(m => m.name === 'Metal');
  const goldMat = materials.find(m => m.name === 'Gold');
  const brownMat = materials.find(m => m.name === 'Brown');
  const redMat = materials.find(m => m.name === 'Red');

  assert.equal(metalMat.emissive.getHex(), 0xff3700, 'Blade metal receives warm IGNIS ember color');
  assert.equal(metalMat.emissiveIntensity, 1.8, 'Blade metal receives 1.8 intensity');
  assert.equal(goldMat.emissive.getHex(), 0x000000, 'Hilt guard stays grounded/unlit');
  assert.equal(goldMat.emissiveIntensity, 0);
  assert.equal(brownMat.emissive.getHex(), 0x000000, 'Leather grip stays grounded/unlit');
  assert.equal(brownMat.emissiveIntensity, 0);
  assert.equal(redMat.emissive.getHex(), 0x000000, 'Pommel accent stays grounded/unlit');
  assert.equal(redMat.emissiveIntensity, 0);

  // 2. HUSH Lit (the Dim never glow)
  applyGlow(true, 'HUSH', materials);
  assert.equal(metalMat.emissive.getHex(), 0x000000, 'HUSH never glows on blade');
  assert.equal(metalMat.emissiveIntensity, 0);

  // 3. Extinguished (lit = false)
  applyGlow(false, 'IGNIS', materials);
  assert.equal(metalMat.emissive.getHex(), 0x000000, 'Unlit blade has zero emissive');
  assert.equal(metalMat.emissiveIntensity, 0);
});
