// Exercises the item ledger on a disposable NEP-245 contract and verifies its chain balances.
import { DatabaseSync } from 'node:sqlite';
import { JsonRpcProvider } from 'near-api-js';
import { migrateDatabase } from '../src/db.js';
import { ensureSindrMerchants } from '../src/economy/agents/agentLoop.js';
import { createLootPile, claimLootPile } from '../src/economy/lootService.js';
import { buyFromMerchant, getMerchant, sellToMerchant } from '../src/economy/merchantService.js';
import { grantPlayerStartingPurse } from '../src/economy/ledgerService.js';
import { addItems, reconcileItemLedger, removeItems, verifyItemLedger } from '../src/economy/satchelService.js';
import { playerImplicitAccount, worldAccount } from '../src/chain/accounts.js';
import { nearClient, Settler } from '../src/chain/settler.js';
import type { ChainConfig } from '../src/chain/config.js';

const base = {
  gameAccount: process.env.NEAR_ACCOUNT_ID,
  playerSecret: process.env.CHAIN_PLAYER_SECRET,
  contractId: process.env.ITEMS_SMOKE_CONTRACT_ID,
  privateKey: process.env.ITEMS_SMOKE_PRIVATE_KEY,
};
if (!base.gameAccount || !base.playerSecret || !base.contractId || !base.privateKey) {
  throw new Error('Set NEAR_ACCOUNT_ID, CHAIN_PLAYER_SECRET, ITEMS_SMOKE_CONTRACT_ID and ITEMS_SMOKE_PRIVATE_KEY');
}
if (!base.contractId.endsWith('-smoke.elements-dev.testnet')) throw new Error('Smoke refuses a contract outside the throwaway *-smoke.elements-dev.testnet name');
const config: ChainConfig = {
  ...base,
  network: 'testnet',
  rpcUrl: process.env.NEAR_RPC_URL ?? 'https://rpc.testnet.fastnear.com',
  explorerUrl: 'https://testnet.nearblocks.io',
  settleEveryMs: 60_000,
  batchSize: 80,
};

const db = new DatabaseSync(':memory:');
migrateDatabase(db);
ensureSindrMerchants(db, 100);
reconcileItemLedger(db);
grantPlayerStartingPurse('items_smoke_player', db);
const pile = createLootPile({
  id: 'pile_items_smoke', x: 0, z: 0, zone: 'sindr', source: 'monster', now: 200,
  contents: { chroma: 0, shards: { IGNIS: 2, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {} },
}, db);
claimLootPile({ pileId: pile.id, accountId: 'items_smoke_player', x: 0, z: 0, now: 201 }, db);
buyFromMerchant({ merchantId: 'sindr_supplies', buyerAccountId: 'items_smoke_player', itemType: 'potion', quantity: 2, now: 202 }, db);
sellToMerchant({ merchantId: 'sindr_supplies', sellerAccountId: 'items_smoke_player', itemType: 'potion', quantity: 1, now: 203 }, db);
removeItems({ accountId: 'items_smoke_player', to: 'world', stacks: [{ itemId: 'potion', quantity: 1 }], reason: 'item_use', now: 204 }, db);
const replay = verifyItemLedger(db);
if (!replay.ok) throw new Error(`Item ledger does not replay: ${replay.mismatches.join('; ')}`);

const settler = new Settler(config, nearClient(config, 'items'), db, 'items');
while ((await settler.tick()) !== null) { /* settle one ordered batch at a time */ }
if (settler.haltReason) throw new Error(settler.haltReason);

const provider = new JsonRpcProvider({ url: config.rpcUrl });
const player = playerImplicitAccount(config.playerSecret, 'items_smoke_player');
const read = (account_id: string, token_id: string) => provider.callFunction({
  contractId: config.contractId, method: 'mt_balance_of', args: { account_id, token_id },
});
const shard = await read(player, 'shard_ignis');
const potion = await read(player, 'potion');
const merchantId = worldAccount('sindr_supplies', config.gameAccount);
const merchantPotion = await read(merchantId, 'potion');
const expectedMerchantPotion = getMerchant('sindr_supplies', db)?.inventory.potion?.stock;
if (Number(shard) !== 2 || Number(potion) !== 0 || expectedMerchantPotion === undefined || Number(merchantPotion) !== expectedMerchantPotion) {
  throw new Error(`Chain disagrees with the ledger: player shards=${shard}, player potions=${potion}, merchant potions=${merchantPotion}, ledger merchant potions=${expectedMerchantPotion}`);
}
console.log(JSON.stringify({ contract: config.contractId, player, balances: { shard_ignis: shard, potion, merchant_potion: merchantPotion }, settlement: settler.status() }, null, 2));
