import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyPair } from 'near-api-js';
import { SINDR_MERCHANTS } from '@elements/shared';
import { worldAccount, worldHolders, worldKeyPair } from '../src/chain/accounts.js';

test('each world holder has its own stable key that signs for its public key', () => {
  const a = worldKeyPair('secret', 'sindr_bright');
  assert.deepEqual(worldKeyPair('secret', 'sindr_bright'), a);
  assert.notEqual(worldKeyPair('secret', 'sindr_coal').publicKey, a.publicKey);
  assert.equal(KeyPair.fromString(a.secretKey).getPublicKey().toString(), a.publicKey);
});

test('world holders cover the treasury, every Sindr keeper and the counting houses, once each', () => {
  const holders = worldHolders();
  assert.equal(new Set(holders).size, holders.length);
  for (const id of ['treasury', 'master_ignis', 'ch_ignis_sindr_upper', ...SINDR_MERCHANTS.map((m) => m.id)]) {
    assert.ok(holders.includes(id), id);
  }
  for (const id of holders) assert.match(worldAccount(id, 'elements-dev.testnet'), /^[a-z0-9_-]+\.elements-dev\.testnet$/);
});
