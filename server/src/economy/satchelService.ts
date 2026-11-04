import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { type ItemStack, type Satchel, findShortfall, isValidQuantity } from '@elements/shared';
import { getDatabase } from '../db.js';

// Items a player carries, held by the server. Every change writes an item_ledger row naming
// where the items came from and went (a pile, a merchant, the world, another player).

export type ItemReason =
  'loot_claim' | 'merchant_buy' | 'merchant_sell' | 'shop_stock' | 'death_drop' | 'grant' | 'trade';

let savepointCounter = 0;

// Runs fn inside a savepoint so a failure undoes every write it made, coin and items alike.
export function withSavepoint<T>(db: DatabaseSync, fn: () => T): T {
  const name = `sp_${++savepointCounter}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}

export function getSatchel(accountId: string, db: DatabaseSync = getDatabase()): Satchel {
  const rows = db
    .prepare('SELECT item_id, quantity FROM player_items WHERE account_id = ? AND quantity > 0')
    .all(accountId) as Array<{ item_id: string; quantity: number }>;
  const satchel: Satchel = {};
  for (const r of rows) satchel[r.item_id] = r.quantity;
  return satchel;
}

export function getItemCount(
  accountId: string,
  itemId: string,
  db: DatabaseSync = getDatabase(),
): number {
  const row = db
    .prepare('SELECT quantity FROM player_items WHERE account_id = ? AND item_id = ?')
    .get(accountId, itemId) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

function writeLedger(
  db: DatabaseSync,
  fromId: string,
  toId: string,
  stack: ItemStack,
  reason: ItemReason,
  refId: string | undefined,
  now: number,
): void {
  db.prepare(
    'INSERT INTO item_ledger (id, from_id, to_id, item_id, quantity, reason, ref_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    `itx_${randomUUID()}`,
    fromId,
    toId,
    stack.itemId,
    stack.quantity,
    reason,
    refId ?? null,
    now,
  );
}

// Puts items into a player's satchel from somewhere outside it (a pile, a merchant's shelf).
export function addItems(
  params: {
    accountId: string;
    from: string;
    stacks: ItemStack[];
    reason: ItemReason;
    refId?: string | undefined;
    now?: number | undefined;
  },
  db: DatabaseSync = getDatabase(),
): void {
  const now = params.now ?? Date.now();
  for (const stack of params.stacks) {
    if (!isValidQuantity(stack.quantity)) throw new Error(`Invalid quantity for ${stack.itemId}`);
  }
  withSavepoint(db, () => {
    for (const stack of params.stacks) {
      db.prepare(
        `INSERT INTO player_items (account_id, item_id, quantity) VALUES (?, ?, ?)
         ON CONFLICT(account_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      ).run(params.accountId, stack.itemId, stack.quantity);
      writeLedger(db, params.from, params.accountId, stack, params.reason, params.refId, now);
    }
  });
}

// Takes items out of a player's satchel to somewhere else. Refuses the whole move if any stack is short.
export function removeItems(
  params: {
    accountId: string;
    to: string;
    stacks: ItemStack[];
    reason: ItemReason;
    refId?: string | undefined;
    now?: number | undefined;
  },
  db: DatabaseSync = getDatabase(),
): void {
  const now = params.now ?? Date.now();
  for (const stack of params.stacks) {
    if (!isValidQuantity(stack.quantity)) throw new Error(`Invalid quantity for ${stack.itemId}`);
  }
  withSavepoint(db, () => {
    const short = findShortfall(getSatchel(params.accountId, db), params.stacks);
    if (short) {
      throw new Error(`Not enough ${short.itemId} in satchel: need ${short.quantity}`);
    }
    for (const stack of params.stacks) {
      db.prepare(
        'UPDATE player_items SET quantity = quantity - ? WHERE account_id = ? AND item_id = ?',
      ).run(stack.quantity, params.accountId, stack.itemId);
      writeLedger(db, params.accountId, params.to, stack, params.reason, params.refId, now);
    }
  });
}
