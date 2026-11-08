import type { DatabaseSync } from 'node:sqlite';
import { armourPiece, armourOf, outfitOf, type ArmourCatalogue } from '@elements/shared';
import { getDatabase } from '../db.js';
import { getItemCount, getSatchel } from './satchelService.js';
import { armour as catalogue } from '../net/balance.js';

// What a player is wearing. A piece of armour is owned in the satchel and worn separately:
// wearing never spends it, and a piece you no longer carry comes off by itself.
// The row is per account, not per session, so it survives a reload and follows the player
// into any room and any zone.

/** The armour catalogue the server judges with, read once from balance.json. */
export const ARMOUR: ArmourCatalogue = catalogue;

/** The piece this account is wearing, or null when it is in rags or no longer owns what it wore. */
export function getWornArmour(accountId: string, db: DatabaseSync = getDatabase()): string | null {
  const row = db
    .prepare('SELECT item_id FROM worn_armour WHERE account_id = ?')
    .get(accountId) as { item_id: string } | undefined;
  const itemId = row?.item_id ?? null;
  if (!itemId) return null;
  if (!armourPiece(ARMOUR, itemId)) return null;
  // Sold, traded or lost: the piece is no longer on your back.
  return getItemCount(accountId, itemId, db) > 0 ? itemId : null;
}

/** The outfit an account draws in, and the armour value it fights with. */
export function wornLook(
  accountId: string,
  db: DatabaseSync = getDatabase(),
): { item: string | null; outfit: string; armour: number } {
  const item = getWornArmour(accountId, db);
  return { item, outfit: outfitOf(ARMOUR, item), armour: armourOf(ARMOUR, item) };
}

function save(accountId: string, itemId: string | null, now: number, db: DatabaseSync): void {
  if (itemId === null) {
    db.prepare('DELETE FROM worn_armour WHERE account_id = ?').run(accountId);
    return;
  }
  db.prepare(
    `INSERT INTO worn_armour (account_id, item_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET item_id = excluded.item_id, updated_at = excluded.updated_at`,
  ).run(accountId, itemId, now);
}

/**
 * Puts a piece the account owns on. Refuses anything that is not armour in the catalogue or is
 * not in the satchel: owning is what earns the right to wear, and you must own it first.
 */
export function wearArmour(
  params: { accountId: string; itemId: string; now?: number | undefined },
  db: DatabaseSync = getDatabase(),
): { item: string; outfit: string; armour: number } {
  const piece = armourPiece(ARMOUR, params.itemId);
  if (!piece) throw new Error('That is not armour');
  if ((getSatchel(params.accountId, db)[params.itemId] ?? 0) <= 0) {
    throw new Error(`You do not own ${piece.name}`);
  }
  save(params.accountId, params.itemId, params.now ?? Date.now(), db);
  return { item: piece.id, outfit: piece.outfit, armour: piece.armour };
}

/** Takes the armour off. Always allowed: plain clothes need nothing. */
export function takeOffArmour(
  params: { accountId: string; now?: number | undefined },
  db: DatabaseSync = getDatabase(),
): { item: null; outfit: string; armour: number } {
  save(params.accountId, null, params.now ?? Date.now(), db);
  return { item: null, outfit: outfitOf(ARMOUR, null), armour: armourOf(ARMOUR, null) };
}
