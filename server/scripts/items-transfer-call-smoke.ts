// Exercises NEP-245 callbacks against disposable contracts deployed for one run.
import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from 'near-api-js';

const gameAccount = process.env.ITEMS_SMOKE_GAME_ACCOUNT;
const contractId = process.env.ITEMS_TRANSFER_SMOKE_CONTRACT_ID;
const receiverId = process.env.ITEMS_TRANSFER_SMOKE_RECEIVER_ID;
const secretKey = process.env.ITEMS_SMOKE_PRIVATE_KEY;
if (!gameAccount || !contractId || !receiverId || !secretKey) {
  throw new Error('Set ITEMS_SMOKE_GAME_ACCOUNT, ITEMS_TRANSFER_SMOKE_CONTRACT_ID, ITEMS_TRANSFER_SMOKE_RECEIVER_ID and ITEMS_SMOKE_PRIVATE_KEY');
}
if (!contractId.includes('smoke') || !receiverId.includes('smoke') || !contractId.endsWith('.elements-dev.testnet') || !receiverId.endsWith('.elements-dev.testnet')) {
  throw new Error('Smoke refuses contracts outside the disposable elements-dev.testnet namespace');
}
const disposableContractId = contractId as string;
const disposableReceiverId = receiverId as string;

const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? 'https://rpc.testnet.fastnear.com' });
const account = new Account(gameAccount, provider, KeyPairSigner.fromSecretKey(secretKey as KeyPairString));
const view = (method: string, args: Record<string, unknown>) => provider.callFunction({ contractId: disposableContractId, method, args });
async function call(methodName: string, args: Record<string, unknown>, deposit = 0n): Promise<void> {
  const result = await account.callFunctionRaw({
    contractId: disposableContractId,
    methodName,
    args,
    deposit,
    gas: 300_000_000_000_000n,
    waitUntil: 'FINAL',
  });
  const status = result.status as { Failure?: unknown } | string;
  if (typeof status === 'object' && status && 'Failure' in status) {
    throw new Error(`${methodName} failed: ${JSON.stringify(status.Failure)}`);
  }
}
async function balance(owner: string, token: string): Promise<bigint> {
  return BigInt(String(await view('mt_balance_of', { account_id: owner, token_id: token })));
}
function expect(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const tokens = ['smoke_potion', 'smoke_shard'];
await call('settle', {
  batch: 1,
  ops: tokens.map((token_id) => ({ from: null, to: gameAccount, token_id, amount: '30', memo: 'transfer-call smoke' })),
});

await call('mt_transfer_call', {
  receiver_id: disposableReceiverId, token_id: tokens[0], amount: '9', approval: null, memo: null, msg: 'keep_all',
}, 1n);
expect(await balance(gameAccount, tokens[0]), 21n, 'single keep all sender');
expect(await balance(receiverId, tokens[0]), 9n, 'single keep all receiver');

await call('mt_transfer_call', {
  receiver_id: disposableReceiverId, token_id: tokens[0], amount: '8', approval: null, memo: null, msg: 'keep_part',
}, 1n);
expect(await balance(gameAccount, tokens[0]), 17n, 'single keep part sender');
expect(await balance(receiverId, tokens[0]), 13n, 'single keep part receiver');

await call('mt_transfer_call', {
  receiver_id: disposableReceiverId, token_id: tokens[0], amount: '6', approval: null, memo: null, msg: 'keep_none',
}, 1n);
expect(await balance(gameAccount, tokens[0]), 17n, 'single keep none sender');
expect(await balance(receiverId, tokens[0]), 13n, 'single keep none receiver');

await call('mt_batch_transfer_call', {
  receiver_id: disposableReceiverId,
  token_ids: tokens,
  amounts: ['10', '6'],
  approvals: null,
  memo: null,
  msg: 'keep_part',
}, 1n);
expect(await balance(gameAccount, tokens[0]), 12n, 'batch potion sender');
expect(await balance(receiverId, tokens[0]), 18n, 'batch potion receiver');
expect(await balance(gameAccount, tokens[1]), 27n, 'batch shard sender');
expect(await balance(receiverId, tokens[1]), 3n, 'batch shard receiver');

console.log(JSON.stringify({ contractId: disposableContractId, receiverId: disposableReceiverId, result: 'single and batch callbacks refunded unused tokens correctly' }, null, 2));
