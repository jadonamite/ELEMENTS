import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { TOTAL_CHROMA_SUPPLY } from '@elements/shared';
import { migrateDatabase, setDatabase } from '../src/db.js';
import { setTokenVerifier } from '../src/auth.js';
import { getAllAccountBalances, grantPlayerStartingPurse, recordTransaction } from '../src/economy/ledgerService.js';
import { RaidService, type RunRec } from '../src/raids/service.js';
import { setupRaidApi } from '../src/raids/api.js';
import { RAIDS } from '../src/raids/config.js';

function world(rand = () => 0.99) {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  let t = 1_700_000_000_000;
  const clock = { now: () => t, advance: (s: number) => { t += s * 1000; } };
  const raids = new RaidService(db, { now: clock.now, rand });
  const give = (id: string, amount: number) => recordTransaction({ from: 'treasury', to: id, amount, reason: 'player_starting_grant', timestamp: t }, db);
  const supply = () => [...getAllAccountBalances(db).values()].reduce((a, b) => a + b, 0);
  return { db, raids, clock, give, supply };
}

function runThrough(raids: RaidService, clock: { advance: (s: number) => void }, who: string, run: RunRec): RunRec {
  let r = run;
  for (const room of r.order.slice(r.roomIndex)) {
    clock.advance(30);
    r = raids.clear(who, r.id, room, {});
  }
  return r;
}

test('a full raid: key, two fighters, private ruin, three rooms and the boss, haul sold', async () => {
  const { raids, clock, supply } = world();
  grantPlayerStartingPurse('ana', raids.db);
  assert.equal(raids.balance('ana'), 100);
  const { price } = raids.buyKey('ana', 'undervault_key');
  assert.ok(price >= RAIDS.keys.undervault_key!.basePrice);
  const w1 = raids.hire('ana', 'f_kesh').wage;
  const w2 = raids.hire('ana', 'f_tamsin').wage;
  assert.equal(raids.balance('ana'), 100 - price - w1 - w2);
  const run = raids.enter('ana', 'sindr_undervault');
  assert.equal(run.order.length, 5);
  assert.equal(run.fighters.length, 2);
  assert.throws(() => raids.view('mallory', run.id), /another party/, 'the instance is private');
  assert.throws(() => raids.enter('ana', 'sindr_undervault'), /already inside/);
  const done = runThrough(raids, clock, 'ana', run);
  assert.equal(done.state, 'won');
  assert.ok(done.settled);
  const pack = raids.pack('ana');
  assert.equal(pack.items.warden_core, 1, 'the boss always gives its core');
  // Fighters were paid less the Hall's cut.
  for (const f of done.summary!.fighters) assert.ok(f.paid > 0 && f.refunded === 0);
  assert.equal(raids.fighter('f_kesh')!.status, 'available');
  const before = raids.balance('ana');
  const quotes = raids.salvageQuotes('ana');
  assert.ok(quotes.length > 0);
  let earned = 0;
  for (const q of quotes) if (q.accepts > 0) earned += raids.sell('ana', q.kind, q.accepts).paid;
  assert.ok(earned > 0);
  assert.equal(raids.balance('ana'), before + earned);
  assert.equal(supply(), TOTAL_CHROMA_SUPPLY, 'no coin made or lost anywhere');
});

test('two runs by the same party come in a different room order', () => {
  const { raids, clock, give } = world();
  give('ana', 1000);
  raids.buyKey('ana', 'undervault_key');
  const a = runThrough(raids, clock, 'ana', raids.enter('ana', 'sindr_undervault'));
  raids.buyKey('ana', 'undervault_key');
  const b = raids.enter('ana', 'sindr_undervault');
  assert.notDeepEqual(a.order, b.order);
});

test('a hired fighter dies, is gone for good, and the Hall takes on a recruit; the wage comes back', () => {
  const { raids, clock, give, supply } = world();
  give('ana', 1000);
  raids.buyKey('ana', 'undervault_key');
  const wage = raids.hire('ana', 'f_kesh').wage;
  const run = raids.enter('ana', 'sindr_undervault');
  const after = raids.balance('ana');
  raids.fighterKilled('ana', run.id, 'f_kesh');
  const done = runThrough(raids, clock, 'ana', raids.run(run.id)!);
  const row = done.summary!.fighters[0]!;
  assert.equal(row.outcome, 'died');
  assert.equal(row.refunded, wage);
  assert.ok(row.replacedBy);
  assert.equal(raids.fighter('f_kesh')!.status, 'dead');
  assert.ok(!raids.roster('ana').some((f) => f.id === 'f_kesh'), 'off the roster');
  assert.ok(raids.roster('ana').some((f) => f.name === row.replacedBy), 'a recruit stands in');
  assert.throws(() => raids.hire('ana', 'f_kesh'), /dead/);
  assert.equal(raids.balance('f_kesh'), 0, 'savings went to the treasury');
  assert.ok(raids.balance('ana') >= after + wage);
  assert.equal(supply(), TOTAL_CHROMA_SUPPLY);
});

test('a fighter breaks and runs when it goes badly; the Hall records it and rules against them', async () => {
  const { raids, clock, give } = world(() => 0.01);
  give('ana', 1000);
  raids.buyKey('ana', 'undervault_key');
  const wage = raids.hire('ana', 'f_tamsin').wage;
  const run = raids.enter('ana', 'sindr_undervault');
  clock.advance(30);
  raids.clear('ana', run.id, run.order[0]!);
  clock.advance(3);
  const calm = raids.fighterCheck('ana', run.id, 'f_tamsin', { health: 1, partyStanding: 1, fightersDown: 0, playersDown: 0, bossRoom: false, foesHealth: 0.3 }, 104);
  assert.equal(calm.flee, false);
  clock.advance(3);
  const bad = raids.fighterCheck('ana', run.id, 'f_tamsin', { health: 0.2, partyStanding: 0.5, fightersDown: 0, playersDown: 1, bossRoom: false, foesHealth: 0.9 }, 20);
  assert.equal(bad.flee, true);
  assert.equal(bad.run.fighterStatus.f_tamsin, 'fled');
  const done = runThrough(raids, clock, 'ana', raids.run(run.id)!);
  assert.equal(done.summary!.fighters[0]!.refunded, wage, 'a fighter who ran is not paid; the wage comes back');
  const hall = raids.hall();
  const c = hall.complaints.find((x) => x.against === 'f_tamsin');
  assert.ok(c && c.kind === 'fighter_fled' && c.status === 'open');
  await raids.tickHall();
  assert.equal(raids.hall().complaints.find((x) => x.id === c.id)!.status, 'upheld', 'the run record bears it out');
  assert.equal(raids.fighter('f_tamsin')!.record.fled, 1);
  assert.ok(raids.store.minds('hall_sindr', 1)[0]!.thought.length > 0, 'the broker\'s reasoning is kept');
});

test('three upheld complaints bar a fighter from hire', async () => {
  const { raids, clock, give } = world(() => 0.01);
  give('ana', 5000);
  for (let i = 0; i < 3; i++) {
    raids.buyKey('ana', 'undervault_key');
    raids.hire('ana', 'f_tamsin');
    const run = raids.enter('ana', 'sindr_undervault');
    clock.advance(3);
    raids.fighterCheck('ana', run.id, 'f_tamsin', { health: 0.1, partyStanding: 0.3, fightersDown: 1, playersDown: 1, bossRoom: true, foesHealth: 1 }, 5);
    runThrough(raids, clock, 'ana', raids.run(run.id)!);
    await raids.tickHall();
  }
  assert.throws(() => raids.hire('ana', 'f_tamsin'), /won't hire out|grudge|won't fight|heard/);
});

test('losing a raid takes a quarter of carried CHROMA and items', () => {
  const { raids, clock, give, supply } = world();
  give('ana', 400);
  raids.buyKey('ana', 'undervault_key');
  // Something carried from an earlier run.
  raids.store.put('pack', 'ana', { ...raids.pack('ana'), items: { old_iron: 4, ember_glass: 4 } }, 0);
  const run = raids.enter('ana', 'sindr_undervault');
  const carried = raids.balance('ana');
  clock.advance(30);
  const lost = raids.down('ana', run.id);
  assert.equal(lost.state, 'lost');
  const loss = lost.summary!.losses.ana!;
  assert.equal(loss.chroma, Math.floor(carried / 4));
  assert.equal(raids.balance('ana'), carried - Math.floor(carried / 4));
  assert.equal(Object.values(loss.items).reduce((a, b) => a + b, 0), 2, 'a quarter of 8 items');
  const left = raids.pack('ana').items;
  assert.equal((left.old_iron ?? 0) + (left.ember_glass ?? 0), 6);
  assert.equal(supply(), TOTAL_CHROMA_SUPPLY);
});

test('walking out on a standing fighter: the Hall records it against the employer and the fighter remembers', async () => {
  const { raids, give } = world();
  give('ana', 1000);
  raids.buyKey('ana', 'undervault_key');
  raids.hire('ana', 'f_odra');
  const run = raids.enter('ana', 'sindr_undervault');
  raids.abandon('ana', run.id);
  assert.ok(raids.hall().complaints.some((c) => c.kind === 'left_to_die' && c.against === 'ana'));
  assert.ok(raids.fighter('f_odra')!.memory.ana!.score <= RAIDS.fighters.refuseBelowScore);
  assert.throws(() => raids.hire('ana', 'f_odra'), /left them to die/);
});

test('parties: invite, accept, the second player shares the instance; fighters count toward five', () => {
  const { raids, clock, give } = world();
  give('ana', 1000); give('bo', 100);
  raids.invite('ana', 'bo');
  assert.equal(raids.invitesFor('bo').length, 1);
  const p = raids.acceptInvite('bo', raids.invitesFor('bo')[0]!.id);
  assert.deepEqual(p.members, ['ana', 'bo']);
  assert.throws(() => raids.hire('bo', 'f_kesh'), /leader/);
  raids.setLootRule('ana', 'equal');
  for (const f of ['f_kesh', 'f_odra', 'f_brannoc']) raids.hire('ana', f);
  assert.throws(() => raids.hire('ana', 'f_issa'), /Five/);
  raids.buyKey('ana', 'undervault_key');
  const run = raids.enter('ana', 'sindr_undervault');
  assert.ok(raids.view('bo', run.id));
  raids.presence('bo', run.id, { x: 1, z: 2, hp: 80, maxHp: 100 });
  assert.equal(raids.view('ana', run.id).presence.bo!.hp, 80);
  assert.throws(() => raids.leave('bo'), /Finish/);
  const done = runThrough(raids, clock, 'bo', run);
  const shares = done.summary!.shares;
  assert.ok(Object.keys(shares).length === 2);
});

test('raid routes need a signed-in player and act as that player only', async () => {
  const { raids, give } = world();
  give('ana', 500);
  setTokenVerifier(async (t) => ({ userId: t.replace('tok-', '') }));
  const app = express();
  app.use(express.json());
  setupRaidApi(app, raids);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const call = async (path: string, body?: unknown, tok?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, json: await res.json() as Record<string, unknown> };
  };
  try {
    assert.equal((await call('/api/raids/board')).status, 401);
    const bought = await call('/api/raids/hall/buy-key', { keyId: 'undervault_key', accountId: 'someone_else' }, 'tok-ana');
    assert.equal(bought.status, 200);
    assert.equal(raids.pack('ana').keys.undervault_key, 1);
    const entered = await call('/api/raids/run/enter', { dungeonId: 'sindr_undervault' }, 'tok-ana');
    const runId = (entered.json.result as { id: string }).id;
    assert.equal((await call(`/api/raids/run/${runId}`, undefined, 'tok-mallory')).status, 400);
    const broke = await call('/api/raids/hall/buy-key', { keyId: 'undervault_key' }, 'tok-pauper');
    assert.equal(broke.status, 400);
  } finally {
    server.close();
    setTokenVerifier(null);
  }
});
