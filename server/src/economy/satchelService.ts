import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { type ItemStack, type Satchel, findShortfall, isValidQuantity } from '@elements/shared';
import { getDatabase } from '../db.js';

// Items a player carries, held by the server. Every change writes an item_ledger row naming
// where the items came from and went (a pile, a merchant, the world, another player).

export type ItemReason =
  | 'loot_claim' | 'merchant_buy' | 'merchant_sell' | 'shop_stock' | 'death_drop' | 'grant' | 'trade'
  | 'loot_drop' | 'loot_expired' | 'merchant_restock' | 'merchant_tribute' | 'opening_stock' | 'item_use' | 'stock_conversion';

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

export function getLedgerItemBalance(accountId: string, itemId: string, db: DatabaseSync = getDatabase()): number {
  const row = db.prepare('SELECT COALESCE(SUM(CASE WHEN to_id = ? THEN quantity ELSE -quantity END), 0) AS quantity FROM item_ledger WHERE item_id = ? AND (to_id = ? OR from_id = ?)').get(accountId,itemId,accountId,accountId) as {quantity:number};
  return row.quantity;
}

export function recordItemMove(
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
      recordItemMove(db, params.from, params.accountId, stack, params.reason, params.refId, now);
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
      recordItemMove(db, params.accountId, params.to, stack, params.reason, params.refId, now);
    }
  });
}

/** Adds a one-time opening entry for holdings that predate item-ledger coverage. */
export function reconcileItemLedger(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS item_ledger_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  if (db.prepare("SELECT 1 FROM item_ledger_migrations WHERE name = 'opening-stock-v1'").get()) return;
  withSavepoint(db, () => {
    const holdings = new Map<string, number>();
    const add = (account: string, item: string, quantity: number) => {
      if (quantity > 0) {
        const key = `${account}\0${item}`;
        holdings.set(key, (holdings.get(key) ?? 0) + quantity);
      }
    };
    const players = db.prepare('SELECT account_id, item_id, quantity FROM player_items WHERE quantity > 0').all() as Array<{account_id:string;item_id:string;quantity:number}>;
    for (const row of players) add(row.account_id, row.item_id, row.quantity);
    const piles = db.prepare('SELECT id, contents FROM loot_piles WHERE claimed = 0 AND expired = 0').all() as Array<{id:string;contents:string}>;
    for (const row of piles) for (const stack of lootStacksFromJson(row.contents)) add(row.id, stack.itemId, stack.quantity);
    const netRows = db.prepare('SELECT from_id, to_id, item_id, quantity FROM item_ledger ORDER BY rowid').all() as Array<{from_id:string;to_id:string;item_id:string;quantity:number}>;
    const net = new Map<string, number>();
    const change = (account:string,item:string,delta:number) => { const key=`${account}\0${item}`; net.set(key,(net.get(key)??0)+delta); };
    for (const row of netRows) { change(row.from_id,row.item_id,-row.quantity); change(row.to_id,row.item_id,row.quantity); }
    const merchants = db.prepare('SELECT id, nation, inventory FROM merchant_states').all() as Array<{id:string;nation:string;inventory:string}>;
    for (const merchant of merchants) {
      const inventory = JSON.parse(merchant.inventory) as Record<string, {stock?:number}>;
      for (const [category, stock] of Object.entries(inventory)) {
        const current = stock.stock ?? 0;
        const categoryNet = netRows.reduce((sum, row) => {
          if (row.item_id === 'world') return sum;
          const mapped = stockCategory(row.item_id, inventory);
          if (mapped !== category) return sum;
          if (row.to_id === merchant.id) return sum + row.quantity;
          if (row.from_id === merchant.id) return sum - row.quantity;
          return sum;
        }, 0);
        const difference = current - categoryNet;
        if (difference < 0) throw new Error(`Item ledger exceeds current merchant stock for ${merchant.id}/${category}`);
        if (difference > 0) recordItemMove(db, 'world', merchant.id, { itemId: category === 'shard' ? `shard_${merchant.nation.toLowerCase()}` : category, quantity:difference }, 'opening_stock', 'opening-stock-v1', Date.now());
      }
    }
    const merchantIds = new Set(merchants.map((merchant) => merchant.id));
    const expiredPiles = new Set((db.prepare('SELECT id FROM loot_piles WHERE expired = 1').all() as Array<{id:string}>).map((row) => row.id));
    const accountItems = new Set([...holdings.keys(), ...net.keys()].filter((key) => {
      const split = key.indexOf('\0');
      return key.slice(0, split) !== 'world' && !merchantIds.has(key.slice(0, split));
    }));
    for (const key of accountItems) {
      const split = key.indexOf('\0'); const account = key.slice(0, split); const itemId = key.slice(split + 1);
      const difference = (holdings.get(key) ?? 0) - (net.get(key) ?? 0);
      const now = Date.now();
      if (difference > 0) recordItemMove(db, 'world', account, {itemId, quantity:difference}, 'opening_stock', 'opening-stock-v1', now);
      else if (difference < 0) recordItemMove(db, account, 'world', {itemId, quantity:-difference}, expiredPiles.has(account) ? 'loot_expired' : 'opening_stock', 'opening-stock-v1', now);
    }
    db.prepare("INSERT INTO item_ledger_migrations (name, applied_at) VALUES ('opening-stock-v1', ?)").run(Date.now());
  });
}

function stockCategory(itemId: string, inventory: Record<string, unknown>): string {
  if (itemId in inventory) return itemId;
  if (itemId.startsWith('shard_') && 'shard' in inventory) return 'shard';
  const head = itemId.split('_')[0] ?? itemId;
  if (head in inventory) return head;
  return 'item' in inventory ? 'item' : itemId;
}

function lootStacksFromJson(contents: string): ItemStack[] {
  const value = JSON.parse(contents) as { shards?:Record<string,number>; materials?:Record<string,number>; gear?:Record<string,number> };
  const stacks: ItemStack[] = [];
  for (const [colour, quantity] of Object.entries(value.shards ?? {})) if (quantity > 0) stacks.push({itemId:`shard_${colour.toLowerCase()}`,quantity});
  for (const [name, quantity] of Object.entries(value.materials ?? {})) if (quantity > 0) stacks.push({itemId:name === 'material' || name.startsWith('material_') ? name : `material_${name}`,quantity});
  for (const [itemId, quantity] of Object.entries(value.gear ?? {})) if (quantity > 0) stacks.push({itemId,quantity});
  return stacks;
}

/** Replays every item move and checks each server-owned holding against the database. */
export function verifyItemLedger(db: DatabaseSync): { ok: boolean; mismatches: string[] } {
  const net = new Map<string, number>();
  const change = (account:string,item:string,delta:number) => { const key=`${account}\0${item}`; net.set(key,(net.get(key)??0)+delta); };
  const rows = db.prepare('SELECT from_id, to_id, item_id, quantity FROM item_ledger ORDER BY rowid').all() as Array<{from_id:string;to_id:string;item_id:string;quantity:number}>;
  for (const row of rows) { change(row.from_id,row.item_id,-row.quantity); change(row.to_id,row.item_id,row.quantity); }
  const current = new Map<string, number>();
  const add = (account:string,item:string,quantity:number) => { if(quantity>0) current.set(`${account}\0${item}`,quantity); };
  for (const r of db.prepare('SELECT account_id,item_id,quantity FROM player_items WHERE quantity>0').all() as Array<{account_id:string;item_id:string;quantity:number}>) add(r.account_id,r.item_id,r.quantity);
  for (const r of db.prepare('SELECT id,contents FROM loot_piles WHERE claimed=0 AND expired=0').all() as Array<{id:string;contents:string}>) for (const s of lootStacksFromJson(r.contents)) add(r.id,s.itemId,s.quantity);
  const merchants = db.prepare('SELECT id,inventory FROM merchant_states').all() as Array<{id:string;inventory:string}>;
  const mismatches: string[] = [];
  for (const merchant of merchants) {
    const inventory = JSON.parse(merchant.inventory) as Record<string,{stock?:number}>;
    for (const [category, stock] of Object.entries(inventory)) {
      const actual = stock.stock ?? 0;
      let ledger = 0;
      for (const [key, value] of net) {
        const split=key.indexOf('\0');
        if (key.slice(0,split)!==merchant.id) continue;
        const item=key.slice(split+1);
        const mapped=stockCategory(item, inventory);
        if(mapped===category) ledger+=value;
      }
      if(actual!==ledger) mismatches.push(`${merchant.id}/${category} db=${actual} ledger=${ledger}`);
    }
  }
  const merchantIds = new Set(merchants.map((merchant) => merchant.id));
  const keys = new Set([...current.keys(), ...[...net.keys()].filter((key) => {
    if (key.startsWith('world\0')) return false;
    const split = key.indexOf('\0');
    return !merchantIds.has(key.slice(0, split));
  })]);
  mismatches.push(...[...keys].filter((key) => (current.get(key) ?? 0) !== (net.get(key) ?? 0)).map((key) => `${key.replace('\0','/')} db=${current.get(key)??0} ledger=${net.get(key)??0}`));
  return { ok: mismatches.length === 0, mismatches };
}
