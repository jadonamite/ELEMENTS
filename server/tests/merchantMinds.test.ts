import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  type AgentObservation,
  GAME_HOUR_MS,
  formatActionSummary,
} from '@elements/shared';
import {
  migrateDatabase,
  setDatabase,
} from '../src/db.js';
import {
  NearAiDecider,
} from '../src/economy/agents/nearAiDecider.js';
import {
  ensureSindrMerchants,
  getMerchantMind,
  tickMerchantAgent,
} from '../src/economy/agents/agentLoop.js';
import { recordNpcInteraction } from '../src/economy/npcMemoryService.js';

test('formatActionSummary formats merchant actions into readable character lines', () => {
  assert.equal(formatActionSummary([]), 'Held stock steady');
  assert.equal(
    formatActionSummary([{ type: 'restock', itemType: 'shard', quantity: 10 }], 'IGNIS'),
    'Restocked 10 Crimson shards',
  );
  assert.equal(
    formatActionSummary([{ type: 'tribute', itemType: 'shard', quantity: 15 }], 'IGNIS'),
    'Shipped 15 Crimson shards tribute',
  );
  assert.equal(
    formatActionSummary([
      { type: 'restock', itemType: 'shard', quantity: 10 },
      { type: 'tribute', itemType: 'potion', quantity: 5 },
    ], 'IGNIS'),
    'Restocked 10 Crimson shards, Shipped 5 potions tribute',
  );
});

test('NearAiDecider: applies valid structured JSON response from NEAR AI Cloud', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  let capturedBody: any = null;
  const fakeFetch: typeof fetch = async (_url, init) => {
    capturedBody = JSON.parse(init?.body as string);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [{ type: 'restock', itemType: 'shard', quantity: 12 }],
                reasoning: 'I stocked 12 Crimson shards to keep our counters bright.',
              }),
            },
          },
        ],
      }),
    } as unknown as Response;
  };

  const decider = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'test-sk-key',
    model: 'openai/gpt-4.1-mini',
    fetchFn: fakeFetch,
  });

  const res = await tickMerchantAgent({
    merchantId: 'sindr_shards',
    now: 12 * GAME_HOUR_MS,
    decider,
    db,
  });

  assert.equal(res.thought, 'I stocked 12 Crimson shards to keep our counters bright.');
  assert.equal(res.actionsApplied.length, 1);
  assert.equal(res.actionsApplied[0]?.type, 'restock');
  assert.equal((res.actionsApplied[0] as any).quantity, 12);

  // Check structured output parameter
  assert.equal(capturedBody.response_format?.type, 'json_object');
  assert.equal(capturedBody.model, 'openai/gpt-4.1-mini');

  // Verify getMerchantMind returns the updated reasoning and last decision
  const mind = getMerchantMind('sindr_shards', db);
  assert.ok(mind);
  assert.equal(mind.latestThought, 'I stocked 12 Crimson shards to keep our counters bright.');
  assert.equal(mind.lastDecision, 'Restocked 12 Crimson shards');
});

test('NearAiDecider: drops invalid actions (illegal price, overdraw) and logs cleanly', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  const fakeFetch: typeof fetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [
                  { type: 'set_price', itemType: 'shard', price: 999 },
                  { type: 'restock', itemType: 'shard', quantity: 50000 },
                  { type: 'say', line: 'Welcome to Sindr market.' },
                ],
                reasoning: 'Attempted to hike prices but welcomed travelers anyway.',
              }),
            },
          },
        ],
      }),
    } as unknown as Response;
  };

  const decider = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'test-sk-key',
    model: 'openai/gpt-4.1-mini',
    fetchFn: fakeFetch,
  });

  const obs: AgentObservation = {
    merchantId: 'sindr_shards',
    purse: 20000,
    stock: { shard: { stock: 100, maxStock: 200, basePrice: 10 } },
    demandWindows: {},
    recentTrades: [],
    tributeSchedule: { nextTributeTime: 1000, intervalMs: 1000 },
    timeOfDay: 12,
    isOpen: true,
    status: 'open',
    daysBroke: 0,
    personality: 'A sharp-eyed firebrand.',
    now: 12 * GAME_HOUR_MS,
  };

  const decision = await decider.decide(obs);

  // set_price and over-capacity restock must be dropped by NearAiDecider; say action remains valid
  assert.equal(decision.actions.length, 1);
  assert.equal(decision.actions[0]?.type, 'say');
  assert.equal(decision.reasoning, 'Attempted to hike prices but welcomed travelers anyway.');

  // Applying through tickMerchantAgent in the next tick verifies end-to-end execution
  const res = await tickMerchantAgent({
    merchantId: 'sindr_shards',
    now: 13 * GAME_HOUR_MS,
    decider,
    db,
  });
  assert.equal(res.actionsApplied.length, 1);
  assert.equal(res.actionsApplied[0]?.type, 'say');
});

test('NearAiDecider: falls back cleanly to RuleDecider on timeout and HTTP 402', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  // Case A: Timeout falls back
  const timeoutFetch: typeof fetch = async () => {
    throw new Error('The operation was aborted');
  };

  const timeoutDecider = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'test-sk-key',
    model: 'openai/gpt-4.1-mini',
    fetchFn: timeoutFetch,
    timeoutMs: 50,
  });

  const timeoutRes = await tickMerchantAgent({
    merchantId: 'sindr_shards',
    now: 12 * GAME_HOUR_MS,
    decider: timeoutDecider,
    db,
  });

  assert.ok(timeoutRes.thought.length > 0);
  assert.ok(timeoutRes.purse > 0);

  // Case B: HTTP 402 (No spending limit / empty account credits) falls back
  const paymentRequiredFetch: typeof fetch = async () => {
    return {
      ok: false,
      status: 402,
      json: async () => ({
        error: { message: 'No spending limit configured. Please contact support to set up credits.' },
      }),
    } as unknown as Response;
  };

  const paymentDecider = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'sk-empty-key',
    model: 'openai/gpt-4.1-mini',
    fetchFn: paymentRequiredFetch,
  });

  const paymentRes = await tickMerchantAgent({
    merchantId: 'sindr_shards',
    now: 14 * GAME_HOUR_MS,
    decider: paymentDecider,
    db,
  });

  assert.ok(paymentRes.thought.length > 0);
  assert.ok(paymentRes.purse > 0);
});

test('NearAiDecider: respects hourly cost cap and 1-call-per-tick rate limit', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  let callCount = 0;
  const fakeFetch: typeof fetch = async () => {
    callCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [{ type: 'say', line: 'Greetings.' }],
                reasoning: 'Checking in on the market stalls.',
              }),
            },
          },
        ],
      }),
    } as unknown as Response;
  };

  const decider = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'test-sk-key',
    model: 'openai/gpt-4.1-mini',
    fetchFn: fakeFetch,
    maxCallsPerHour: 3,
  });

  const nowBase = 12 * GAME_HOUR_MS;

  // Calls 1, 2, 3 should hit fetchFn
  await tickMerchantAgent({ merchantId: 'sindr_shards', now: nowBase + 1000, decider, db });
  await tickMerchantAgent({ merchantId: 'sindr_supplies', now: nowBase + 2000, decider, db });
  await tickMerchantAgent({ merchantId: 'sindr_arms', now: nowBase + 3000, decider, db });
  assert.equal(callCount, 3);

  // Call 4 within the hour exceeds maxCallsPerHour (3); falls back to RuleDecider without calling fetchFn
  await tickMerchantAgent({ merchantId: 'sindr_shards', now: nowBase + 4000, decider, db });
  assert.equal(callCount, 3, '4th call must be blocked by hourly cost cap');

  // Also test 1-call-per-merchant-per-tick
  const deciderRate = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'test-sk-key',
    model: 'openai/gpt-4.1-mini',
    fetchFn: fakeFetch,
    maxCallsPerHour: 100,
  });

  const tickNow = nowBase + 50000;
  await tickMerchantAgent({ merchantId: 'sindr_shards', now: tickNow, decider: deciderRate, db });
  const countBeforeSecondCallSameTick = callCount;
  await tickMerchantAgent({ merchantId: 'sindr_shards', now: tickNow, decider: deciderRate, db });
  assert.equal(callCount, countBeforeSecondCallSameTick, 'Second call in same tick must fall back without calling fetch');
});

test('NearAiDecider: prompt payload is strictly anonymized with zero player account IDs or personal data', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  // Seed memories with specific accounts to verify they are never leaked
  recordNpcInteraction('sindr_shards', 'secret_player_account_xyz', 45, db);
  recordNpcInteraction('sindr_shards', 'troublemaker_account_123', -60, db);

  let capturedRequestBody = '';
  const fakeFetch: typeof fetch = async (_url, init) => {
    capturedRequestBody = String(init?.body ?? '');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [],
                reasoning: 'Fair trade and steady feet today.',
              }),
            },
          },
        ],
      }),
    } as unknown as Response;
  };

  const decider = new NearAiDecider({
    baseUrl: 'https://cloud-api.near.ai/v1',
    apiKey: 'test-sk-key',
    model: 'openai/gpt-4.1-mini',
    fetchFn: fakeFetch,
  });

  await tickMerchantAgent({
    merchantId: 'sindr_shards',
    now: 15 * GAME_HOUR_MS,
    decider,
    db,
  });

  // Verify private accounts never leaked
  assert.ok(!capturedRequestBody.includes('secret_player_account_xyz'), 'Player account ID must not be in prompt');
  assert.ok(!capturedRequestBody.includes('troublemaker_account_123'), 'Player account ID must not be in prompt');

  const parsed = JSON.parse(capturedRequestBody);
  const userPayload = JSON.parse(parsed.messages.find((m: any) => m.role === 'user').content);

  // Verify enriched trader context is present and aggregate-only
  assert.ok(userPayload.solvency !== undefined, 'Solvency urgency must be present');
  assert.ok(userPayload.tributeStatus !== undefined, 'Tribute status must be present');
  assert.ok(userPayload.customerMemory !== undefined, 'Customer memory summary must be present');
  assert.equal(userPayload.customerMemory.friendlyPatrons, 1);
  assert.equal(userPayload.customerMemory.hostileCustomers, 1);
});
