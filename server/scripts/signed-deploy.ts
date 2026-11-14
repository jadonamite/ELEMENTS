// Deploys checked balances to the same testnet holders and records the fixed legacy claim list.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { Account, JsonRpcProvider, KeyPairSigner, KeyPair, actions, nearToYocto, type KeyPairString } from 'near-api-js';

const owner='elements-dev.testnet';
const targets={chroma:'chroma-v2.elements-dev.testnet',items:'items-v4.elements-dev.testnet'};
const snapshot=JSON.parse(await readFile('workbench/signed/snapshot.json','utf8')) as {
  network:string;legacyHolders:string[];coins:[string,string][];items:Array<{holder:string;token_id:string;amount:string}>;height:number;sourceBatches:{chroma:number;items:number};
};
assert.equal(snapshot.network,'testnet');
const remap=(holder:string)=>holder;
const provider=new JsonRpcProvider({url:'https://rpc.testnet.fastnear.com'});
for (const [kind,source] of Object.entries({chroma:'chroma.elements-dev.testnet',items:'items-v3.elements-dev.testnet'})) {
  const batch=await provider.callFunction({contractId:source,method:'last_batch',args:{}});
  assert.equal(batch,snapshot.sourceBatches[kind as 'chroma'|'items'],'Source batch changed; take a fresh snapshot');
}
const credentials=`${homedir()}/.near-credentials/testnet`;
const saved=JSON.parse(await readFile(`${credentials}/${owner}.json`,'utf8')) as {private_key:KeyPairString};
const game=new Account(owner,provider,KeyPairSigner.fromSecretKey(saved.private_key));
for (const id of Object.values(targets)) {
  let missing=false;
  try { await provider.viewAccount({accountId:id}); } catch(error) {
    if (/UNKNOWN_ACCOUNT|does not exist/.test(String(error))) missing=true; else throw error;
  }
  assert.ok(missing,`Refusing to overwrite existing ${id}`);
}
const holders: Record<string,{coin:string;items:Record<string,string>}>={};
for (const holder of snapshot.legacyHolders) {
  holders[holder]={coin:snapshot.coins.find(([id])=>id===holder)?.[1]??'0',items:Object.fromEntries(snapshot.items.filter(item=>item.holder===holder).map(item=>[item.token_id,item.amount]))};
}
await mkdir('server/config',{recursive:true});
await writeFile('server/config/legacy-claims.testnet.json',JSON.stringify({network:'testnet',height:snapshot.height,contracts:targets,holders},null,2)+'\n');
if (!process.argv.includes('--deploy')) {
  console.log(JSON.stringify({result:'PREFLIGHT PASS',targets,height:snapshot.height,coinHolders:snapshot.coins.length,itemHoldings:snapshot.items.length}));
  process.exit(0);
}
const coinMap=new Map<string,bigint>();
for (const [holder,amount] of snapshot.coins) coinMap.set(remap(holder),(coinMap.get(remap(holder))??0n)+BigInt(amount));
const itemMap=new Map<string,{holder:string;token_id:string;amount:bigint}>();
for (const item of snapshot.items) {
  const holder=remap(item.holder);const key=`${holder}\0${item.token_id}`;
  itemMap.set(key,{holder,token_id:item.token_id,amount:(itemMap.get(key)?.amount??0n)+BigInt(item.amount)});
}
const itemGenesis=[...itemMap.values()];
const transactions:Record<string,string>={};
for (const [kind,id] of Object.entries(targets)) {
  const pair=KeyPair.fromRandom('ed25519');
  await writeFile(`${credentials}/${id}.json`,JSON.stringify({account_id:id,public_key:pair.getPublicKey().toString(),private_key:pair.toString()}),{mode:0o600,flag:'wx'});
  const created=await game.createAccount({newAccountId:id,publicKey:pair.getPublicKey().toString(),nearToTransfer:nearToYocto(kind==='items'?'4':'3')});
  transactions[`${kind}_create`]=created.transaction.hash;
  const contract=new Account(id,provider,KeyPairSigner.fromSecretKey(pair.toString()));
  const wasm=kind==='chroma'?'contracts/chroma/target/near/chroma_token.wasm':'contracts/items/target/near/elements_items.wasm';
  const args=kind==='chroma'?{owner_id:owner,genesis:[...coinMap].map(([holder,amount])=>[holder,amount.toString()])}:{owner_id:owner};
  const deployed=await contract.signAndSendTransaction({receiverId:id,actions:[actions.deployContract(await readFile(wasm)),actions.functionCall('new',args,100_000_000_000_000n,0n)],waitUntil:'FINAL'});
  transactions[`${kind}_deploy`]=deployed.transaction.hash;
  if (kind==='items') {
    let batch=0;
    for (let i=0;i<itemGenesis.length;i+=60) {
      const ops=itemGenesis.slice(i,i+60).map(item=>({from:null,to:item.holder,token_id:item.token_id,amount:item.amount.toString(),memo:'genesis snapshot'}));
      const minted=await game.callFunctionRaw({contractId:id,methodName:'settle',args:{batch:++batch,ops},gas:300_000_000_000_000n,waitUntil:'FINAL'});
      assert.ok(typeof minted.status==='object' && !('Failure' in minted.status),JSON.stringify(minted.status));
      transactions[`items_genesis_${batch}`]=minted.transaction.hash;
    }
  }
}
for (const [holder,amount] of coinMap) assert.equal(await provider.callFunction({contractId:targets.chroma,method:'ft_balance_of',args:{account_id:holder}}),amount.toString());
for (const item of itemGenesis) assert.equal(await provider.callFunction({contractId:targets.items,method:'mt_balance_of',args:{account_id:item.holder,token_id:item.token_id}}),item.amount.toString());
console.log(JSON.stringify({result:'PASS',targets,transactions},null,2));
