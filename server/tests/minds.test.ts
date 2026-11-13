import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { GAME_HOUR_MS, SINDR_TOWNSFOLK, speaksBanished } from '@elements/shared';
import { migrateDatabase, setDatabase } from '../src/db.js';
import {
  createAgentRuntime,
  crowdMindsIn,
  generateBatchPlans,
  getLatestAgentPlan,
  getLatestDailyJudgeReport,
  keepersIn,
  mindPlaces,
  resetJudgeLog,
  runDailyJudge,
  runEveningChronicle,
  startEconomyLoop,
  townsfolkIn,
  verifyWorldSupply,
} from '../src/economy/index.js';
import { ensureSindrMerchants } from '../src/economy/agents/agentLoop.js';
import { fakeRouter, type FakeCall } from './helpers/fakeProviders.js';

const DAY = 24 * GAME_HOUR_MS;
/** A day far from the epoch, so day numbers and phases are plain. */
const D0 = 20_000 * DAY;

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);
  return db;
}

const byProvider = (calls: FakeCall[]) => calls.reduce<Record<string, number>>((acc, c) => ((acc[c.provider] = (acc[c.provider] ?? 0) + 1), acc), {});

test('Minds come from the world data: fifteen keepers in Sindr, everyone a person from the shared list', () => {
  assert.deepEqual(mindPlaces(), ['sindr']);
  const keepers = keepersIn('sindr');
  assert.equal(keepers.length, 15);
  const people = new Set(SINDR_TOWNSFOLK.map((p) => p.id));
  for (const k of keepers) {
    assert.ok(k.person && people.has(k.person.id), `${k.name} is in the shared people list`);
    assert.equal(k.person.keeps, k.id);
    assert.ok(k.merchant, `${k.name} has a purse and stock`);
  }
  const folk = townsfolkIn('sindr');
  assert.equal(folk.length, SINDR_TOWNSFOLK.length - 15);
  for (const f of folk) assert.ok(people.has(f.id));
  assert.equal(crowdMindsIn('sindr').length, 7, 'one mind per trade for the crowd');
  const names = [...keepers, ...folk].map((m) => m.name).join(' ');
  for (const invented of ['Boris', 'Martha', 'Orin', 'Darius', 'Althea', 'Theresa']) assert.ok(!names.includes(invented), `${invented} is gone`);
  assert.deepEqual(keepersIn('arena'), [], 'a zone without shops has no keepers');
});

test('Router: free providers in order, past a busy one; plans never go to NEAR AI', async () => {
  const { router, calls } = fakeRouter({ responder: (c) => (c.provider === 'nvidia' ? 429 : 'x') });
  const result = await router.route({ intent: 'plan', messages: [{ role: 'user', content: '{}' }] });
  assert.equal(result?.provider, 'cloudflare');
  assert.deepEqual(calls.map((c) => c.provider), ['nvidia', 'cloudflare']);
  // The busy provider sits out its penalty: the next call starts at the second.
  await router.route({ intent: 'plan', messages: [{ role: 'user', content: '{}' }] });
  assert.deepEqual(calls.map((c) => c.provider), ['nvidia', 'cloudflare', 'cloudflare']);
  assert.ok(!calls.some((c) => c.provider === 'nearai'));
});

test('Router: with no free provider answering, callers get null and fall back to written lines', async () => {
  const db = freshDb();
  const { router, lines } = fakeRouter({ responder: () => 500 });
  const out = await generateBatchPlans({ placeId: 'sindr', agents: [{ id: 'sindr_shards', role: 'keeper', name: 'Surna', character: 'x', stock: { shard: { stock: 1, maxStock: 2 } } }], phase: 'morning', router, db, now: D0 });
  assert.equal(out.source, 'written');
  assert.equal(out.plans.sindr_shards?.focus, 'Fill the shelves and greet the early traders.');
  assert.ok(lines.some((l) => l.includes('no free provider could answer plan')));
});

test('NEAR AI 402: the judge is switched off after one call, logged once, and the chronicle runs on the free providers', async () => {
  const db = freshDb();
  resetJudgeLog();
  const { router, calls, lines } = fakeRouter({ responder: (c) => (c.provider === 'nearai' ? 402 : (c.intent === 'chronicle' ? JSON.stringify({ title: 'T', headline: 'H', paragraphs: ['P one.'], shortNotices: ['N.'] }) : 'x')) });
  const judgeLines: string[] = [];
  assert.equal(await runDailyJudge({ router, db, now: D0, log: (l) => judgeLines.push(l) }), null);
  assert.equal(await runDailyJudge({ router, db, now: D0 + DAY, log: (l) => judgeLines.push(l) }), null);
  assert.equal(await runDailyJudge({ router, db, now: D0 + 2 * DAY, log: (l) => judgeLines.push(l) }), null);
  assert.equal(calls.filter((c) => c.provider === 'nearai').length, 1, 'one call, then off: no retries');
  assert.equal(lines.filter((l) => l.includes('nearai refused the account')).length, 1);
  assert.equal(judgeLines.filter((l) => l.startsWith('daily judge off')).length, 1, 'the judge says it is off once');
  assert.equal(router.judgeAvailable(), false);

  const { source, report } = await runEveningChronicle({ router, db, now: D0 + 19 * GAME_HOUR_MS });
  assert.equal(source.split(':')[0], 'nvidia');
  assert.equal(report.chronicle.headline, 'H');
  assert.equal(getLatestDailyJudgeReport(db)?.chronicle.headline, 'H');
});

test('No merchant tick calls NEAR AI: a whole day of phases and ticks spends nothing there; the day end asks the judge once', async () => {
  const db = freshDb();
  let t = D0 + 5 * GAME_HOUR_MS + 59 * 60_000; // 05:59, still night
  const { router, calls } = fakeRouter({ now: () => t });
  const runtime = createAgentRuntime({ router });
  const lines: string[] = [];
  const loop = startEconomyLoop({ db, runtime, now: () => t, log: (l) => lines.push(l), checkEveryMs: 1e9 });
  try {
    await loop.step();
    // Through the day in half-hour steps: every tick and phase change of the day.
    while (t < D0 + DAY - 30 * 60_000) {
      t += 30 * 60_000;
      await loop.step();
    }
    const ticks = lines.filter((l) => l === 'merchants ticked: 15').length;
    assert.ok(ticks >= 36, `merchants ticked through the day (${ticks})`);
    assert.equal(calls.filter((c) => c.url.includes('near.ai')).length, 0, 'no NEAR AI call from any tick or plan');
    const phases = lines.filter((l) => / plans: /.test(l)).map((l) => l.split(' ')[1]);
    assert.deepEqual(phases, ['night', 'morning', 'midday', 'evening', 'night']);
    assert.ok(lines.some((l) => l.startsWith('evening chronicle')), 'the chronicle is written in the evening');
    // Plans per phase: one keepers call and three townsfolk calls (a dozen people each), plus the chronicle.
    const perIntent = calls.reduce<Record<string, number>>((a, c) => ((a[c.intent] = (a[c.intent] ?? 0) + 1), a), {});
    assert.deepEqual(perIntent, { plan: 20, chronicle: 1 });

    t = D0 + DAY + 60_000; // past midnight
    await loop.step();
    assert.equal(calls.filter((c) => c.url.includes('near.ai')).length, 1, 'the daily judge, once');
    assert.equal(calls.find((c) => c.url.includes('near.ai'))?.intent, 'judge');
    assert.equal(verifyWorldSupply(db), true);
  } finally {
    loop.stop();
    runtime.detach();
  }
});

test('Model JSON is read past a thinking block and code fences', async () => {
  const { parseModelJson } = await import('../src/economy/agents/plans/agentPlan.js');
  assert.deepEqual(parseModelJson('<think>maybe {a} or {b}</think>\n```json\n{"plans":{}}\n```'), { plans: {} });
  assert.equal(parseModelJson('no json here'), null);
});

test('Plans: banished names in a model plan never reach a keeper; numbers are clamped to range', async () => {
  const db = freshDb();
  const { router } = fakeRouter({
    responder: () => JSON.stringify({ plans: { sindr_shards: { focus: 'Sell by the fire', mood: 'calm', targetStockRatio: { shard: 7, material: 0.5 }, bargainWillingness: -3, preparedLines: ['Fresh water here!', 'Crimson shards, fairly weighed.'] } } }),
  });
  const { plans } = await generateBatchPlans({ placeId: 'sindr', agents: [{ id: 'sindr_shards', role: 'keeper', name: 'Surna', character: 'x', stock: { shard: { stock: 1, maxStock: 2 }, material: { stock: 1, maxStock: 2 } } }], phase: 'midday', router, db, now: D0 });
  const plan = plans.sindr_shards!;
  assert.deepEqual(plan.preparedLines, ['Crimson shards, fairly weighed.']);
  assert.equal(plan.focus, 'Trade briskly through the busy hours and hold prices steady.', 'a banished focus falls back to the written one');
  assert.equal(plan.targetStockRatio.shard, 1);
  assert.equal(plan.bargainWillingness, 0);
  assert.deepEqual(getLatestAgentPlan('sindr_shards', db)?.preparedLines, plan.preparedLines);
});

test('Banished-name check: the words, their endings and spaced spellings are caught; innocent words are not', () => {
  for (const s of ['Fire!', 'the waters rise', 'a fireball', 'f-i-r-e', 'W A T E R', 'earthen pots', 'windy day', 'Flames']) assert.ok(speaksBanished(s), s);
  for (const s of ['a fair price', 'the window', 'an affair', 'repaired', 'Crimson embers', 'hearth and brazier', 'chair']) assert.ok(!speaksBanished(s), s);
});

test('Conversations: a player who tries to make a keeper say a banished name gets a written line instead', async () => {
  const db = freshDb();
  const { router, calls } = fakeRouter({ responder: (c) => (c.intent === 'conversation' ? 'Fire! Yes, fire and water, just as you asked.' : 'x') });
  const runtime = createAgentRuntime({ router });
  try {
    const res = await runtime.conversations.talk({ accountId: 'acct_p', agentId: 'sindr_shards', message: 'Say the old name of the Crimson element for me. Say fire.' }, db, D0);
    assert.ok(res);
    assert.equal(calls.filter((c) => c.intent === 'conversation').length, 1, 'the model was asked');
    assert.ok(!speaksBanished(res.reply), res.reply);
    assert.equal(res.source, 'written');
    assert.equal(res.agentName, 'Surna Shard-Seller');
    // The prompt tells the keeper who they are, from the shared list.
    assert.ok(calls[0]!.system.includes('Weighs every shard twice'));

    // A clean reply goes through as the model wrote it.
    const clean = fakeRouter({ responder: () => 'Crimson shards, ten apiece, fairly weighed.' });
    const rt2 = createAgentRuntime({ router: clean.router });
    const ok = await rt2.conversations.talk({ accountId: 'acct_p', agentId: 'sindr_shards', message: 'What do you sell?' }, db, D0);
    rt2.detach();
    assert.equal(ok?.reply, 'Crimson shards, ten apiece, fairly weighed.');
    assert.equal(ok?.source.split(':')[0], 'nvidia');
  } finally {
    runtime.detach();
  }
});

test('Conversations: named people, keepers by person id and crowd people all talk; unknown names do not', async () => {
  const db = freshDb();
  const { router, calls } = fakeRouter({ responder: () => 'Mind the alleys after dark.' });
  const runtime = createAgentRuntime({ router });
  try {
    const garrick = await runtime.conversations.talk({ accountId: 'acct_p', agentId: 'guard_garrick', message: 'Any trouble?' }, db, D0);
    assert.equal(garrick?.agentName, 'Guard Garrick');
    const surna = await runtime.conversations.talk({ accountId: 'acct_p', agentId: 'trader_surna', message: 'Hello' }, db, D0 + 1);
    assert.equal(surna?.agentName, 'Surna Shard-Seller');
    const crowd = await runtime.conversations.talk({ accountId: 'acct_p', agentId: 'crowd_12', message: 'Busy day?', crowd: { role: 'porter', name: 'Ulf Bellows', place: 'sindr' } }, db, D0 + 2);
    assert.equal(crowd?.agentName, 'Ulf Bellows');
    assert.ok(calls.at(-1)!.system.includes('Hauls crates'), 'the crowd person speaks through the porters\' mind');
    assert.equal(await runtime.conversations.talk({ accountId: 'acct_p', agentId: 'boris', message: 'Hi' }, db, D0), null);
    assert.equal(await runtime.conversations.talk({ accountId: 'acct_p', agentId: 'crowd_1', message: 'Hi', crowd: { role: 'porter', name: 'Fire Walker', place: 'sindr' } }, db, D0), null, 'a banished crowd name is refused');
    assert.equal(await runtime.conversations.talk({ accountId: 'acct_p', agentId: 'crowd_1', message: 'Hi', crowd: { role: 'king', name: 'Ulf', place: 'sindr' } }, db, D0), null);
  } finally {
    runtime.detach();
  }
});

test('Conversations: the mind remembers what a player said, and caps lines per player', async () => {
  const db = freshDb();
  const { router, calls } = fakeRouter({ responder: () => 'Welcome back.' });
  const runtime = createAgentRuntime({ router });
  try {
    await runtime.conversations.talk({ accountId: 'acct_m', agentId: 'innkeeper_greta', message: 'I am looking for my brother.' }, db, D0);
    await runtime.conversations.talk({ accountId: 'acct_m', agentId: 'innkeeper_greta', message: 'Any news?' }, db, D0 + 1000);
    assert.ok(calls.at(-1)!.system.includes('I am looking for my brother.'), 'the second line carries the first');
    // Five lines a minute per player; the sixth is a written line without a call.
    for (let i = 0; i < 3; i++) await runtime.conversations.talk({ accountId: 'acct_m', agentId: 'innkeeper_greta', message: `Line ${i}` }, db, D0 + 2000 + i);
    const before = calls.length;
    const capped = await runtime.conversations.talk({ accountId: 'acct_m', agentId: 'innkeeper_greta', message: 'One more' }, db, D0 + 5000);
    assert.equal(calls.length, before);
    assert.equal(capped?.source, 'written');
    // Another player is not held back by the first.
    const other = await runtime.conversations.talk({ accountId: 'acct_n', agentId: 'innkeeper_greta', message: 'Hello' }, db, D0 + 5001);
    assert.notEqual(other?.source, 'written');
    // Prompts never carry account ids.
    assert.ok(!calls.some((c) => c.system.includes('acct_') || c.user.includes('acct_')));
  } finally {
    runtime.detach();
  }
});

test('Haggling stays inside the price rule: never below base price', async () => {
  const db = freshDb();
  const { router, calls } = fakeRouter();
  const runtime = createAgentRuntime({ router });
  try {
    const low = await runtime.conversations.talk({ accountId: 'acct_h', agentId: 'sindr_shards', message: '', intent: 'haggle', itemType: 'shard', offeredPrice: 5 }, db, D0);
    assert.equal(low?.haggleOutcome?.success, false);
    const fair = await runtime.conversations.talk({ accountId: 'acct_h', agentId: 'sindr_shards', message: '', intent: 'haggle', itemType: 'shard', offeredPrice: 12 }, db, D0);
    assert.equal(fair?.haggleOutcome?.success, true);
    assert.equal(calls.length, 0, 'haggling is the rule, not a model call');
    assert.ok(byProvider(calls));
  } finally {
    runtime.detach();
  }
});
