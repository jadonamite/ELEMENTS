import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAction,
  validateActions,
  type AgentObservation,
  type AgentAction,
  AGENT_CONFIG,
} from '../src/economy/index.js';

function makeMockObservation(overrides: Partial<AgentObservation> = {}): AgentObservation {
  return {
    merchantId: 'sindr_shards',
    purse: 5000,
    stock: {
      shard: { stock: 50, maxStock: 200, basePrice: 10 },
      material: { stock: 20, maxStock: 100, basePrice: 15 },
    },
    demandWindows: {},
    recentTrades: [],
    tributeSchedule: { nextTributeTime: 100000, intervalMs: 86400000 },
    timeOfDay: 12,
    isOpen: true,
    status: 'open',
    daysBroke: 0,
    personality: 'A sharp-eyed firebrand.',
    ...overrides,
  };
}

test('validateAction: accepts valid restock and rejects overspend and overstock', () => {
  const obs = makeMockObservation({ purse: 500 });

  // Valid restock: 40 shards * 10 = 400 <= 500 purse, 50 + 40 = 90 <= 200 maxStock
  const validRestock: AgentAction = { type: 'restock', itemType: 'shard', quantity: 40 };
  const res1 = validateAction(obs, validRestock);
  assert.equal(res1.valid, true);

  // Overspend: 60 shards * 10 = 600 > 500 purse
  const overspend: AgentAction = { type: 'restock', itemType: 'shard', quantity: 60 };
  const res2 = validateAction(obs, overspend);
  assert.equal(res2.valid, false);
  assert.match(res2.reason ?? '', /Insufficient purse/);

  // Overstock: 160 shards + 50 = 210 > 200 maxStock (even if purse had enough)
  const richObs = makeMockObservation({ purse: 100000 });
  const overstock: AgentAction = { type: 'restock', itemType: 'shard', quantity: 160 };
  const res3 = validateAction(richObs, overstock);
  assert.equal(res3.valid, false);
  assert.match(res3.reason ?? '', /exceed max stock/);

  // Invalid quantity: negative or non-integer
  assert.equal(validateAction(obs, { type: 'restock', itemType: 'shard', quantity: -5 }).valid, false);
  assert.equal(validateAction(obs, { type: 'restock', itemType: 'shard', quantity: 0 }).valid, false);
  assert.equal(validateAction(obs, { type: 'restock', itemType: 'shard', quantity: 12.5 }).valid, false);

  // Unknown item
  assert.equal(validateAction(obs, { type: 'restock', itemType: 'mythic_ruby', quantity: 1 }).valid, false);
});

test('validateAction: accepts valid tribute and rejects excessive tribute', () => {
  const obs = makeMockObservation();

  // Valid tribute: 30 shards <= 50 on hand
  const validTribute: AgentAction = { type: 'tribute', itemType: 'shard', quantity: 30 };
  assert.equal(validateAction(obs, validTribute).valid, true);

  // Excessive tribute: 60 shards > 50 on hand
  const excessTribute: AgentAction = { type: 'tribute', itemType: 'shard', quantity: 60 };
  const res = validateAction(obs, excessTribute);
  assert.equal(res.valid, false);
  assert.match(res.reason ?? '', /Cannot ship more tribute than current stock/);
});

test('validateAction: rejects any attempt to modify or set prices directly', () => {
  const obs = makeMockObservation();

  // Explicit set_price type
  const priceAction = { type: 'set_price', itemType: 'shard', price: 25 } as unknown as AgentAction;
  const res1 = validateAction(obs, priceAction);
  assert.equal(res1.valid, false);
  assert.match(res1.reason ?? '', /prices are governed strictly by merchant rules/);

  // Sneaking price into restock action
  const sneakAction = {
    type: 'restock',
    itemType: 'shard',
    quantity: 10,
    price: 30,
  } as unknown as AgentAction;
  const res2 = validateAction(obs, sneakAction);
  assert.equal(res2.valid, false);
  assert.match(res2.reason ?? '', /prices are governed strictly by merchant rules/);
});

test('validateAction: validates shop hours and spoken lines within bounds', () => {
  const obs = makeMockObservation();

  // Valid hours within [minOpenHour, maxCloseHour]
  const validHours: AgentAction = {
    type: 'set_hours',
    openHour: AGENT_CONFIG.minOpenHour,
    closeHour: AGENT_CONFIG.nightStartHour,
  };
  assert.equal(validateAction(obs, validHours).valid, true);

  // Invalid hours: before minOpenHour or after maxCloseHour
  assert.equal(
    validateAction(obs, { type: 'set_hours', openHour: 4, closeHour: 20 }).valid,
    false,
  );
  assert.equal(
    validateAction(obs, { type: 'set_hours', openHour: 8, closeHour: 23 }).valid,
    false,
  );
  assert.equal(
    validateAction(obs, { type: 'set_hours', openHour: 18, closeHour: 10 }).valid,
    false,
  );

  // Say line validation
  assert.equal(
    validateAction(obs, { type: 'say', line: 'Fair coin for fair iron today.' }).valid,
    true,
  );
  assert.equal(validateAction(obs, { type: 'say', line: '' }).valid, false);
  assert.equal(validateAction(obs, { type: 'say', line: '   ' }).valid, false);
});

test('validateActions: cumulative validation catches chained overspending', () => {
  const obs = makeMockObservation({ purse: 700 });

  // Each action alone is <= 700, but together 400 + 450 = 850 > 700
  const actions: AgentAction[] = [
    { type: 'restock', itemType: 'shard', quantity: 40 }, // 40 * 10 = 400 (remains 300)
    { type: 'restock', itemType: 'material', quantity: 30 }, // 30 * 15 = 450 > 300 (fails)
    { type: 'say', line: 'Trade is brisk.' },
  ];

  const result = validateActions(obs, actions);
  assert.equal(result.validActions.length, 2);
  assert.equal(result.validActions[0]?.type, 'restock');
  assert.equal(result.validActions[1]?.type, 'say');
  assert.equal(result.droppedActions.length, 1);
  assert.equal(result.droppedActions[0]?.action.type, 'restock');
  assert.match(result.droppedActions[0]?.reason ?? '', /Insufficient purse/);
});
