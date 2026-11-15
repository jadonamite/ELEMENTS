import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomDoor } from '../src/economy/door.ts';
import { economyAvailable } from '../src/economy/api.ts';

class FakeRoom {
  handlers = new Map();
  sent = [];

  on(type, handler) {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(type, message) {
    this.sent.push({ type, message });
  }

  emit(type, body) {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(body);
    }
  }
}

test('RoomDoor sends deposit, withdraw and notes bank messages and resolves responses', async () => {
  const room = new FakeRoom();
  const door = new RoomDoor(room);

  // Test deposit
  const depositPromise = door.deposit('ch_upper', 50);
  assert.equal(room.sent.length, 1);
  assert.equal(room.sent[0].type, 'bank');
  assert.deepEqual(room.sent[0].message, { req: 1, house: 'ch_upper', action: 'deposit', amount: 50 });

  room.emit('econ_reply', { req: 1, ok: true, note: { noteId: 'note_123', amount: 50, status: 'active' } });
  const note = await depositPromise;
  assert.equal(note.noteId, 'note_123');
  assert.equal(note.amount, 50);

  // Test withdraw
  const withdrawPromise = door.withdraw('ch_upper', 'note_123');
  assert.equal(room.sent.length, 2);
  assert.equal(room.sent[1].type, 'bank');
  assert.deepEqual(room.sent[1].message, { req: 2, house: 'ch_upper', action: 'withdraw', note: 'note_123' });

  room.emit('econ_reply', { req: 2, ok: true, withdrawnAmount: 50, note: { noteId: 'note_123', status: 'redeemed' } });
  const withdrawResult = await withdrawPromise;
  assert.equal(withdrawResult.withdrawnAmount, 50);
  assert.equal(withdrawResult.note.status, 'redeemed');

  // Test notes query
  const notesPromise = door.notes('ch_upper');
  assert.equal(room.sent.length, 3);
  assert.equal(room.sent[2].type, 'bank');
  assert.deepEqual(room.sent[2].message, { req: 3, house: 'ch_upper', action: 'notes' });

  room.emit('econ_reply', { req: 3, ok: true, notes: [{ noteId: 'note_1', amount: 100, status: 'active' }] });
  const notes = await notesPromise;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].noteId, 'note_1');
});

test('RoomDoor sends wear message and resolves outfit response', async () => {
  const room = new FakeRoom();
  const door = new RoomDoor(room);

  const wearPromise = door.wear('armour_shaper_ignis');
  assert.equal(room.sent.length, 1);
  assert.equal(room.sent[0].type, 'wear');
  assert.deepEqual(room.sent[0].message, { item: 'armour_shaper_ignis' });

  room.emit('outfit', { item: 'armour_shaper_ignis', outfit: 'shaper_ignis', armour: 40 });
  const result = await wearPromise;
  assert.equal(result.item, 'armour_shaper_ignis');
  assert.equal(result.outfit, 'shaper_ignis');
  assert.equal(result.armour, 40);

  // Take off armour
  const stripPromise = door.wear(null);
  assert.equal(room.sent.length, 2);
  assert.deepEqual(room.sent[1].message, { item: null });

  room.emit('outfit', { item: null, outfit: 'rags', armour: 0 });
  const stripResult = await stripPromise;
  assert.equal(stripResult.item, null);
  assert.equal(stripResult.outfit, 'rags');
  assert.equal(stripResult.armour, 0);
});

test('RoomDoor sends trade_offer, trade_accept, trade_cancel and listens to trade state', () => {
  const room = new FakeRoom();
  const door = new RoomDoor(room);

  let heardState = null;
  door.listenTrade((s) => { heardState = s; });

  // Offer
  door.offerTrade('partner_1', 25, { material_linen: 2 });
  assert.equal(room.sent.length, 1);
  assert.equal(room.sent[0].type, 'trade_offer');
  assert.deepEqual(room.sent[0].message, { with: 'partner_1', chroma: 25, items: { material_linen: 2 } });

  // Incoming trade update
  room.emit('trade', {
    open: true,
    with: 'partner_1',
    mine: { chroma: 25, items: { material_linen: 2 }, accepted: false },
    theirs: { chroma: 0, items: {}, accepted: false },
  });
  assert.ok(heardState);
  assert.equal(heardState.open, true);
  assert.equal(heardState.mine.chroma, 25);

  // Accept
  door.acceptTrade();
  assert.equal(room.sent.length, 2);
  assert.equal(room.sent[1].type, 'trade_accept');

  // Cancel
  door.cancelTrade();
  assert.equal(room.sent.length, 3);
  assert.equal(room.sent[2].type, 'trade_cancel');
});

test('economyAvailable is on without an auth token so guests see loot online', () => {
  assert.equal(economyAvailable(), true);
});

test('fetchMerchantMind: queries merchant mind and parses reasoning and lastDecision', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/economy/merchants/sindr_shards/mind')) {
      return {
        ok: true,
        json: async () => ({
          merchantId: 'sindr_shards',
          latestThought: 'I stocked 12 Crimson shards to keep our counters bright.',
          lastDecision: 'Restocked 12 Crimson shards',
          actions: [{ action: { type: 'restock', itemType: 'shard', quantity: 12 }, timestamp: 1000 }],
          purse: 20000,
          open: true,
          status: 'open',
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    const { fetchMerchantMind } = await import('../src/economy/api.ts');
    const mind = await fetchMerchantMind('sindr_shards');
    assert.equal(mind.merchantId, 'sindr_shards');
    assert.equal(mind.latestThought, 'I stocked 12 Crimson shards to keep our counters bright.');
    assert.equal(mind.lastDecision, 'Restocked 12 Crimson shards');
    assert.equal(mind.open, true);
  } finally {
    globalThis.fetch = origFetch;
  }
});
