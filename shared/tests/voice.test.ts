import assert from 'node:assert/strict';
import test from 'node:test';
import { lineKey, voiceId } from '../src/story/voice.js';

test('line keys match the render script hash, including non-ASCII text', () => {
  assert.equal(lineKey('Hold! Stand where you are.'), 'c513a165');
  assert.equal(lineKey('Crimson shards, CHROMA — fair price.'), '7cf55320');
  assert.equal(voiceId('guard_sindr', 'female'), 'guard_sindr_female');
});
