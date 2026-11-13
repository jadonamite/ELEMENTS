import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TOTAL_CHROMA_SUPPLY } from '@elements/shared';
import { migrateDatabase } from '../src/db.js';
import { grantPlayerStartingPurse, recordTransaction } from '../src/economy/ledgerService.js';
import { addItems, removeItems } from '../src/economy/satchelService.js';
import { genesisArgs, playerImplicitAccount, worldAccount } from '../src/chain/accounts.js';
import { Settler, type ChainClient, type ChainMove } from '../src/chain/settler.js';
import type { ChainConfig } from '../src/chain/config.js';

const config: ChainConfig = {
  network: 'testnet',
  rpcUrl: 'http://unused',
  explorerUrl: 'https://testnet.nearblocks.io',
  gameAccount: 'game.testnet',
  privateKey: 'ed25519:unused',
  contractId: 'chroma.game.testnet',
  playerSecret: 'test-secret',
  settleEveryMs: 60_000,
  batchSize: 2,
};

// A stand-in contract with the real one's rules: ordered batches, no overdraw.
class FakeChain implements ChainClient {
  last = 0;
  balances = new Map<string, bigint>();
  failNextAfterApplying = false;
  failNextBeforeApplying = false;
  sent: number[] = [];

  constructor() {
    for (const [account, amount] of genesisArgs(config.gameAccount).genesis) {
      this.balances.set(account, BigInt(amount));
    }
  }
  async lastBatch() {
    return this.last;
  }
  async settle(batch: number, moves: ChainMove[]) {
    this.sent.push(batch);
    if (this.failNextBeforeApplying) {
      this.failNextBeforeApplying = false;
      throw new Error('network timeout');
    }
    if (batch !== this.last + 1) throw new Error('Batch out of order');
    for (const m of moves) {
      const from = this.balances.get(m.from) ?? 0n;
      if (from < BigInt(m.amount)) throw new Error('Insufficient balance');
      this.balances.set(m.from, from - BigInt(m.amount));
      this.balances.set(m.to, (this.balances.get(m.to) ?? 0n) + BigInt(m.amount));
    }
    this.last = batch;
    if (this.failNextAfterApplying) {
      this.failNextAfterApplying = false;
      throw new Error('network timeout');
    }
    return `hash${batch}`;
  }
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  return db;
}

function play(db: DatabaseSync) {
  grantPlayerStartingPurse('alice', db);
  grantPlayerStartingPurse('bob', db);
  recordTransaction({ from: 'alice', to: 'merchant_ignis', amount: 30, reason: 'merchant_buy' }, db);
  recordTransaction({ from: 'treasury', to: 'pile_1', amount: 20, reason: 'loot_drop' }, db);
  recordTransaction({ from: 'pile_1', to: 'bob', amount: 20, reason: 'loot_claim' }, db);
}

async function drain(settler: Settler) {
  for (let i = 0; i < 20; i++) {
    if ((await settler.tick()) === null) return;
  }
}

test('genesis on chain is the server genesis and sums to the supply', () => {
  const { owner_id, genesis } = genesisArgs('game.testnet');
  assert.equal(owner_id, 'game.testnet');
  assert.equal(genesis.reduce((s, [, a]) => s + Number(a), 0), TOTAL_CHROMA_SUPPLY);
  assert.ok(genesis.some(([a]) => a === 'treasury.game.testnet'));
});

test('player accounts are stable 64-hex implicit accounts; world names are valid', () => {
  const a = playerImplicitAccount('s', 'alice');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, playerImplicitAccount('s', 'alice'));
  assert.notEqual(a, playerImplicitAccount('s', 'bob'));
  assert.equal(worldAccount('merchant_ignis', 'game.testnet'), 'merchant_ignis.game.testnet');
  const long = worldAccount('pile_e211112b-127d-44bb-9045-862be9cf0a4c-extra-long-id', 'elements-dev.testnet');
  assert.ok(long.length <= 64);
  assert.match(long, /^[a-z0-9_-]+\.elements-dev\.testnet$/);
});

test('settlement brings chain balances to the ledger balances', async () => {
  const db = freshDb();
  const chain = new FakeChain();
  const settler = new Settler(config, chain, db);
  play(db);
  await drain(settler);
  assert.equal(chain.last, 3); // 5 moves in batches of 2
  const alice = playerImplicitAccount(config.playerSecret, 'alice');
  const bob = playerImplicitAccount(config.playerSecret, 'bob');
  assert.equal(chain.balances.get(alice), 70n);
  assert.equal(chain.balances.get(bob), 120n);
  assert.equal(chain.balances.get('merchant_ignis.game.testnet'), 300_030n);
  assert.equal(chain.balances.get('pile_1.game.testnet'), 0n);
  assert.equal(settler.status('alice').waiting, 0);
});

test('a batch applied but not confirmed is not applied twice', async () => {
  const db = freshDb();
  const chain = new FakeChain();
  const settler = new Settler(config, chain, db);
  play(db);
  chain.failNextAfterApplying = true;
  await settler.tick();
  await drain(settler);
  assert.equal(chain.last, 3);
  assert.equal(chain.balances.get(playerImplicitAccount(config.playerSecret, 'alice')), 70n);
});

test('a batch lost in transit is resent with the same number', async () => {
  const db = freshDb();
  const chain = new FakeChain();
  const settler = new Settler(config, chain, db);
  play(db);
  chain.failNextBeforeApplying = true;
  await settler.tick();
  await drain(settler);
  assert.deepEqual(chain.sent, [1, 1, 2, 3]);
  assert.equal(chain.balances.get(playerImplicitAccount(config.playerSecret, 'bob')), 120n);
});

test('settlement stops when the contract belongs to another ledger', async () => {
  const db = freshDb();
  const chain = new FakeChain();
  chain.last = 9;
  const settler = new Settler(config, chain, db);
  play(db);
  assert.equal(await settler.tick(), null);
  assert.match(settler.haltReason ?? '', /another ledger/);
});

test('the shared settler maps item world entries to mint and burn operations', async () => {
  const db = freshDb();
  grantPlayerStartingPurse('alice', db);
  addItems({ accountId: 'alice', from: 'world', stacks: [{ itemId: 'potion', quantity: 3 }], reason: 'grant' }, db);
  removeItems({ accountId: 'alice', to: 'world', stacks: [{ itemId: 'potion', quantity: 1 }], reason: 'item_use' }, db);
  const opsSent: unknown[][] = [];
  const balances = new Map<string, bigint>();
  const supplies = new Map<string, bigint>();
  let last = 0;
  const client: ChainClient = {
    async lastBatch() { return last; },
    async settle(batch, raw) {
      assert.equal(batch, last + 1);
      const ops = raw as Array<{from:string|null;to:string|null;token_id:string;amount:string}>;
      opsSent.push(raw);
      for (const op of ops) {
        const amount = BigInt(op.amount);
        const from = op.from ? `${op.from}:${op.token_id}` : null;
        const to = op.to ? `${op.to}:${op.token_id}` : null;
        if (from) { const old=balances.get(from)??0n; assert.ok(old>=amount); balances.set(from,old-amount); }
        else supplies.set(op.token_id,(supplies.get(op.token_id)??0n)+amount);
        if (to) balances.set(to,(balances.get(to)??0n)+amount);
        else supplies.set(op.token_id,(supplies.get(op.token_id)??0n)-amount);
      }
      last=batch;
      return `items-${batch}`;
    },
  };
  const settler = new Settler({ ...config, contractId:'items.game.testnet' }, client, db, 'items');
  await drain(settler);
  assert.equal(last, 1);
  assert.equal(balances.get(`${playerImplicitAccount(config.playerSecret,'alice')}:potion`),2n);
  assert.equal(supplies.get('potion'),2n);
  const sent = opsSent[0] as Array<{from:string|null;to:string|null}>;
  assert.equal(sent[0]!.from, null);
  assert.equal(sent[1]!.to, null);
});
