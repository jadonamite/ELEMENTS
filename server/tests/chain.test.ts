import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TOTAL_CHROMA_SUPPLY } from '@elements/shared';
import { migrateDatabase } from '../src/db.js';
import { grantPlayerStartingPurse, recordTransaction } from '../src/economy/ledgerService.js';
import { addItems, removeItems } from '../src/economy/satchelService.js';
import { KeyPair, baseDecode, baseEncode } from 'near-api-js';
import { createOrGetAccount } from '../src/db.js';
import { type LiveGrant } from '../src/chain/grants.js';
import type { SignedSessionGrant } from '@elements/shared';
import { genesisArgs, playerImplicitAccount, worldAccount } from '../src/chain/accounts.js';
import { chainAccountFor } from '../src/chain/accounts.js';
import { legacyGrant } from '../src/chain/legacy.js';
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

function grantMethods() {
  const grants = new Map<string, LiveGrant>();
  return {
    grants,
    async sessionGrant(holder: string) { return grants.get(holder) ?? null; },
    async submitGrant(signed: SignedSessionGrant) {
      const terms = JSON.parse(signed.payload.message) as { holder_id: string; caps: Record<string,string>; expires_at: string };
      grants.set(terms.holder_id, { ...terms, nonce: signed.payload.nonce });
    },
    async registerWorld() {},
  };
}
function playerGrant(holder: string): LiveGrant {
  return { caps: { CHROMA: '1000000', potion: '1000' }, expires_at: (BigInt(Date.now()+3_600_000)*1_000_000n).toString(), nonce: Array(32).fill(0) };
}

// A stand-in contract with the real one's rules: ordered batches, no overdraw.
class FakeChain implements ChainClient {
  grantsApi = grantMethods();
  sessionGrant = this.grantsApi.sessionGrant;
  submitGrant = this.grantsApi.submitGrant;
  registerWorld = this.grantsApi.registerWorld;
  last = 0;
  balances = new Map<string, bigint>();
  failNextAfterApplying = false;
  failNextBeforeApplying = false;
  sent: number[] = [];

  constructor() {
    for (const id of ['alice', 'bob']) this.grantsApi.grants.set(playerImplicitAccount(config.playerSecret,id), playerGrant(playerImplicitAccount(config.playerSecret,id)));
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
      const grant = await this.sessionGrant(m.from);
      assert.ok(grant && BigInt(grant.expires_at) > BigInt(Date.now())*1_000_000n, 'No live grant');
      assert.ok(BigInt(grant.caps.CHROMA ?? '0') >= BigInt(m.amount), 'Grant cap exceeded');
      grant.caps.CHROMA = (BigInt(grant.caps.CHROMA!) - BigInt(m.amount)).toString();
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
  for (const id of ['alice', 'bob']) {
    createOrGetAccount(id,db);
    const bytes = Buffer.from(playerImplicitAccount(config.playerSecret,id),'hex');
    db.prepare('UPDATE accounts SET chain_public_key = ? WHERE id = ?').run(`ed25519:${baseEncode(bytes)}`,id);
  }
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
  const methods = grantMethods();
  methods.grants.set(playerImplicitAccount(config.playerSecret,'alice'),playerGrant(playerImplicitAccount(config.playerSecret,'alice')));
  const client: ChainClient = {
    ...methods,
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

test('the item settler halts on every contract refusal, including supply underflow', async () => {
  for (const refusal of [
    'Supply underflow',
    'Amount must be positive',
    'Operation has no source or destination',
    'Sender and receiver cannot be the same',
    'attempt to add with overflow',
    'Insufficient balance',
    'Batch out of order',
    'Only the game account settles',
  ]) {
    const db = freshDb();
    addItems({ accountId: 'alice', from: 'world', stacks: [{ itemId: 'potion', quantity: 1 }], reason: 'grant' }, db);
    const client: ChainClient = {
      ...grantMethods(),
      async lastBatch() { return 0; },
      async settle() { throw new Error(`Contract panicked: ${refusal}`); },
    };
    const settler = new Settler({ ...config, contractId: 'items.game.testnet' }, client, db, 'items');
    assert.equal(await settler.tick(), null, refusal);
    assert.ok((settler.haltReason ?? '').toLowerCase().includes(refusal.toLowerCase()), refusal);
    assert.equal(await settler.tick(), null, 'a halted settler does not retry');
  }
});


test('a missing player grant holds the batch and reports the holder without sending', async () => {
  const db=freshDb(); const chain=new FakeChain(); const settler=new Settler(config,chain,db);
  play(db); await settler.tick();
  chain.grantsApi.grants.delete(playerImplicitAccount(config.playerSecret,'alice'));
  assert.equal(await settler.tick(),null);
  assert.equal(chain.last,1);
  assert.equal(chain.sent.length,1);
  assert.match(settler.status().held ?? '',/No live grant/);
});

test('an expired grant holds until the next signed session renews it', async () => {
  const db=freshDb(); const chain=new FakeChain(); const settler=new Settler(config,chain,db);
  play(db); await settler.tick();
  const holder=playerImplicitAccount(config.playerSecret,'alice');
  chain.grantsApi.grants.set(holder,{ ...playerGrant(holder),expires_at:'1' });
  assert.equal(await settler.tick(),null);
  chain.grantsApi.grants.set(holder,playerGrant(holder));
  await drain(settler);
  assert.equal(chain.last,3);
  assert.equal(settler.status().held,null);
});

test('caps are summed across every debit in the same batch', async () => {
  const db=freshDb(); const chain=new FakeChain(); const settler=new Settler({...config,batchSize:80},chain,db);
  play(db); await drain(settler);
  const holder=playerImplicitAccount(config.playerSecret,'alice');
  chain.grantsApi.grants.set(holder,{...playerGrant(holder),caps:{CHROMA:'15'}});
  recordTransaction({from:'alice',to:'merchant_ignis',amount:10,reason:'sentry_fine'},db);
  recordTransaction({from:'alice',to:'merchant_ignis',amount:10,reason:'sentry_fine'},db);
  assert.equal(await settler.tick(),null);
  assert.match(settler.status().held ?? '',/No live grant/);
});

test('a player without a browser key cannot receive into a server-derived account', async () => {
  const db=freshDb(); const chain=new FakeChain(); const settler=new Settler(config,chain,db);
  db.prepare('UPDATE accounts SET chain_public_key = NULL WHERE id = ?').run('alice');
  play(db); assert.equal(await settler.tick(),null);
  assert.equal(chain.sent.length,0);
  assert.match(settler.status().held ?? '',/has no holder key/);
});


function legacyFixture() {
  const db=freshDb();grantPlayerStartingPurse('alice',db);
  const old=playerImplicitAccount(config.playerSecret,'alice');
  const wallet=KeyPair.fromRandom('ed25519');const destination=Buffer.from(baseDecode(wallet.getPublicKey().toString().split(':')[1]!)).toString('hex');
  db.prepare('UPDATE accounts SET chain_public_key=? WHERE id=?').run(wallet.getPublicKey().toString(),'alice');
  const legacyClaims={network:'testnet' as const,height:1,contracts:{chroma:config.contractId,items:'items.game.testnet'},holders:{[old]:{coin:'100',items:{}}}};
  const settings={...config,legacyClaims};const chain=new FakeChain();chain.balances.set(old,100n);chain.balances.set('treasury.game.testnet',chain.balances.get('treasury.game.testnet')!-100n);
  chain.grantsApi.grants.set(destination,playerGrant(destination));
  const settler=new Settler(settings,chain,db);
  const cutoff=(db.prepare('SELECT MAX(rowid) AS n FROM ledger_entries').get() as {n:number}).n;
  db.prepare("INSERT INTO chain_batches (batch,first_rowid,last_rowid,moves,status,created_at) VALUES (0,0,?,0,'settled',0)").run(cutoff);
  return {db,old,destination,settings,chain,settler};
}
test('legacy genesis holdings move once without changing the game ledger balance',async()=>{
  const f=legacyFixture();
  assert.equal(chainAccountFor('alice',f.settings,f.db),f.old);
  assert.equal(await f.settler.tick(),1);
  assert.equal(f.chain.balances.get(f.old),0n);assert.equal(f.chain.balances.get(f.destination),100n);
  assert.equal(chainAccountFor('alice',f.settings,f.db),f.destination);
  assert.equal(await f.settler.tick(),null);assert.deepEqual(f.chain.sent,[1]);
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE reason='player_starting_grant'").get() as {n:number}).n,1);
  f.chain.balances.set(f.old,1n);assert.equal(await f.settler.tick(),null);assert.equal(f.chain.balances.get(f.old),1n);
});
test('a confirmed legacy claim survives a lost transaction response without replay',async()=>{
  const f=legacyFixture();f.chain.failNextAfterApplying=true;
  assert.equal(await f.settler.tick(),null);assert.equal(await f.settler.tick(),1);assert.equal(await f.settler.tick(),null);
  assert.deepEqual(f.chain.sent,[1]);assert.equal(f.chain.balances.get(f.destination),100n);
});
test('a player signing in releases a held ordinary batch with its legacy claim first',async()=>{
  const f=legacyFixture();f.db.prepare('UPDATE accounts SET chain_public_key=NULL WHERE id=?').run('alice');
  recordTransaction({from:'alice',to:'merchant_ignis',amount:10,reason:'merchant_buy'},f.db);
  assert.equal(await f.settler.tick(),null);assert.match(f.settler.status().held??'',/no holder key/);
  f.db.prepare('UPDATE accounts SET chain_public_key=? WHERE id=?').run(`ed25519:${baseEncode(Buffer.from(f.destination,'hex'))}`,'alice');
  assert.equal(await f.settler.tick(),1);assert.equal(f.chain.balances.get(f.destination),90n);assert.equal(f.chain.balances.get(f.old),0n);
  assert.equal(await f.settler.tick(),null);
});
test('the legacy signer rejects players outside the fixed genesis list',()=>{
  const f=legacyFixture();assert.throws(()=>legacyGrant(config.playerSecret,'bob',config.contractId,f.settings.legacyClaims),/not on the genesis/);
});


test('binding a legacy key cannot change an ordinary batch already sent before a timeout',async()=>{
  const f=legacyFixture();f.db.prepare('UPDATE accounts SET chain_public_key=NULL WHERE id=?').run('alice');
  recordTransaction({from:'treasury',to:'pile_1',amount:20,reason:'loot_drop'},f.db);
  f.chain.failNextBeforeApplying=true;assert.equal(await f.settler.tick(),null);
  f.db.prepare('UPDATE accounts SET chain_public_key=? WHERE id=?').run(`ed25519:${baseEncode(Buffer.from(f.destination,'hex'))}`,'alice');
  await drain(f.settler);
  assert.deepEqual(f.chain.sent,[1,1,2]);assert.equal(f.chain.balances.get('pile_1.game.testnet'),20n);
  assert.equal(f.chain.balances.get(f.destination),100n);assert.equal(f.chain.balances.get(f.old),0n);
});

test('legacy item claims preserve every listed token and keep the item-ledger cursor',async()=>{
  const f=legacyFixture();
  addItems({accountId:'alice',from:'world',stacks:[{itemId:'potion',quantity:2},{itemId:'shard_ignis',quantity:1}],reason:'loot_claim'},f.db);
  const contractId=f.settings.legacyClaims.contracts.items;
  f.settings.legacyClaims.holders[f.old]!.items={potion:'2',shard_ignis:'1'};
  const grants=grantMethods();let last=0;
  const balances=new Map([[`${f.old}:potion`,2n],[`${f.old}:shard_ignis`,1n]]);
  const client:ChainClient={...grants,async lastBatch(){return last;},async settle(batch,raw){
    assert.equal(batch,last+1);
    for(const move of raw as Array<{from:string;to:string;token_id:string;amount:string}>) {
      const grant=await grants.sessionGrant(move.from);assert.ok(grant);const amount=BigInt(move.amount);
      assert.ok(BigInt(grant.caps[move.token_id]??'0')>=amount);
      const from=`${move.from}:${move.token_id}`;const to=`${move.to}:${move.token_id}`;
      assert.ok((balances.get(from)??0n)>=amount);balances.set(from,balances.get(from)!-amount);balances.set(to,(balances.get(to)??0n)+amount);
      grant.caps[move.token_id]=(BigInt(grant.caps[move.token_id]!)-amount).toString();
    }
    last=batch;return 'items-claim';
  }};
  const settler=new Settler({...f.settings,contractId},client,f.db,'items');
  const cutoff=(f.db.prepare('SELECT MAX(rowid) AS n FROM item_ledger').get() as {n:number}).n;
  f.db.prepare("INSERT INTO items_chain_batches (batch,first_rowid,last_rowid,moves,status,created_at) VALUES (0,0,?,0,'settled',0)").run(cutoff);
  assert.equal(await settler.tick(),1);assert.equal(await settler.tick(),null);
  assert.equal(balances.get(`${f.destination}:potion`),2n);assert.equal(balances.get(`${f.destination}:shard_ignis`),1n);
  assert.equal(balances.get(`${f.old}:potion`),0n);assert.equal(settler.status().waiting,0);
});
