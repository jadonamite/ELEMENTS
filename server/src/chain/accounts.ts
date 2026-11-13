import { createHash, createHmac, createPrivateKey, createPublicKey } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createGenesisEntries } from '@elements/shared';

// A NEAR implicit account is the hex of an ed25519 public key. Each player's key is derived
// from the server's chain secret and their game id, so no per-player key is ever stored.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function playerSeed(secret: string, playerId: string): Buffer {
  return createHmac('sha256', secret).update(`elements-player:${playerId}`).digest();
}

export function playerImplicitAccount(secret: string, playerId: string): string {
  const seed = playerSeed(secret, playerId);
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return Buffer.from(spki.subarray(spki.length - 32)).toString('hex');
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
  return isPlayer(ledgerId, db)
    ? playerImplicitAccount(names.playerSecret, ledgerId)
    : worldAccount(ledgerId, names.gameAccount);
}

/** The contract's `new` arguments: the server's own genesis split, on chain names. */
export function genesisArgs(gameAccount: string): { owner_id: string; genesis: [string, string][] } {
  return {
    owner_id: gameAccount,
    genesis: createGenesisEntries(0).map((e) => [worldAccount(e.to, gameAccount), String(e.amount)]),
  };
}
