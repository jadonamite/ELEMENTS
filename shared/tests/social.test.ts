import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  acceptPeace, addLand, answerDuel, answerWar, atWar, bannerFor, challenge, declareWar, deposit, duelPayout, expel,
  fightConsequence, foundGuild, inviteToGroup, joinGroup, landLimit, leaveGroup, newDay, offerPeace, resolveDuel,
  setRank, setVaultRight, surrender, upgradeToClan, withdraw, type Group, type SocialConfig, type War, type Duel,
} from '../src/index.js';

const cfg = JSON.parse(readFileSync(new URL('../balance.json', import.meta.url), 'utf8')).social as SocialConfig;
const T0 = 5_000_000;
const none = { names: [] as string[], tags: [] as string[] };
const banner = { field: '#7a1a12', device: 'flame' };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

function guild(id: string, leader: string, extra: string[] = []): Group {
  let g = unwrap(foundGuild({ id, name: `House ${id}`, tag: id.slice(0, 3).toUpperCase(), founder: leader, founderChroma: 99999, founderGroup: null, banner, now: T0, taken: none }, cfg)).group;
  for (const m of extra) { g = unwrap(inviteToGroup(g, leader, m, null, cfg)); g = unwrap(joinGroup(g, m, T0, cfg)); }
  return g;
}

test('founding costs a great deal and checks the name', () => {
  assert.equal(cfg.placeholder, true);
  const r = foundGuild({ id: 'g1', name: 'Ash Wardens', tag: 'ASH', founder: 'ana', founderChroma: cfg.guild.foundCost, founderGroup: null, banner, now: T0, taken: none }, cfg);
  assert.ok(r.ok);
  assert.equal(r.value.cost, cfg.guild.foundCost);
  assert.ok(cfg.guild.foundCost >= 50 * 100, 'a great deal: at least fifty starting purses');
  assert.ok(!foundGuild({ id: 'g', name: 'Ash Wardens', tag: 'ASH', founder: 'x', founderChroma: cfg.guild.foundCost - 1, founderGroup: null, banner, now: T0, taken: none }, cfg).ok);
  assert.ok(!foundGuild({ id: 'g', name: 'ash wardens', tag: 'NEW', founder: 'x', founderChroma: 1e6, founderGroup: null, banner, now: T0, taken: { names: ['Ash Wardens'], tags: [] } }, cfg).ok);
  assert.ok(!foundGuild({ id: 'g', name: 'Ok Name', tag: 'OK', founder: 'x', founderChroma: 1e6, founderGroup: 'other', banner, now: T0, taken: none }, cfg).ok);
  assert.ok(!foundGuild({ id: 'g', name: 'x', tag: 'OK', founder: 'x', founderChroma: 1e6, founderGroup: null, banner, now: T0, taken: none }, cfg).ok);
  const strict = { ...cfg, bannedNameWords: ['forbidden'] };
  assert.ok(!foundGuild({ id: 'g', name: 'The Forbidden', tag: 'TF', founder: 'x', founderChroma: 1e6, founderGroup: null, banner, now: T0, taken: none }, strict).ok);
});

test('guild holds 30, clan 50; upgrading costs more again from the vault', () => {
  const members = Array.from({ length: 29 }, (_, i) => `m${i}`);
  let g = guild('g1', 'lead', members);
  assert.equal(g.members.length, 30);
  assert.ok(!inviteToGroup(g, 'lead', 'extra', null, cfg).ok);
  assert.ok(!upgradeToClan(g, 'lead', cfg).ok, 'vault too poor');
  g = unwrap(deposit(g, 'm1', cfg.clan.upgradeCost));
  assert.ok(!upgradeToClan(g, 'm1', cfg).ok, 'only the leader');
  const up = unwrap(upgradeToClan(g, 'lead', cfg));
  assert.ok(up.cost > cfg.guild.foundCost);
  assert.equal(up.group.kind, 'clan');
  assert.equal(up.group.vault.chroma, 0);
  let c = up.group;
  for (let i = 0; i < 20; i++) { c = unwrap(inviteToGroup(c, 'lead', `n${i}`, null, cfg)); c = unwrap(joinGroup(c, `n${i}`, T0, cfg)); }
  assert.equal(c.members.length, 50);
  assert.ok(!inviteToGroup(c, 'lead', 'n99', null, cfg).ok);
  assert.ok(!inviteToGroup(guild('g2', 'z'), 'z', 'n1', 'g1', cfg).ok, 'one group at a time');
});

test('anyone may join, any nation, Lit or Dim; only leader and officers invite', () => {
  const g = guild('g1', 'lead', ['a']);
  assert.ok(!inviteToGroup(g, 'a', 'b', null, cfg).ok);
  const off = unwrap(setRank(g, 'lead', 'a', 'officer'));
  assert.ok(inviteToGroup(off, 'a', 'b', null, cfg).ok);
});

test('vault: rank allowances, daily limits, leaver takes nothing, land stays', () => {
  let g = guild('g1', 'lead', ['off', 'mem', 'rec']);
  g = unwrap(setRank(g, 'lead', 'off', 'officer'));
  g = unwrap(setRank(g, 'lead', 'mem', 'member'));
  g = unwrap(deposit(g, 'mem', 1000, { ember_glass: 4 }));
  assert.ok(!withdraw(g, 'rec', 1).ok, 'recruits take nothing');
  assert.ok(!withdraw(g, 'mem', 0, { ember_glass: 1 }).ok, 'members may not take items');
  g = unwrap(withdraw(g, 'mem', 50));
  assert.ok(!withdraw(g, 'mem', 1).ok, 'daily allowance used');
  g = newDay(g);
  assert.ok(withdraw(g, 'mem', 50).ok);
  g = unwrap(withdraw(g, 'off', 100, { ember_glass: 2 }));
  assert.equal(g.vault.items.ember_glass, 2);
  g = unwrap(setVaultRight(g, 'lead', 'member', { chromaPerDay: 0, items: false }));
  assert.ok(!withdraw(newDay(g), 'mem', 1).ok, 'the leader decides who can take what');
  g = unwrap(addLand(g, 'off', 'plot_7', cfg));
  const before = g.vault.chroma;
  const left = unwrap(leaveGroup(g, 'off'));
  assert.equal(left.vault.chroma, before, 'leaver takes nothing');
  assert.equal(left.land.plot_7, 'off', 'land paid for stays with the group');
  assert.ok(!leaveGroup(g, 'lead').ok, 'leader hands over first');
  assert.ok(!expel(g, 'mem', 'off').ok, 'cannot expel someone above you');
  assert.ok(expel(g, 'off', 'mem').ok);
});

test('pooled land limit grows with members up to the cap', () => {
  const g = guild('g1', 'lead', ['a', 'b']);
  assert.equal(landLimit(g, cfg), 3);
  let h = g;
  for (const p of ['p1', 'p2', 'p3']) h = unwrap(addLand(h, 'lead', p, cfg));
  assert.ok(!addLand(h, 'lead', 'p4', cfg).ok);
  const big = guild('g2', 'lead', Array.from({ length: 29 }, (_, i) => `m${i}`));
  assert.equal(landLimit(big, cfg), cfg.guild.landCap);
  assert.equal(landLimit({ ...big, kind: 'clan' }, cfg), Math.min(cfg.clan.landCap, 30));
});

test('banner shows over members only', () => {
  const g = guild('g1', 'lead', ['a']);
  assert.equal(bannerFor([g], 'a')?.tag, 'G1');
  assert.equal(bannerFor([g], 'stranger'), null);
});

test('war: declared and accepted by both sides; fights inside carry no red flag', () => {
  const a = guild('ga', 'la', ['a1']);
  const b = guild('gb', 'lb', ['b1']);
  assert.ok(!declareWar({ id: 'w', attacker: a, defender: b, by: 'a1', now: T0, wars: [] }, cfg).ok, 'leaders only');
  let w: War = unwrap(declareWar({ id: 'w1', attacker: a, defender: b, by: 'la', now: T0, wars: [] }, cfg));
  const ctx = { attacker: 'a1', defender: 'b1', attackerGroup: 'ga', defenderGroup: 'gb', zone: 'road' as const, duels: [] };
  assert.equal(fightConsequence({ ...ctx, wars: [w] }).redFlag, true, 'not yet accepted');
  assert.ok(!answerWar(w, b, 'b1', true, T0, cfg).ok);
  w = unwrap(answerWar(w, b, 'lb', true, T0 + 1000, cfg));
  assert.equal(w.state, 'active');
  assert.ok(atWar([w], 'gb', 'ga'));
  assert.equal(fightConsequence({ ...ctx, wars: [w] }).redFlag, false);
  assert.equal(fightConsequence({ ...ctx, attackerGroup: 'gc', wars: [w] }).redFlag, true, 'outsiders still flagged');
  assert.ok(!declareWar({ id: 'w2', attacker: a, defender: b, by: 'la', now: T0 + 2000, wars: [w] }, cfg).ok);
  // Peace: offered by one, accepted by the other, after the minimum length.
  w = unwrap(offerPeace(w, a, 'la'));
  assert.ok(!acceptPeace(w, a, 'la', T0 + 1e9, cfg).ok, 'the other side accepts');
  assert.ok(!acceptPeace(w, b, 'lb', T0 + 2000, cfg).ok, 'too young');
  const ended = unwrap(acceptPeace(w, b, 'lb', T0 + 1000 + cfg.war.minDurationSeconds * 1000, cfg));
  assert.equal(ended.state, 'ended');
  assert.ok(!declareWar({ id: 'w3', attacker: a, defender: b, by: 'la', now: ended.endedAt! + 1000, wars: [ended] }, cfg).ok, 'cooldown');
  assert.ok(declareWar({ id: 'w3', attacker: a, defender: b, by: 'la', now: ended.endedAt! + cfg.war.redeclareCooldownSeconds * 1000 + 1, wars: [ended] }, cfg).ok);
  const s = unwrap(surrender(unwrap(answerWar(unwrap(declareWar({ id: 'w4', attacker: b, defender: a, by: 'lb', now: T0, wars: [] }, cfg)), a, 'la', true, T0, cfg)), a, 'la', T0 + 5));
  assert.equal(s.surrenderedBy, 'ga');
  const late = unwrap(declareWar({ id: 'w5', attacker: a, defender: b, by: 'la', now: T0, wars: [] }, cfg));
  assert.equal(unwrap(answerWar(late, b, 'lb', true, T0 + cfg.war.acceptSeconds * 1000 + 1, cfg)).state, 'expired');
  assert.equal(unwrap(answerWar(late, b, 'lb', false, T0, cfg)).state, 'declined');
});

test('duel: only the agreed stake changes hands; fleeing forfeits; time-out draws', () => {
  const holds = { chroma: 500, items: { ember_glass: 2 } };
  const stakeA = { chroma: 100, items: {} };
  const stakeB = { chroma: 50, items: { ember_glass: 1 } };
  assert.ok(!challenge({ id: 'd', challenger: 'a', target: 'b', challengerStake: { chroma: 600, items: {} }, targetStake: stakeB, challengerHolds: holds, busy: [], now: T0 }, cfg).ok);
  assert.ok(!challenge({ id: 'd', challenger: 'a', target: 'b', challengerStake: stakeA, targetStake: stakeB, challengerHolds: holds, busy: ['b'], now: T0 }, cfg).ok);
  let d: Duel = unwrap(challenge({ id: 'd1', challenger: 'a', target: 'b', challengerStake: stakeA, targetStake: stakeB, challengerHolds: holds, busy: [], now: T0 }, cfg));
  assert.ok(!answerDuel(d, 'a', true, holds, holds, T0, cfg).ok);
  assert.ok(!answerDuel(d, 'b', true, { chroma: 10, items: {} }, holds, T0, cfg).ok, 'target must carry their stake');
  assert.equal(unwrap(answerDuel(d, 'b', true, holds, holds, T0 + cfg.duel.acceptSeconds * 1000 + 1, cfg)).state, 'expired');
  d = unwrap(answerDuel(d, 'b', true, holds, holds, T0 + 1000, cfg));
  // Inside an accepted duel: no flag, stake only.
  const c = fightConsequence({ attacker: 'a', defender: 'b', attackerGroup: null, defenderGroup: null, zone: 'town', wars: [], duels: [d] });
  assert.deepEqual([c.redFlag, c.loot], [false, 'stake']);
  assert.equal(resolveDuel(d, { now: T0 + 2000 }, cfg), null);
  const won = resolveDuel(d, { beaten: 'a', now: T0 + 3000 }, cfg)!;
  assert.equal(won.winner, 'b');
  const pay = duelPayout(won);
  assert.equal(pay.reduce((n, t) => n + t.chroma, 0), 150, 'exactly the two stakes, nothing more');
  assert.ok(pay.every((t) => t.to === 'b'));
  const fled = resolveDuel(d, { distance: { b: cfg.duel.fleeRadius + 1 }, now: T0 + 3000 }, cfg)!;
  assert.deepEqual([fled.winner, fled.how], ['a', 'fled']);
  const dc = resolveDuel(d, { offline: { a: cfg.duel.disconnectForfeitSeconds + 1 }, now: T0 + 3000 }, cfg)!;
  assert.equal(dc.winner, 'b');
  const draw = resolveDuel(d, { now: T0 + 1000 + cfg.duel.timeLimitSeconds * 1000 + 1 }, cfg)!;
  assert.equal(draw.how, 'draw');
  assert.deepEqual(duelPayout(draw).map((t) => [t.to, t.chroma]), [['a', 100], ['b', 50]]);
});

test('red flags: unprovoked attacks flag, lawless zones loot fully, self-defence is free', () => {
  const base = { attacker: 'a', defender: 'b', attackerGroup: null, defenderGroup: null, wars: [], duels: [] };
  assert.deepEqual(fightConsequence({ ...base, zone: 'town' }), { redFlag: true, loot: 'materials', why: 'An unprovoked attack' });
  assert.deepEqual(fightConsequence({ ...base, zone: 'lawless' }).loot, 'full');
  assert.equal(fightConsequence({ ...base, zone: 'lawless' }).redFlag, false);
  assert.equal(fightConsequence({ ...base, zone: 'road', defenderStarted: true }).redFlag, false);
});
