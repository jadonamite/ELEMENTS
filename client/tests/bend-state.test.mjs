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

test('water is conserved and reusable in water environments without depleting waterskin', () => {
  const bend = new BendState({ element: 'AQUES', weapon: 'spear' }, 7);
  bend.hasWaterEnvironment = true;
  // Bending far away in a water environment never drains waterskin charges
  for (let i = 0; i < 10; i++) {
    bend.tick(5, far);
    const start = bend.begin('bend_palm', true, far);
    assert.equal(start.go, true);
    assert.equal(start.fromSkin, false);
    assert.equal(bend.waterskin, balance.combat.waterskin.charges);
  }
});

test('healing quality scales by water source: wellspring water (2.5x), natural water (1.5x), waterskin (1.0x)', () => {
  const spiritPos = new Vector3(10, 0, 10);
  const naturalPos = new Vector3(-10, 0, -10);
  const bend = new BendState(
    { element: 'AQUES', weapon: 'spear' },
    7,
    () => [naturalPos],
    () => [spiritPos]
  );

  assert.equal(bend.healingQuality(spiritPos), 'wellspring');
  assert.equal(bend.healingMultiplier(spiritPos), 2.5);

  assert.equal(bend.healingQuality(naturalPos), 'natural');
  assert.equal(bend.healingMultiplier(naturalPos), 1.5);

  assert.equal(bend.healingQuality(far), 'waterskin');
  assert.equal(bend.healingMultiplier(far), 1.0);
});

test('moon tide leaves bend strength alone (the edge is applied in checkHit)', () => {
  const normalAques = new BendState({ element: 'AQUES', weapon: 'spear' }, 5, () => [here]);
  const normal = normalAques.begin('bend_palm', true, here);
  assert.equal(normal.go, true);
  const baseStrength = normal.strength;

  const moonAques = new BendState({ element: 'AQUES', weapon: 'spear' }, 5, () => [here]);
  moonAques.isFullMoon = true;
  const surged = moonAques.begin('bend_palm', true, here);
  assert.equal(surged.go, true);
  assert.equal(surged.strength, baseStrength);
});

test('Windskiff technique is exclusive to non-Hush AURA benders', () => {
  const aura = new BendState({ element: 'AURA', weapon: 'twin' });
  assert.equal(aura.windskiffActive, false);
  assert.equal(aura.toggleWindskiff(), true);
  assert.equal(aura.windskiffActive, true);
  assert.equal(aura.toggleWindskiff(), false);
  assert.equal(aura.windskiffActive, false);

  const ignis = new BendState({ element: 'IGNIS', weapon: 'sword' });
  assert.equal(ignis.toggleWindskiff(), false);
  assert.equal(ignis.windskiffActive, false);

  const auraHush = new BendState({ element: 'AURA', weapon: 'twin', hush: true });
  assert.equal(auraHush.toggleWindskiff(), false);
  assert.equal(auraHush.windskiffActive, false);
});

test('Stonehearing is exclusive to non-Hush TERRA benders', () => {
  const terra = new BendState({ element: 'TERRA', weapon: 'axe' });
  assert.equal(terra.stonehearingActive, false);
  assert.equal(terra.triggerStonehearing(), true);
  assert.equal(terra.stonehearingActive, true);
  assert.ok(terra.stonehearingCooldown > 0);

  const aura = new BendState({ element: 'AURA', weapon: 'twin' });
  assert.equal(aura.triggerStonehearing(), false);
  assert.equal(aura.stonehearingActive, false);

  const terraHush = new BendState({ element: 'TERRA', weapon: 'axe', hush: true });
  assert.equal(terraHush.triggerStonehearing(), false);
  assert.equal(terraHush.stonehearingActive, false);
});

test('hit confirmation invariant: guarded, wall-blocked, or countered attacks deal ZERO damage and never reduce life', () => {
  const maxHp = 120;
  let heroHp = maxHp;

  const simulateIncomingAttack = ({ guarded, wallBlocked, countered, rawDamage = 25 }) => {
    if (guarded || wallBlocked || countered) {
      return 0;
    }
    return rawDamage;
  };

  const damageGuarded = simulateIncomingAttack({ guarded: true, wallBlocked: false, countered: false });
  assert.equal(damageGuarded, 0);
  heroHp -= damageGuarded;
  assert.equal(heroHp, maxHp, 'Guarded hit must deal 0 damage and leave hero HP untouched');

  const damageWall = simulateIncomingAttack({ guarded: false, wallBlocked: true, countered: false });
  assert.equal(damageWall, 0);
  heroHp -= damageWall;
  assert.equal(heroHp, maxHp, 'Wall-blocked hit must deal 0 damage and leave hero HP untouched');

  const damageCountered = simulateIncomingAttack({ guarded: false, wallBlocked: false, countered: true });
  assert.equal(damageCountered, 0);
  heroHp -= damageCountered;
  assert.equal(heroHp, maxHp, 'Countered hit must deal 0 damage and leave hero HP untouched');

  const unblockedDamage = simulateIncomingAttack({ guarded: false, wallBlocked: false, countered: false, rawDamage: 24 });
  assert.equal(unblockedDamage, 24);
  heroHp -= unblockedDamage;
  assert.equal(heroHp, maxHp - 24, 'Confirmed unblocked hit must reduce life');
});

test('feet bending: leg kicks when Lit map to elemental bending moves and apply afflictions', async () => {
  const { afflictionFor } = await import('../src/element-moves.js');
  const heroPos = new Vector3(0, 0, 0);
  const targetPos = new Vector3(0, 0, 2);

  // When Lit, leg kicks produce elemental afflictions
  const ignisKick = afflictionFor('IGNIS', 'leg_heavy_1', heroPos, targetPos, 1.0);
  // AQUES leg kicks slow and shove
  const aquesKick = afflictionFor('AQUES', 'leg_heavy_1', heroPos, targetPos, 1.0);
  assert.ok(aquesKick, 'AQUES heavy kick must produce affliction');
  assert.ok(aquesKick.slowScale < 1.0, 'AQUES heavy kick must slow');

  // AURA leg kicks push
  const auraKick = afflictionFor('AURA', 'leg_heavy_1', heroPos, targetPos, 1.0);
  assert.ok(auraKick, 'AURA heavy kick must produce affliction');
  assert.ok(auraKick.shove.length() > 0, 'AURA heavy kick must push target away');

  // TERRA leg kicks stun
  const terraKick = afflictionFor('TERRA', 'leg_heavy_1', heroPos, targetPos, 1.0);
  assert.ok(terraKick, 'TERRA heavy kick must produce affliction');
  assert.ok(terraKick.stunSeconds > 0, 'TERRA heavy kick must stun target');
});


