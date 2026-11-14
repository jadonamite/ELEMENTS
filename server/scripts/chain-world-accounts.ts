// Creates a NEAR account for every world holder (treasury, keepers, masters, counting houses) under the
// game account, each with its own derived key. Accounts that already exist are skipped.
// Usage: NEAR_ACCOUNT_ID=... NEAR_PRIVATE_KEY=... CHAIN_PLAYER_SECRET=... npx tsx scripts/chain-world-accounts.ts [--dry-run]
import { Account, JsonRpcProvider, KeyPairSigner, nearToYocto, type KeyPairString } from 'near-api-js';
import { worldAccount, worldHolders, worldKeyPair } from '../src/chain/accounts.js';

const gameAccount = process.env.NEAR_ACCOUNT_ID;
const gameKey = process.env.NEAR_PRIVATE_KEY as KeyPairString | undefined;
const secret = process.env.CHAIN_PLAYER_SECRET;
const rpcUrl = process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com';
const dryRun = process.argv.includes('--dry-run');
if (!gameAccount || !gameKey || !secret) {
  console.error('NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY and CHAIN_PLAYER_SECRET are required');
  process.exit(1);
}

const provider = new JsonRpcProvider({ url: rpcUrl });
const game = new Account(gameAccount, provider, KeyPairSigner.fromSecretKey(gameKey));

async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

for (const id of worldHolders()) {
  const accountId = worldAccount(id, gameAccount);
  const { publicKey } = worldKeyPair(secret, id);
  if (await exists(accountId)) {
    console.log(`exists  ${accountId}`);
    continue;
  }
  if (dryRun) {
    console.log(`would create ${accountId} ${publicKey}`);
    continue;
  }
  const tx = await game.createAccount({ newAccountId: accountId, publicKey, nearToTransfer: nearToYocto('0.01') });
  console.log(`created ${accountId} ${tx.transaction.hash}`);
  await new Promise((r) => setTimeout(r, 1000));
}
