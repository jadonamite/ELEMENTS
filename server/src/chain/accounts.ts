import { createHash, createHmac, createPrivateKey, createPublicKey } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { COUNTING_HOUSES, SINDR_MERCHANTS, createGenesisEntries } from '@elements/shared';
import { baseDecode, baseEncode, type KeyPairString } from 'near-api-js';

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

/** World holders that get their own NEAR account: the genesis holders, every Sindr keeper and every counting house. */
export function worldHolders(): string[] {
  const ids = [
    ...createGenesisEntries(0).map((e) => e.to),
    ...SINDR_MERCHANTS.map((m) => m.id),
    ...COUNTING_HOUSES.map((c) => c.id),
  ];
  return [...new Set(ids)];
}

// Places and townsfolk (treasury, merchants, masters, shops, loot piles, counting houses)
// get readable names under the game account.
export function worldAccount(ledgerId: string, gameAccount: string): string {
  let name = ledgerId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .replace(/[-_]{2,}/g, '-');
  if (!name) name = 'x';
  const limit = 64 - gameAccount.length - 1;
  if (name.length > limit) {
    const hash = createHash('sha256').update(ledgerId).digest('hex').slice(0, 10);
    name = `${name.slice(0, Math.max(1, limit - 11)).replace(/[-_]+$/, '')}-${hash}`;
  }
  return `${name}.${gameAccount}`;
}

/** A ledger id belongs to a player once the treasury has paid them a starting purse. */
export function isPlayer(ledgerId: string, db: DatabaseSync): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM ledger_entries WHERE receiver = ? AND reason = 'player_starting_grant' LIMIT 1",
    )
    .get(ledgerId);
  if (row) return true;
  return Boolean(db.prepare('SELECT 1 FROM accounts WHERE id = ? LIMIT 1').get(ledgerId));
}

export interface ChainNames {
  gameAccount: string;
  playerSecret: string;
}

export function chainAccountFor(ledgerId: string, names: ChainNames, db: DatabaseSync): string {
  if (!isPlayer(ledgerId, db)) return worldAccount(ledgerId, names.gameAccount);
  const row = db.prepare('SELECT chain_public_key FROM accounts WHERE id = ?').get(ledgerId) as { chain_public_key: string | null } | undefined;
  if (!row?.chain_public_key) throw new Error(`Player ${ledgerId} has no holder key; sign in to grant a session`);
  const key = baseDecode(row.chain_public_key.replace(/^ed25519:/, ''));
  if (!row.chain_public_key.startsWith('ed25519:') || key.length !== 32) throw new Error('Invalid player holder key');
  return Buffer.from(key).toString('hex');
}

/** The contract's `new` arguments: the server's own genesis split, on chain names. */
export function genesisArgs(gameAccount: string): { owner_id: string; genesis: [string, string][] } {
  return {
    owner_id: gameAccount,
    genesis: createGenesisEntries(0).map((e) => [worldAccount(e.to, gameAccount), String(e.amount)]),
  };
}
