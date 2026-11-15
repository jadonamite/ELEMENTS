import { baseDecode } from 'near-api-js';
import type { DatabaseSync } from 'node:sqlite';
import type { SignedSessionGrant } from '@elements/shared';
import { createOrGetAccount } from '../db.js';
import { getAccountBalance, recordTransaction } from '../economy/ledgerService.js';
import { getSatchel, removeItems, withSavepoint } from '../economy/satchelService.js';
import { bindPlayerGrant } from './grants.js';

/** Moves a device holder's ledger assets to its signed-in holder using ordinary ledger rows. */
export function prepareGuestClaim(db: DatabaseSync, accountId: string, grants: SignedSessionGrant[], contracts: { coin?: string; items?: string }, proof: SignedSessionGrant): { guestId: string; moved: boolean } {
  return withSavepoint(db, () => {
    const allowed = Object.values(contracts).filter((id): id is string => !!id);
    if (!grants.length) throw new Error('Guest ownership proof required');
    const terms = JSON.parse(grants[0]!.payload.message) as { holder_id: string };
    const guestId = `guest:${terms.holder_id}`;
    createOrGetAccount(guestId, db);
    const destination = db.prepare('SELECT chain_public_key FROM accounts WHERE id = ?').get(accountId) as { chain_public_key: string | null } | undefined;
    if (!destination?.chain_public_key) throw new Error('Destination holder key required');
    const destinationHolder = Buffer.from(baseDecode(destination.chain_public_key.replace(/^ed25519:/, ''))).toString('hex');
    const ownership = bindPlayerGrant(db, guestId, proof, [destinationHolder]);
    if (ownership.holder_id !== terms.holder_id) throw new Error('Guest proof holder differs');
    const caps = new Map<string, Record<string, string>>();
    for (const grant of grants) {
      const verified = bindPlayerGrant(db, guestId, grant, allowed);
      if (verified.holder_id !== terms.holder_id) throw new Error('Guest holders differ');
      if (caps.has(grant.payload.recipient)) throw new Error('Duplicate guest contract grant');
      caps.set(grant.payload.recipient, verified.caps);
    }
    const coin = getAccountBalance(guestId, db);
    const stacks = Object.entries(getSatchel(guestId, db)).map(([itemId, quantity]) => ({ itemId, quantity }));
    if (coin > 0 && BigInt(caps.get(contracts.coin ?? '')?.CHROMA ?? '0') < BigInt(coin)) throw new Error('Guest CHROMA cap too small');
    for (const stack of stacks) if (BigInt(caps.get(contracts.items ?? '')?.[stack.itemId] ?? '0') < BigInt(stack.quantity)) throw new Error('Guest item cap too small');
    if (coin > 0) recordTransaction({ from: guestId, to: accountId, amount: coin, reason: 'guest_claim' }, db);
    if (stacks.length) {
      removeItems({ accountId: guestId, to: accountId, stacks, reason: 'guest_claim' }, db);
      for (const stack of stacks) db.prepare(`INSERT INTO player_items (account_id,item_id,quantity) VALUES (?,?,?)
        ON CONFLICT(account_id,item_id) DO UPDATE SET quantity=quantity+excluded.quantity`).run(accountId,stack.itemId,stack.quantity);
    }
    return { guestId, moved: coin > 0 || stacks.length > 0 };
  });
}
