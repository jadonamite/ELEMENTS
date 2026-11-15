import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { KeyPair, baseDecode } from 'near-api-js';
import { sessionGrantBytes, type SignedSessionGrant, type SessionGrantTerms } from '@elements/shared';
import { worldKeyPair } from './accounts.js';

export interface LiveGrant {
  caps: Record<string, string>;
  expires_at: string;
  nonce: number[];
}

export function signWorldGrant(secret: string, ledgerId: string, holder: string, contract: string, caps: Record<string, string>): SignedSessionGrant {
  const pair = KeyPair.fromString(worldKeyPair(secret, ledgerId).secretKey);
  const terms: SessionGrantTerms = { holder_id: holder, expires_at: (BigInt(Date.now() + 24 * 60 * 60 * 1000) * 1_000_000n).toString(), caps, rules: 'elements-session-v1' };
  const payload = { message: JSON.stringify(terms), nonce: [...randomBytes(32)], recipient: contract, callback_url: null };
  const hash = createHash('sha256').update(sessionGrantBytes(payload)).digest();
  return { payload, public_key: pair.getPublicKey().toString(), signature: Buffer.from(pair.sign(hash).signature).toString('base64') };
}

/** The authenticated account may bind one holder key; changing it needs an owner-signed migration. */
export function bindPlayerGrant(db: DatabaseSync, accountId: string, signed: SignedSessionGrant, contracts: string[]): SessionGrantTerms {
  if (!contracts.includes(signed.payload.recipient)) throw new Error('Wrong recipient');
  const terms = JSON.parse(signed.payload.message) as SessionGrantTerms;
  const key = baseDecode(signed.public_key.replace(/^ed25519:/, ''));
  if (!signed.public_key.startsWith('ed25519:') || key.length !== 32 || Buffer.from(key).toString('hex') !== terms.holder_id) throw new Error('Wrong holder key');
  if (terms.rules !== 'elements-session-v1' || BigInt(terms.expires_at) <= BigInt(Date.now()) * 1_000_000n) throw new Error('Grant expired or rules missing');
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key)]), format: 'der', type: 'spki' });
  if (!verify(null, createHash('sha256').update(sessionGrantBytes(signed.payload)).digest(), publicKey, Buffer.from(signed.signature, 'base64'))) throw new Error('Invalid grant signature');
  const row = db.prepare('SELECT chain_public_key FROM accounts WHERE id = ?').get(accountId) as { chain_public_key: string | null } | undefined;
  if (!row) throw new Error('Account missing');
  if (row.chain_public_key && row.chain_public_key !== signed.public_key) throw new Error('Holder key change requires a signed migration');
  db.prepare('UPDATE accounts SET chain_public_key = ? WHERE id = ?').run(signed.public_key, accountId);
  return terms;
}
