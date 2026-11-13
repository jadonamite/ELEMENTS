// Plays a short session on a throwaway ledger and settles it to a live contract, then reads
// the balances back. Point CHROMA_CONTRACT_ID at a contract made only for this run.
import { DatabaseSync } from 'node:sqlite';
import { JsonRpcProvider } from 'near-api-js';
import { migrateDatabase } from '../src/db.js';
import { grantPlayerStartingPurse, recordTransaction } from '../src/economy/ledgerService.js';
import { readChainConfig } from '../src/chain/config.js';
import { nearClient, Settler } from '../src/chain/settler.js';
import { playerImplicitAccount } from '../src/chain/accounts.js';

const config = readChainConfig();
if (!config) throw new Error('Set NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, CHROMA_CONTRACT_ID, CHAIN_PLAYER_SECRET');
const db = new DatabaseSync(':memory:');
migrateDatabase(db);
grantPlayerStartingPurse('smoke_alice', db);
grantPlayerStartingPurse('smoke_bob', db);
recordTransaction({ from: 'smoke_alice', to: 'merchant_ignis', amount: 30, reason: 'merchant_buy' }, db);
recordTransaction({ from: 'treasury', to: 'pile_smoke', amount: 20, reason: 'loot_drop' }, db);
recordTransaction({ from: 'pile_smoke', to: 'smoke_bob', amount: 20, reason: 'loot_claim' }, db);

const settler = new Settler({ ...config, batchSize: 3 }, nearClient(config), db);
while ((await settler.tick()) !== null) { /* one batch per tick */ }
const provider = new JsonRpcProvider({ url: config.rpcUrl });
for (const id of ['smoke_alice', 'smoke_bob']) {
  const account = playerImplicitAccount(config.playerSecret, id);
  const balance = await provider.callFunction({ contractId: config.contractId, method: 'ft_balance_of', args: { account_id: account } });
  console.log(id, account, balance);
}
console.log(JSON.stringify(settler.status(), null, 2));
