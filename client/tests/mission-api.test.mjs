import test from 'node:test';
import assert from 'node:assert/strict';
import { MissionApi } from '../src/story/mission-api.ts';
import { freshMission } from '../../shared/src/story/missions.ts';

test('mission client only saves training over HTTP and sends location-gated choices through the room', async () => {
  const original = { window: globalThis.window, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch };
  const values = new Map([['elements_session_token', 'test-token'], ['elements_account_id', 'player']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.localStorage = storage; globalThis.sessionStorage = storage;
  globalThis.window = { location: { search: '', port: '5173', hostname: '127.0.0.1' } };
  const requests = [];
  const snapshot = { accountId: 'player', state: freshMission('IGNIS'), balance: 0, items: {}, tier: 0 };
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(snapshot)); };
  const api = new MissionApi();
  try {
    for (const event of ['register', 'take_pouch', 'buy_meal', 'eat_meal', 'meet_neri', 'accept_search', 'inspect_invitation', 'kellan_lead', 'hall_briefing', 'start_spar', 'identify_invitation', 'start_ambush']) {
      await assert.rejects(api.choose(event), /Connect to the shared world/);
    }
    assert.equal(requests.length, 0);
    await api.choose('training_complete');
    const sentTraining = JSON.parse(requests[0].options.body);
    assert.equal(sentTraining.event, 'training_complete');
    assert.equal('context' in sentTraining, false);
    let handler;
    api.bind({ on(type, callback) { assert.equal(type, 'mission_reply'); handler = callback; }, send(type, message) {
      assert.equal(type, 'mission');
      assert.equal(message.event, 'register');
      assert.equal('context' in message, false);
      handler({ operationId: message.operationId, result: snapshot });
    } });
    await api.choose('register');
    assert.equal(requests.length, 1);
  } finally { api.dispose(); Object.assign(globalThis, original); }
});

test('a guest room becomes stale after login; training can save over HTTP before one reconnect', async () => {
  const original = { window: globalThis.window, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch };
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.localStorage = storage; globalThis.sessionStorage = storage;
  globalThis.window = { location: { search: '?online=1&login', port: '5173', hostname: '127.0.0.1' } };
  const requests = [], messages = [];
  const snapshot = { accountId: 'player', state: freshMission('IGNIS'), balance: 0, items: {}, tier: 0 };
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(snapshot)); };
  const api = new MissionApi();
  const room = { on() {}, send(type, body) { messages.push({ type, body }); } };
  try {
    api.bind(room, { accountId: null, token: null });
    assert.equal(api.needsReconnect, false);
    values.set('elements_session_token', 'signed-in-token'); values.set('elements_account_id', 'player');
    assert.equal(api.needsReconnect, true);
    await assert.rejects(api.choose('register'), /Reconnect after signing in/);
    await assert.rejects(api.choose('take_pouch'), /Reconnect after signing in/);
    await api.choose('training_complete');
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(requests[0].options.body).event, 'training_complete');
    assert.equal(messages.length, 0);
    api.bind(room, { accountId: 'player', token: 'signed-in-token' });
    assert.equal(api.needsReconnect, false);
    values.set('elements_account_id', 'another-player');
    assert.equal(api.needsReconnect, true);
  } finally { api.dispose(); Object.assign(globalThis, original); }
});
