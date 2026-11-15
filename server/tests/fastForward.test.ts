import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateWeek } from '../src/economy/fastForward.js';

test('a fast-forwarded week plays the lore economy, names its NEAR moves and keeps the coin supply whole', async () => {
  const week = await simulateWeek(1);
  assert.equal(week.frames.length, 7 * 24 + 1);
  assert.equal(week.supplyConserved, true);

  const crimson = (h: number) => week.frames[h]!.keepers.find((k) => k.id === 'sindr_shards')!.goods.find((g) => g.item === 'shard_ignis')!;
  assert.ok(crimson(84).stock > crimson(0).stock, 'the flood fills the shelf');
  assert.ok(crimson(84).sell < crimson(0).sell, 'and the keeper pays less for crimson');

  const events = week.frames.flatMap((f) => f.events);
  const of = (kind: string) => events.filter((e) => e.kind === kind);
  const text = events.map((e) => e.text).join('\n');
  assert.match(text, /stops buying/);
  assert.match(text, /shuts/);
  assert.match(text, /buys the shuttered/);
  assert.match(text, /red flag 1/);
  assert.match(text, /bounty of \d+ CHROMA/);
  assert.match(text, /refuses/);
  assert.match(text, /Jail seizes/);
  assert.match(text, /Lit-to-Lit/);
  assert.match(text, /outsider|traveller/);
  assert.match(text, /hires/);

  // Routine traffic is one line per kind per day, never one per hour.
  for (const kind of ['tribute', 'caravan', 'rival']) assert.ok(of(kind).length <= 7, `${kind}: ${of(kind).length} lines`);
  // Story events that move coin carry the moves their ledger rows settle.
  for (const kind of ['bank', 'robbery', 'jail', 'hire', 'tribute']) {
    assert.ok(of(kind).every((e) => e.moves.length > 0), `${kind} has NEAR moves`);
  }
  for (const m of events.flatMap((e) => e.moves)) {
    assert.ok(m.amount > 0);
    if (m.contract === 'coin') assert.ok(m.from && m.to, 'coin never appears from or vanishes into the world');
  }
  // No raw ids in what a reader sees.
  assert.doesNotMatch(text, /\b(route|merchant)_[a-z]+/);
  // The world pushes back rarely: never more than every other day.
  assert.ok(of('firestorm').length <= 3, `${of('firestorm').length} firestorms`);
});
