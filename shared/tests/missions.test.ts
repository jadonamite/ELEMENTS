import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceMission, freshMission, normalizeMission, MISSION_FLAGS, IGNIS_MISSION, MISSION_COPY } from '../src/story/missions.js';
import { SINDR_ANCHORS } from '../src/world/ignis/sindr.js';

test('the meal stall cook and seat follow the shared Sindr world anchor', () => {
  const stall = SINDR_ANCHORS.find(anchor => anchor.id === 'stall_food');
  assert.ok(stall?.keeper && stall.seat);
  assert.deepEqual(IGNIS_MISSION.stallKeeper, stall.keeper);
  assert.deepEqual(IGNIS_MISSION.seat, stall.seat);
  assert.match(MISSION_COPY.cookGreeting, /5 CHROMA/);
});

for (const nation of ['IGNIS', 'AQUES', 'TERRA', 'AURA'] as const) for (const hush of [false, true]) {
  test(`mission prerequisites and role unlock: ${nation}/${hush ? 'Hush' : 'Lit'}`, () => {
    let state = freshMission(nation);
    assert.throws(() => advanceMission(state, 'take_pouch', hush));
    assert.throws(() => advanceMission(state, 'register', hush));
    assert.throws(() => advanceMission(state, 'kellan_lead', hush));
    for (const event of ['training_complete', 'register', 'take_pouch'] as const) state = advanceMission(state, event, hush);
    assert.equal(state.flags.bending_unlocked, !hush);
    assert.equal(state.flags.mission_1_complete, true);
    assert.equal(state.nation, nation);
    assert.equal(state.zone, 'sindr');
    assert.throws(() => advanceMission(state, 'accept_search', hush));
    for (const event of ['buy_meal', 'eat_meal', 'meet_neri', 'accept_search', 'start_ambush'] as const) state = advanceMission(state, event, hush);
    assert.equal(state.attempt, 1);
    assert.equal(state.checkpoint, 'search');
    assert.throws(() => advanceMission(state, 'collect_ticket', hush));
    for (const event of ['survive_ambush', 'collect_ticket', 'inspect_invitation', 'kellan_lead', 'hall_briefing', 'start_spar', 'survive_spar', 'identify_invitation'] as const) state = advanceMission(state, event, hush);
    assert.equal(state.flags.mission_1a_complete, true);
    assert.equal(state.flags.meal_eaten, true);
    assert.equal(MISSION_FLAGS.filter(flag => state.flags[flag]).length, hush ? MISSION_FLAGS.length - 1 : MISSION_FLAGS.length);
  });
}

test('mission transitions do not mutate their inputs; victory requires an attempt', () => {
  const start = freshMission('IGNIS');
  const next = advanceMission(start, 'training_complete', false);
  assert.equal(start.flags.training_complete, false);
  assert.equal(next.flags.training_complete, true);
  next.flags.neri_search_accepted = true;
  assert.throws(() => advanceMission(next, 'survive_ambush', false), /No ambush attempt/);
});


test('legacy delivery saves migrate to the search and preserve completed leads', () => {
  const legacy = JSON.parse(JSON.stringify(freshMission('IGNIS')));
  delete legacy.flags.neri_search_accepted;
  delete legacy.flags.invitation_inspected;
  delete legacy.flags.hall_briefed;
  legacy.flags.neri_delivery_accepted = true;
  legacy.checkpoint = 'delivery';
  legacy.attempt = 3; delete legacy.ambushAttempt; delete legacy.sparAttempt;
  assert.equal(normalizeMission(legacy).ambushAttempt, 3);
  assert.equal(normalizeMission(legacy).sparAttempt, 0);
  assert.equal(normalizeMission(legacy).checkpoint, 'search');
  assert.equal(normalizeMission(legacy).flags.neri_search_accepted, true);
  legacy.flags.mission_1a_complete = true;
  const migrated = normalizeMission(legacy);
  assert.equal(migrated.flags.invitation_inspected, true);
  assert.equal(migrated.flags.hall_briefed, false);
  assert.equal(migrated.checkpoint, 'hall');
  assert.equal('neri_delivery_accepted' in migrated.flags, false);
  assert.deepEqual(normalizeMission(migrated), migrated);
});

test('older mission saves gain the Sindr start zone without changing their Drawing', () => {
  const legacy = { ...freshMission('AQUES'), version: 1 } as Record<string, unknown>;
  delete legacy.zone;
  const migrated = normalizeMission(legacy as unknown as ReturnType<typeof freshMission>);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.nation, 'AQUES');
  assert.equal(migrated.zone, 'sindr');
});

test('inspection, Hall and supervised spar precede Kellan identification', () => {
  let state = freshMission('IGNIS');
  for (const event of ['training_complete', 'register', 'take_pouch', 'buy_meal', 'eat_meal', 'meet_neri', 'accept_search', 'start_ambush', 'survive_ambush', 'collect_ticket'] as const) state = advanceMission(state, event, false);
  assert.throws(() => advanceMission(state, 'kellan_lead', false), /invitation_inspected/);
  assert.throws(() => advanceMission(state, 'start_spar', false), /hall_briefed/);
  assert.throws(() => advanceMission(state, 'identify_invitation', false), /spar_completed/);
  const briefed = advanceMission(advanceMission(advanceMission(state, 'inspect_invitation', false), 'kellan_lead', false), 'hall_briefing', false);
  assert.throws(() => advanceMission(briefed, 'survive_spar', false), /No spar attempt/);
  for (const event of ['inspect_invitation', 'kellan_lead', 'hall_briefing', 'start_spar', 'survive_spar', 'identify_invitation'] as const) state = advanceMission(state, event, false);
  assert.equal(state.flags.invitation_identified, true);
  assert.equal(state.attempt, 2);
  assert.throws(() => advanceMission(state, 'start_spar', false), /already completed/);
});
