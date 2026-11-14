// Checks canonical balances, live world grants, locked keys, and the unchanged live-server targets.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JsonRpcProvider} from 'near-api-js';
import {worldAccount,worldHolders} from '../src/chain/accounts.js';
const provider=new JsonRpcProvider({url:'https://rpc.testnet.fastnear.com'});
const snapshot=JSON.parse(await readFile('workbench/signed/snapshot.json','utf8')) as {coins:[string,string][];items:Array<{holder:string;token_id:string;amount:string}>;supply:string;supplies:Record<string,string>};
const targets={chroma:'chroma-v2.elements-dev.testnet',items:'items-v4.elements-dev.testnet'};
const view=(contractId:string,method:string,args:object)=>provider.callFunction({contractId,method,args});
const start=[await view(targets.chroma,'last_batch',{}),await view(targets.items,'last_batch',{})];
for(const [account_id,amount] of snapshot.coins) assert.equal(await view(targets.chroma,'ft_balance_of',{account_id}),amount);
assert.equal(await view(targets.chroma,'ft_total_supply',{}),snapshot.supply);
console.log(JSON.stringify({result:'PASS',coinHolders:snapshot.coins.length,supply:snapshot.supply}));
for(const item of snapshot.items) assert.equal(await view(targets.items,'mt_balance_of',{account_id:item.holder,token_id:item.token_id}),item.amount);
for(const [token_id,supply] of Object.entries(snapshot.supplies)) assert.equal(await view(targets.items,'mt_supply',{token_id}),supply);
console.log(JSON.stringify({result:'PASS',itemHoldings:snapshot.items.length,itemTypes:Object.keys(snapshot.supplies).length}));
for(const id of worldHolders()) {
 const holder_id=worldAccount(id,'elements-dev.testnet');
 for(const contractId of Object.values(targets)) {
  const grant=await view(contractId,'session_grant',{holder_id}) as {expires_at:string;caps:Record<string,string>}|null;
  assert.ok(grant&&BigInt(grant.expires_at)>BigInt(Date.now()+3600_000)*1_000_000n,`Missing/expired world grant ${contractId} ${holder_id}`);
  for(const token of contractId===targets.chroma?['CHROMA']:Object.keys(snapshot.supplies)) assert.ok(BigInt(grant.caps[token]??'0')>=9_999_999n,`World cap missing ${holder_id} ${token}`);
 }
}
console.log(JSON.stringify({result:'PASS',worldHolders:worldHolders().length,liveGrants:2*worldHolders().length}));
for(const contractId of Object.values(targets)) {const keys=await provider.viewAccessKeyList({accountId:contractId});assert.deepEqual(keys.keys,[]);console.log(JSON.stringify({contractId,view_access_key_list:keys}));}
assert.deepEqual([await view(targets.chroma,'last_batch',{}),await view(targets.items,'last_batch',{})],start);
const live=await(await fetch('https://elements-server-production.up.railway.app/api/chain')).json() as {contracts:{chroma:{contract:string};items:{contract:string}}};
assert.equal(live.contracts.chroma.contract,'chroma.elements-dev.testnet');assert.equal(live.contracts.items.contract,'items-v3.elements-dev.testnet');
console.log(JSON.stringify({result:'PASS',canonicalBatches:start,liveServerContracts:[live.contracts.chroma.contract,live.contracts.items.contract]}));
