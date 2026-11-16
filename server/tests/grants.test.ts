import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { KeyPair, baseDecode } from 'near-api-js';
import { sessionGrantBytes, type SignedSessionGrant } from '@elements/shared';
import { prepareGuestClaim } from '../src/chain/guest-claim.js';
import { addItems, getSatchel } from '../src/economy/satchelService.js';
import { getAccountBalance, recordTransaction } from '../src/economy/ledgerService.js';
import { migrateDatabase, createOrGetAccount } from '../src/db.js';
import { bindPlayerGrant, signWorldGrant } from '../src/chain/grants.js';
import { chainAccountFor, worldKeyPair } from '../src/chain/accounts.js';
const contract = 'chroma-v2.game.testnet';
function signed(pair = KeyPair.fromRandom('ed25519')): SignedSessionGrant {
  const holder = Buffer.from(baseDecode(pair.getPublicKey().toString().split(':')[1]!)).toString('hex');
  const payload = {message:JSON.stringify({holder_id:holder,expires_at:(BigInt(Date.now()+60_000)*1_000_000n).toString(),caps:{CHROMA:'100'},rules:'elements-session-v1'}),recipient:contract,nonce:Array(32).fill(1),callback_url:null};
  const hash=createHash('sha256').update(sessionGrantBytes(payload)).digest();
  return { payload,public_key:pair.getPublicKey().toString(),signature:Buffer.from(pair.sign(hash).signature).toString('base64') };
}
function db() { const db=new DatabaseSync(':memory:');migrateDatabase(db);createOrGetAccount('alice',db);return db; }

function proof(database: DatabaseSync, pair: ReturnType<typeof KeyPair.fromRandom>, destination = 'alice'): SignedSessionGrant {
  const value=signed(pair);
  value.payload.recipient=chainAccountFor(destination,{gameAccount:'game.testnet',playerSecret:''},database);
  value.signature=Buffer.from(pair.sign(createHash('sha256').update(sessionGrantBytes(value.payload)).digest()).signature).toString('base64');
  return value;
}

test('player key binding requires the implicit holder signature and stays fixed', () => {
  const database=db(); const grant=signed();
  const terms=bindPlayerGrant(database,'alice',grant,[contract]);
  assert.equal(chainAccountFor('alice',{gameAccount:'game.testnet',playerSecret:'unused'},database),terms.holder_id);
  assert.throws(()=>bindPlayerGrant(database,'alice',signed(),[contract]),/signed migration/);
});
test('a tampered grant cannot bind a key', () => {
  // Raise the coin cap itself; a plain text replace could land in the random holder key instead.
  const database=db();const grant=signed();const terms=JSON.parse(grant.payload.message);terms.caps.CHROMA='1000';grant.payload.message=JSON.stringify(terms);
  assert.throws(()=>bindPlayerGrant(database,'alice',grant,[contract]),/Invalid grant signature/);
  assert.throws(()=>chainAccountFor('alice',{gameAccount:'game.testnet',playerSecret:'unused'},database),/no holder key/);
});
test('wrong contract, holder, and expired session are refused before key binding', () => {
  const database=db();
  assert.throws(()=>bindPlayerGrant(database,'alice',signed(),['other.testnet']),/Wrong recipient/);
  const wrong=signed();wrong.payload.message=wrong.payload.message.replace(/"holder_id":"[a-f0-9]+"/,'"holder_id":"victim.testnet"');
  assert.throws(()=>bindPlayerGrant(database,'alice',wrong,[contract]),/Wrong holder key/);
  const expired=signed();const terms=JSON.parse(expired.payload.message);terms.expires_at='1';expired.payload.message=JSON.stringify(terms);
  assert.throws(()=>bindPlayerGrant(database,'alice',expired,[contract]),/Grant expired/);
});
test('world grants sign the NEP-413 hash with the named holder key', () => {
  const grant=signWorldGrant('secret','treasury','treasury.game.testnet',contract,{CHROMA:'1000'});
  const pair=KeyPair.fromString(worldKeyPair('secret','treasury').secretKey);
  assert.ok(pair.verify(createHash('sha256').update(sessionGrantBytes(grant.payload)).digest(),Buffer.from(grant.signature,'base64')));
});
test('nonce bytes and callback encodings cannot be ambiguous', () => {
  const grant=signed();
  assert.throws(()=>sessionGrantBytes({...grant.payload,nonce:[-1,...Array(31).fill(0)]}),/Invalid nonce/);
  assert.throws(()=>sessionGrantBytes({...grant.payload,nonce:Array(31).fill(0)}),/Invalid nonce/);
  assert.throws(()=>sessionGrantBytes({...grant.payload,callback_url:'x'} as unknown as typeof grant.payload),/Callbacks/);
});


test('guest claims move coin and items once through normal ledger rows', () => {
  const database=db();
  bindPlayerGrant(database,'alice',signed(),[contract]);
  const pair=KeyPair.fromRandom('ed25519');
  const grant=signed(pair); const holder=JSON.parse(grant.payload.message).holder_id as string;const guest=`guest:${holder}`;
  createOrGetAccount(guest,database);
  recordTransaction({from:'treasury',to:guest,amount:20,reason:'loot_claim'},database);
  addItems({accountId:guest,from:'world',stacks:[{itemId:'potion',quantity:2}],reason:'loot_claim'},database);
  const itemGrant=signed(pair);itemGrant.payload.recipient='items.game.testnet';
  const terms=JSON.parse(itemGrant.payload.message);terms.caps={potion:'2'};itemGrant.payload.message=JSON.stringify(terms);
  itemGrant.signature=Buffer.from(pair.sign(createHash('sha256').update(sessionGrantBytes(itemGrant.payload)).digest()).signature).toString('base64');
  assert.equal(prepareGuestClaim(database,'alice',[grant,itemGrant],{coin:contract,items:'items.game.testnet'},proof(database,pair)).moved,true);
  assert.equal(getAccountBalance(guest,database),0);
  assert.equal(getAccountBalance('alice',database),20);
  assert.deepEqual(getSatchel('alice',database),{potion:2});
  assert.deepEqual(getSatchel(guest,database),{});
  assert.equal(prepareGuestClaim(database,'alice',[grant,itemGrant],{coin:contract,items:'items.game.testnet'},proof(database,pair)).moved,false);
  const rows=database.prepare("SELECT COUNT(*) AS n FROM item_ledger WHERE reason='guest_claim'").get() as {n:number};
  assert.equal(rows.n,1);
});
test('an undersized guest cap rolls back all migration writes', () => {
  const database=db();bindPlayerGrant(database,'alice',signed(),[contract]);const pair=KeyPair.fromRandom('ed25519');const grant=signed(pair);
  const guest=`guest:${JSON.parse(grant.payload.message).holder_id}`;createOrGetAccount(guest,database);
  recordTransaction({from:'treasury',to:guest,amount:101,reason:'loot_claim'},database);
  assert.throws(()=>prepareGuestClaim(database,'alice',[grant],{coin:contract},proof(database,pair)),/cap too small/);
  assert.equal(getAccountBalance(guest,database),101);assert.equal(getAccountBalance('alice',database),0);
  const row=database.prepare('SELECT chain_public_key FROM accounts WHERE id=?').get(guest) as {chain_public_key:string|null};
  assert.equal(row.chain_public_key,null);
});


test('a public guest grant cannot be claimed to a different destination', () => {
  const database=db();bindPlayerGrant(database,'alice',signed(),[contract]);
  createOrGetAccount('bob',database);bindPlayerGrant(database,'bob',signed(),[contract]);
  const pair=KeyPair.fromRandom('ed25519');const grant=signed(pair);const guest=`guest:${JSON.parse(grant.payload.message).holder_id}`;
  createOrGetAccount(guest,database);recordTransaction({from:'treasury',to:guest,amount:20,reason:'loot_claim'},database);
  assert.throws(()=>prepareGuestClaim(database,'bob',[grant],{coin:contract},proof(database,pair)),/Wrong recipient/);
  assert.equal(getAccountBalance(guest,database),20);assert.equal(getAccountBalance('bob',database),0);
});
