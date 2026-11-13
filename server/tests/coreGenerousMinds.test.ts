import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  type AgentObservation,
  GAME_HOUR_MS,
  SINDR_MERCHANTS,
} from '@elements/shared';
import { migrateDatabase, setDatabase } from '../src/db.js';
import { BudgetGovernor } from '../src/economy/agents/router/budgetGovernor.js';
import { ModelRouter } from '../src/economy/agents/router/modelRouter.js';
import type { ProviderConfig, ProviderKey } from '../src/economy/agents/router/types.js';
import {
  generateBatchPlans,
  getPlanPhase,
  type AgentPlanContext,
} from '../src/economy/agents/plans/agentPlan.js';
import { AgentEventQueue } from '../src/economy/agents/plans/eventQueue.js';
import {
  runDailyJudge,
  createDeterministicJudgeReport,
} from '../src/economy/agents/judge/dailyJudge.js';
import {
  getLatestAgentPlan,
  getLatestDailyJudgeReport,
} from '../src/economy/agents/db.js';

test('BudgetGovernor: manages rate limits, health penalties, and pressure levels', () => {
  const providers: Record<string, ProviderConfig> = {
    nvidia: {
      key: 'nvidia',
      name: 'NVIDIA',
      baseUrl: 'http://test',
      apiKeyEnv: 'NVIDIA_KEY',
      models: { plan: 'm1' },
      rpm: 2,
      rpd: 5,
      timeoutMs: 1000,
    },
    cloudflare: {
      key: 'cloudflare',
      name: 'CF',
      baseUrl: 'http://test',
      apiKeyEnv: 'CF_KEY',
      models: { plan: 'm2' },
      rpm: 2,
      rpd: 5,
      timeoutMs: 1000,
    },
    gemini: {
      key: 'gemini',
      name: 'Gemini',
      baseUrl: 'http://test',
      apiKeyEnv: 'GEMINI_KEY',
      models: { plan: 'm3' },
      rpm: 2,
      rpd: 5,
      timeoutMs: 1000,
    },
    groq: {
      key: 'groq',
      name: 'Groq',
      baseUrl: 'http://test',
      apiKeyEnv: 'GROQ_KEY',
      models: { plan: 'm4' },
      rpm: 2,
      rpd: 5,
      timeoutMs: 1000,
    },
  };

  const gov = new BudgetGovernor({ providers });
  const now = 1_000_000;

  // Initially healthy, normal pressure (0)
  assert.equal(gov.getPressureLevel(now), 0);
  assert.equal(gov.hasBudget('nvidia', now), true);
  assert.equal(gov.shouldDeferTier2(now), false);
  assert.equal(gov.shouldUseTemplateFloor(now), false);

  // Consume RPM for nvidia
  gov.recordCall('nvidia', now);
  assert.equal(gov.hasBudget('nvidia', now), true);
  gov.recordCall('nvidia', now + 100);
  assert.equal(gov.hasBudget('nvidia', now + 200), false); // RPM limit (2) reached

  // After 61 seconds, RPM resets
  assert.equal(gov.hasBudget('nvidia', now + 62_000), true);

  // Circuit breaker on failure
  gov.recordFailure('nvidia', 30_000, now);
  assert.equal(gov.isProviderHealthy('nvidia', now + 10_000), false);
  assert.equal(gov.hasBudget('nvidia', now + 10_000), false);
  assert.equal(gov.isProviderHealthy('nvidia', now + 35_000), true);
});

test('ModelRouter: priority failover routes past failed providers and respects judge isolation', async () => {
  const callLog: string[] = [];

  const fakeFetch: typeof fetch = async (url, init) => {
    const body = JSON.parse(init?.body as string);
    callLog.push(body.model);

    // Fail first provider (NVIDIA) with 429
    if (body.model === 'nvidia/nemotron-3.5-super-vl-120b-a12b') {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response;
    }

    // Succeed on second provider (Cloudflare)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                plans: {
                  sindr_shards: {
                    focus: 'Stocking shards for caravan arrival.',
                    mood: 'brisk',
                    targetStockRatio: { shard: 0.85 },
                    bargainWillingness: 0.4,
                    preparedLines: ['Caravan brought fine quartz today.'],
                  },
                },
              }),
            },
          },
        ],
      }),
    } as unknown as Response;
  };

  process.env.NVIDIA_API_KEY = 'test-nvidia';
  process.env.CLOUDFLARE_API_TOKEN = 'test-cf';

  const router = new ModelRouter({
    fetchFn: fakeFetch,
    order: ['nvidia', 'cloudflare', 'gemini'],
  });

  const result = await router.route({
    intent: 'plan',
    messages: [{ role: 'user', content: 'test' }],
  });

  assert.ok(result);
  assert.equal(result.provider, 'cloudflare');
  assert.equal(callLog.length, 2);
  assert.equal(callLog[0], 'nvidia/nemotron-3.5-super-vl-120b-a12b');
  assert.equal(callLog[1], '@cf/qwen/qwen3-30b-a3b-fp8');
});

test('AgentPlan: generates batched plans per place across 4 phases and falls back gracefully', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  assert.equal(getPlanPhase(7), 'morning');
  assert.equal(getPlanPhase(13), 'midday');
  assert.equal(getPlanPhase(19), 'evening');
  assert.equal(getPlanPhase(23), 'night');

  const agents: AgentPlanContext[] = [
    {
      id: 'sindr_shards',
      role: 'merchant',
      name: 'Kaelen',
      personality: 'Pragmatic trader',
      purse: 2500,
      stock: { shard: { stock: 15, maxStock: 50 } },
    },
    {
      id: 'sindr_potions',
      role: 'merchant',
      name: 'Vael',
      personality: 'Quiet apothecary',
      purse: 1800,
      stock: { potion: { stock: 8, maxStock: 30 } },
    },
  ];

  // Router that fails -> should use deterministic fallback without crashing
  const failingFetch: typeof fetch = async () => {
    throw new Error('Connection refused');
  };

  const router = new ModelRouter({ fetchFn: failingFetch, order: ['nvidia'] });

  const plans = await generateBatchPlans({
    placeId: 'sindr_market',
    agents,
    phase: 'morning',
    router,
    db,
    now: 10_000,
  });

  assert.equal(Object.keys(plans).length, 2);
  assert.ok(plans['sindr_shards']);
  assert.equal(plans['sindr_shards'].phase, 'morning');
  assert.equal(plans['sindr_shards'].mood, 'brisk');
  assert.ok(plans['sindr_shards'].targetStockRatio['shard'] > 0);

  // Verify persistence in agent_plans SQLite table
  const saved = getLatestAgentPlan('sindr_shards', db);
  assert.ok(saved);
  assert.equal(saved.phase, 'morning');
  assert.equal(saved.mood, 'brisk');
});

test('AgentEventQueue: handles 3 tiers of events, tracks dirty agents, and respects cooldowns', async () => {
  const queue = new AgentEventQueue();
  const gov = new BudgetGovernor({
    providers: {
      nvidia: {
        key: 'nvidia',
        name: 'NVIDIA',
        baseUrl: '',
        apiKeyEnv: '',
        models: {},
        rpm: 40,
        rpd: 1000,
        timeoutMs: 1000,
      },
      cloudflare: {
        key: 'cloudflare',
        name: 'CF',
        baseUrl: '',
        apiKeyEnv: '',
        models: {},
        rpm: 30,
        rpd: 520,
        timeoutMs: 1000,
      },
    },
  });
  const placeId = 'sindr_market';
  const agentId = 'sindr_shards';
  const now = 100_000;

  // Tier 3: Ordinary event (folded into next observation, not dirty)
  queue.recordEvent(placeId, agentId, {
    tier: 'ordinary',
    type: 'sale',
    description: 'Sold 2 Crimson shards to traveler',
  }, gov, now);

  assert.equal(queue.isAgentDirty(placeId, agentId), false);
  assert.equal(queue.getRecentEvents(agentId).length, 1);

  // Tier 2: Significant event (marks agent dirty)
  queue.recordEvent(placeId, agentId, {
    tier: 'significant',
    type: 'theft',
    description: 'Thief attempted to snatch goods from rack',
  }, gov, now);

  assert.equal(queue.isAgentDirty(placeId, agentId), true);
  assert.deepEqual(queue.getDirtyAgents(placeId), [agentId]);

  // Flush dirty agents
  const agents: AgentPlanContext[] = [
    {
      id: agentId,
      role: 'merchant',
      name: 'Kaelen',
      personality: 'Pragmatic trader',
      purse: 2000,
      stock: {},
    },
  ];

  const fakeFetch: typeof fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              reactions: {
                [agentId]: {
                  reasoning: 'Bolstered the chest locks after the theft attempt.',
                  actions: [],
                },
              },
            }),
          },
        },
      ],
    }),
  } as unknown as Response);

  process.env.NVIDIA_API_KEY = 'key';
  const router = new ModelRouter({ fetchFn: fakeFetch, order: ['nvidia'] });

  const flushResults = await queue.flushDirtyAgents({
    placeId,
    agents,
    router,
    governor: gov,
    now,
  });

  assert.ok(flushResults[agentId]);
  assert.equal(flushResults[agentId].reasoning, 'Bolstered the chest locks after the theft attempt.');
  assert.equal(queue.isAgentDirty(placeId, agentId), false);

  // Immediate subsequent event within cooldown should not flush immediately
  queue.recordEvent(placeId, agentId, {
    tier: 'significant',
    type: 'price_war',
    description: 'Rival stall dropped prices',
  }, gov, now + 1000);

  assert.equal(queue.canFlushAgent(agentId, gov, now + 1000), false);
});

test('DailyJudge: executes NEAR AI judge, generates chronicle and guidance, falls back on 402/error', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  // Simulate NEAR AI 402 error (no limit configured / payment required)
  const fakeNearAi402: typeof fetch = async () => ({
    ok: false,
    status: 402,
    statusText: 'Payment Required',
  } as Response);

  process.env.NEAR_AI_API_KEY = 'sk-test';
  const router = new ModelRouter({ fetchFn: fakeNearAi402 });

  const report = await runDailyJudge({
    dayNumber: 1,
    router,
    db,
    now: 100_000,
  });

  assert.ok(report);
  assert.equal(report.dayNumber, 1);
  assert.ok(report.chronicle.title.includes('Day 1'));
  assert.ok(report.chronicle.paragraphs.length >= 2);
  assert.ok(report.agentGuidance['sindr_shards']);
  assert.equal(typeof report.agentGuidance['sindr_shards'].score, 'number');

  // Verify persistence in SQLite
  const savedReport = getLatestDailyJudgeReport(db);
  assert.ok(savedReport);
  assert.equal(savedReport.dayNumber, 1);
  assert.equal(savedReport.chronicle.title, report.chronicle.title);
});
