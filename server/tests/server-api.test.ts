import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express, { type Application } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { isOriginAllowed, setupApi } from '../src/api.js';
import { setTokenVerifier } from '../src/auth.js';
import {
  createDatabase,
  createGuestRising,
  createOrGetRising,
  GUEST_RISINGS_PER_IP_PER_DAY,
  getAccount,
  getRising,
  migrateDatabase,
  setDatabase,
} from '../src/db.js';
import { resetRateLimits } from '../src/rate-limit.js';

interface TestServer {
  app: Application;
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
  const app = express();
  setupApi(app);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to obtain server address');
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    app,
    server,
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

test('Database migration: safely migrates existing accounts table and keeps existing data', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      element TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec("INSERT INTO accounts VALUES ('legacy_shaper', 'Shaper', 'AURA', 1700000001);");
  db.exec("INSERT INTO accounts VALUES ('legacy_hush', 'Hush', NULL, 1700000002);");

  migrateDatabase(db);

  const shaper = getAccount('legacy_shaper', db);
  assert.ok(shaper);
  assert.equal(shaper.id, 'legacy_shaper');
  assert.equal(shaper.role, 'Shaper');
  assert.equal(shaper.element, 'AURA');

  const hush = getAccount('legacy_hush', db);
  assert.ok(hush);
  assert.equal(hush.id, 'legacy_hush');
  assert.equal(hush.role, 'Hush');
  assert.equal(hush.element, null);

  const shaperRising = getRising('legacy_shaper', db);
  assert.ok(shaperRising);
  assert.equal(shaperRising.role, 'Shaper');
  assert.equal(shaperRising.element, 'AURA');

  const hushRising = getRising('legacy_hush', db);
  assert.ok(hushRising);
  assert.equal(hushRising.role, 'Hush');
  assert.equal(hushRising.element, null);
});

test('HTTP API: rejects missing or bad tokens with 401', async () => {
  const ts = await startTestServer();
  const testDb = createDatabase(':memory:');
  setDatabase(testDb);
  resetRateLimits();

  setTokenVerifier(async (token: string) => {
    if (token === 'valid_token') {
      return { userId: 'did:privy:user1' };
    }
    throw new Error('Invalid token');
  });

  try {
    // Missing token
    const resNoToken = await fetch(`${ts.baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(resNoToken.status, 401);

    const resNoTokenRising = await fetch(`${ts.baseUrl}/api/rising`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(resNoTokenRising.status, 401);

    // Bad token
    const resBadToken = await fetch(`${ts.baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'bad_token_123' }),
    });
    assert.equal(resBadToken.status, 401);

    const resBadTokenRising = await fetch(`${ts.baseUrl}/api/rising`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'bad_token_123' }),
    });
    assert.equal(resBadTokenRising.status, 401);
  } finally {
    setTokenVerifier(null);
    await ts.close();
  }
});

test('HTTP API: session endpoint creates account and returns rising status', async () => {
  const ts = await startTestServer();
  const testDb = createDatabase(':memory:');
  setDatabase(testDb);
  resetRateLimits();

  setTokenVerifier(async (token: string) => {
    if (token.startsWith('valid_')) {
      return { userId: `did:privy:${token}` };
    }
    throw new Error('Bad token');
  });

  try {
    // New account: rising should be null
    const res1 = await fetch(`${ts.baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid_user_abc' }),
    });
    assert.equal(res1.status, 200);
    const data1 = (await res1.json()) as { accountId: string; rising: unknown };
    assert.equal(data1.accountId, 'did:privy:valid_user_abc');
    assert.equal(data1.rising, null);

    // Account now exists in db
    const record = getAccount('did:privy:valid_user_abc', testDb);
    assert.ok(record);
    assert.equal(record.id, 'did:privy:valid_user_abc');
  } finally {
    setTokenVerifier(null);
    await ts.close();
  }
});

test('HTTP API: first /api/rising stores a result, second call returns same result', async () => {
  const ts = await startTestServer();
  const testDb = createDatabase(':memory:');
  setDatabase(testDb);
  resetRateLimits();

  setTokenVerifier(async (token: string) => {
    return { userId: `did:privy:${token}` };
  });

  try {
    const userToken = 'user_roll_test';

    // First call: rolls and stores
    const res1 = await fetch(`${ts.baseUrl}/api/rising`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken }),
    });
    assert.equal(res1.status, 200);
    const data1 = (await res1.json()) as {
      accountId: string;
      role: 'Shaper' | 'Hush';
      element?: string | null;
      rising: { role: string; element?: string | null };
    };

    assert.equal(data1.accountId, 'did:privy:user_roll_test');
    assert.ok(data1.role === 'Shaper' || data1.role === 'Hush');
    if (data1.role === 'Shaper') {
      assert.ok(['IGNIS', 'AQUES', 'TERRA', 'AURA'].includes(data1.element!));
    } else {
      assert.equal(data1.element, null);
    }

    // Second call: must return the exact same result
    const res2 = await fetch(`${ts.baseUrl}/api/rising`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken }),
    });
    assert.equal(res2.status, 200);
    const data2 = (await res2.json()) as typeof data1;

    assert.deepEqual(data1.rising, data2.rising);
    assert.equal(data1.role, data2.role);
    assert.equal(data1.element, data2.element);

    // Verify session endpoint now returns the rising
    const resSession = await fetch(`${ts.baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken }),
    });
    const sessionData = (await resSession.json()) as { accountId: string; rising: unknown };
    assert.deepEqual(sessionData.rising, data1.rising);
  } finally {
    setTokenVerifier(null);
    await ts.close();
  }
});

test('HTTP API: 20 concurrent calls to /api/rising return the exact same result', async () => {
  const ts = await startTestServer();
  const testDb = createDatabase(':memory:');
  setDatabase(testDb);
  resetRateLimits();

  setTokenVerifier(async (token: string) => {
    return { userId: `did:privy:${token}` };
  });

  try {
    const userToken = 'concurrent_user';

    // 20 concurrent requests fired at once
    const promises = Array.from({ length: 20 }, () =>
      fetch(`${ts.baseUrl}/api/rising`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken }),
      }).then(async (r) => {
        assert.equal(r.status, 200);
        return r.json() as Promise<{
          role: string;
          element?: string | null;
          rising: { role: string; element?: string | null };
        }>;
      }),
    );

    const results = await Promise.all(promises);
    assert.equal(results.length, 20);

    const first = results[0]!;
    for (let i = 1; i < results.length; i++) {
      assert.deepEqual(
        results[i]!.rising,
        first.rising,
        `Result at index ${i} did not match first result: expected ${JSON.stringify(first.rising)}, got ${JSON.stringify(results[i]!.rising)}`,
      );
      assert.equal(results[i]!.role, first.role);
      assert.equal(results[i]!.element, first.element);
    }
  } finally {
    setTokenVerifier(null);
    await ts.close();
  }
});

test('CORS: a local origin gets the allow header', async () => {
  const ts = await startTestServer();
  try {
    const res = await fetch(`${ts.baseUrl}/api/session`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(res.headers.get('vary') ?? '', /Origin/);
  } finally {
    await ts.close();
  }
});

test('CORS: a foreign origin gets no allow header', async () => {
  const ts = await startTestServer();
  try {
    const res = await fetch(`${ts.baseUrl}/api/session`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  } finally {
    await ts.close();
  }
  assert.equal(isOriginAllowed('https://play.example', 'https://play.example'), true);
  assert.equal(isOriginAllowed('http://localhost:5173', 'https://play.example'), false);
});

test('HTTP API: a guard seeing a street brawl flags the signed-in player, three flags become a bounty', async () => {
  const ts = await startTestServer();
  setDatabase(createDatabase(':memory:'));
  resetRateLimits();
  setTokenVerifier(async (token: string) => {
    if (token === 'brawler') return { userId: 'did:privy:brawler' };
    throw new Error('Invalid token');
  });
  const post = (headers: Record<string, string>, body: unknown = {}) => fetch(`${ts.baseUrl}/api/economy/crime/brawl-seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const standing = async (token: string) => {
    const res = await fetch(`${ts.baseUrl}/api/economy/crime/standing`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as { redFlags: number; hasBounty: boolean } };
  };

  try {
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ Authorization: 'Bearer forged' })).status, 401);
    assert.equal((await standing('forged')).status, 401);
    assert.deepEqual((await standing('brawler')).body, { accountId: 'did:privy:brawler', redFlags: 0, hasBounty: false });

    // The account named in the body is ignored: the flag lands on the token's account.
    const first = await post({ Authorization: 'Bearer brawler' }, { accountId: 'someone_else' });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { accountId: 'did:privy:brawler', convertedToBounty: false, redFlags: 1, hasBounty: false });
    assert.deepEqual((await standing('brawler')).body, { accountId: 'did:privy:brawler', redFlags: 1, hasBounty: false });

    await post({ Authorization: 'Bearer brawler' });
    const third = await post({ Authorization: 'Bearer brawler' });
    assert.deepEqual(await third.json(), { accountId: 'did:privy:brawler', convertedToBounty: true, redFlags: 0, hasBounty: true });
    assert.deepEqual((await standing('brawler')).body, { accountId: 'did:privy:brawler', redFlags: 0, hasBounty: true });

    // Nobody can flag or jail an account by naming it any more.
    const forgedFlag = await fetch(`${ts.baseUrl}/api/economy/crime/flag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'did:privy:brawler', reason: 'framed' }),
    });
    assert.equal(forgedFlag.status, 404);
  } finally {
    setTokenVerifier(null);
    await ts.close();
  }
});

test('Character controls: authenticated, per-character, bounded, merged across devices and persistent', async () => {
  const db = createDatabase(':memory:'); setDatabase(db); resetRateLimits();
  setTokenVerifier(async token => {
    if (!['learner-a', 'learner-b', 'newcomer'].includes(token)) throw new Error('Invalid token');
    return { userId: token };
  });
  const ts = await startTestServer();
  const call = (token: string, progress?: unknown) => fetch(`${ts.baseUrl}/api/character/controls`, {
    method: progress === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(progress === undefined ? {} : { body: JSON.stringify({ accountId: 'learner-b', progress }) }),
  });
  try {
    assert.equal((await fetch(`${ts.baseUrl}/api/character/controls`)).status, 401);
    assert.equal((await call('forged')).status, 401);
    assert.equal((await call('newcomer')).status, 409);
    for (const token of ['learner-a', 'learner-b']) await fetch(`${ts.baseUrl}/api/rising`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal((await call('learner-a', [])).status, 400);
    const write = await call('learner-a', { strike: { uses: 300, shown: 1 }, forged: { uses: 3, shown: 3 } });
    assert.deepEqual(await write.json(), { progress: { strike: { uses: 3, shown: 1 } } });
    const stale = await call('learner-a', { strike: { uses: 0, shown: 2 } });
    assert.deepEqual(await stale.json(), { progress: { strike: { uses: 3, shown: 2 } } });
    assert.deepEqual(await (await call('learner-b')).json(), { progress: {}, tier: 5 });
    migrateDatabase(db);
    assert.deepEqual(await (await call('learner-a')).json(), { progress: { strike: { uses: 3, shown: 2 } }, tier: 5 });
  } finally { setTokenVerifier(null); await ts.close(); db.close(); }
});

test('GET /api/economy/director/today serves the daily judge report and chronicle', async () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  const ts = await startTestServer();
  try {
    const res = await fetch(`${ts.baseUrl}/api/economy/director/today`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.ok(data);
    assert.equal(typeof data.dayNumber, 'number');
    assert.ok(data.chronicle);
    assert.ok(typeof data.chronicle.title === 'string');
    assert.ok(Array.isArray(data.chronicle.paragraphs));
    assert.ok(data.agentGuidance);
  } finally {
    await ts.close();
    db.close();
  }
});

test('Guest Drawing: signing in with the ticket makes the guest result the account\'s, once', async () => {
  const ts = await startTestServer();
  const testDb = createDatabase(':memory:');
  setDatabase(testDb);
  resetRateLimits();
  setTokenVerifier(async (token: string) => ({ userId: `did:privy:${token}` }));
  try {
    const guestRes = await fetch(`${ts.baseUrl}/api/rising/guest`, { method: 'POST' });
    assert.equal(guestRes.status, 200);
    const guest = (await guestRes.json()) as { guestTicket: string; rising: { role: string; element: string | null } };
    assert.ok(guest.guestTicket.length >= 32);

    const claim = async (token: string): Promise<{ rising: { role: string; element: string | null } }> => {
      const res = await fetch(`${ts.baseUrl}/api/rising`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, guestTicket: guest.guestTicket, element: 'TERRA', role: 'Shaper' }),
      });
      assert.equal(res.status, 200);
      return (await res.json()) as { rising: { role: string; element: string | null } };
    };

    const first = await claim('guest_signs_in');
    assert.deepEqual(first.rising, guest.rising, 'the account takes the result the server held, not anything the browser sends');
    const row = testDb.prepare('SELECT claimed_by FROM guest_risings WHERE ticket = ?').get(guest.guestTicket) as { claimed_by: string };
    assert.equal(row.claimed_by, 'did:privy:guest_signs_in');

    await claim('someone_else');
    const after = testDb.prepare('SELECT claimed_by FROM guest_risings WHERE ticket = ?').get(guest.guestTicket) as { claimed_by: string };
    assert.equal(after.claimed_by, 'did:privy:guest_signs_in', 'a ticket is claimed once');
  } finally {
    await ts.close();
  }
});

test('Guest Drawing: an account that already rose keeps its result and leaves the ticket unclaimed', () => {
  const db = createDatabase(':memory:');
  const hush = createGuestRising('1.2.3.4', () => 0.01, db);
  assert.equal(hush?.role, 'Hush');
  const kept = createOrGetRising('did:privy:veteran', () => 0.99, db);
  assert.equal(kept.role, 'Shaper');
  const again = createOrGetRising('did:privy:veteran', () => 0.99, db, hush!.ticket);
  assert.equal(again.role, 'Shaper');
  const row = db.prepare('SELECT claimed_by FROM guest_risings WHERE ticket = ?').get(hush!.ticket) as { claimed_by: string | null };
  assert.equal(row.claimed_by, null);
});

test('Guest Drawing: one address gets a day\'s worth of draws, then none until the day passes', () => {
  const db = createDatabase(':memory:');
  const now = 1_800_000_000_000;
  for (let i = 0; i < GUEST_RISINGS_PER_IP_PER_DAY; i++) assert.ok(createGuestRising('5.6.7.8', undefined, db, now));
  assert.equal(createGuestRising('5.6.7.8', undefined, db, now), null);
  assert.ok(createGuestRising('9.9.9.9', undefined, db, now), 'other addresses are unaffected');
  assert.ok(createGuestRising('5.6.7.8', undefined, db, now + 24 * 60 * 60 * 1000 + 1));
});
