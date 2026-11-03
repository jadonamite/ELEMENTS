import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, setDatabase } from '../src/db.js';
import {
  addItems,
  removeItems,
  getSatchel,
  getItemCount,
  createLootPile,
  createLootPileFromFight,
  claimLootPile,
  sellToMerchant,
  buyFromMerchant,
  getMerchant,
  getAccountBalance,
  grantPlayerStartingPurse,
  verifyWorldSupply,
  ensureSindrMerchants,
} from '../src/economy/index.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);
  return db;
}

// Items in minus items out, from the item ledger, for one account and item.
function ledgerNet(db: DatabaseSync, accountId: string, itemId: string): number {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN to_id = ? THEN quantity ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN from_id = ? THEN quantity ELSE 0 END), 0) AS net
       FROM item_ledger WHERE item_id = ?`,
    )
    .get(accountId, accountId, itemId) as { net: number };
  return row.net;
}

test('Satchel: claiming a pile puts its shards and materials in the satchel, with ledger rows', () => {
  const db = freshDb();
  const pile = createLootPile(
    {
      x: 0,
      z: 0,
      zone: 'sindr',
      contents: { chroma: 20, shards: { IGNIS: 2, AQUES: 1, TERRA: 0, AURA: 0 }, materials: { linen: 3 } },
      source: 'villain',
      now: 1000,
    },
    db,
  );
  claimLootPile({ pileId: pile.id, accountId: 'p1', x: 0.5, z: 0, now: 2000 }, db);

  assert.deepEqual(getSatchel('p1', db), { shard_ignis: 2, shard_aques: 1, material_linen: 3 });
  assert.equal(getAccountBalance('p1', db), 20);
  assert.equal(ledgerNet(db, 'p1', 'shard_ignis'), 2);
  assert.equal(ledgerNet(db, 'p1', 'material_linen'), 3);
  assert.equal(verifyWorldSupply(db), true);
});

test('Satchel: selling shards you do not carry is refused and changes nothing', () => {
  const db = freshDb();
  const before = getMerchant('sindr_shards', db)!;
  assert.throws(
    () =>
      sellToMerchant(
        { merchantId: 'sindr_shards', sellerAccountId: 'p1', itemType: 'shard_ignis', quantity: 5, now: 1000 },
        db,
      ),
    /Not enough shard_ignis/,
  );
  const after = getMerchant('sindr_shards', db)!;
  assert.equal(getAccountBalance('p1', db), 0);
  assert.equal(after.balance, before.balance);
  assert.equal(after.inventory['shard']!.stock, before.inventory['shard']!.stock);
});

test('Satchel: selling shards you carry moves them to the merchant and pays you', () => {
  const db = freshDb();
  addItems({ accountId: 'p1', from: 'world', stacks: [{ itemId: 'shard_ignis', quantity: 5 }], reason: 'grant', now: 1000 }, db);
  const stockBefore = getMerchant('sindr_shards', db)!.inventory['shard']!.stock;

  const sale = sellToMerchant(
    { merchantId: 'sindr_shards', sellerAccountId: 'p1', itemType: 'shard_ignis', quantity: 5, now: 2000 },
    db,
  );

  assert.equal(getItemCount('p1', 'shard_ignis', db), 0);
  assert.equal(getAccountBalance('p1', db), sale.totalPrice);
  assert.equal(getMerchant('sindr_shards', db)!.inventory['shard']!.stock, stockBefore + 5);
  assert.equal(verifyWorldSupply(db), true);
});

test("Satchel: buying a plain shard gives the merchant's own nation colour", () => {
  const db = freshDb();
  grantPlayerStartingPurse('p1', db);
  const merchant = getMerchant('sindr_shards', db)!;
  const bought = buyFromMerchant(
    { merchantId: 'sindr_shards', buyerAccountId: 'p1', itemType: 'shard', quantity: 1, now: 1000 },
    db,
  );
  const expected = `shard_${merchant.nation.toLowerCase()}`;
  assert.equal(bought.itemId, expected);
  assert.equal(getItemCount('p1', expected, db), 1);
  assert.equal(verifyWorldSupply(db), true);
});

test('Satchel: a failed multi-item removal leaves every stack untouched', () => {
  const db = freshDb();
  addItems({ accountId: 'p1', from: 'world', stacks: [{ itemId: 'shard_terra', quantity: 4 }], reason: 'grant' }, db);
  assert.throws(
    () =>
      removeItems(
        {
          accountId: 'p1',
          to: 'somewhere',
          stacks: [
            { itemId: 'shard_terra', quantity: 4 },
            { itemId: 'material_ore', quantity: 1 },
          ],
          reason: 'shop_stock',
        },
        db,
      ),
    /Not enough material_ore/,
  );
  assert.equal(getItemCount('p1', 'shard_terra', db), 4);
  assert.equal(ledgerNet(db, 'p1', 'shard_terra'), 4);
});

test('Satchel: dying drops from what the server holds, not from what the client says, and another player can take it', () => {
  const db = freshDb();
  addItems(
    {
      accountId: 'victim',
      from: 'world',
      stacks: [
        { itemId: 'shard_ignis', quantity: 8 },
        { itemId: 'material_linen', quantity: 2 },
      ],
      reason: 'grant',
      now: 1000,
    },
    db,
  );

  const pile = createLootPileFromFight(
    {
      x: 10,
      z: 10,
      zone: 'road',
      source: 'player_death',
      sourceAccountId: 'victim',
      // A forged claim of a huge satchel is ignored.
      carried: { chroma: 0, shards: { IGNIS: 999 }, materials: { gold: 50 } },
      now: 2000,
    },
    db,
  );

  assert.equal(pile.contents.shards.IGNIS, 2); // a quarter of 8
  assert.deepEqual(pile.contents.materials, { linen: 2 });
  assert.equal(getItemCount('victim', 'shard_ignis', db), 6);
  assert.equal(getItemCount('victim', 'material_linen', db), 0);

  claimLootPile({ pileId: pile.id, accountId: 'scavenger', x: 10, z: 10.5, now: 3000 }, db);
  assert.equal(getItemCount('scavenger', 'shard_ignis', db), 2);
  assert.equal(getItemCount('scavenger', 'material_linen', db), 2);
  assert.equal(getAccountBalance('victim', db), 0);
});
