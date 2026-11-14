import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { KeyPair, baseEncode } from 'near-api-js';
import { sessionGrantBytes, type SignedSessionGrant } from '@elements/shared';
import { playerImplicitAccount, playerSeed } from './keys.js';

export interface LegacyClaims {
  network: 'testnet';
  height: number;
  contracts: { chroma: string; items: string };
  holders: Record<string, { coin: string; items: Record<string, string> }>;
}

export function readLegacyClaims(path = new URL('../../config/legacy-claims.testnet.json', import.meta.url)): LegacyClaims {
  const list = JSON.parse(readFileSync(path, 'utf8')) as LegacyClaims;
  if (list.network !== 'testnet') throw new Error('Legacy list must be testnet');
  for (const [holder, amounts] of Object.entries(list.holders)) {
    if (!/^[a-f0-9]{64}$/.test(holder) || BigInt(amounts.coin) < 0n || Object.values(amounts.items).some(n => BigInt(n) <= 0n)) throw new Error('Invalid legacy claim list');
  }
  return list;
}

export function legacyCaps(list: LegacyClaims | undefined, contract: string, holder: string): Record<string, string> | null {
  const entry = list?.holders[holder];
  if (!list || !entry) return null;
  if (contract === list.contracts.chroma) return BigInt(entry.coin) > 0n ? { CHROMA: entry.coin } : null;
  if (contract === list.contracts.items && Object.keys(entry.items).length) return entry.items;
  return null;
}

export function migrateLegacyTables(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS legacy_chain_claims (
    contract TEXT NOT NULL, holder TEXT NOT NULL, destination TEXT NOT NULL, status TEXT NOT NULL,
    grant_json TEXT NOT NULL, moves_json TEXT NOT NULL, batch INTEGER, tx_hash TEXT,
    PRIMARY KEY(contract,holder)
  )`);
}

export function legacyGrant(secret: string, ledgerId: string, contract: string, list: LegacyClaims): SignedSessionGrant {
  const holder = playerImplicitAccount(secret, ledgerId);
  const caps = legacyCaps(list, contract, holder);
  if (!caps) throw new Error('Holder is not on the genesis legacy claim list');
  const pair = KeyPair.fromString(`ed25519:${baseEncode(Buffer.concat([playerSeed(secret, ledgerId),Buffer.from(holder,'hex')]))}`);
  const payload = {
    message: JSON.stringify({ holder_id:holder, expires_at:(BigInt(Date.now()+10*365*24*3600_000)*1_000_000n).toString(), caps, rules:'elements-session-v1' }),
    nonce:[...createHash('sha256').update(`legacy:${list.height}:${contract}:${holder}`).digest()],
    recipient:contract, callback_url:null,
  };
  return {payload,public_key:pair.getPublicKey().toString(),signature:Buffer.from(pair.sign(createHash('sha256').update(sessionGrantBytes(payload)).digest()).signature).toString('base64')};
}
