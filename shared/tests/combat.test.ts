import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCombatRules, ELEMENTS } from '../src/index.js';
import type { CombatBalance, Combatant, HitInput, MoveId } from '../src/index.js';

const balance: { combat: CombatBalance } = JSON.parse(await readFile(new URL('../balance.json', import.meta.url), 'utf8'));
// The cap is pinned here so the cap tests do not move with tuning.
const combat = createCombatRules({ ...balance.combat, rules: { ...balance.combat.rules, maxDamagePerSecond: 100 } });
const fighter = (element: Combatant['element'] = 'IGNIS'): Combatant => ({
  element, position: { x: 0, y: 0, z: 0 }, health: combat.createHealth(), armour: balance.combat.rules.defaultArmour,
});
const mv = (id: MoveId) => combat.moveFor(id, combat.defaultKit());
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

test('no fixed counter cycle: every element takes the same damage from a move', () => {
  for (const element of ELEMENTS) assert.equal(accepted(input({ target: fighter(element) })).damage, mv('light_1').damage);
  assert.equal(combat.calculateDamage(100, 0), 100);
});

test('situational counters: off by default and yields neutral 1.0 multiplier', () => {
  // By default, situationalCounters.enabled is false in balance.json
  assert.equal(combat.situationalCounters?.enabled, false);
  const aquesKit = combat.defaultKit('AQUES');
  const aquesDamage = combat.moveFor('light_1', aquesKit).damage;
  const wetHit = accepted(input({
    attacker: fighter('AQUES'),
    target: fighter('IGNIS'),
    situation: { terrain: 'wet', weather: 'rain' },
  }));
  assert.equal(wetHit.damage, aquesDamage);
  assert.equal(combat.calculateSituationalMultiplier('AQUES', 'IGNIS', { terrain: 'wet' }), 1);
});

test('situational counters: edge applies when enabled and conditions match, and no element always beats another', () => {
  const enabledCombat = createCombatRules({
    ...balance.combat,
    rules: { ...balance.combat.rules, maxDamagePerSecond: 100 },
    situationalCounters: {
      ...balance.combat.situationalCounters!,
      enabled: true,
    },
  });

  // 1. AQUES gets edge over IGNIS in wet terrain / rain
  assert.equal(enabledCombat.calculateSituationalMultiplier('AQUES', 'IGNIS', { terrain: 'wet' }), 1.15);
  assert.equal(enabledCombat.calculateSituationalMultiplier('AQUES', 'IGNIS', { weather: 'rain' }), 1.15);
  // Without wet/rain, AQUES has no edge over IGNIS
  assert.equal(enabledCombat.calculateSituationalMultiplier('AQUES', 'IGNIS', { terrain: 'volcanic' }), 1);

  // 2. IGNIS gets edge over AURA in volcanic / ash
  assert.equal(enabledCombat.calculateSituationalMultiplier('IGNIS', 'AURA', { terrain: 'volcanic' }), 1.15);
  assert.equal(enabledCombat.calculateSituationalMultiplier('IGNIS', 'AURA', { weather: 'ash' }), 1.15);
  assert.equal(enabledCombat.calculateSituationalMultiplier('IGNIS', 'AURA', { terrain: 'wet' }), 1);

  // 3. AURA gets edge over TERRA in elevated / gale
  assert.equal(enabledCombat.calculateSituationalMultiplier('AURA', 'TERRA', { terrain: 'elevated' }), 1.15);
  assert.equal(enabledCombat.calculateSituationalMultiplier('AURA', 'TERRA', { weather: 'gale' }), 1.15);
  assert.equal(enabledCombat.calculateSituationalMultiplier('AURA', 'TERRA', { terrain: 'rocky' }), 1);

  // 4. TERRA gets edge over AQUES in rocky / drought
  assert.equal(enabledCombat.calculateSituationalMultiplier('TERRA', 'AQUES', { terrain: 'rocky' }), 1.15);
  assert.equal(enabledCombat.calculateSituationalMultiplier('TERRA', 'AQUES', { weather: 'drought' }), 1.15);
  assert.equal(enabledCombat.calculateSituationalMultiplier('TERRA', 'AQUES', { terrain: 'wet' }), 1);

  // 5. Check hit application: damage increases by edgeMultiplier
  const aquesKit = enabledCombat.defaultKit('AQUES');
  const baseDmg = enabledCombat.moveFor('light_1', aquesKit).damage;
  const hitRes = enabledCombat.checkHit({
    attacker: fighter('AQUES'),
    target: fighter('IGNIS'),
    moveId: 'light_1',
    now: 0,
    state: enabledCombat.createActionState(),
    situation: { terrain: 'wet' },
  });
  assert.equal(hitRes.accepted, true);
  if (hitRes.accepted) {
    assert.equal(hitRes.damage, baseDmg * 1.15);
  }
});

test('armour reduces damage and lethal damage clamps health to zero without mutation', () => {
  assert.equal(combat.calculateDamage(100, balance.combat.rules.armourScale), 50);
  const target = { ...fighter(), health: { current: 1, maximum: 100 } };
  const result = accepted(input({ target }));
  assert.equal(result.damage, 1);
  assert.equal(combat.isDead(result.target.health), true);
  assert.equal(target.health.current, 1);
  rejects(input({ target: result.target }), 'target_dead');
  rejects(input({ attacker: { ...fighter(), health: { current: 0, maximum: 100 } } }), 'attacker_dead');
});

test('reach uses all three position axes and accepts the exact boundary', () => {
  const reach = mv('light_1').reach;
  accepted(input({ target: { ...fighter(), position: { x: 0, y: reach, z: 0 } } }));
  rejects(input({ target: { ...fighter(), position: { x: reach, y: reach, z: 0 } } }), 'out_of_reach');
});

test('accepted hits consume move cooldown at time zero and exact expiry is ready', () => {
  const first = accepted(input());
  const cooldown = mv('light_1').cooldownSeconds;
  rejects(input({ state: first.state, now: cooldown / 2 }), 'cooldown');
  assert.equal(combat.cooldownRemaining('light_1', first.state, cooldown), 0);
  accepted(input({ state: first.state, now: cooldown }));
  assert.equal(combat.cooldownRemaining('heavy_1', first.state, 0), 0);
  rejects(input({ state: first.state, now: -1 }), 'invalid_input');
  const later = accepted(input({ now: 10 }));
  rejects(input({ state: later.state, now: 9 }), 'clock_reversed');
});

test('rolling damage cap spans moves and targets and expires at the window boundary', () => {
  const first = accepted(input({ moveId: 'ultimate' }));
  assert.equal(first.state.damageHistory[0]?.damage, mv('ultimate').damage);
  rejects(input({ target: fighter('TERRA'), moveId: 'heavy_1', state: first.state }), 'damage_cap');
  accepted(input({ state: first.state, now: balance.combat.rules.damageWindowSeconds }));
  // Armour and low remaining health cannot hide damage from the cap.
  const tiny = { ...fighter('AURA'), armour: 1000, health: { current: 1, maximum: 100 } };
  const armoured = accepted(input({ target: tiny, moveId: 'ultimate' }));
  assert.equal(armoured.state.damageHistory[0]?.damage, mv('ultimate').damage);
  rejects(input({ state: armoured.state, moveId: 'light_2' }), 'damage_cap');
});

test('expired damage events are removed when the next accepted action records state', () => {
  const first = accepted(input({ moveId: 'dash_strike' }));
  const now = balance.combat.rules.damageWindowSeconds;
  const next = accepted(input({ state: first.state, now, moveId: 'light_1' }));
  assert.deepEqual(next.state.damageHistory, [{ at: now, damage: mv('light_1').damage }]);
  assert.equal(next.state.lastActionAt, now);
});

test('a single oversized move is rejected using balance, never a damage claim', () => {
  const tuning = structuredClone(balance.combat);
  (tuning.weapons.sword.light_1 as { damage: number }).damage = 1000;
  (tuning.rules as { maxDamagePerSecond: number }).maxDamagePerSecond = 100;
  const result = createCombatRules(tuning).checkHit(input());
  assert.deepEqual(result, { accepted: false, reason: 'damage_cap' });
  const withClaim = { ...input(), claimedDamage: 1000000 };
  assert.equal(accepted(withClaim).damage, mv('light_1').damage);
});

test('unknown moves and dodge hits are rejected; the Hush never bend and only the Hush throw sparks', () => {
  rejects(input({ moveId: 'heavy_3' }), 'unknown_move');
  rejects(input({ moveId: 'toString' }), 'unknown_move');
  rejects(input({ moveId: 'dodge' }), 'not_attack');
  rejects(input({ moveId: 'shard_spark' }), 'wrong_element');
  rejects(input({ moveId: 'bend_palm', attacker: { ...fighter(), hush: true } }), 'wrong_element');
  accepted(input({ moveId: 'shard_spark', attacker: { ...fighter('AQUES'), hush: true } }));
});

test('nonfinite and invalid values fail before updating health or state', () => {
  for (const number of [NaN, Infinity, -Infinity]) {
    rejects(input({ now: number }), 'invalid_input');
    rejects(input({ target: { ...fighter(), position: { x: number, y: 0, z: 0 } } }), 'invalid_input');
    rejects(input({ target: { ...fighter(), armour: number } }), 'invalid_input');
    rejects(input({ target: { ...fighter(), health: { current: number, maximum: 100 } } }), 'invalid_input');
    rejects(input({ state: { lastActionAt: 0, cooldowns: { light_1: number }, damageHistory: [] } }), 'invalid_input');
    rejects(input({ state: { lastActionAt: 0, cooldowns: {}, damageHistory: [{ at: 0, damage: number }] } }), 'invalid_input');
    assert.throws(() => combat.calculateDamage(number, 0), RangeError);
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
  (tuning.weapons.sword.light_1 as { damage: number }).damage = 10000;
  assert.equal(isolated.checkHit(before).accepted, true);
});

test('dodge consumes its own cooldown, preserves hit history, rejects reverse clocks', () => {
  const first = accepted(input());
  const dodge = combat.useDodge(first.state, 0);
  assert.equal(dodge.accepted, true);
  if (!dodge.accepted) return;
  assert.deepEqual(dodge.state.damageHistory, first.state.damageHistory);
  assert.deepEqual(combat.useDodge(dodge.state, 0), { accepted: false, reason: 'cooldown' });
  assert.equal(combat.useDodge(dodge.state, mv('dodge').cooldownSeconds).accepted, true);
  const later = combat.useDodge(combat.createActionState(), 10);
  if (later.accepted) assert.deepEqual(combat.useDodge(later.state, 9), { accepted: false, reason: 'clock_reversed' });
});

test('invalid tuning throws on startup', () => {
  const bad = structuredClone(balance.combat);
  (bad.rules as { damageWindowSeconds: number }).damageWindowSeconds = 0;
  assert.throws(() => createCombatRules(bad), RangeError);
  const badMove = structuredClone(balance.combat);
  (badMove.weapons.sword.light_1 as { cooldownSeconds: number }).cooldownSeconds = Infinity;
  assert.throws(() => createCombatRules(badMove), RangeError);
});

test('one swing touching several targets is one action, a new swing waits for the cooldown', () => {
  const first = accepted(input({ now: 0.2, swingAt: 0 }));
  assert.equal(first.state.cooldowns.light_1, 0);
  const second = accepted(input({ target: fighter('TERRA'), state: first.state, now: 0.25, swingAt: 0 }));
  rejects(input({ state: second.state, now: 0.3, swingAt: 0.3 }), 'cooldown');
  const cooldown = mv('light_1').cooldownSeconds;
  accepted(input({ state: second.state, now: cooldown + 0.1, swingAt: cooldown }));
  rejects(input({ now: 1, swingAt: 2 }), 'invalid_input');
});

test('startMove consumes cooldown immediately on press, a miss preserves cooldown, and swing connects with multiple targets', () => {
  const state0 = combat.createActionState();
  const start = combat.startMove(state0, 'uppercut', 1.0);
  assert.equal(start.accepted, true);
  if (!start.accepted) return;
  assert.equal(start.state.cooldowns.uppercut, 1.0);
  assert.equal(combat.cooldownRemaining('uppercut', start.state, 1.0), mv('uppercut').cooldownSeconds);

  // Immediate retry on press is rejected
  const retry = combat.startMove(start.state, 'uppercut', 1.5);
  assert.deepEqual(retry, { accepted: false, reason: 'cooldown' });

  // Move connects at 1.2s: same swing touches target 1 and target 2
  const hit1 = combat.checkHit({
    attacker: fighter('IGNIS'),
    target: fighter('TERRA'),
    moveId: 'uppercut',
    now: 1.2,
    swingAt: 1.0,
    state: start.state,
  });
  assert.equal(hit1.accepted, true);
  if (!hit1.accepted) return;
  assert.equal(hit1.state.cooldowns.uppercut, 1.0);

  const hit2 = combat.checkHit({
    attacker: fighter('IGNIS'),
    target: fighter('AURA'),
    moveId: 'uppercut',
    now: 1.25,
    swingAt: 1.0,
    state: hit1.state,
  });
  assert.equal(hit2.accepted, true);

  // New swing before cooldown expires is rejected
  const newSwingHit = combat.checkHit({
    attacker: fighter('IGNIS'),
    target: fighter('TERRA'),
    moveId: 'uppercut',
    now: 2.0,
    swingAt: 2.0,
    state: hit2.state,
  });
  assert.deepEqual(newSwingHit, { accepted: false, reason: 'cooldown' });
});

test('lit perks: +60% damage respects rolling damage cap, and cooldown recovers with lit multiplier', () => {
  const unlitHit = accepted(input({ moveId: 'uppercut' }));
  const litHit = accepted(input({ moveId: 'uppercut', isLit: true }));
  const expectedLitDamage = mv('uppercut').damage * 1.6;
  assert.equal(litHit.damage, expectedLitDamage);
  assert.equal(litHit.damage, unlitHit.damage * 1.6);

  // Lit damage is bounded by maxDamagePerSecond (pinned at 100 in combat fixture)
  // ultimate base damage 90 * 1.6 = 144 > 100 -> rejected by cap
  const capHit = combat.checkHit(input({ moveId: 'ultimate', isLit: true }));
  assert.deepEqual(capHit, { accepted: false, reason: 'damage_cap' });

  // Lit cooldown multiplier
  const state = combat.createActionState();
  const start = combat.startMove(state, 'uppercut', 0, true);
  assert.equal(start.accepted, true);
  if (!start.accepted) return;
  const normalCd = mv('uppercut').cooldownSeconds;
  const litCd = normalCd * 0.7;
  assert.equal(combat.cooldownRemaining('uppercut', start.state, litCd, true), 0);
  assert.ok(combat.cooldownRemaining('uppercut', start.state, litCd, false) > 0);
});

test('burn rules: calculateBurnDamage and applyBurnTick respect DPS and armour', () => {
  assert.ok(combat.burn);
  assert.equal(combat.burn.damagePerSecond, balance.combat.burn!.damagePerSecond);
  assert.equal(combat.calculateBurnDamage(1.0, 0), combat.burn.damagePerSecond);
  assert.equal(combat.calculateBurnDamage(1.0, balance.combat.rules.armourScale), combat.burn.damagePerSecond * 0.5);
  const tick1 = combat.applyBurnTick(combat.createHealth(30), 0.5, 0);
  assert.equal(tick1.damage, combat.burn.damagePerSecond * 0.5);
  assert.equal(tick1.health.current, 30 - combat.burn.damagePerSecond * 0.5);
  const fatalTick = combat.applyBurnTick(combat.createHealth(5), 1.0, 0);
  assert.equal(fatalTick.damage, 5);
  assert.equal(combat.isDead(fatalTick.health), true);
});

test('bare-handed and bending moves execute through checkHit and starter moves definitions', () => {
  // Bare-handed light punch
  const punchHit = accepted(input({ moveId: 'bare_light_1' }));
  assert.equal(punchHit.damage, mv('bare_light_1').damage);

  // Bare-handed kick
  const kickHit = accepted(input({ moveId: 'bare_light_3' }));
  assert.equal(kickHit.damage, mv('bare_light_3').damage);

  // Bending palm thrust
  const palmHit = accepted(input({ moveId: 'bend_palm' }));
  assert.equal(palmHit.damage, mv('bend_palm').damage);

  // Bending sweep
  const sweepHit = accepted(input({ moveId: 'bend_sweep' }));
  assert.equal(sweepHit.damage, mv('bend_sweep').damage);
});

test('moves take their numbers from the element and the weapon', () => {
  const axe = { ...fighter('TERRA') };
  assert.equal(accepted(input({ attacker: axe })).damage, balance.combat.weapons.axe.light_1.damage);
  assert.equal(accepted(input({ attacker: { ...fighter('AURA'), weapon: 'spear' } })).damage, balance.combat.weapons.spear.light_1.damage);
  for (const element of ELEMENTS) {
    assert.equal(combat.moveFor('bend_palm', { element, weapon: 'sword' }).damage, balance.combat.elements[element].bend_palm.damage);
  }
  rejects(input({ moveId: 'dash_strike', attacker: fighter('AQUES') }), 'not_attack');
  const spark = combat.moveFor('shard_spark', { element: 'TERRA', weapon: 'axe', hush: true });
  assert.equal(spark.damage, balance.combat.elements.TERRA.bend_palm.damage * balance.combat.shardSpark.damageScale);
});

test('meter: bending never needs it, an empty bar is weaker, heavy bending drains it, chains cost and skip cooldown', () => {
  const m = balance.combat.meter;
  assert.deepEqual(combat.spendBend(0, 'bend_palm'), { meter: 0, strength: m.weakScale });
  assert.deepEqual(combat.spendBend(100, 'bend_palm'), { meter: 100, strength: 1 });
  assert.deepEqual(combat.spendBend(100, 'uppercut'), { meter: 100 - m.costs.uppercut, strength: 1 });
  assert.equal(combat.spendBend(10, 'uppercut').strength, m.weakScale);
  assert.equal(combat.spendBend(10, 'uppercut').meter, 0);
  assert.equal(combat.meterGain(95, 'hit'), 100);
  assert.equal(combat.meterDrain(50, m.drainDelay - 0.1, 1), 50);
  assert.equal(combat.meterDrain(50, m.drainDelay, 1), 50 - m.drainPerSecond);
  assert.equal(combat.chainBend(m.chainCost - 1, 1, 7), null);
  assert.equal(combat.chainBend(100, 1, 3), null);
  assert.deepEqual(combat.chainBend(100, 2, 4), { meter: 100 - m.chainCost, damageScale: (1 + m.chainBonus) ** 2 });
  const start = combat.startMove(combat.createActionState(), 'uppercut', 0);
  assert.equal(start.accepted, true);
  if (!start.accepted) return;
  assert.deepEqual(combat.startMove(start.state, 'uppercut', 0.5), { accepted: false, reason: 'cooldown' });
  assert.equal(combat.startMove(start.state, 'uppercut', 0.5, false, combat.defaultKit(), true).accepted, true);
  assert.equal(combat.startMove(start.state, 'light_1', 0.5, false, combat.defaultKit(), true).accepted, true);
  const hit = accepted(input({ moveId: 'uppercut', state: start.state, now: 0.6, chained: true, bendScale: 1.15 }));
  assert.equal(hit.damage, mv('uppercut').damage * 1.15);
});

test('tiers gate moves in order and strengthen bending at 6 and 7', () => {
  assert.equal(combat.tierAllows('light_1', 1), true);
  assert.equal(combat.tierAllows('heavy_1', 1), false);
  assert.equal(combat.tierAllows('light_3', 3), false);
  assert.equal(combat.tierAllows('chain', 4), true);
  assert.equal(combat.tierAllows('ultimate', 4), false);
  assert.equal(combat.tierAllows('ultimate', 5), true);
  assert.equal(combat.tierBendScale(5), 1);
  assert.equal(combat.tierBendScale(6), 1.25);
  assert.equal(combat.tierBendScale(7), 1.5);
  assert.equal(combat.tierNames.length, 7);
});

test('the Hush get the wider parry window and longer stagger', () => {
  assert.ok(combat.parryWindow(true) > combat.parryWindow(false));
  assert.ok(combat.parryStagger(true) > combat.parryStagger(false));
});

test('staff is a weapon in shared rules and default nation weapon for AURA', () => {
  assert.equal(combat.defaultKit('AURA').weapon, 'staff');
  const staffMove = combat.moveFor('light_1', { element: 'AURA', weapon: 'staff' });
  assert.equal(staffMove.damage, balance.combat.weapons.staff.light_1.damage);
  assert.equal(staffMove.reach, balance.combat.weapons.staff.light_1.reach);
  assert.equal(staffMove.cooldownSeconds, balance.combat.weapons.staff.light_1.cooldownSeconds);
});

test('AURA kit with a staff passes bendWithWeapon and with a sword does not', () => {
  assert.equal(combat.canBendWithWeapon({ element: 'AURA', weapon: 'staff' }), true);
  assert.equal(combat.canBendWithWeapon({ element: 'AURA', weapon: 'sword' }), false);
  assert.equal(combat.canBendWithWeapon({ element: 'IGNIS', weapon: 'sword' }), true);
  assert.equal(combat.canBendWithWeapon({ element: 'AQUES', weapon: 'spear' }), false);
  assert.equal(combat.canBendWithWeapon({ element: 'TERRA', weapon: 'axe' }), false);
});

test('moon tide: +20% damage for AQUES when isFullMoon is true', () => {
  const aquesKit = combat.defaultKit('AQUES');
  const baseDamage = combat.moveFor('light_1', aquesKit).damage;
  const normalHit = accepted(input({ attacker: fighter('AQUES'), target: fighter('IGNIS'), situation: { isFullMoon: false } }));
  assert.equal(normalHit.damage, baseDamage);

  const surgeHit = accepted(input({ attacker: fighter('AQUES'), target: fighter('IGNIS'), situation: { isFullMoon: true } }));
  assert.equal(surgeHit.damage, Math.round(baseDamage * 1.2));

  // Other elements do not receive the lunar surge
  const ignisHit = accepted(input({ attacker: fighter('IGNIS'), target: fighter('AURA'), situation: { isFullMoon: true } }));
  assert.equal(ignisHit.damage, mv('light_1').damage);
});

test('scars cap healing: inflictScars adds scars and heal cannot exceed maximum minus scars', () => {
  const initial = combat.createHealth(100);
  assert.equal(initial.maximum, 100);
  assert.equal(initial.current, 100);
  assert.equal(initial.scars, 0);

  const damaged = { ...initial, current: 40 };
  const scarred = combat.inflictScars(damaged, 30);
  assert.equal(scarred.scars, 30);
  assert.equal(scarred.current, 40);

  // Attempting to heal for 50 only heals up to 100 - 30 = 70
  const healed = combat.heal(scarred, 50);
  assert.equal(healed.current, 70);

  // Healing further is capped at 70
  const overHealed = combat.heal(healed, 50);
  assert.equal(overHealed.current, 70);
});

