// Proves named holder provisioning, registration and grants on testnet.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { nearClient } from '../src/chain/settler.js';
import { signWorldGrant } from '../src/chain/grants.js';
import { worldAccount, worldKeyPair, worldHolders } from '../src/chain/accounts.js';

const canonical=process.argv.includes('--canonical');
const owner=canonical?'elements-dev.testnet':process.env.SIGNED_SMOKE_ACCOUNT;
if (!owner || (!canonical && !owner.includes('signed-smoke')) || !owner.endsWith('.testnet')) throw new Error('Disposable testnet owner required');
const directory=`${homedir()}/.near-credentials/testnet`;
const key=JSON.parse(await readFile(`${directory}/${owner}.json`,'utf8')).private_key as string;
const secret=canonical?(process.env.CHAIN_PLAYER_SECRET??await readFile(process.env.CHAIN_PLAYER_SECRET_FILE!, 'utf8')).trim():randomBytes(32).toString('hex');
const ids=canonical?worldHolders():[`world-${Date.now()}`];
for (const ledgerId of ids) {
const holder=worldAccount(ledgerId,owner);
const holderKey=worldKeyPair(secret,ledgerId);
if(!canonical) await writeFile(`${directory}/${holder}.json`,JSON.stringify({account_id:holder,public_key:holderKey.publicKey,private_key:holderKey.secretKey}),{mode:0o600,flag:'wx'});
for (const kind of ['chroma','items']) {
  const contractId=canonical?(kind==='chroma'?'chroma-v2.elements-dev.testnet':'items-v4.elements-dev.testnet'):`${kind}.${owner}`;
  const courier=canonical?JSON.parse(await readFile(`${directory}/courier-${contractId}.json`,'utf8')).private_key as string:key;
  const client=nearClient({network:'testnet',rpcUrl:'https://rpc.testnet.fastnear.com',explorerUrl:'https://testnet.nearblocks.io',gameAccount:owner,contractId,privateKey:courier,worldProvisionerKey:key,playerSecret:secret,batchSize:2,settleEveryMs:60000},kind==='items'?'items':'coin');
  const snapshot=canonical?JSON.parse(await readFile('workbench/signed/snapshot.json','utf8')) as {supplies:Record<string,string>}:null;
  const caps:Record<string,string>=kind==='chroma'?{CHROMA:'10000000'}:Object.fromEntries(Object.keys(snapshot?.supplies??{potion:'10'}).map(token=>[token,'10000000']));
  const existing=await client.sessionGrant(holder);
  if(!existing) await client.registerWorld(ledgerId,holder);
  if(!existing || BigInt(existing.expires_at)<BigInt(Date.now()+3600_000)*1_000_000n) await client.submitGrant(signWorldGrant(secret,ledgerId,holder,contractId,caps));
  const grant=await client.sessionGrant(holder);
  for(const [token,amount] of Object.entries(caps)) assert.equal(grant?.caps[token],amount);
  console.log(JSON.stringify({result:'PASS',contractId,holder,publicKey:holderKey.publicKey,expiresAt:grant?.expires_at}));
}
}
console.log(JSON.stringify({result:'PASS',holders:ids.length,contracts:2}));
