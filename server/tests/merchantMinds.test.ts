import assert from 'node:assert/strict';
import test from 'node:test';
import { formatActionSummary } from '@elements/shared';

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
