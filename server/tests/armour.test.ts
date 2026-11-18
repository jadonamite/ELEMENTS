import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, setDatabase } from '../src/db.js';
import {
  addItems,
  ARMOUR,
  buyFromMerchant,
  claimLootPile,
  createLootPile,
  ensureSindrMerchants,
  getSatchel,
  getWornArmour,
  recordTransaction,
  takeOffArmour,
  wearArmour,
  wornLook,
} from '../src/economy/index.js';
import { TREASURY_ACCOUNT_ID } from '@elements/shared';
import { dropForKill } from '../src/net/money.js';
import { ZoneWorld } from '../src/net/world.js';
import { balance } from '../src/net/balance.js';

const PIECE = 'armour_shaper_ignis';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);
  return db;
}

test('Armour: every fighter starts in rags with no armour until a piece is put on', () => {
  const db = freshDb();
  assert.equal(getWornArmour('p1', db), null);
  assert.deepEqual(wornLook('p1', db), { item: null, outfit: 'rags', armour: 0 });
});

test('Armour: wearing refuses a piece you do not own, and one that is not armour at all', () => {
  const db = freshDb();
  assert.throws(() => wearArmour({ accountId: 'p1', itemId: PIECE }, db), /do not own/);
  assert.throws(() => wearArmour({ accountId: 'p1', itemId: 'material_linen' }, db), /not armour/);
  assert.equal(getWornArmour('p1', db), null);

  addItems({ accountId: 'p1', from: 'test', stacks: [{ itemId: 'material_linen', quantity: 1 }], reason: 'grant' }, db);
  assert.throws(() => wearArmour({ accountId: 'p1', itemId: PIECE }, db), /do not own/);
});

test('Armour: owning is not wearing; a worn piece stays in the satchel and survives until taken off', () => {
  const db = freshDb();
  addItems({ accountId: 'p1', from: 'test', stacks: [{ itemId: PIECE, quantity: 1 }], reason: 'grant' }, db);
  assert.equal(getWornArmour('p1', db), null);

  const on = wearArmour({ accountId: 'p1', itemId: PIECE, now: 1000 }, db);
  assert.deepEqual(on, { item: PIECE, outfit: 'shaper_ignis', armour: ARMOUR.pieces[PIECE]!.armour });
  assert.equal(getWornArmour('p1', db), PIECE);
  assert.equal(getSatchel('p1', db)[PIECE], 1, 'wearing does not spend the piece');
  assert.deepEqual(wornLook('p1', db), { item: PIECE, outfit: 'shaper_ignis', armour: 40 });

  const off = takeOffArmour({ accountId: 'p1', now: 2000 }, db);
  assert.deepEqual(off, { item: null, outfit: 'rags', armour: 0 });
  assert.equal(getWornArmour('p1', db), null);
  assert.equal(getSatchel('p1', db)[PIECE], 1);
});

test('Armour: a piece sold or traded away comes off by itself', () => {
  const db = freshDb();
  addItems({ accountId: 'p1', from: 'test', stacks: [{ itemId: PIECE, quantity: 1 }], reason: 'grant' }, db);
  wearArmour({ accountId: 'p1', itemId: PIECE }, db);
  db.prepare('UPDATE player_items SET quantity = 0 WHERE account_id = ? AND item_id = ?').run('p1', PIECE);
  assert.equal(getWornArmour('p1', db), null);
  assert.equal(wornLook('p1', db).outfit, 'rags');
});

test('Armour: the Sindr smith sells the IGNIS Shaper set and the buyer may then wear it', () => {
  const db = freshDb();
  const smith = 'sindr_arms';
  recordTransaction({ from: TREASURY_ACCOUNT_ID, to: 'p1', amount: 1000, reason: 'bounty_payout', timestamp: 1000 }, db);

  const bought = buyFromMerchant({ merchantId: smith, buyerAccountId: 'p1', itemType: PIECE, quantity: 1, now: 1000 }, db);
  assert.equal(bought.itemId, PIECE);
  assert.equal(getSatchel('p1', db)[PIECE], 1);
  assert.equal(wearArmour({ accountId: 'p1', itemId: PIECE }, db).outfit, 'shaper_ignis');

  // The set can be sold back to the stall it came from, as the same piece.
  assert.ok(getSatchel('p1', db)[PIECE]);
});

test('Armour: a defeated foe can be carrying the set, and the pile puts it in the killer\'s satchel', () => {
  const db = freshDb();
  const world = new ZoneWorld('sindr', () => 0.5);
  // Shard roll misses, armour roll hits.
  const draws = [0.99, 0];
  const rng = (): number => draws.shift() ?? 0.99;
  const pile = dropForKill(
    { zone: 'sindr', worldId: world.id, enemyId: 'villain_1', kind: 'armed', x: 140, z: 9, killerAccountId: 'p1', damageBy: {}, at: 1 },
    rng,
    db,
  );
  assert.ok(pile);
  assert.deepEqual(pile.contents.gear, { [PIECE]: 1 });

  claimLootPile({ pileId: pile.id, accountId: 'p1', x: 140, z: 9, now: 2000 }, db);
  assert.equal(getSatchel('p1', db)[PIECE], 1);
  assert.equal(wearArmour({ accountId: 'p1', itemId: PIECE }, db).armour, ARMOUR.pieces[PIECE]!.armour);
});

test('Armour: a pile of gear claims as the piece itself, not as a generic armour key', () => {
  const db = freshDb();
  const pile = createLootPile(
    { x: 0, z: 0, zone: 'sindr', contents: { chroma: 0, shards: { IGNIS: 0, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {}, gear: { [PIECE]: 1 } }, source: 'villain' },
    db,
  );
  claimLootPile({ pileId: pile.id, accountId: 'p1', x: 0.4, z: 0, now: 2000 }, db);
  assert.deepEqual(getSatchel('p1', db), { [PIECE]: 1 });
});

test('Armour: the room draws the wearer in the worn outfit and takes its share of every blow', () => {
  const world = new ZoneWorld('sindr', () => 0.5);
  const p = world.join('s1', { accountId: 'acct_a', role: 'Shaper', element: 'IGNIS', worn: PIECE }, 0);
  const tuple = world.snapshot(1).p[0]!;
  assert.equal(tuple[12], 'shaper_ignis');
  assert.equal(p.outfit, 'shaper_ignis');

  const strike = { enemy: 'e1', target: 's1', damage: 12, fromX: 0, fromZ: 1 };
  const bare = world.join('s2', { accountId: 'acct_b', role: 'Shaper', element: 'IGNIS' }, 0);
  assert.equal(bare.armour, 0);
  const armoured = p.takeStrike(strike, 1)!;
  const unarmoured = bare.takeStrike(strike, 1)!;
  assert.ok(armoured < unarmoured, `${armoured} is not less than ${unarmoured}`);
  assert.equal(armoured, 12 / (1 + balance.economy.armour.pieces[PIECE].armour / balance.combat.rules.armourScale));
});

test('Armour: a shelf added to a merchant that already trades opens once, its stock ledgered from the world', async () => {
  const { getMerchant, saveMerchant } = await import('../src/economy/merchantService.js');
  const db = freshDb();
  // The saved shop as it stood before the AQUES and AURA shelves were added.
  const shop = getMerchant('sindr_bright', db)!;
  delete shop.inventory['armour_shaper_aques'];
  delete shop.inventory['armour_shaper_aura'];
  saveMerchant(shop, db);
  db.prepare("DELETE FROM item_ledger WHERE to_id = 'sindr_bright' AND item_id IN ('armour_shaper_aques', 'armour_shaper_aura')").run();

  ensureSindrMerchants(db, 0);
  ensureSindrMerchants(db, 0);
  const after = getMerchant('sindr_bright', db)!;
  assert.equal(after.inventory['armour_shaper_aques']?.stock, 4);
  assert.equal(after.inventory['armour_shaper_aura']?.basePrice, 90);
  const ledgered = db.prepare("SELECT item_id, SUM(quantity) AS q FROM item_ledger WHERE from_id = 'world' AND to_id = 'sindr_bright' AND item_id IN ('armour_shaper_aques', 'armour_shaper_aura') GROUP BY item_id").all() as Array<{ item_id: string; q: number }>;
  assert.deepEqual(ledgered.map(r => [r.item_id, r.q]).sort(), [['armour_shaper_aques', 4], ['armour_shaper_aura', 4]], 'opened once, not twice');
});

test('Armour: an IGNIS foe never drops river or sky armour', () => {
  const db = freshDb();
  for (let i = 0; i < 3; i++) {
    const pile = dropForKill({ killerAccountId: 'p1', zone: 'sindr', kind: 'robber', x: 100, z: 0 } as never, () => 0, db);
    assert.deepEqual(pile?.contents.gear, { armour_shaper_ignis: 1 }, 'with every roll a hit, the foe carries its own nation\'s piece and no other');
  }
});
