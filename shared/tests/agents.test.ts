import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRobberGang,
  createDeserterBand,
  evaluateDeserterAmbush,
  recordPlayerDefeat,
  recordPlayerFled,
  sellToFence,
  RuleDecider,
  type OutlawSenses,
  type OutlawLimits,
} from '../src/agents/index.js';

const limits: OutlawLimits = {
  gangSizeMin: 3,
  gangSizeMax: 3,
  maxLitFraction: 0.20,
  sentrySafeDistance: 25,
  minCarryThreshold: 50,
  highCarryThreshold: 300,
  dayAmbushOdds: 0.15,
  nightAmbushOdds: 0.85,
  fleeHealthFraction: 0.30,
  reachDistance: 20,
  ambushCooldownSeconds: 45,
};

test('createRobberGang: enforces mostly Dim (at most 20% Lit) and assigns weapons', () => {
  const gang = createRobberGang('gang_1', 'Sindr Shadows', { x: 100, z: -10 }, limits, 5);
  assert.equal(gang.members.length, 5);
  const litCount = gang.members.filter((m) => m.isLit).length;
  assert.ok(litCount <= 1, `Expected at most 1 Lit member out of 5 (20%), got ${litCount}`);
  for (const m of gang.members) {
    assert.ok(m.weapon === 'sword' || m.weapon === 'club');
    assert.equal(m.health, 100);
  }
});

test('RuleDecider: ignores a player carrying only 20 CHROMA (pockets too light)', () => {
  const decider = new RuleDecider();
  const gang = createRobberGang('gang_1', 'Sindr Shadows', { x: 100, z: -10 }, limits);

  const senses: OutlawSenses = {
    playerCarry: { accountId: 'player_poor', chroma: 20, satchelWeight: 1 },
    playerLocation: { x: 105, z: -12, zoneType: 'alley' },
    timeOfDay: 'night',
    hour: 23,
    sentriesNear: false,
    sentryDistance: 60,
  };

  const decision = decider.decide(gang, senses, limits);
  assert.equal(decision.action, 'ignore');
  assert.match(decision.reason, /below threshold/i);
});

test('RuleDecider: heavy pockets (500 CHROMA) at night in an alley triggers ambush sequence', () => {
  const decider = new RuleDecider();
  const gang = createRobberGang('gang_1', 'Sindr Shadows', { x: 100, z: -10 }, limits);

  const senses: OutlawSenses = {
    playerCarry: { accountId: 'player_rich', chroma: 500, satchelWeight: 8 },
    playerLocation: { x: 105, z: -12, zoneType: 'alley' },
    timeOfDay: 'night',
    hour: 23,
    sentriesNear: false,
    sentryDistance: 60,
  };

  // Step 1: idle gang shadows
  const step1 = decider.decide(gang, senses, limits);
  assert.equal(step1.action, 'shadow');
  gang.state = 'shadowing';

  // Step 2: calls members
  const step2 = decider.decide(gang, senses, limits);
  assert.equal(step2.action, 'call_members');
  gang.state = 'calling_members';

  // Step 3: strikes with ambush
  const step3 = decider.decide(gang, senses, limits);
  assert.equal(step3.action, 'ambush');
  assert.ok(step3.ambushSpot !== undefined);
});

test('RuleDecider: guards nearby force gang to hold back in shadows', () => {
  const decider = new RuleDecider();
  const gang = createRobberGang('gang_1', 'Sindr Shadows', { x: 100, z: -10 }, limits);

  const senses: OutlawSenses = {
    playerCarry: { accountId: 'player_rich', chroma: 500, satchelWeight: 8 },
    playerLocation: { x: 105, z: -12, zoneType: 'alley' },
    timeOfDay: 'night',
    hour: 23,
    sentriesNear: true,
    sentryDistance: 12, // within 25m sentry limit
  };

  const decision = decider.decide(gang, senses, limits);
  assert.equal(decision.action, 'ignore');
  assert.match(decision.reason, /guards/i);
});

test('A robber who loses runs; a gang remembers a player who beat them', () => {
  const decider = new RuleDecider();
  const gang = createRobberGang('gang_1', 'Sindr Shadows', { x: 100, z: -10 }, limits, 3);
  const playerId = 'hero_blade';

  // 1. Simulating losing fight: 2 of 3 members dead, surviving member at low health
  gang.state = 'ambushing';
  gang.members[0]!.state = 'dead';
  gang.members[0]!.health = 0;
  gang.members[1]!.state = 'dead';
  gang.members[1]!.health = 0;
  gang.members[2]!.health = 20;

  const senses: OutlawSenses = {
    playerCarry: { accountId: playerId, chroma: 500, satchelWeight: 8 },
    playerLocation: { x: 105, z: -12, zoneType: 'alley' },
    timeOfDay: 'night',
    hour: 23,
    sentriesNear: false,
    sentryDistance: 60,
  };

  // Gang member who loses runs
  const fleeDecision = decider.decide(gang, senses, limits);
  assert.equal(fleeDecision.action, 'flee');
  assert.match(fleeDecision.reason, /losing/i);

  // 2. Record that player beat them
  recordPlayerDefeat(gang, playerId);
  const mem = gang.memories[playerId];
  assert.ok(mem);
  assert.equal(mem.timesBeaten, 1);
  assert.ok(mem.fearScore >= 50);

  // 3. Next time gang encounters this player, memory makes them avoid
  gang.state = 'idle';
  gang.members.forEach((m) => {
    m.state = 'idle';
    m.health = 100;
  });

  const nextEncounter = decider.decide(gang, senses, limits);
  assert.equal(nextEncounter.action, 'ignore');
  assert.match(nextEncounter.reason, /remembers player.*defeated/i);
});

test('Gang memory: player fleeing emboldens gang, fence hook deposits to gang purse', () => {
  const gang = createRobberGang('gang_2', 'Gorge Cutthroats', { x: 180, z: 0 }, limits);
  const playerId = 'runner_mark';

  recordPlayerFled(gang, playerId);
  const mem = gang.memories[playerId];
  assert.ok(mem);
  assert.equal(mem.timesPlayerFled, 1);
  assert.ok(mem.fearScore < 0);

  // Sell loot to fence
  const initialPurse = gang.purse.balance;
  const sale = sellToFence(gang, {
    chroma: 100,
    items: [{ id: 'ember_fangs', name: 'Ember Fangs', count: 2, estimatedValue: 30 }],
  });

  assert.ok(sale.payoutToPurse > 0);
  assert.equal(gang.purse.balance, initialPurse + sale.payoutToPurse);
  assert.ok(gang.purse.transactions.length >= 1);
});

test('Deserter bands: operate on road out of Sindr and ambush travellers', () => {
  const band = createDeserterBand('band_1', 'Slag Deserters', { x: 210, z: 0 });
  assert.ok(band.members.length >= 3);
  assert.ok(band.members.some((m) => m.weapon === 'sword'));

  // Traveller on road out of Sindr
  const roadDecision = evaluateDeserterAmbush(
    band,
    { accountId: 'traveller_1', chroma: 150, satchelWeight: 4 },
    { x: 215, z: 2, zoneType: 'road_out_of_town' }
  );
  assert.equal(roadDecision.action, 'ambush');

  // When band is down to 1 survivor, they flee
  band.members.forEach((m, idx) => {
    if (idx > 0) m.state = 'dead';
  });
  const fleeDecision = evaluateDeserterAmbush(
    band,
    { accountId: 'traveller_1', chroma: 150, satchelWeight: 4 },
    { x: 215, z: 2, zoneType: 'road_out_of_town' }
  );
  assert.equal(fleeDecision.action, 'flee');
});
