import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('balance data starts as an empty object', async () => {
  const data = await readFile(new URL('../balance.json', import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(data), {});
});
