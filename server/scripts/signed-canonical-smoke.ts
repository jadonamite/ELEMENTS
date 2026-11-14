// Exercises grant-covered and refused debits, then restores the canonical genesis balances.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {Account,JsonRpcProvider,KeyPairSigner,KeyPair,baseDecode,actions,type KeyPairString} from 'near-api-js';
import {sessionGrantBytes} from '@elements/shared';
const provider=new JsonRpcProvider({url:'https://rpc.testnet.fastnear.com'});
const directory=`${homedir()}/.near-credentials/testnet`;
const live=await (await fetch('https://elements-server-production.up.railway.app/api/chain')).json() as {contracts:{chroma:{contract:string};items:{contract:string}}};
assert.equal(live.contracts.chroma.contract,'chroma.elements-dev.testnet');assert.equal(live.contracts.items.contract,'items-v3.elements-dev.testnet');
for(const kind of ['chroma','items']) {
 const contractId=kind==='chroma'?'chroma-v2.elements-dev.testnet':'items-v4.elements-dev.testnet';
 const saved=JSON.parse(await readFile(`${directory}/courier-${contractId}.json`,'utf8')) as {private_key:KeyPairString};
 const courier=new Account('elements-dev.testnet',provider,KeyPairSigner.fromSecretKey(saved.private_key));
 const world=kind==='chroma'?'treasury.elements-dev.testnet':'sindr_supplies.elements-dev.testnet';
 const fixture=KeyPair.fromRandom('ed25519');const holder=Buffer.from(baseDecode(fixture.getPublicKey().toString().split(':')[1]!)).toString('hex');
 await writeFile(`${directory}/${holder}.json`,JSON.stringify({account_id:holder,private_key:fixture.toString(),public_key:fixture.getPublicKey().toString()}),{mode:0o600,flag:'wx'});
 const balance=async(account_id:string)=>String(await provider.callFunction({contractId,method:kind==='chroma'?'ft_balance_of':'mt_balance_of',args:{account_id,...(kind==='items'?{token_id:'potion'}:{})}}));
 const before=await balance(world);assert.ok(BigInt(before)>0n);
 let batch=Number(await provider.callFunction({contractId,method:'last_batch',args:{}}));
 const call=async(method:string,args:object,fail=false)=>{
  const result=await courier.signAndSendTransaction({receiverId:contractId,actions:[actions.functionCall(method,args,100_000_000_000_000n,0n)],waitUntil:'FINAL',throwOnFailure:false});
  assert.equal(typeof result.status==='object'&&'Failure' in result.status,fail,JSON.stringify(result.status));
  return result;
 };
 const settle=(number:number,from:string,to:string,fail=false)=>call('settle',{batch:number,[kind==='chroma'?'moves':'ops']:[{from,to,amount:'1',memo:'canonical smoke',...(kind==='items'?{token_id:'potion'}:{})}]},fail);
 const covered=await settle(++batch,world,holder);
 const refused=await settle(batch+1,holder,world,true);assert.match(JSON.stringify(refused.status),/No live grant/);
 assert.equal(await provider.callFunction({contractId,method:'last_batch',args:{}}),batch);assert.equal(await balance(holder),'1');
 const payload={message:JSON.stringify({holder_id:holder,expires_at:(BigInt(Date.now()+3600_000)*1_000_000n).toString(),caps:{[kind==='chroma'?'CHROMA':'potion']:'1'},rules:'elements-session-v1'}),nonce:[...randomBytes(32)],recipient:contractId,callback_url:null};
 await call('grant',{payload,public_key:fixture.getPublicKey().toString(),signature:Buffer.from(fixture.sign(createHash('sha256').update(sessionGrantBytes(payload)).digest()).signature).toString('base64')});
 const restored=await settle(++batch,holder,world);
 assert.equal(await balance(world),before);assert.equal(await balance(holder),'0');
 const keys=await provider.viewAccessKeyList({accountId:contractId});assert.deepEqual(keys.keys,[]);
 console.log(JSON.stringify({result:'PASS',contractId,covered:`https://testnet.nearblocks.io/txns/${covered.transaction.hash}`,uncovered:`https://testnet.nearblocks.io/txns/${refused.transaction.hash}`,restored:`https://testnet.nearblocks.io/txns/${restored.transaction.hash}`,lastBatch:batch,worldBalanceRestored:before,keys:keys.keys}));
}
