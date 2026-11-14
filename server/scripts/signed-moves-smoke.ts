// Deploys disposable testnet contracts and proves holder authorisation on chain.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Account, JsonRpcProvider, KeyPairSigner, KeyPair, actions, baseDecode, nearToYocto, type KeyPairString } from 'near-api-js';
import { sessionGrantBytes } from '@elements/shared';

const owner = process.env.SIGNED_SMOKE_ACCOUNT;
if (!owner?.includes('signed-smoke') || !owner.endsWith('.testnet')) throw new Error('SIGNED_SMOKE_ACCOUNT must be a disposable signed-smoke testnet account');
const credentials = `${homedir()}/.near-credentials/testnet`;
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.fastnear.com' });
const credential = JSON.parse(await readFile(`${credentials}/${owner}.json`, 'utf8')) as { private_key: KeyPairString };
const game = new Account(owner, provider, KeyPairSigner.fromSecretKey(credential.private_key));
const holder = KeyPair.fromRandom('ed25519');
const holderId = Buffer.from(baseDecode(holder.getPublicKey().toString().split(':')[1]!)).toString('hex');
const receiver = KeyPair.fromRandom('ed25519');
const receiverId = Buffer.from(baseDecode(receiver.getPublicKey().toString().split(':')[1]!)).toString('hex');
for (const [accountId,pair] of [[holderId,holder],[receiverId,receiver]] as const) {
  await writeFile(`${credentials}/${accountId}.json`, JSON.stringify({account_id:accountId,public_key:pair.getPublicKey().toString(),private_key:pair.toString()}),{mode:0o600,flag:'wx'});
}
const links: Record<string, string> = {};
const link = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
async function deploy(name: string, wasm: string, args: Record<string, unknown>) {
  const id = `${name}.${owner}`;
  const pair = KeyPair.fromRandom('ed25519');
  await writeFile(`${credentials}/${id}.json`, JSON.stringify({ account_id: id, public_key: pair.getPublicKey().toString(), private_key: pair.toString() }), { mode: 0o600, flag: 'wx' });
  const result = await game.createAccount({ newAccountId: id, publicKey: pair.getPublicKey().toString(), nearToTransfer: nearToYocto('3') });
  links[`${name}_create`] = link(result.transaction.hash);
  const contract = new Account(id, provider, KeyPairSigner.fromSecretKey(pair.toString()));
  const code = await readFile(resolve(wasm));
  const deployed = await contract.signAndSendTransaction({ receiverId: id, actions: [actions.deployContract(code), actions.functionCall('new',args,100_000_000_000_000n,0n)], waitUntil: 'FINAL' });
  links[`${name}_deploy`] = link(deployed.transaction.hash);
  return id;
}
async function call(contract: string, method: string, args: Record<string, unknown>, expectFailure = false) {
  const result = await game.signAndSendTransaction({ receiverId: contract, actions: [actions.functionCall(method,args,100_000_000_000_000n,0n)], waitUntil: 'FINAL', throwOnFailure: false });
  const failed = typeof result.status === 'object' && 'Failure' in result.status;
  assert.equal(failed, expectFailure, JSON.stringify(result.status));
  return { hash: result.transaction.hash, status: result.status };
}
async function grant(contract: string, token: string) {
  const payload = { message: JSON.stringify({ holder_id: holderId, expires_at: (BigInt(Date.now()+3_600_000)*1_000_000n).toString(), caps: { [token]: '1' }, rules: 'elements-session-v1' }), nonce: [...randomBytes(32)], recipient: contract, callback_url: null };
  const hash = createHash('sha256').update(sessionGrantBytes(payload)).digest();
  await call(contract,'grant',{ payload, public_key:holder.getPublicKey().toString(), signature:Buffer.from(holder.sign(hash).signature).toString('base64') });
}
const chroma = await deploy('chroma','contracts/chroma/target/near/chroma_token.wasm',{owner_id:owner,genesis:[[holderId,'100']]});
await grant(chroma,'CHROMA');
const accepted = await call(chroma,'settle',{batch:1,moves:[{from:holderId,to:receiverId,amount:'1',memo:'signed grant smoke'}]});
links.chroma_covered = link(accepted.hash);
const refused = await call(chroma,'settle',{batch:2,moves:[{from:receiverId,to:holderId,amount:'1',memo:'unsigned debit must fail'}]},true);
links.chroma_uncovered = link(refused.hash);
assert.match(JSON.stringify(refused.status),/No live grant/);
assert.equal(await provider.callFunction({contractId:chroma,method:'last_batch',args:{}}),1);
assert.equal(await provider.callFunction({contractId:chroma,method:'ft_balance_of',args:{account_id:receiverId}}),'1');
const items = await deploy('items','contracts/items/target/near/elements_items.wasm',{owner_id:owner});
await call(items,'settle',{batch:1,ops:[{from:null,to:holderId,token_id:'potion',amount:'2',memo:'smoke mint'}]});
await grant(items,'potion');
const itemAccepted = await call(items,'settle',{batch:2,ops:[{from:holderId,to:receiverId,token_id:'potion',amount:'1',memo:'signed grant smoke'}]});
links.items_covered = link(itemAccepted.hash);
const itemRefused = await call(items,'settle',{batch:3,ops:[{from:receiverId,to:holderId,token_id:'potion',amount:'1',memo:'unsigned debit must fail'}]},true);
links.items_uncovered = link(itemRefused.hash);
assert.match(JSON.stringify(itemRefused.status),/No live grant/);
assert.equal(await provider.callFunction({contractId:items,method:'last_batch',args:{}}),2);
assert.equal(await provider.callFunction({contractId:items,method:'mt_balance_of',args:{account_id:receiverId,token_id:'potion'}}),'1');
console.log(JSON.stringify({ result:'PASS',owner,chroma,items,links },null,2));
