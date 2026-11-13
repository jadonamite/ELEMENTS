import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, setDatabase } from '../src/db.js';
import { ModelRouter } from '../src/economy/agents/router/modelRouter.js';
import { BudgetGovernor } from '../src/economy/agents/router/budgetGovernor.js';
import {
  generateTownsfolkBatchPlans,
  getTownsfolkMindState,
} from '../src/economy/agents/townsfolk/townsfolkMinds.js';
import { SINDR_TOWNSFOLK } from '../src/economy/agents/townsfolk/townsfolkRoster.js';
import { ConversationService } from '../src/economy/agents/conversations/conversationService.js';
import { ensureSindrMerchants } from '../src/economy/agents/agentLoop.js';
import { getNpcMemory } from '../src/economy/npcMemoryService.js';

test('Townsfolk: generates batch plans for citizens and falls back to deterministic routines', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);

  const fakeFetch: typeof fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              plans: {
                smith_sindr: {
                  focus: 'Hammering high-grade iron ingots for town guard cuirasses.',
                  mood: 'focused and hot-tempered',
                  preparedLines: [
                    'The forge does not wait for chatter.',
                    'Good iron makes good armor.',
                  ],
                },
              },
            }),
          },
        },
      ],
    }),
  } as unknown as Response);

  process.env.NVIDIA_API_KEY = 'test-key';
  const router = new ModelRouter({ fetchFn: fakeFetch, order: ['nvidia'] });

  const plans = await generateTownsfolkBatchPlans({
    placeId: 'sindr_market',
    phase: 'morning',
    router,
    db,
    now: 1000,
  });

  assert.ok(plans['smith_sindr']);
  assert.equal(plans['smith_sindr'].mood, 'focused and hot-tempered');
  assert.equal(
    plans['smith_sindr'].focus,
    'Hammering high-grade iron ingots for town guard cuirasses.',
  );

  // Other market townsfolk receive deterministic plan
  assert.ok(plans['guard_sindr']);
  assert.equal(plans['guard_sindr'].phase, 'morning');

  // Query mind state
  const smithState = getTownsfolkMindState('smith_sindr', db);
  assert.ok(smithState);
  assert.equal(smithState.role, 'smith');
  assert.equal(smithState.routine, 'Hammering high-grade iron ingots for town guard cuirasses.');
});

test('Conversations: player talks with agent, memory is tracked, and thinking beat is included', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  const fakeFetch: typeof fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: 'The road from the east was quiet today, traveler.',
          },
        },
      ],
    }),
  } as unknown as Response);

  process.env.NVIDIA_API_KEY = 'test-key';
  const router = new ModelRouter({ fetchFn: fakeFetch, order: ['nvidia'] });
  const service = new ConversationService({ router });

  const res = await service.talk(
    {
      accountId: 'player_aldor',
      agentId: 'sindr_shards',
      message: 'Have you heard any news of caravans?',
      intent: 'ask',
    },
    db,
    5000,
  );

  assert.equal(res.agentId, 'sindr_shards');
  assert.equal(res.reply, 'The road from the east was quiet today, traveler.');
  assert.ok(res.thinkingBeat);
  assert.equal(res.memoryScore, 1);

  // Check persisted memory
  const mem = getNpcMemory('sindr_shards', 'player_aldor', db);
  assert.equal(mem.score, 1);
});

test('Conversations: haggling respects price formula bounds and cannot sell below base price', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  const router = new ModelRouter({
    fetchFn: async () => ({ ok: false, status: 500 } as Response),
    order: ['nvidia'],
  });
  const service = new ConversationService({ router });

  // 1. Unfairly low offer (below minimum acceptable price)
  const lowRes = await service.talk(
    {
      accountId: 'player_cheap',
      agentId: 'sindr_shards',
      message: 'I will give you 2 CHROMA for this shard.',
      intent: 'haggle',
      itemType: 'shard',
      offeredPrice: 2,
    },
    db,
    1000,
  );

  assert.equal(lowRes.haggleOutcome?.success, false);
  assert.ok(lowRes.reply.includes('cannot part with it'));
  assert.equal(lowRes.memoryScore, -1); // Memory reduced on lowball

  // 2. Fair offer within acceptable range
  const fairRes = await service.talk(
    {
      accountId: 'player_fair',
      agentId: 'sindr_shards',
      message: 'Can you do 25 CHROMA for the shard?',
      intent: 'haggle',
      itemType: 'shard',
      offeredPrice: 25,
    },
    db,
    2000,
  );

  assert.equal(fairRes.haggleOutcome?.success, true);
  assert.equal(fairRes.haggleOutcome?.agreedPrice, 25);
  assert.ok(fairRes.reply.includes('agreed'));
  assert.equal(fairRes.memoryScore, 2); // Memory rewarded on fair deal
});

test('Conversations: governor pressure level 3 serves prepared lines without calling model', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  let fetchCalled = false;
  const fakeFetch: typeof fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200 } as Response;
  };

  // Governor with 0 budget remaining -> Pressure Level 3 (Template Floor)
  const gov = new BudgetGovernor({ providers: {} });
  const router = new ModelRouter({ governor: gov, fetchFn: fakeFetch });
  const service = new ConversationService({ router, governor: gov });

  const res = await service.talk(
    {
      accountId: 'player_tired',
      agentId: 'sindr_shards',
      message: 'Hello there.',
    },
    db,
    10_000,
  );

  assert.equal(fetchCalled, false); // Model was never called
  assert.ok(res.reply.length > 0);
  assert.ok(res.thinkingBeat);
});
