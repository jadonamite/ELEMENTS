import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';

test('public build ignores server overrides and resumes the browser rising without fetching', async () => {
  const previousSetting = process.env.VITE_NO_SERVER;
  process.env.VITE_NO_SERVER = '1';
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    envDir: false,
    build: {
      write: false,
      lib: { entry: new URL('../src/auth/server-api.ts', import.meta.url).pathname, formats: ['es'] },
      minify: false,
    },
  });
  if (previousSetting === undefined) delete process.env.VITE_NO_SERVER;
  else process.env.VITE_NO_SERVER = previousSetting;
  const bundle = Array.isArray(output) ? output[0] : output;
  const code = bundle.output.find(item => item.type === 'chunk').code;
  const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const previous = { fetch: globalThis.fetch, window: globalThis.window, localStorage: globalThis.localStorage };
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  globalThis.window = { location: { search: '?online&server=http://localhost:2567&serverPort=2670' } };
  globalThis.fetch = () => { throw new Error('Game server request escaped the public build'); };
  try {
    assert.equal(api.hasGameServer(), false);
    assert.equal(api.getServerUrl(), '');
    assert.deepEqual(api.localSession('did:privy:test'), { accountId: 'did:privy:test', rising: null });
    const first = await api.postRising();
    assert.ok(first.role === 'Hush' || ['IGNIS', 'AQUES', 'TERRA', 'AURA'].includes(first.element));
    assert.deepEqual(await api.postRising(), first);
    assert.deepEqual(await api.postSession(''), { accountId: 'did:privy:test', rising: first });
    assert.deepEqual(api.localSession('did:privy:another').rising, first);
    values.set('elements_drawing_result', '{broken');
    assert.equal(api.localSession().rising, null);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
