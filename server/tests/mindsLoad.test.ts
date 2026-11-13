import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { GAME_HOUR_MS, SINDR_TOWNSFOLK, speaksBanished } from '@elements/shared';
import { migrateDatabase, setDatabase } from '../src/db.js';
import {
  AgentEventQueue,
  ConversationService,
  ModelRouter,
  generateBatchPlans,
  getProviderConfigs,
  type AgentPlanContext,
} from '../src/economy/index.js';
import { ensureSindrMerchants } from '../src/economy/agents/agentLoop.js';
import { allKeys, defaultResponder, fakeFetch, type FakeCall } from './helpers/fakeProviders.js';

// The generous plan under load: 50 players and 300 keepers (20 towns of 15) through one hour of event storm.
// The clock is simulated a second at a time. The fake providers keep their real per-minute limits and answer 429
// past them, so a governor that overspends shows up as refusals. Set LOAD_REPORT=<file> to write the
// calls-per-provider-per-minute table.

const PLAYERS = 50;
const TOWNS = 20;
const KEEPERS_PER_TOWN = 15;
const SECONDS = 3600;
const T0 = 20_000 * 24 * GAME_HOUR_MS + 10 * GAME_HOUR_MS;

/** Small seeded random, so the storm is the same every run. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('Load: 50 players, 300 keepers, an hour of event storm: no provider overspent, nothing blocked, every player answered', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);
  const rand = seeded(42);
  let now = T0;

  const configs = getProviderConfigs();
  const rpm = Object.fromEntries(Object.entries(configs).map(([k, c]) => [k, c!.rpm]));
  // Providers that refuse past their real per-minute limit.
  const minuteCount = new Map<string, number>();
  let refusals = 0;
  const fake = fakeFetch((call: FakeCall) => {
    const key = `${call.provider}:${Math.floor((call.at - T0) / 60_000)}`;
    const n = (minuteCount.get(key) ?? 0) + 1;
    minuteCount.set(key, n);
    if (n > (rpm[call.provider] ?? 0)) {
      refusals++;
      return 429;
    }
    if (call.intent === 'conversation' && rand() < 0.05) return 'Aye, the water is cold.'; // a model slipping
    return defaultResponder(call);
  }, () => now);
  const router = new ModelRouter({ fetchFn: fake.fetch, keyFor: allKeys, now: () => now, log: () => {} });
  const queue = new AgentEventQueue();
  const talk = new ConversationService({ router, queue });

  const towns = Array.from({ length: TOWNS }, (_, i) => `town_${i}`);
  const keepers = new Map<string, AgentPlanContext[]>(towns.map((town) => [
    town,
    Array.from({ length: KEEPERS_PER_TOWN }, (_, k) => ({
      id: `${town}_keeper_${k}`,
      role: 'keeper',
      name: `Keeper ${k}`,
      character: 'A keeper of a counter.',
      purse: 5000,
      stock: { shard: { stock: 20, maxStock: 40 }, potion: { stock: 10, maxStock: 20 } },
    })),
  ]));
  assert.equal([...keepers.values()].flat().length, 300);
  const players = Array.from({ length: PLAYERS }, (_, i) => ({ id: `acct_load_${i}`, town: towns[i % TOWNS]! }));
  const people = SINDR_TOWNSFOLK.map((p) => p.keeps ?? p.id);

  // The morning plans for every town.
  for (const town of towns) await generateBatchPlans({ placeId: town, agents: keepers.get(town)!, phase: 'morning', router, db, now });

  let events = 0;
  let significant = 0;
  let recordMs = 0;
  let conversations = 0;
  let writtenReplies = 0;
  const pressureByMinute: number[] = [];
  const types = ['robbery', 'theft', 'purse_low', 'flood', 'rival_price'];

  for (let sec = 0; sec < SECONDS; sec++) {
    now = T0 + sec * 1000;
    // The storm: every player acts about every two seconds; one action in six is significant.
    const started = performance.now();
    for (const p of players) {
      if (rand() > 0.5) continue;
      const list = keepers.get(p.town)!;
      const keeper = list[Math.floor(rand() * list.length)]!;
      const isSignificant = rand() < 1 / 6;
      queue.recordEvent(p.town, keeper.id, isSignificant
        ? { tier: 'significant', type: types[Math.floor(rand() * types.length)]!, description: 'Something happened nearby.' }
        : { tier: 'ordinary', type: 'sale', description: 'Sold 1 Crimson shards.' }, router.governor, now);
      events++;
      if (isSignificant) significant++;
    }
    recordMs += performance.now() - started;

    // Face to face: each player speaks about every 40 seconds.
    for (const p of players) {
      if (rand() > 1 / 40) continue;
      const res = await talk.talk({ accountId: p.id, agentId: people[Math.floor(rand() * people.length)]!, message: 'What news?' }, db, now);
      assert.ok(res && res.reply.length > 0, 'every player gets an answer');
      assert.ok(!speaksBanished(res.reply), res.reply);
      conversations++;
      if (res.source === 'written') writtenReplies++;
    }

    // The loop's flush: every town checks each second; the governor decides when it may go.
    for (const town of towns) {
      await queue.flushDirtyAgents({
        placeId: town,
        phase: 'morning',
        contextFor: (id) => {
          const k = keepers.get(town)!.find((a) => a.id === id);
          return k ? { ...k, events: queue.eventLines(id) } : null;
        },
        router,
        governor: router.governor,
        db,
        now,
      });
    }
    if (sec % 60 === 59) pressureByMinute.push(router.governor.getPressureLevel(now));
  }

  // Calls per provider per minute, from the providers' side.
  const minutes = Array.from({ length: SECONDS / 60 }, (_, m) => m);
  const providers = Object.keys(rpm).filter((k) => k !== 'nearai');
  const table = minutes.map((m) => Object.fromEntries(providers.map((p) => [p, fake.calls.filter((c) => c.provider === p && Math.floor((c.at - T0) / 60_000) === m).length])));
  const totals = Object.fromEntries(providers.map((p) => [p, fake.calls.filter((c) => c.provider === p).length]));
  const byIntent = fake.calls.reduce<Record<string, number>>((a, c) => ((a[c.intent] = (a[c.intent] ?? 0) + 1), a), {});
  const summary = {
    players: PLAYERS,
    keepers: 300,
    seconds: SECONDS,
    events,
    significant,
    deferred: queue.stats.deferred,
    flushes: queue.stats.flushes,
    flushedKeepers: queue.stats.flushedAgents,
    conversations,
    writtenReplies,
    calls: fake.calls.length,
    byIntent,
    totals,
    refusals,
    pressureByMinute,
    recordMicrosPerEvent: Math.round((recordMs * 1000) / events),
  };
  console.log(`[load] ${JSON.stringify(summary)}`);
  if (process.env.LOAD_REPORT) {
    const rows = table.map((row, m) => `| ${m + 1} | ${providers.map((p) => row[p]).join(' | ')} | ${pressureByMinute[m]} |`);
    fs.writeFileSync(process.env.LOAD_REPORT, [
      `| minute | ${providers.join(' | ')} | pressure |`,
      `|---|${providers.map(() => '---').join('|')}|---|`,
      ...rows,
      '',
      '```json',
      JSON.stringify(summary, null, 2),
      '```',
      '',
    ].join('\n'));
  }

  // No provider was ever asked past its per-minute limit: the governor held every budget.
  assert.equal(refusals, 0, 'no 429 from any provider');
  for (const row of table) for (const p of providers) assert.ok(row[p]! <= rpm[p]!, `${p} within ${rpm[p]} a minute`);
  // Events never call a model: every event-intent call is one batched flush (a flush with no provider free makes none).
  assert.ok((byIntent.event ?? 0) <= queue.stats.flushes);
  assert.ok(fake.calls.length < events / 20, `${fake.calls.length} calls for ${events} events`);
  assert.ok(queue.stats.flushedAgents >= queue.stats.flushes, 'a flush re-plans at least one keeper');
  // Spread through the hour: no ten minutes of the storm go without a model call.
  for (let m = 0; m + 10 <= minutes.length; m += 10) assert.ok(table.slice(m, m + 10).some((row) => providers.some((p) => row[p]! > 0)), `calls in minutes ${m + 1}-${m + 10}`);
  // Storm traffic (talk and flushes; the phase plans are the fixed core) never bursts in one minute.
  for (const m of minutes) {
    const storm = fake.calls.filter((c) => c.intent !== 'plan' && Math.floor((c.at - T0) / 60_000) === m).length;
    assert.ok(storm <= 12, `minute ${m + 1}: ${storm} storm calls`);
  }
  // As the day budget drains the governor stretches, then defers, then answers from written lines.
  assert.ok(Math.max(...pressureByMinute) >= 2, `pressure rose: ${pressureByMinute.join(',')}`);
  assert.ok(queue.stats.deferred > 0, 'significant events were deferred to the next plan under pressure');
  assert.ok(writtenReplies > 0 && writtenReplies < conversations, 'some players were answered from written lines, not all');
  // Recording an event is bookkeeping, not a call: it stays far under a millisecond.
  assert.ok(summary.recordMicrosPerEvent < 200, `${summary.recordMicrosPerEvent} µs an event`);
});
