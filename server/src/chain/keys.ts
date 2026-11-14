import { createHmac, createPrivateKey, createPublicKey } from 'node:crypto';
import { baseEncode, type KeyPairString } from 'near-api-js';

// An implicit account is the hex of its ed25519 public key.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function playerSeed(secret: string, playerId: string): Buffer {
  return createHmac('sha256', secret).update(`elements-player:${playerId}`).digest();
}

function publicKeyBytes(seed: Buffer): Buffer {
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return Buffer.from(spki.subarray(spki.length - 32));
}

export function playerImplicitAccount(secret: string, playerId: string): string {
  return publicKeyBytes(playerSeed(secret, playerId)).toString('hex');
}

/** Each world holder signs with its own key under a separate derivation prefix. */
export function worldKeyPair(secret: string, ledgerId: string): { secretKey: KeyPairString; publicKey: string } {
  const seed = createHmac('sha256', secret).update(`elements-world:${ledgerId}`).digest();
  const pub = publicKeyBytes(seed);
  return {
    secretKey: `ed25519:${baseEncode(Buffer.concat([seed, pub]))}`,
    publicKey: `ed25519:${baseEncode(pub)}`,
  };
}
