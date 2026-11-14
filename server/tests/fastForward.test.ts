import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateWeek } from '../src/economy/fastForward.js';

test('a fast-forwarded week moves prices by the rules, shuts a broke keeper and keeps the coin supply whole', async () => {
  const week = await simulateWeek(1);
  assert.equal(week.frames.length, 7 * 24 + 1);
  assert.equal(week.supplyConserved, true);
  const crimson = (h: number) => week.frames[h]!.keepers.find((k) => k.id === 'sindr_shards')!.goods.find((g) => g.item === 'shard_ignis')!;
  assert.ok(crimson(84).stock > crimson(0).stock, 'the flood fills the shelf');
  assert.ok(crimson(84).sell < crimson(0).sell, 'and the keeper pays less for crimson');
  const events = week.frames.flatMap((f) => f.events).join('\n');
  assert.match(events, /stops buying/);
  assert.match(events, /shuts/);
  assert.match(events, /buys the shuttered/);
});
