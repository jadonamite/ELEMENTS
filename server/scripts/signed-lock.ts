// Removes every canonical contract access key after verifying its deployed code and owner.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { Account,JsonRpcProvider,KeyPairSigner,PublicKey,actions,baseEncode,type KeyPairString } from 'near-api-js';
const provider=new JsonRpcProvider({url:'https://rpc.testnet.fastnear.com'});
for (const [id,file] of [['chroma-v2.elements-dev.testnet','contracts/chroma/target/near/chroma_token.wasm'],['items-v4.elements-dev.testnet','contracts/items/target/near/elements_items.wasm']]) {
  const accountId=id!;
  assert.equal(await provider.callFunction({contractId:accountId,method:'owner',args:{}}),'elements-dev.testnet');
  const state=await provider.viewAccount({accountId});
  assert.equal(state.code_hash,baseEncode(createHash('sha256').update(await readFile(file!)).digest()));
  const saved=JSON.parse(await readFile(`${homedir()}/.near-credentials/testnet/${accountId}.json`,'utf8')) as {private_key:KeyPairString};
  const contract=new Account(accountId,provider,KeyPairSigner.fromSecretKey(saved.private_key));
  const before=await contract.getAccessKeyList();
  if(before.keys.length) {
    assert.ok(before.keys.every(k=>k.access_key.permission==='FullAccess'),'Unexpected restricted contract key');
    const result=await contract.signAndSendTransaction({receiverId:accountId,actions:before.keys.map(k=>actions.deleteKey(PublicKey.fromString(k.public_key))),waitUntil:'FINAL'});
    console.log(JSON.stringify({accountId,lockTx:`https://testnet.nearblocks.io/txns/${result.transaction.hash}`}));
  }
  const after=await contract.getAccessKeyList();assert.deepEqual(after.keys,[]);
  console.log(JSON.stringify({accountId,view_access_key_list:after}));
}
