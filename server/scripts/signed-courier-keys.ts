// Creates game-account courier keys restricted to the two canonical contracts.
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {Account,JsonRpcProvider,KeyPairSigner,KeyPair,PublicKey,actions,nearToYocto,type KeyPairString} from 'near-api-js';
const directory=`${homedir()}/.near-credentials/testnet`;
const saved=JSON.parse(await readFile(`${directory}/elements-dev.testnet.json`,'utf8')) as {private_key:KeyPairString};
const provider=new JsonRpcProvider({url:'https://rpc.testnet.fastnear.com'});
const game=new Account('elements-dev.testnet',provider,KeyPairSigner.fromSecretKey(saved.private_key));
for(const id of ['chroma-v2.elements-dev.testnet','items-v4.elements-dev.testnet']) {
  const file=`${directory}/courier-${id}.json`;
  let pair:KeyPair;
  try {pair=KeyPair.fromString(JSON.parse(await readFile(file,'utf8')).private_key as KeyPairString);}
  catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;pair=KeyPair.fromRandom('ed25519');await writeFile(file,JSON.stringify({account_id:'elements-dev.testnet',public_key:pair.getPublicKey().toString(),private_key:pair.toString()}),{mode:0o600,flag:'wx'});}
  const existing=await game.getAccessKeyList();
  if(!existing.keys.some(k=>k.public_key===pair.getPublicKey().toString())) {
    const result=await game.signAndSendTransaction({receiverId:game.accountId,actions:[actions.addFunctionCallAccessKey(PublicKey.fromString(pair.getPublicKey().toString()),id,['settle','grant'],nearToYocto('2'))],waitUntil:'FINAL'});
    console.log(JSON.stringify({contract:id,publicKey:pair.getPublicKey().toString(),credentialFile:file,tx:`https://testnet.nearblocks.io/txns/${result.transaction.hash}`}));
  }
}
