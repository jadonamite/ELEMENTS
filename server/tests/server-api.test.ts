import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express, { type Application } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { isOriginAllowed, setupApi } from '../src/api.js';
import { setTokenVerifier } from '../src/auth.js';
import {
  createDatabase,
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
