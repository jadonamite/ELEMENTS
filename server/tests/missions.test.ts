import http from 'node:http';
import express from 'express';
import { setupApi } from '../src/api.js';
import { setTokenVerifier } from '../src/auth.js';
import { resetPresence } from '../src/net/presence.js';
import { resetRateLimits } from '../src/rate-limit.js';
import { ZoneRoom } from '../src/rooms/ZoneRoom.js';
import { ZoneEconomy } from '../src/net/zone-economy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, saveAccount, setDatabase } from '../src/db.js';
import { getMission, missionChoice, missionSnapshot, missionGateCheckpoint, saveMission } from '../src/story/missionService.js';
import { MissionEncounter } from '../src/story/missionEncounter.js';
import { advanceMission, IGNIS_MISSION as M, MEAL_ITEM, ARENA_TICKET } from '@elements/shared';
import { getAccountBalance, grantPlayerStartingPurse, verifyWorldSupply } from '../src/economy/ledgerService.js';
import { getSatchel, verifyItemLedger } from '../src/economy/satchelService.js';
import { claimLootPile, getLootPileById } from '../src/economy/lootService.js';
import { ZoneWorld } from '../src/net/world.js';
import type { KillReport } from '../src/net/kill-hook.js';
import type { MissionEvent } from '@elements/shared';

function setup(hush = false) {
  const db = createDatabase(':memory:');
  saveAccount('player', hush ? 'Hush' : 'Shaper', hush ? null : 'IGNIS', db);
  let id = 0;
  const choice = (event: MissionEvent, at = M.gate, op = `op:${++id}`) => missionChoice('player', event, op, { ...at, zone: 'sindr' }, db);
  const register = () => { choice('training_complete'); choice('register'); choice('take_pouch'); };
  const search = () => { register(); choice('buy_meal', M.stall); choice('eat_meal', M.stall); choice('meet_neri', M.neri); choice('accept_search', M.neri); };
  return { db, choice, register, search };
}

test('arrival and meal transactions are atomic, idempotent and resume from the database', () => {
  const { db, choice, register } = setup();
  try {
    assert.throws(() => choice('take_pouch'), /requires/);
    assert.throws(() => choice('register', M.stall), /Stand beside/);
    register();
    assert.equal(getAccountBalance('player', db), 1000);
    for (let i = 0; i < 4; i++) choice('take_pouch');
    assert.equal(getAccountBalance('player', db), 1000);
    choice('buy_meal', M.stall, 'meal:1');
    const retry = choice('buy_meal', M.stall, 'meal:1');
    assert.equal(retry.applied, false);
    assert.equal(retry.balance, 995);
    assert.equal(retry.items[MEAL_ITEM], 1);
    assert.throws(() => choice('eat_meal', M.stall, 'meal:1'), /already used/);
    choice('eat_meal', M.stall, 'eat:1');
    choice('eat_meal', M.stall, 'eat:1');
    assert.equal(getSatchel('player', db)[MEAL_ITEM], undefined);
    assert.equal(getMission('player', db).flags.meal_eaten, true);
    assert.throws(() => choice('eat_meal', M.stall), /Not enough/);
    assert.equal(verifyWorldSupply(db), true);
    assert.deepEqual(verifyItemLedger(db), { ok: true, mismatches: [] });
  } finally { db.close(); }
});

test('a failed state write rolls back coin and items; failed purchases remain retriable', () => {
  const { db, choice, register } = setup();
  try {
    register();
    db.exec("CREATE TRIGGER refuse_mission BEFORE UPDATE ON character_missions BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END");
    assert.throws(() => choice('buy_meal', M.stall, 'meal:retry'), /storage unavailable/);
    assert.equal(getAccountBalance('player', db), 1000);
    assert.deepEqual(getSatchel('player', db), {});
    db.exec('DROP TRIGGER refuse_mission');
    choice('buy_meal', M.stall, 'meal:retry');
    assert.equal(getAccountBalance('player', db), 995);
  } finally { db.close(); }
});

test('legacy 100 CHROMA grant preserves balances and Hush never unlocks bending', () => {
  const { db, choice } = setup(true);
  try {
    grantPlayerStartingPurse('player', db);
    const previous = getAccountBalance('player', db);
    const state = getMission('player', db);
    assert.equal(state.flags.mission_1_complete, true);
    assert.equal(state.flags.bending_unlocked, false);
    choice('take_pouch');
    assert.equal(getAccountBalance('player', db), previous);
  } finally { db.close(); }
});

test('public choices reject forged victories while every Drawing starts the Sindr mission', () => {
  const { db, choice, search } = setup();
  try {
    search();
    assert.throws(() => choice('survive_ambush', M.ambush), /requires the mission encounter/);
    assert.throws(() => choice('collect_ticket', M.ambush), /requires the mission encounter/);
    for (const [id, role, element] of [
      ['aques', 'Shaper', 'AQUES'], ['terra', 'Shaper', 'TERRA'], ['aura', 'Shaper', 'AURA'], ['hush', 'Hush', null],
    ] as const) {
      saveAccount(id, role, element, db);
      const state = getMission(id, db);
      assert.equal(state.zone, 'sindr', `${id} starts in Sindr`);
      assert.equal(state.nation, element ?? 'IGNIS', `${id} keeps the Drawing`);
      missionChoice(id, 'training_complete', `${id}:training_complete`, { ...M.gate, zone: 'sindr' }, db);
      assert.deepEqual(missionGateCheckpoint(id, db), M.gate, `${id} resumes at the Sindr registrar`);
      for (const event of ['register', 'take_pouch'] as const) {
        missionChoice(id, event, `${id}:${event}`, { ...M.gate, zone: 'sindr' }, db);
      }
      assert.equal(getMission(id, db).flags.mission_1_complete, true);
      assert.equal(getMission(id, db).nation, element ?? 'IGNIS');
      assert.equal(getMission(id, db).zone, 'sindr');
    }
  } finally { db.close(); }
});

test('older AQUES mission records migrate to the Sindr location without changing the Drawing', () => {
  const db = createDatabase(':memory:');
  try {
    saveAccount('aques', 'Shaper', 'AQUES', db);
    const state = getMission('aques', db);
    db.prepare('UPDATE character_missions SET state = ? WHERE account_id = ?').run(JSON.stringify({ ...state, version: 1, zone: undefined }), 'aques');
    const migrated = getMission('aques', db);
    assert.equal(migrated.nation, 'AQUES');
    assert.equal(migrated.zone, 'sindr');
  } finally { db.close(); }
});

test('ambush roster, retry and permanent ticket use existing loot and commit ownership with the flag', () => {
  const { db, choice, search } = setup();
  try {
    search();
    const world = new ZoneWorld('sindr', () => 0.5);
    const encounter = new MissionEncounter(world, db);
    const at = { ...M.ambush, zone: 'sindr' };
    encounter.start('player', at);
    const first = [...world.enemies.keys()].filter(id => id.startsWith('mission:'));
    assert.equal(first.length, 2);
    assert.ok(first.every(id => id.length <= 40));
    encounter.start('player', at);
    assert.equal(getMission('player', db).attempt, 1);
    encounter.abandon('player');
    assert.ok(first.every(id => !world.enemies.has(id)));
    encounter.start('player', at);
    assert.equal(getMission('player', db).attempt, 2);
    const roster = [...world.enemies.keys()].filter(id => id.startsWith('mission:'));
    const report = (enemyId: string): KillReport => ({ zone: 'sindr', worldId: world.id, enemyId, kind: 'robber', x: M.ambush.x, z: 0, killerAccountId: 'player', damageBy: { player: 100 }, at: 20 });
    assert.equal(encounter.killed(report('unrelated'), null), null);
    assert.equal(encounter.killed(report(roster[0]!), null), null);
    assert.equal(getMission('player', db).flags.ambush_survived, false);
    const pile = encounter.killed(report(roster[1]!), null)!;
    assert.equal(pile.contents.gear?.[ARENA_TICKET], 1);
    assert.equal(getMission('player', db).flags.ambush_survived, true);
    assert.equal(getMission('player', db).flags.arena_ticket_collected, false);
    assert.throws(() => choice('kellan_lead', M.cover), /requires/);
    assert.equal(encounter.killed(report(roster[1]!), null), null);
    assert.equal(getLootPileById(pile.id, db)?.expiresAt, Number.MAX_SAFE_INTEGER);
    assert.throws(() => claimLootPile({ pileId: pile.id, accountId: 'thief', x: pile.x, z: pile.z, now: Date.now() + 999999999 }, db), /reserved/);
    assert.throws(() => claimLootPile({ pileId: pile.id, accountId: 'player', x: 0, z: 0 }, db), /too far/);
    db.exec("CREATE TRIGGER refuse_ticket BEFORE UPDATE ON character_missions BEGIN SELECT RAISE(ABORT, 'ticket unavailable'); END");
    assert.throws(() => claimLootPile({ pileId: pile.id, accountId: 'player', x: pile.x, z: pile.z }, db), /ticket unavailable/);
    assert.equal(getLootPileById(pile.id, db)?.claimed, false);
    db.exec('DROP TRIGGER refuse_ticket');
    claimLootPile({ pileId: pile.id, accountId: 'player', x: pile.x, z: pile.z }, db);
    assert.equal(missionSnapshot('player', db).items[ARENA_TICKET], 1);
    assert.equal(getMission('player', db).flags.arena_ticket_collected, true);
    choice('inspect_invitation', M.stall);
    assert.throws(() => choice('kellan_lead', M.stall), /Stand beside/);
    choice('kellan_lead', M.cover);
    assert.equal(getMission('player', db).flags.mission_1a_complete, true);
    choice('hall_briefing', M.hall);
    const beforeSpar = getMission('player', db).attempt;
    encounter.start('player', { ...M.yard, zone: 'sindr' }, 'spar');
    assert.equal(getMission('player', db).attempt, beforeSpar + 1);
    assert.ok([...world.enemies.values()].filter(e => e.storyOwner).every(e => e.kind !== 'robber'));
    assert.equal((db.prepare('SELECT ticket_pile_id FROM mission_encounters WHERE account_id = ?').get('player') as { ticket_pile_id: string }).ticket_pile_id, pile.id);
    encounter.dispose();
    assert.deepEqual(verifyItemLedger(db), { ok: true, mismatches: [] });
  } finally { db.close(); }
});

test('room-judged hits alone complete the mission encounter, and a second world cannot duplicate it', () => {
  const { db, search } = setup();
  search();
  const world = new ZoneWorld('sindr', () => 0.5);
  const economy = new ZoneEconomy(world, db, Date.now, () => 0.5);
  try {
    const player = world.join('hero', { accountId: 'player', role: 'Shaper', element: 'IGNIS', tier: 5 }, 10);
    player.x = M.ambush.x; player.z = 0;
    assert.equal(economy.story('hero', { event: 'start_ambush', operationId: 'fight:1' })[0]?.body.error, undefined);
    const otherWorld = new ZoneWorld('sindr');
    const second = new MissionEncounter(otherWorld, db);
    assert.throws(() => second.start('player', { ...M.ambush, zone: 'sindr' }), /already active/);
    const enemies = [...world.enemies.values()].filter(e => e.id.startsWith('mission:'));
    let time = 11, swing = 0;
    for (const enemy of enemies) {
      while (enemy.alive) {
        time += 2;
        player.x = enemy.x; player.z = enemy.z - 1;
        player.history.push(time, player.x, player.z, 0);
        enemy.history.push(time, enemy.x, enemy.z, Math.PI);
        const verdict = world.hit('hero', { e: enemy.id, m: 'light_1', sw: ++swing, t: time, v: time, lit: false }, time + 0.02)[0]!;
        assert.equal(verdict.type === 'hit_result' && verdict.ok, true, JSON.stringify(verdict));
      }
    }
    assert.equal(getMission('player', db).flags.ambush_survived, true);
    assert.equal(getMission('player', db).flags.arena_ticket_collected, false);
    const drops = economy.drain().filter(e => e.type === 'loot_new');
    assert.equal(drops.length, 2);
    assert.equal(drops.filter(e => (e.body.pile as { contents: { gear?: Record<string, number> } }).contents.gear?.[ARENA_TICKET] === 1).length, 1);
  } finally { economy.dispose(); db.close(); }
});

test('HTTP cannot authorize location-gated choices with forged coordinates; authenticated room positions decide', async () => {
  const { db } = setup();
  setDatabase(db);
  setTokenVerifier(async token => { if (token !== 'mission-player') throw new Error('Invalid token'); return { userId: 'player' }; });
  resetPresence(); resetRateLimits();
  const app = express(); setupApi(app);
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/api/story/mission`;
  const call = (event: string, token = 'mission-player') => fetch(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, operationId: `http:${event}`, context: { ...M.gate, zone: 'sindr' }, accountId: 'another-account' }),
  });
  const world = new ZoneWorld('sindr');
  const economy = new ZoneEconomy(world, db);
  try {
    assert.equal((await call('training_complete', 'forged')).status, 401);
    assert.equal((await call('training_complete')).status, 200);
    assert.equal(getMission('player', db).flags.training_complete, true);
    for (const event of ['register', 'take_pouch', 'buy_meal', 'eat_meal', 'meet_neri', 'accept_search', 'inspect_invitation', 'kellan_lead', 'hall_briefing', 'start_spar', 'identify_invitation', 'start_ambush']) {
      assert.equal((await call(event)).status, 409, event);
    }
    assert.equal(getAccountBalance('player', db), 0);
    assert.equal(getMission('player', db).flags.nation_arrival_registered, false);
    const player = world.join('hero', { accountId: 'player', role: 'Shaper', element: 'IGNIS', tier: 0 }, 10);
    player.x = 8; player.z = 0;
    const forged = economy.story('hero', { event: 'register', operationId: 'room:register', context: { ...M.gate, zone: 'sindr' } });
    assert.match(String(forged[0]?.body.error), /Stand beside/);
    player.x = M.gate.x; player.y = M.gate.y; player.z = M.gate.z;
    assert.equal(economy.story('hero', { event: 'register', operationId: 'room:register' })[0]?.body.error, undefined);
    assert.equal(economy.story('hero', { event: 'take_pouch', operationId: 'room:pouch' })[0]?.body.error, undefined);
    assert.equal(getAccountBalance('player', db), 1000);
    assert.equal((await call('buy_meal')).status, 409);
    assert.equal(getAccountBalance('player', db), 1000);
  } finally {
    economy.dispose(); setTokenVerifier(null); resetPresence(); resetRateLimits();
    await new Promise<void>(resolve => server.close(() => resolve())); db.close();
  }
});

test('authenticated room resumes saved training at its own gate checkpoint, without granting arrival', () => {
  const { db, choice } = setup();
  setDatabase(db); resetPresence();
  choice('training_complete');
  const room = new ZoneRoom();
  room.world = new ZoneWorld('sindr');
  room.economy = new ZoneEconomy(room.world, db);
  const sent: Array<{ type: string; body: unknown }> = [];
  const client = { sessionId: 'resume', send(type: string, body: unknown) { sent.push({ type, body }); } } as unknown as Parameters<ZoneRoom['onJoin']>[0];
  try {
    room.onJoin(client, {}, { accountId: 'player', role: 'Shaper', element: 'IGNIS', tier: 0 });
    const player = room.world.players.get('resume')!;
    assert.equal(player.x, M.gate.x);
    assert.equal(player.z, M.gate.z);
    assert.equal(player.arrivalRegistered, false);
    assert.equal(getAccountBalance('player', db), 0);
    assert.deepEqual((sent.find(m => m.type === 'welcome')!.body as { position: unknown }).position, M.gate);
  } finally { room.economy.dispose(); resetPresence(); db.close(); }
});

test('story enemies reject bystanders and never target them, including the finishing blow', () => {
  const { db, search } = setup();
  search();
  const world = new ZoneWorld('sindr', () => 0.5);
  const economy = new ZoneEconomy(world, db);
  try {
    const owner = world.join('owner', { accountId: 'player', role: 'Shaper', element: 'IGNIS', tier: 5 }, 10);
    const bystander = world.join('other', { accountId: 'other', role: 'Shaper', element: 'IGNIS', tier: 5 }, 10);
    owner.x = M.ambush.x; owner.z = M.ambush.z;
    economy.story('owner', { event: 'start_ambush', operationId: 'fight' });
    const enemies = [...world.enemies.values()].filter(e => e.storyOwner);
    const enemy = enemies[0]!;
    bystander.x = enemy.x; bystander.z = enemy.z - 1;
    enemy.hp = 1;
    const rejected = world.hit('other', { e: enemy.id, m: 'light_1', sw: 1, t: 11, v: 11, lit: false }, 11.02)[0]!;
    assert.equal(rejected.type === 'hit_result' && rejected.reason, 'story_reserved');
    assert.equal(enemy.hp, 1);
    world.step(0.1, 12);
    assert.ok(enemies.every(e => e.target === 'owner'));
    assert.equal(getMission('player', db).flags.ambush_survived, false);
    assert.equal(economy.drain().length, 0);
  } finally { economy.dispose(); db.close(); }
});

test('Hall and spar use room position, keep retries, award no loot, and identify only afterwards', () => {
  const { db, choice, search } = setup();
  search();
  let state = getMission('player', db);
  for (const event of ['start_ambush', 'survive_ambush', 'collect_ticket', 'inspect_invitation', 'kellan_lead'] as const) state = advanceMission(state, event, false);
  saveMission('player', state, db);
  const world = new ZoneWorld('sindr', () => 0.5);
  const economy = new ZoneEconomy(world, db);
  try {
    const player = world.join('owner', { accountId: 'player', role: 'Shaper', element: 'IGNIS', tier: 5 }, 10);
    assert.throws(() => choice('hall_briefing', M.stall), /Stand beside/);
    assert.throws(() => choice('survive_spar', M.yard), /requires the mission encounter/);
    assert.throws(() => choice('identify_invitation', M.kellan), /spar_completed/);
    choice('hall_briefing', M.hall, 'hall:1');
    assert.equal(choice('hall_briefing', M.hall, 'hall:1').applied, false);
    player.x = M.yard.x; player.z = M.yard.z; player.y = 0;
    assert.match(String(economy.story('owner', { event: 'start_spar', operationId: 'spar:1' })[0]?.body.error), /Stand at/);
    player.y = M.yard.y;
    assert.equal(economy.story('owner', { event: 'start_spar', operationId: 'spar:1' })[0]?.body.error, undefined);
    const firstAttempt = getMission('player', db).attempt;
    economy.story('owner', { event: 'start_spar', operationId: 'spar:1' });
    assert.equal(getMission('player', db).attempt, firstAttempt);
    const balance = getAccountBalance('player', db), items = getSatchel('player', db);
    economy.death('owner');
    assert.equal(getAccountBalance('player', db), balance);
    assert.deepEqual(getSatchel('player', db), items);
    assert.equal(getMission('player', db).flags.spar_completed, false);
    economy.story('owner', { event: 'start_spar', operationId: 'spar:retry' });
    assert.equal(getMission('player', db).attempt, firstAttempt + 1);
    const enemies = [...world.enemies.values()].filter(e => e.storyOwner);
    assert.deepEqual(enemies.map(e => e.kind), ['brawler', 'armed']);
    let time = 12, swing = 0;
    for (const enemy of enemies) while (enemy.alive) {
      time += 2;
      player.x = enemy.x; player.z = enemy.z - 1;
      player.history.push(time, player.x, player.z, 0);
      enemy.history.push(time, enemy.x, enemy.z, Math.PI);
      const verdict = world.hit('owner', { e: enemy.id, m: 'light_1', sw: ++swing, t: time, v: time, lit: false }, time + 0.02)[0]!;
      assert.equal(verdict.type === 'hit_result' && verdict.ok, true);
    }
    assert.equal(getMission('player', db).flags.spar_completed, true);
    assert.equal(getMission('player', db).flags.invitation_identified, false);
    assert.equal(economy.drain().filter(e => e.type === 'loot_new').length, 0);
    choice('identify_invitation', M.kellan);
    assert.equal(getMission('player', db).flags.invitation_identified, true);
    assert.equal(getAccountBalance('player', db), balance);
    assert.deepEqual(getSatchel('player', db), items);
    assert.equal(verifyWorldSupply(db), true);
    assert.deepEqual(verifyItemLedger(db), { ok: true, mismatches: [] });
  } finally { economy.dispose(); db.close(); }
});
