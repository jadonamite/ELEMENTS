// Proves the Chromara board on testnet against throwaway copies of the game contracts: gasless deposits from new
// implicit accounts, two signed offers matched by the broker, and goods taken back into the game.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, baseDecode, baseEncode, nearToYocto, type KeyPairString } from 'near-api-js';
import { marketPayload, type MarketIntent } from '@elements/shared';
import { migrateDatabase } from '../src/db.js';
import { MarketService } from '../src/economy/marketService.js';
import { NearMarketChain, delegateFor, signWorldIntent } from '../src/chain/marketClient.js';
import type { MarketConfig } from '../src/chain/marketConfig.js';

const owner = process.env.BOARD_SMOKE_ACCOUNT;
const secret = process.env.CHAIN_PLAYER_SECRET?.trim();
const wasmDir = process.env.BOARD_SMOKE_WASM_DIR;
if (!owner?.includes('board-smoke') || !owner.endsWith('.testnet')) throw new Error('BOARD_SMOKE_ACCOUNT must be a disposable board-smoke testnet account');
if (!secret || !wasmDir) throw new Error('CHAIN_PLAYER_SECRET and BOARD_SMOKE_WASM_DIR are required');

const rpcUrl = 'https://rpc.testnet.fastnear.com';
const provider = new JsonRpcProvider({ url: rpcUrl });
const credential = JSON.parse(await readFile(`${homedir()}/.near-credentials/testnet/${owner}.json`, 'utf8')) as { private_key: KeyPairString };
const game = new Account(owner, provider, KeyPairSigner.fromSecretKey(credential.private_key));
const link = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
const links: Record<string, string> = {};
const stamp = Date.now().toString(36);

async function deploy(name: string, wasm: string, args: Record<string, unknown>) {
  const id = `${name}-${stamp}.${owner}`;
  await game.createAccount({ newAccountId: id, publicKey: KeyPair.fromString(credential.private_key).getPublicKey().toString(), nearToTransfer: nearToYocto('3') });
  const publicKey = KeyPair.fromString(credential.private_key).getPublicKey().toString();
  for (let i = 0; ; i++) {
    try { await provider.viewAccessKey({ accountId: id, publicKey, finalityQuery: { finality: 'final' } }); break; }
    catch (error) { if (i > 30) throw error; await new Promise((r) => setTimeout(r, 1000)); }
  }
  const contract = new Account(id, provider, KeyPairSigner.fromSecretKey(credential.private_key));
  const deployed = await contract.signAndSendTransaction({ receiverId: id, actions: [actions.deployContract(await readFile(`${wasmDir}/${wasm}`)), actions.functionCall('new', args, 100_000_000_000_000n, 0n)], waitUntil: 'FINAL' });
  links[`${name}_deploy`] = link(deployed.transaction.hash);
  return id;
}
const implicit = (pair: KeyPair) => Buffer.from(baseDecode(pair.getPublicKey().toString().slice(8))).toString('hex');

const seller = KeyPair.fromRandom('ed25519');
const buyer = KeyPair.fromRandom('ed25519');
const sellerId = implicit(seller);
const buyerId = implicit(buyer);

const coin = await deploy('coin', 'chroma_token.wasm', { owner_id: owner, genesis: [[buyerId, '500']] });
const items = await deploy('items', 'elements_items.wasm', { owner_id: owner });
const mint = await game.signAndSendTransaction({ receiverId: items, actions: [actions.functionCall('settle', { batch: 1, ops: [{ from: null, to: sellerId, token_id: 'shard_ignis', amount: '3', memo: 'board smoke' }] }, 100_000_000_000_000n, 0n)], waitUntil: 'FINAL' });
links.items_mint = link(mint.transaction.hash);

// The game's books for the same two players, everything already settled.
const db = new DatabaseSync(':memory:');
migrateDatabase(db);
for (const [id, pair] of [['seller', seller], ['buyer', buyer]] as const) {
  db.prepare('INSERT INTO accounts (id, role, created_at, chain_public_key) VALUES (?, ?, ?, ?)').run(id, 'Hush', Date.now(), pair.getPublicKey().toString());
  db.prepare('INSERT INTO risings (account_id, role, created_at) VALUES (?, ?, ?)').run(id, 'Hush', Date.now());
}
db.prepare("INSERT INTO ledger_entries (id, sender, receiver, amount, reason, timestamp) VALUES ('g', 'world', 'buyer', 500, 'genesis', 0)").run();
db.prepare('INSERT INTO player_items VALUES (?, ?, ?)').run('seller', 'shard_ignis', 3);
db.prepare("INSERT INTO item_ledger (id, from_id, to_id, item_id, quantity, reason, timestamp) VALUES ('m', 'world', 'seller', 'shard_ignis', 3, 'loot_claim', 0)").run();
const config: MarketConfig = {
  network: 'testnet', rpcUrl, explorerUrl: 'https://testnet.nearblocks.io', gameAccount: 'elements-dev.testnet', privateKey: 'ed25519:unused',
  contractId: coin, items, playerSecret: secret, settleEveryMs: 60_000, batchSize: 80,
  verifier: 'market.elements-dev.testnet', broker: 'market-broker.elements-dev.testnet', treasury: 'treasury.elements-dev.testnet',
};
const board = new MarketService(db, config, new NearMarketChain(config));
const item = board.itemToken('shard_ignis');
for (const [batches, ledger] of [['chain_batches', 'ledger_entries'], ['items_chain_batches', 'item_ledger']] as const) {
  const last = (db.prepare(`SELECT MAX(rowid) AS r FROM ${ledger}`).get() as { r: number }).r;
  db.prepare(`INSERT INTO ${batches} (batch, first_rowid, last_rowid, moves, status, created_at) VALUES (1, 1, ?, 1, 'settled', 0)`).run(last);
}


async function deposit(who: string, pair: KeyPair, token: string, amount: number) {
  const quote = await board.depositQuote(who, token, amount);
  const signed = await KeyPairSigner.fromSecretKey(pair.toString() as KeyPairString).signDelegateAction(delegateFor(quote.action));
  const op = await board.deposit(who, quote.id, `ed25519:${baseEncode(signed.signedDelegate.signature.data)}`) as { status: string; tx: string };
  assert.equal(op.status, 'settled', JSON.stringify(op));
  links[`${who}_deposit`] = link((JSON.parse(op.tx) as { hash: string }).hash);
}
async function sign(who: string, pair: KeyPair, intents: MarketIntent[]) {
  const holder = board.identity(who).holder;
  const { current_salt } = await board.chain.state();
  return signWorldIntent(holder, pair.toString() as KeyPairString, marketPayload(holder, config.verifier, current_salt, intents));
}

await deposit('seller', seller, item, 1);
await deposit('buyer', buyer, board.coinToken, 105);

const sell = { side: 'sell' as const, item: 'shard_ignis', quantity: 1, price: 100 };
const sellId = board.postOffer('seller', sell, await sign('seller', seller, board.offerTerms('seller', sell).intents));
const buy = { ...sell, side: 'buy' as const, target: sellId };
board.postOffer('buyer', buy, await sign('buyer', buyer, board.offerTerms('buyer', buy).intents));
await board.tick();
const filled = db.prepare("SELECT status, tx_hash FROM market_offers WHERE id = ?").get(sellId) as { status: string; tx_hash: string };
assert.equal(filled.status, 'filled');
links.broker_match = link(filled.tx_hash);

const back = await board.returnGoods('buyer', item, 1, await sign('buyer', buyer, [{ intent: 'mt_withdraw', token: items, receiver_id: buyerId, token_ids: ['shard_ignis'], amounts: ['1'] }])) as { status: string; tx: string };
assert.equal(back.status, 'settled', JSON.stringify(back));
links.buyer_take_back = link((JSON.parse(back.tx) as { hash: string }).hash);

const view = (contractId: string, method: string, args: object) => provider.callFunction({ contractId, method, args });
const result = {
  result: 'PASS', coin, items, seller: sellerId, buyer: buyerId,
  board: {
    seller_coin: await view(config.verifier, 'mt_balance_of', { account_id: sellerId, token_id: board.coinToken }),
    treasury_coin: await view(config.verifier, 'mt_balance_of', { account_id: config.treasury, token_id: board.coinToken }),
    buyer_item: await view(config.verifier, 'mt_balance_of', { account_id: buyerId, token_id: item }),
  },
  buyer_item_in_game_contract: await view(items, 'mt_balance_of', { account_id: buyerId, token_id: 'shard_ignis' }),
  links,
};
assert.equal(result.board.seller_coin, '100');
assert.equal(result.board.treasury_coin, '5');
assert.equal(result.board.buyer_item, '0');
assert.equal(result.buyer_item_in_game_contract, '1');
console.log(JSON.stringify(result, null, 2));
// The throwaway contracts return their NEAR to the smoke account.
for (const id of [coin, items]) {
  try { await new Account(id, provider, KeyPairSigner.fromSecretKey(credential.private_key)).deleteAccount(owner); }
  catch (error) { console.warn(`could not reclaim ${id}: ${String(error).slice(0, 120)}`); }
}
