import { playerImplicitAccount } from './keys.js';
export { playerSeed, playerImplicitAccount, worldKeyPair } from './keys.js';
import { legacyCaps, type LegacyClaims } from './legacy.js';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { COUNTING_HOUSES, SINDR_MERCHANTS, createGenesisEntries } from '@elements/shared';
import { baseDecode } from 'near-api-js';

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
  contractId?: string;
  claimHolder?: string;
  legacyClaims?: LegacyClaims;
}

export function chainAccountFor(ledgerId: string, names: ChainNames, db: DatabaseSync): string {
  if (!isPlayer(ledgerId, db)) return worldAccount(ledgerId, names.gameAccount);
  const row = db.prepare('SELECT chain_public_key FROM accounts WHERE id = ?').get(ledgerId) as { chain_public_key: string | null } | undefined;
  if (!row?.chain_public_key) throw new Error(`Player ${ledgerId} has no holder key; sign in to grant a session`);
  const key = baseDecode(row.chain_public_key.replace(/^ed25519:/, ''));
  if (!row.chain_public_key.startsWith('ed25519:') || key.length !== 32) throw new Error('Invalid player holder key');
  const destination = Buffer.from(key).toString('hex');
  const source = playerImplicitAccount(names.playerSecret,ledgerId);
  if (names.contractId && legacyCaps(names.legacyClaims,names.contractId,source)) {
    const claim = db.prepare('SELECT status FROM legacy_chain_claims WHERE contract=? AND holder=?').get(names.contractId,source) as {status:string}|undefined;
    if (claim?.status !== 'settled' && names.claimHolder !== source) return source;
  }
  return destination;
}

/** The contract's `new` arguments: the server's own genesis split, on chain names. */
export function genesisArgs(gameAccount: string): { owner_id: string; genesis: [string, string][] } {
  return {
    owner_id: gameAccount,
    genesis: createGenesisEntries(0).map((e) => [worldAccount(e.to, gameAccount), String(e.amount)]),
  };
}
