// Proves named holder provisioning, key registration and grant forwarding on disposable contracts.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { nearClient } from '../src/chain/settler.js';
import { signWorldGrant } from '../src/chain/grants.js';
import { worldAccount, worldKeyPair } from '../src/chain/accounts.js';

const owner=process.env.SIGNED_SMOKE_ACCOUNT;
if (!owner?.includes('signed-smoke') || !owner.endsWith('.testnet')) throw new Error('Disposable testnet owner required');
const directory=`${homedir()}/.near-credentials/testnet`;
const key=JSON.parse(await readFile(`${directory}/${owner}.json`,'utf8')).private_key as string;
const secret=randomBytes(32).toString('hex');
const ledgerId=`world-${Date.now()}`;
const holder=worldAccount(ledgerId,owner);
const holderKey=worldKeyPair(secret,ledgerId);
await writeFile(`${directory}/${holder}.json`,JSON.stringify({account_id:holder,public_key:holderKey.publicKey,private_key:holderKey.secretKey}),{mode:0o600,flag:'wx'});
for (const kind of ['chroma','items']) {
  const contractId=`${kind}.${owner}`;
  const client=nearClient({network:'testnet',rpcUrl:'https://rpc.testnet.fastnear.com',explorerUrl:'https://testnet.nearblocks.io',gameAccount:owner,contractId,privateKey:key,worldProvisionerKey:key,playerSecret:secret,batchSize:2,settleEveryMs:60000},kind==='items'?'items':'coin');
  await client.registerWorld(ledgerId,holder);
  const signed=signWorldGrant(secret,ledgerId,holder,contractId,{CHROMA:'100',potion:'10'});
  await client.submitGrant(signed);
  const grant=await client.sessionGrant(holder);
  assert.equal(grant?.caps.CHROMA,'100');
  assert.equal(grant?.caps.potion,'10');
  console.log(JSON.stringify({result:'PASS',contractId,holder,publicKey:holderKey.publicKey,expiresAt:grant?.expires_at}));
}
