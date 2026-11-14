// Reads both live contracts at one block and writes a checked deployment snapshot.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const rpc = 'https://rpc.testnet.fastnear.com';
async function request(method: string, params: object) {
  const response = await fetch(rpc, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'snapshot',method,params}) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const data = await response.json() as { result?: any; error?: unknown };
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}
const block = await request('block',{finality:'final'});
const height = block.header.height as number;
const contracts = { chroma:'chroma.elements-dev.testnet',items:'items-v3.elements-dev.testnet' };
async function view(contract: string, method: string, args: object) {
  const result = await request('query',{request_type:'call_function',block_id:height,account_id:contract,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')});
  return JSON.parse(Buffer.from(result.result).toString());
}
async function state(contract: string): Promise<Array<{ key: string; value: string }>> {
  return (await request('query',{request_type:'view_state',block_id:height,account_id:contract,prefix_base64:'',include_proof:false})).values;
}
function mapEntry(entry: {key:string;value:string}) {
  const key=Buffer.from(entry.key,'base64');const value=Buffer.from(entry.value,'base64');
  if (key.length<5 || key[0]!==0) return null;
  const length=key.readUInt32LE(1);
  assert.equal(key.length,5+length,'Unexpected balance key schema');
  assert.equal(value.length,16,'Unexpected balance value schema');
  const amount=value.readBigUInt64LE(0)+(value.readBigUInt64LE(8)<<64n);
  return { key:key.subarray(5).toString(),amount:amount.toString() };
}
const chromaState=await state(contracts.chroma);
const coins=chromaState.map(mapEntry).filter(e=>e!==null && BigInt(e.amount)>0).map(e=>[e!.key,e!.amount] as [string,string]);
const itemsState=await state(contracts.items);
const items=itemsState.map(mapEntry).filter(e=>e!==null && BigInt(e.amount)>0).map(e=> {
  const [holder,token,...rest]=e!.key.split('\0');
  assert.ok(holder && token && rest.length===0,'Unexpected item key');
  return {holder:holder!,token_id:token!,amount:e!.amount};
});
const supply=await view(contracts.chroma,'ft_total_supply',{});
assert.equal(coins.reduce((sum,[,amount])=>sum+BigInt(amount),0n),BigInt(supply),'CHROMA snapshot supply mismatch');
const supplies: Record<string,string>={};
for (const item of items) supplies[item.token_id]=(BigInt(supplies[item.token_id]??'0')+BigInt(item.amount)).toString();
for (const [token,total] of Object.entries(supplies)) assert.equal(await view(contracts.items,'mt_supply',{token_id:token}),total,`Item supply mismatch: ${token}`);
const legacyHolders=[...new Set([...coins.map(([holder])=>holder),...items.map(item=>item.holder)])].filter(holder=>/^[a-f0-9]{64}$/.test(holder));
const snapshot={network:'testnet',rpc,height,blockHash:block.header.hash,contracts,sourceBatches:{chroma:await view(contracts.chroma,'last_batch',{}),items:await view(contracts.items,'last_batch',{})},supply,coins,items,supplies,legacyHolders};
const directory=resolve('workbench/signed');await mkdir(directory,{recursive:true});
await writeFile(`${directory}/snapshot.json`,JSON.stringify(snapshot,null,2));
console.log(JSON.stringify({result:'PASS',height,blockHash:snapshot.blockHash,sourceBatches:snapshot.sourceBatches,supply,coinHolders:coins.length,itemHoldings:items.length,itemTypes:Object.keys(supplies).length,legacyHolders,output:'workbench/signed/snapshot.json'},null,2));
