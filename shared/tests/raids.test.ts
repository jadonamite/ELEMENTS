import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  accept, abandonRun, abandonedFighters, applyHallActions, applyRaidLoss, bagValue, clearRoom, createParty, decideFlee,
  decideHall, decideJob, decideSalvage, fighterDied, fighterFled, fighterFromTemplate, fighterWage, invite, isBarred,
  judgeComplaint, keyPrice, kick, leave, memberDown, planRun, recruit, salvageQuote, seededRng, setLootRule, settleFighter,
  splitLoot, startRun, validateHallAction, type HallState, type RaidsConfig, type Fighter, type Complaint,
} from '../src/index.js';

const cfg = JSON.parse(readFileSync(new URL('../balance.json', import.meta.url), 'utf8')).raids as RaidsConfig;
const dungeon = cfg.dungeons.sindr_undervault!;
const T0 = 1_000_000;

test('raids block is marked placeholder and every referenced kind exists as data', () => {
  assert.equal(cfg.placeholder, true);
  for (const k of Object.values(cfg.keys)) assert.ok(cfg.dungeons[k.dungeon], 'key opens a real dungeon');
  for (const t of [...dungeon.loot.fight, ...dungeon.loot.boss]) assert.ok(cfg.itemKinds[t.item], `${t.item} is a known item kind`);
  for (const r of Object.values(dungeon.rooms)) if (r.carving) assert.ok(dungeon.carvings[r.carving]);
  for (const f of cfg.fighters.roster) assert.notEqual(f.element as string, 'VAKNA');
});

test('rooms: entry first, three shuffled fight rooms, boss last; two runs differ', () => {
  const a = planRun(dungeon, 1);
  const b = planRun(dungeon, 2, a.order);
  for (const p of [a, b]) {
    assert.equal(p.order.length, 5);
    assert.equal(p.order[0], 'vault_gate');
    assert.equal(p.order.at(-1), 'warden_chamber');
    assert.equal(new Set(p.order).size, 5);
    for (const id of p.order.slice(1, -1)) assert.equal(dungeon.rooms[id]!.kind, 'fight');
  }
  assert.notDeepEqual(a.order, b.order);
  // Same seed, same order: every client of the party builds the same ruin.
  assert.deepEqual(planRun(dungeon, 1).order, a.order);
  // Even a seed that would repeat the last order is redrawn.
  assert.notDeepEqual(planRun(dungeon, 1, a.order).order, a.order);
  const seen = new Set(Array.from({ length: 40 }, (_, i) => planRun(dungeon, i + 10).order.join('>')));
  assert.ok(seen.size > 20, `orders vary widely (${seen.size} of 40)`);
});

test('party: invite, accept, leader hand-over, size limit, no joining mid-raid', () => {
  const rules = cfg.party;
  let p = createParty('p1', 'ana');
  const r1 = invite(p, 'ana', 'bo', T0, rules); assert.ok(r1.ok); p = r1.value;
  assert.ok(!accept(p, 'cy', T0, rules).ok, 'no invite, no entry');
  const r2 = accept(p, 'bo', T0 + 1000, rules); assert.ok(r2.ok); p = r2.value;
  assert.deepEqual(p.members, ['ana', 'bo']);
  // Invites run out.
  const r3 = invite(p, 'bo', 'cy', T0, rules); assert.ok(r3.ok);
  assert.ok(!accept(r3.value, 'cy', T0 + rules.inviteSeconds * 1000 + 1, rules).ok);
  // Five at most.
  let q = p;
  for (const id of ['c', 'd', 'e']) { q = (invite(q, 'ana', id, T0, rules) as { ok: true; value: typeof q }).value; q = (accept(q, id, T0, rules) as { ok: true; value: typeof q }).value; }
  assert.equal(q.members.length, 5);
  assert.ok(!invite(q, 'ana', 'f', T0, rules).ok);
  // Leader leaves: the lead passes on.
  const l = leave(p, 'ana'); assert.ok(l.ok); assert.equal(l.value.leaderId, 'bo');
  assert.ok(!kick(p, 'bo', 'ana').ok, 'only the leader kicks');
  const locked = { ...p, inRaid: 'run1' };
  assert.ok(!invite(locked, 'ana', 'zz', T0, rules).ok);
  assert.ok(!setLootRule(locked, 'ana', 'need', rules).ok, 'split is fixed inside');
  assert.ok(setLootRule(p, 'ana', 'leader', rules).ok);
  assert.ok(!setLootRule(p, 'bo', 'leader', rules).ok);
});

test('loot split: equal is fair within one unit, need honours declarations, leader assigns', () => {
  const kinds = cfg.itemKinds;
  const haul = [{ kind: 'warden_core', qty: 1 }, { kind: 'ember_glass', qty: 3 }, { kind: 'old_iron', qty: 5 }, { kind: 'ignis_shard', qty: 4 }];
  const eq = splitLoot(haul, ['a', 'b', 'c'], 'equal', kinds, { leaderId: 'a' });
  const values = Object.values(eq).map((b) => bagValue(b, kinds));
  assert.ok(Math.max(...values) - Math.min(...values) <= 140, `equal shares ${values}`);
  const total = Object.values(eq).reduce((n, b) => n + Object.values(b).reduce((x, y) => x + y, 0), 0);
  assert.equal(total, 13, 'nothing lost or made in the split');
  const need = splitLoot(haul, ['a', 'b'], 'need', kinds, { leaderId: 'a', needs: { b: ['ember_glass'] } });
  assert.equal(need.b!.ember_glass, 3);
  assert.equal(need.a!.ember_glass, undefined);
  const lead = splitLoot(haul, ['a', 'b'], 'leader', kinds, { leaderId: 'a', leaderAssign: { warden_core: 'b' } });
  assert.equal(lead.b!.warden_core, 1);
  assert.equal(lead.a!.old_iron, 5);
});

test('losing takes exactly a quarter of carried CHROMA and items, and wears gear heavily', () => {
  const carried = { chroma: 403, items: { old_iron: 6, ember_glass: 2, ignis_shard: 4 }, gear: [{ id: 'g1', kind: 'ruin_blade', wear: 0.2 }] };
  const r = applyRaidLoss(carried, cfg.loss, seededRng(7));
  assert.equal(r.lostChroma, 100);
  assert.equal(r.kept.chroma, 303);
  const lostN = Object.values(r.lostItems).reduce((a, b) => a + b, 0);
  const keptN = Object.values(r.kept.items).reduce((a, b) => a + b, 0);
  assert.equal(lostN, 3, 'a quarter of 12 units');
  assert.equal(keptN, 9);
  for (const [k, q] of Object.entries(r.lostItems)) assert.equal((r.kept.items[k] ?? 0) + q, carried.items[k as keyof typeof carried.items]);
  assert.equal(r.kept.gear[0]!.wear, 0.5);
  assert.equal(applyRaidLoss({ chroma: 3, items: {}, gear: [] }, cfg.loss, seededRng(1)).lostChroma, 0, 'rounds down');
});

const f = (id: string): Fighter => fighterFromTemplate(cfg.fighters.roster.find((x) => x.id === id)!);

test('fighters: wage rises faster than skill; they refuse grudges and bad names', () => {
  const w = [1, 2, 5, 8].map((s) => fighterWage({ skill: s }, cfg.fighters));
  assert.ok(w[0]! < w[1]! && w[1]! < w[2]! && w[2]! < w[3]!);
  assert.ok(w[3]! / w[0]! > 8 / 1 / 2.5, 'better fighters cost a lot more');
  const kesh = f('f_kesh');
  assert.ok(decideJob(kesh, { employerIds: ['ana'], danger: 3, partyComplaints: 0 }, cfg.fighters).accept);
  const hurt = { ...kesh, memory: { ana: { score: -40, runs: 1, paid: 0, abandoned: 1 } } };
  assert.ok(!decideJob(hurt, { employerIds: ['ana'], danger: 3, partyComplaints: 0 }, cfg.fighters).accept);
  assert.ok(!decideJob(kesh, { employerIds: ['ana'], danger: 3, partyComplaints: 2 }, cfg.fighters).accept);
  assert.ok(!decideJob({ ...kesh, status: 'dead' }, { employerIds: ['ana'], danger: 1, partyComplaints: 0 }, cfg.fighters).accept);
});

test('fighters: a timid one runs when it goes badly, a brave one holds', () => {
  const bad = { health: 0.25, partyStanding: 0.4, fightersDown: 1, playersDown: 0, bossRoom: true, foesHealth: 0.9, loyalty: 0 };
  const good = { health: 0.9, partyStanding: 1, fightersDown: 0, playersDown: 0, bossRoom: false, foesHealth: 0.5, loyalty: 0 };
  const tamsin = f('f_tamsin');
  const dain = f('f_dain');
  assert.equal(decideFlee(tamsin, bad, cfg.fighters, 0.1).flee, true);
  assert.equal(decideFlee(tamsin, good, cfg.fighters, 0.0).flee, false);
  assert.equal(decideFlee(dain, { ...bad, health: 0.5 }, cfg.fighters, 0.1).flee, false);
});

test('fighters: the dead are gone; survivors are paid, remember, and train', () => {
  const brannoc = { ...f('f_brannoc'), purse: 200 };
  const wage = fighterWage(brannoc, cfg.fighters);
  const cut = Math.round(wage * cfg.hall.hireCut);
  const won = settleFighter(brannoc, ['ana'], { outcome: 'stayed', won: true, wage, hallCut: cut, abandoned: false, kills: 4, bossKill: false }, cfg.fighters);
  assert.equal(won.paid, wage - cut);
  assert.equal(won.trained, true);
  assert.equal(won.fighter.skill, brannoc.skill + 1);
  assert.equal(won.fighter.memory.ana!.score, 15);
  const dead = settleFighter(brannoc, ['ana'], { outcome: 'died', won: false, wage, hallCut: cut, abandoned: false, kills: 0, bossKill: false }, cfg.fighters);
  assert.equal(dead.fighter.status, 'dead');
  assert.equal(dead.paid, 0);
  const ran = settleFighter(brannoc, ['ana'], { outcome: 'fled', won: false, wage, hallCut: cut, abandoned: false, kills: 0, bossKill: false }, cfg.fighters);
  assert.equal(ran.paid, 0, 'a fighter who ran forfeits the wage');
  assert.equal(ran.fighter.record.fled, 1);
  const left = settleFighter(brannoc, ['ana'], { outcome: 'stayed', won: false, wage, hallCut: cut, abandoned: true, kills: 0, bossKill: false }, cfg.fighters);
  assert.ok(left.fighter.memory.ana!.score <= cfg.fighters.refuseBelowScore);
  assert.ok(!decideJob(left.fighter, { employerIds: ['ana'], danger: 3, partyComplaints: 0 }, cfg.fighters).accept, 'and then refuses that employer');
  const r = recruit('f_new1', cfg.fighters, 40, seededRng(3), new Set());
  assert.ok(r.skill <= cfg.fighters.skillMin + 2 && cfg.fighters.recruitNames.includes(r.name));
});

const hall = (over: Partial<HallState> = {}): HallState => ({
  id: 'hall_sindr', nation: 'IGNIS', purse: 5000, keyStock: { undervault_key: 8 }, sales: [], complaints: [], barred: {}, jobs: [], memory: {}, ...over,
});

test('hall: key price climbs with demand and scarcity, stays in its band', () => {
  const key = cfg.keys.undervault_key!;
  const calm = keyPrice(hall(), 'undervault_key', key, cfg.hall, T0);
  const busy = keyPrice(hall({ sales: Array.from({ length: 5 }, () => ({ keyId: 'undervault_key', at: T0 - 1000 })) }), 'undervault_key', key, cfg.hall, T0);
  const empty = keyPrice(hall({ keyStock: { undervault_key: 1 } }), 'undervault_key', key, cfg.hall, T0);
  assert.ok(busy > calm && empty > calm, `${calm} ${busy} ${empty}`);
  const extreme = keyPrice(hall({ keyStock: { undervault_key: 0 }, sales: Array.from({ length: 99 }, () => ({ keyId: 'undervault_key', at: T0 })), memory: { x: -100 } }), 'undervault_key', key, cfg.hall, T0, 'x');
  assert.ok(extreme <= key.basePrice * cfg.hall.keyPriceMax);
  const liked = keyPrice(hall(), 'undervault_key', key, cfg.hall, T0, 'friend');
  const lovedHall = hall({ memory: { friend: 100 } });
  assert.ok(keyPrice(lovedHall, 'undervault_key', key, cfg.hall, T0, 'friend') < liked);
});

test('hall: a fighter who ran is upheld from the run record; three upheld bars them', () => {
  const facts = { runId: 'r1', members: ['ana'], fighters: ['f_tamsin'], fled: ['f_tamsin'], abandoned: [] };
  const c = (id: string, at = T0): Complaint => ({ id, kind: 'fighter_fled', by: 'hall', against: 'f_tamsin', runId: 'r1', note: '', at, status: 'open' });
  assert.ok(judgeComplaint(c('c0'), facts).uphold);
  assert.ok(!judgeComplaint(c('c0'), { ...facts, fled: [] }).uphold, 'no flight on record, no complaint');
  assert.ok(!judgeComplaint({ ...c('c0'), by: 'stranger' }, facts).uphold, 'only those on the run may complain');
  const complaints = [c('c1'), c('c2'), c('c3')];
  const h = hall({ complaints });
  const judgements = Object.fromEntries(complaints.map((x) => [x.id, judgeComplaint(x, facts)]));
  const obs = { hall: h, keys: cfg.keys, cfg: cfg.hall, now: T0 + 5, judgements };
  const d = decideHall(obs);
  const out = applyHallActions(obs, d.actions, () => 'job1');
  assert.equal(out.hall.complaints.filter((x) => x.status === 'upheld').length, 3);
  assert.ok(isBarred(out.hall, 'f_tamsin', T0 + 10));
  assert.ok(!isBarred(out.hall, 'f_tamsin', T0 + 10 + cfg.hall.barDays * 86_400_000));
});

test('hall rule file: cannot uphold without record, set prices, overspend or bar early', () => {
  const comp: Complaint = { id: 'c1', kind: 'bad_split', by: 'ana', against: 'bo', runId: 'r1', note: '', at: T0, status: 'open' };
  const obs = { hall: hall({ complaints: [comp], purse: 50 }), keys: cfg.keys, cfg: cfg.hall, now: T0, judgements: { c1: { uphold: false, ruling: 'fair' } } };
  assert.ok(!validateHallAction(obs, { type: 'rule', complaintId: 'c1', uphold: true, ruling: 'I say so' }).valid);
  assert.ok(!validateHallAction(obs, { type: 'restock_keys', keyId: 'undervault_key', quantity: 3, price: 1 } as never).valid);
  assert.ok(!validateHallAction(obs, { type: 'restock_keys', keyId: 'undervault_key', quantity: 3 }).valid, 'purse too small');
  assert.ok(!validateHallAction(obs, { type: 'bar', id: 'bo', days: 7 }).valid);
  // Bad split: equal rule and under half the fair share is upheld.
  const facts = { runId: 'r1', members: ['ana', 'bo'], fighters: [], fled: [], abandoned: [], lootRule: 'equal', shareValues: { ana: 20, bo: 300 } };
  assert.ok(judgeComplaint(comp, facts).uphold);
  assert.ok(!judgeComplaint(comp, { ...facts, lootRule: 'leader' }).uphold);
});

test('hall decider restocks a low shelf and keeps jobs posted', () => {
  const obs = { hall: hall({ keyStock: { undervault_key: 2 } }), keys: cfg.keys, cfg: cfg.hall, now: T0, judgements: {} };
  const out = applyHallActions(obs, decideHall(obs).actions, () => 'j1');
  assert.equal(out.hall.keyStock.undervault_key, cfg.keys.undervault_key!.maxStock);
  assert.equal(out.craftSpend, 10 * cfg.keys.undervault_key!.craftCost);
  assert.equal(out.hall.jobs.length, 1);
});

test('salvage buyer pays under base and under the best merchant, less as it fills, refuses only when full', () => {
  const s = { id: 'salvage_sindr', purse: 8000, holdings: {}, discount: cfg.salvage.baseDiscount };
  const q = salvageQuote(s, 'ember_glass', 3, cfg.itemKinds, cfg.salvage);
  assert.equal(q.accepts, 3);
  assert.ok(q.unitPrice < cfg.itemKinds.ember_glass!.basePrice);
  const capped = salvageQuote(s, 'ember_glass', 3, cfg.itemKinds, cfg.salvage, 20);
  assert.ok(capped.unitPrice <= 18);
  const fuller = salvageQuote({ ...s, holdings: { old_iron: 40 } }, 'ember_glass', 1, cfg.itemKinds, cfg.salvage);
  assert.ok(fuller.unitPrice < q.unitPrice);
  const full = salvageQuote({ ...s, holdings: { old_iron: 60 } }, 'ember_glass', 1, cfg.itemKinds, cfg.salvage);
  assert.equal(full.accepts, 0);
  const broke = salvageQuote({ ...s, purse: 5 }, 'warden_core', 1, cfg.itemKinds, cfg.salvage);
  assert.equal(broke.accepts, 0);
  const d = decideSalvage({ ...s, holdings: { old_iron: 50 } }, cfg.itemKinds, cfg.salvage);
  assert.ok(d.actions.some((a) => a.type === 'ship_onward'));
});

test('run: rooms in order, too-fast clears refused, boss ends it won; fighters die or flee', () => {
  const plan = planRun(dungeon, 42);
  let run = startRun({ id: 'r1', dungeonId: 'sindr_undervault', partyId: 'p1', members: ['ana'], fighters: [{ id: 'f_kesh', wage: 22, employer: 'ana' }, { id: 'f_tamsin', wage: 22, employer: 'ana' }], seed: plan.seed, order: plan.order, now: T0 });
  let t = T0;
  const step = (room: string, dt = 20_000) => { t += dt; const r = clearRoom(run, room, dungeon, t); assert.ok(r.ok, r.ok ? '' : r.reason); run = r.value; };
  step(plan.order[0]!, 1);
  assert.ok(!clearRoom(run, plan.order[2]!, dungeon, t + 30_000).ok, 'cannot skip a room');
  assert.ok(!clearRoom(run, plan.order[1]!, dungeon, t + 1000).ok, 'too fast');
  step(plan.order[1]!);
  const d = fighterDied(run, 'f_kesh', 'Kesh', t); assert.ok(d.ok); run = d.value;
  const fl = fighterFled(run, 'f_tamsin', 'Tamsin', t); assert.ok(fl.ok); run = fl.value;
  assert.ok(!fighterFled(run, 'f_kesh', 'Kesh', t).ok, 'the dead do not run');
  step(plan.order[2]!); step(plan.order[3]!); step(plan.order[4]!);
  assert.equal(run.state, 'won');
  assert.ok(run.loot.some((l) => l.kind === 'warden_core'), 'the boss always gives its core');
  assert.deepEqual(run.fighterStatus, { f_kesh: 'died', f_tamsin: 'fled' });
  assert.deepEqual(abandonedFighters(run), []);
});

test('run: the last player down loses it; walking out leaves standing fighters behind', () => {
  const plan = planRun(dungeon, 9);
  const base = startRun({ id: 'r2', dungeonId: 'sindr_undervault', partyId: 'p', members: ['a', 'b'], fighters: [{ id: 'f_odra', wage: 30, employer: 'a' }], seed: plan.seed, order: plan.order, now: T0 });
  const one = memberDown(base, 'a', T0); assert.ok(one.ok); assert.equal(one.value.state, 'active');
  const two = memberDown(one.value, 'b', T0); assert.ok(two.ok); assert.equal(two.value.state, 'lost');
  assert.deepEqual(abandonedFighters(two.value), [], 'a beaten party left nobody behind');
  const out = abandonRun(base, T0); assert.ok(out.ok); assert.equal(out.value.state, 'abandoned');
  assert.deepEqual(abandonedFighters(out.value), ['f_odra']);
});
