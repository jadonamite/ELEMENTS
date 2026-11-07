import test from 'node:test';
import assert from 'node:assert/strict';
import { isTownMode } from '../src/world-mode.ts';

test('home and existing town URLs enter Sindr; arena is explicit', () => {
  for (const query of ['', '?town', '?offline', '?debug&element=TERRA', '?town&arena']) {
    assert.equal(isTownMode(new URLSearchParams(query)), true, query);
  }
  assert.equal(isTownMode(new URLSearchParams('?arena')), false);
  assert.equal(isTownMode(new URLSearchParams('?arena&element=AQUES&debug')), false);
});
