import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { KeyPair, baseEncode, KeyPairSigner } from 'near-api-js';
import { MARKET_RULES, marketPayload, type SignedMarketIntent } from '@elements/shared';
import { migrateDatabase } from '../src/db.js';
import { MarketService } from '../src/economy/marketService.js';
import { getAccountBalance } from '../src/economy/ledgerService.js';
import { getItemCount } from '../src/economy/satchelService.js';
import { Settler, type ChainClient } from '../src/chain/settler.js';
import { delegateFor, signWorldIntent, type MarketChain, type PreparedMarketTx, type DepositAction } from '../src/chain/marketClient.js';
import type { MarketConfig } from '../src/chain/marketConfig.js';

const config: MarketConfig={network:'testnet',rpcUrl:'http://unused',explorerUrl:'http://unused',gameAccount:'game.testnet',privateKey:'ed25519:unused',playerSecret:'test',contractId:'coin.game.testnet',items:'items.game.testnet',verifier:'board.game.testnet',broker:'market-broker.game.testnet',treasury:'treasury.game.testnet',settleEveryMs:60_000,batchSize:80};
class FakeVerifier implements MarketChain {
  balances=new Map<string,number>(); used=10; transactions=0; simulateCount=0; refuse=false; timeout=false; failed=false; receiptFailures=false;
  async state(){return {current_salt:'7c983c52',fee:MARKET_RULES.feePips};}
  async prepareDeposit(holder:string,publicKey:string,token:string,amount:number):Promise<DepositAction>{return {sender:holder,publicKey,contract:token.split(':')[1]!,method:token.startsWith('nep141:')?'ft_transfer_call':'mt_transfer_call',args:{receiver_id:config.verifier,amount:String(amount),msg:''},nonce:'1',maxBlockHeight:'100'};}
  async depositTransaction(){return {hash:'deposit-hash',signer:'courier',bytes:'deposit'};}
  async executeTransaction(signed:SignedMarketIntent[]){return {hash:'swap-hash',signer:'broker',bytes:JSON.stringify(signed)};}
  async simulate(signed:SignedMarketIntent[]){
    this.simulateCount++;
    if(this.refuse)throw new Error('unmatched_deltas');
    const net=new Map<string,bigint>();
    for(const s of signed)for(const intent of JSON.parse(s.payload.message).intents){
      if(intent.intent!=='token_diff')continue;
      for(const [token,raw]of Object.entries(intent.diff)){
        net.set(token,(net.get(token)??0n)+BigInt(raw as string));
      }
    }
    if([...net.values()].some(n=>n!==0n))throw new Error('unmatched_deltas');
  }
  async submit(tx:PreparedMarketTx){
    this.transactions++;
    if(this.timeout){this.timeout=false;throw new Error('network timeout');}
    return {failed:this.failed,receiptFailures:this.receiptFailures,...(tx.bytes==='deposit'?{used:this.used}:{})};
  }
}
async function fixture(lit=false,quantity=10){
 const db=new DatabaseSync(':memory:');migrateDatabase(db);
 const chain=new FakeVerifier();const board=new MarketService(db,config,chain);
 const keys=[KeyPair.fromRandom('ed25519'),KeyPair.fromRandom('ed25519')];
 for(const [index,id]of ['alice','bob'].entries()){
  db.prepare('INSERT INTO accounts (id,role,created_at,chain_public_key) VALUES (?,?,?,?)').run(id,lit?'Shaper':'Hush',Date.now(),keys[index]!.getPublicKey().toString());
  db.prepare('INSERT INTO risings (account_id,role,created_at) VALUES (?,?,?)').run(id,lit?'Shaper':'Hush',Date.now());
 }
 db.prepare("INSERT INTO ledger_entries (id,sender,receiver,amount,reason,timestamp) VALUES ('seed','world',?,1000,'genesis',0)").run(config.verifier);
 db.prepare('INSERT INTO player_items VALUES (?,?,?)').run(config.verifier,'shard_ignis',20);
 db.prepare('INSERT INTO market_balances VALUES (?,?,?)').run('alice',board.itemToken('shard_ignis'),20);
 db.prepare('INSERT INTO market_balances VALUES (?,?,?)').run('bob',board.coinToken,1000);
 const request={side:'sell' as const,item:'shard_ignis',quantity,price:100};
 const terms=board.offerTerms('alice',request);
 const a=await signWorldIntent(board.identity('alice').holder,keys[0]!.toString(),marketPayload(board.identity('alice').holder,config.verifier,'7c983c52',terms.intents));
 const sell=board.postOffer('alice',request,a);
 const buyRequest={...request,side:'buy' as const,target:sell};
 const b=await signWorldIntent(board.identity('bob').holder,keys[1]!.toString(),marketPayload(board.identity('bob').holder,config.verifier,'7c983c52',board.offerTerms('bob',buyRequest).intents));
 const buy=board.postOffer('bob',buyRequest,b);
 return {db,board,chain,keys,sell,buy};
}
test('matching signed offers settle atomically; items move whole and the buyer pays the Dim tax',async()=>{
 const {board,chain,db}=await fixture();await board.tick();
 assert.equal(chain.simulateCount,2);assert.equal(chain.transactions,1);
 assert.equal(board.balance('alice',board.coinToken),100);
 assert.equal(board.balance('bob',board.itemToken('shard_ignis')),10);
 assert.equal(board.balance('bob',board.coinToken),895);
 assert.equal(board.balance(config.treasury,board.coinToken),5);
 assert.equal(board.balance(config.treasury,board.itemToken('shard_ignis')),0);
 assert.equal(getAccountBalance(config.verifier,db),1000);
 assert.equal((db.prepare("SELECT COUNT(*) AS n FROM market_offers WHERE status='filled'").get()as{n:number}).n,2);
 assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE chain_route='market' AND chain_tx='swap-hash'").get()as{n:number}).n,2);
 await board.tick();assert.equal(chain.transactions,1);db.close();
});
test('mismatch refused at simulation changes no balances or trade ledger',async()=>{
 const {board,chain,db}=await fixture();chain.refuse=true;
 await assert.rejects(board.tick(),/unmatched_deltas/);
 assert.equal(chain.transactions,0);assert.equal(board.balance('bob',board.coinToken),1000);
 assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE chain_route='market'").get()as{n:number}).n,0);db.close();
});
test('Lit-to-Lit extra tax is in buyer signature and reaches treasury',async()=>{
 const {board,db,buy}=await fixture(true);
 const row=db.prepare('SELECT signed FROM market_offers WHERE id=?').get(buy)as{signed:string};
 assert.equal(JSON.parse(JSON.parse(row.signed).payload.message).intents[1].tokens[board.coinToken],'20');
 await board.tick();assert.equal(board.balance(config.treasury,board.coinToken),20);assert.equal(board.balance('bob',board.coinToken),880);db.close();
});
test('refunded meta deposit reverses game and board rows',async()=>{
 const {board,chain,db,keys}=await fixture();chain.used=0;
 db.prepare("INSERT INTO ledger_entries (id,sender,receiver,amount,reason,timestamp) VALUES ('alice-seed','world','alice',100,'genesis',0)").run();
 const q=await board.depositQuote('alice',board.coinToken,10);
 const signature=(await KeyPairSigner.fromSecretKey(keys[0]!.toString()).signDelegateAction(delegateFor(q.action))).signedDelegate.signature;
 await board.deposit('alice',q.id,`ed25519:${baseEncode(signature.data)}`);
 assert.equal(getAccountBalance('alice',db),100);assert.equal(board.balance('alice',board.coinToken),0);
 assert.equal(getAccountBalance(config.verifier,db),1000);
 const rows=db.prepare("SELECT * FROM ledger_entries WHERE ref_id=?").all(q.id);
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.chain_route==='market'&&r.chain_tx==='deposit-hash'));db.close();
});
test('retry keeps signed transaction and writes swap once after timeout',async()=>{
 const {board,chain,db}=await fixture();chain.timeout=true;await assert.rejects(board.tick(),/timeout/);
 assert.equal(board.balance('bob',board.coinToken),1000);
 await board.tick();await board.tick();assert.equal(board.balance('bob',board.coinToken),895);assert.equal(chain.transactions,2);db.close();
});
test('settlers skip board rows inside ranges and when they trail the checkpoint',async()=>{
 const {db,board}=await fixture();await board.tick();
 const sent:unknown[][]=[];
 const client:ChainClient={async lastBatch(){return sent.length;},async settle(_batch,moves){sent.push(moves);return 'normal';},async sessionGrant(){return {caps:{CHROMA:'100000',shard_ignis:'100000'},expires_at:'9999999999999999999',nonce:[]};},async submitGrant(){},async registerWorld(){}};
 for(const kind of ['coin','items']as const){
   const settler=new Settler({...config,contractId:kind==='coin'?config.contractId:config.items},client,db,kind);
   assert.equal(await settler.tick(),null);assert.equal(settler.status().waiting,0);
 }
 assert.equal(sent.length,0);db.close();
});
test('return cannot name another destination and open offers reserve goods',async()=>{
 const {board,keys,db}=await fixture();
 const holder=board.identity('alice').holder;
 const wrong=await signWorldIntent(holder,keys[0]!.toString(),marketPayload(holder,config.verifier,'7c983c52',[{intent:'mt_withdraw',token:config.items,receiver_id:'elsewhere.testnet',token_ids:['shard_ignis'],amounts:['10']}]));
 await assert.rejects(board.returnGoods('alice',board.itemToken('shard_ignis'),10,wrong),/Signed terms/);
 assert.equal(board.available('alice',board.itemToken('shard_ignis')),10);db.close();
});

test('a single item sells whole',async()=>{
 const {board,db}=await fixture(false,1);await board.tick();
 assert.equal(board.balance('bob',board.itemToken('shard_ignis')),1);
 assert.equal(board.balance('alice',board.itemToken('shard_ignis')),19);db.close();
});
test('a deposit waits until the holder\'s earlier moves have settled',async()=>{
 const {board,chain,db,keys}=await fixture();chain.used=10;
 db.prepare("INSERT INTO ledger_entries (id,sender,receiver,amount,reason,timestamp) VALUES ('alice-seed','world','alice',100,'genesis',0)").run();
 db.prepare("INSERT INTO ledger_entries (id,sender,receiver,amount,reason,timestamp) VALUES ('alice-loot','treasury','alice',5,'loot_claim',1)").run();
 const q=await board.depositQuote('alice',board.coinToken,10);
 const signature=(await KeyPairSigner.fromSecretKey(keys[0]!.toString()).signDelegateAction(delegateFor(q.action))).signedDelegate.signature;
 await assert.rejects(board.deposit('alice',q.id,`ed25519:${baseEncode(signature.data)}`),/settle on NEAR/);
 assert.equal(chain.transactions,0);
 const last=(db.prepare('SELECT MAX(rowid) AS r FROM ledger_entries').get() as {r:number}).r;
 db.prepare("INSERT INTO chain_batches (batch,first_rowid,last_rowid,moves,status,created_at) VALUES (1,1,?,1,'settled',0)").run(last);
 await board.tick();
 assert.equal(chain.transactions,1);assert.equal(board.balance('alice',board.coinToken),10);db.close();
});
