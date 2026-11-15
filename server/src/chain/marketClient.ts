import { createHash } from 'node:crypto';
import { JsonRpcProvider, KeyPair, KeyPairSigner, PublicKey, Signature, actions, buildDelegateAction, encodeDelegateAction, createTransaction, baseDecode, baseEncode, SignedTransaction, type Action, type KeyPairString } from 'near-api-js';
import { MARKET_RULES, type SignedMarketIntent } from '@elements/shared';
import { worldKeyPair } from './keys.js';
import type { MarketConfig } from './marketConfig.js';

/** 0.001 NEAR: enough one-yocto deposits for a lifetime of board trades. */
const HOLDER_FLOAT = 1_000_000_000_000_000_000_000n;
export interface DepositAction { sender: string; publicKey: string; contract: string; method: string; args: Record<string, unknown>; nonce: string; maxBlockHeight: string }
export interface PreparedMarketTx { hash: string; signer: string; bytes: string }
export interface MarketOutcome { failed: boolean; receiptFailures: boolean; used?: number }
export interface MarketChain {
  state(): Promise<{ current_salt: string; fee: number }>;
  prepareDeposit(holder: string, publicKey: string, token: string, amount: number): Promise<DepositAction>;
  depositTransaction(action: DepositAction, signature: string): Promise<PreparedMarketTx>;
  executeTransaction(signed: SignedMarketIntent[]): Promise<PreparedMarketTx>;
  simulate(signed: SignedMarketIntent[]): Promise<void>;
  submit(tx: PreparedMarketTx, depositContract?: string): Promise<MarketOutcome>;
}
export function delegateFor(action: DepositAction) {
  return buildDelegateAction({ senderId: action.sender, receiverId: action.contract, publicKey: PublicKey.fromString(action.publicKey), nonce: BigInt(action.nonce), maxBlockHeight: BigInt(action.maxBlockHeight),
    actions: [actions.functionCall(action.method, action.args, 100_000_000_000_000n, 1n)] });
}
export function verifyDelegate(action: DepositAction, signature: string): boolean {
  const hash = createHash('sha256').update(encodeDelegateAction(delegateFor(action))).digest();
  return PublicKey.fromString(action.publicKey).verify(hash, baseDecode(signature.replace(/^ed25519:/, '')));
}
export class NearMarketChain implements MarketChain {
  readonly provider: JsonRpcProvider;
  constructor(readonly config: MarketConfig) { this.provider = new JsonRpcProvider({ url: config.rpcUrl }); }
  async state() {
    const result = await this.provider.callFunction({ contractId: this.config.verifier, method: 'simulate_intents', args: { signed: [] } }) as {state:{current_salt:string;fee:number}};
    return result.state;
  }
  async prepareDeposit(holder: string, publicKey: string, token: string, amount: number): Promise<DepositAction> {
    let exists = true;
    try { await this.provider.viewAccount({ accountId: holder }); }
    catch (error) { if (/UNKNOWN_ACCOUNT|does not exist/.test(String(error))) exists = false; else throw error; }
    if (!exists) {
      if (!/^[0-9a-f]{64}$/.test(holder)) throw new Error('World account needs provisioning');
      // A holder needs a little NEAR of its own: every transfer_call attaches one yoctoNEAR from the holder.
      const tx = await this.prepare(this.config.broker, this.brokerKey(), holder, [actions.transfer(HOLDER_FLOAT)]);
      const result = await this.submit(tx);
      if (result.failed) throw new Error('Could not create holder account');
    }
    const key = await this.provider.viewAccessKey({ accountId: holder, publicKey, finalityQuery: { finality: 'final' } });
    const block = await this.provider.viewBlock({ finality: 'final' });
    const coin = token === `nep141:${this.config.contractId}`;
    const prefix = `nep245:${this.config.items}:`;
    if (!coin && !token.startsWith(prefix)) throw new Error('Unsupported market token');
    return { sender: holder, publicKey, contract: coin ? this.config.contractId : this.config.items, method: coin ? 'ft_transfer_call' : 'mt_transfer_call',
      args: { receiver_id: this.config.verifier, amount: String(amount), msg: '', ...(coin ? {} : { token_id: token.slice(prefix.length) }) },
      nonce: String(BigInt(key.nonce) + 1n), maxBlockHeight: String(block.header.height + 120) };
  }
  async depositTransaction(action: DepositAction, signature: string) {
    if (!verifyDelegate(action, signature)) throw new Error('Invalid deposit signature');
    return this.prepare(this.config.broker, this.brokerKey(), action.sender, [actions.signedDelegate({ delegateAction: delegateFor(action), signature: new Signature({ keyType: 0, data: baseDecode(signature.replace(/^ed25519:/, '')) }) })]);
  }
  async executeTransaction(signed: SignedMarketIntent[]) {
    return this.prepare(this.config.broker, this.brokerKey(), this.config.verifier, [actions.functionCall('execute_intents', { signed }, 250_000_000_000_000n, 0n)]);
  }
  async simulate(signed: SignedMarketIntent[]) {
    const result = await this.provider.callFunction({ contractId: this.config.verifier, method: 'simulate_intents', args: { signed } }) as { invariant_violated?: unknown; state: { fee: number } };
    if (result.invariant_violated) throw new Error(`Offers do not match: ${JSON.stringify(result.invariant_violated)}`);
    if (result.state.fee !== MARKET_RULES.feePips) throw new Error('Verifier fee differs from the board rules; trading is paused');
  }
  /** The Dim broker relays deposits and runs matches from its own account and key, paying the gas. */
  private brokerKey(): KeyPairString { return worldKeyPair(this.config.playerSecret, 'market-broker').secretKey; }
  private async prepare(signerId: string, secret: KeyPairString, receiverId: string, actionList: Action[]): Promise<PreparedMarketTx> {
    const signer = KeyPairSigner.fromSecretKey(secret);
    const publicKey = await signer.getPublicKey();
    const key = await this.provider.viewAccessKey({ accountId: signerId, publicKey: publicKey.toString(), finalityQuery: { finality: 'final' } });
    const block = await this.provider.viewBlock({ finality: 'final' });
    const tx = createTransaction(signerId, publicKey, receiverId, BigInt(key.nonce) + 1n, actionList, baseDecode(block.header.hash));
    const signed = await signer.signTransaction(tx);
    return { hash: baseEncode(signed.txHash), signer: signerId, bytes: Buffer.from(signed.signedTransaction.encode()).toString('base64') };
  }
  async submit(tx: PreparedMarketTx, depositContract?: string): Promise<MarketOutcome> {
    // The same signed transaction always has the same hash, so sending it again is safe. A timeout or a used
    // nonce means it may already have run: then read its result.
    let result;
    try { result = await this.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(tx.bytes, 'base64')), 'FINAL'); }
    catch (error) {
      if (!/Timeout|408|InvalidNonce|nonce/i.test(String(error))) throw error;
      result = await this.provider.viewTransactionStatus({ txHash: tx.hash, accountId: tx.signer, waitUntil: 'FINAL' });
    }
    const status = result.status as { Failure?: unknown };
    const receipts = result.receipts_outcome ?? [];
    const outcome: MarketOutcome = { failed: !!status.Failure, receiptFailures: receipts.some(r => typeof r.outcome.status === 'object' && 'Failure' in r.outcome.status) };
    if (depositContract) {
      for (const receipt of [...receipts].reverse()) {
        const value = receipt.outcome.status as { SuccessValue?: string };
        if (receipt.outcome.executor_id !== depositContract || !value.SuccessValue) continue;
        try {
          const used = JSON.parse(Buffer.from(value.SuccessValue, 'base64').toString()) as unknown;
          const amount = Array.isArray(used) && used.length === 1 ? used[0] : used;
          if (typeof amount === 'string' && /^\d+$/.test(amount) && Number.isSafeInteger(Number(amount))) { outcome.used = Number(amount); break; }
        } catch { /* Other receipt values are not transfer resolver results. */ }
      }
    }
    return outcome;
  }
}
export async function signWorldIntent(signerId: string, secret: KeyPairString, payload: SignedMarketIntent['payload']): Promise<SignedMarketIntent> {
  const { marketSigningBytes } = await import('@elements/shared');
  const key = KeyPair.fromString(secret);
  const signature = key.sign(createHash('sha256').update(marketSigningBytes(payload)).digest()).signature;
  return { standard: 'nep413', payload, public_key: key.getPublicKey().toString(), signature: `ed25519:${baseEncode(signature)}` };
}
