import type { DatabaseSync } from 'node:sqlite';
import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from 'near-api-js';
import { getDatabase } from '../db.js';
import { chainAccountFor, playerImplicitAccount } from './accounts.js';
import type { ChainConfig } from './config.js';

// Settles the server ledger to the CHROMA contract in numbered batches. A batch is written down
// (rows and number) before it is sent, so after a crash or a timeout the same batch is checked
// against the contract and resent only if the contract never applied it.

export interface ChainMove {
  from: string;
  to: string;
  amount: string;
  memo: string;
}

export interface ChainClient {
  lastBatch(): Promise<number>;
  settle(batch: number, moves: ChainMove[]): Promise<string>;
}

export function migrateChainTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chain_batches (
      batch INTEGER PRIMARY KEY,
      first_rowid INTEGER NOT NULL,
      last_rowid INTEGER NOT NULL,
      moves INTEGER NOT NULL,
      status TEXT NOT NULL,
      tx_hash TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      settled_at INTEGER
    );
  `);
}

export function nearClient(config: ChainConfig): ChainClient {
  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const signer = KeyPairSigner.fromSecretKey(config.privateKey as KeyPairString);
  const account = new Account(config.gameAccount, provider, signer);
  return {
    async lastBatch() {
      const value = await provider.callFunction({
        contractId: config.contractId,
        method: 'last_batch',
        args: {},
      });
      return Number(value ?? 0);
    },
    async settle(batch, moves) {
      const result = await account.callFunctionRaw({
        contractId: config.contractId,
        methodName: 'settle',
        args: { batch, moves },
        gas: 300_000_000_000_000n,
        waitUntil: 'EXECUTED_OPTIMISTIC',
      });
      const status = result.status as { Failure?: unknown } | string;
      if (typeof status === 'object' && status && 'Failure' in status) {
        throw new Error(`settle failed: ${JSON.stringify(status.Failure)}`);
      }
      return result.transaction.hash as string;
    },
  };
}

interface BatchRow {
  batch: number;
  first_rowid: number;
  last_rowid: number;
  status: string;
}

interface LedgerRow {
  rowid: number;
  id: string;
  sender: string;
  receiver: string;
  amount: number;
  reason: string;
}

export class Settler {
  private busy = false;
  private halted: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ChainConfig,
    private readonly client: ChainClient,
    private readonly db: DatabaseSync = getDatabase(),
  ) {
    migrateChainTables(db);
  }

  start(): void {
    const run = () => {
      void this.tick().catch((err: unknown) => console.error('[chain] settle tick failed:', err));
    };
    run();
    this.timer = setInterval(run, this.config.settleEveryMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get haltReason(): string | null {
    return this.halted;
  }

  /** Sends at most one batch. Returns the batch number settled, or null if nothing was sent. */
  async tick(): Promise<number | null> {
    if (this.busy || this.halted) return null;
    this.busy = true;
    try {
      const pending = this.db
        .prepare("SELECT batch, first_rowid, last_rowid, status FROM chain_batches WHERE status = 'sent' ORDER BY batch LIMIT 1")
        .get() as BatchRow | undefined;
      const onChain = await this.client.lastBatch();

      if (pending) {
        if (onChain >= pending.batch) {
          this.markSettled(pending.batch, null);
          return pending.batch;
        }
        return await this.send(pending.batch, pending.first_rowid, pending.last_rowid);
      }

      const localLast = this.db.prepare('SELECT COALESCE(MAX(batch), 0) AS b FROM chain_batches').get() as { b: number };
      if (onChain !== localLast.b) {
        this.halt(`contract is at batch ${onChain} but this server's books are at ${localLast.b}; the contract belongs to another ledger`);
        return null;
      }

      const settledTo = this.db
        .prepare("SELECT COALESCE(MAX(last_rowid), 0) AS r FROM chain_batches WHERE status = 'settled'")
        .get() as { r: number };
      const rows = this.db
        .prepare(
          "SELECT rowid FROM ledger_entries WHERE rowid > ? AND reason != 'genesis' ORDER BY rowid LIMIT ?",
        )
        .all(settledTo.r, this.config.batchSize) as Array<{ rowid: number }>;
      if (rows.length === 0) return null;

      const batch = localLast.b + 1;
      const first = rows[0]!.rowid;
      const last = rows[rows.length - 1]!.rowid;
      this.db
        .prepare(
          "INSERT INTO chain_batches (batch, first_rowid, last_rowid, moves, status, created_at) VALUES (?, ?, ?, ?, 'sent', ?)",
        )
        .run(batch, first, last, rows.length, Date.now());
      return await this.send(batch, first, last);
    } finally {
      this.busy = false;
    }
  }

  private async send(batch: number, first: number, last: number): Promise<number | null> {
    const entries = this.db
      .prepare(
        "SELECT rowid, id, sender, receiver, amount, reason FROM ledger_entries WHERE rowid BETWEEN ? AND ? AND reason != 'genesis' ORDER BY rowid",
      )
      .all(first, last) as unknown as LedgerRow[];
    const names = { gameAccount: this.config.gameAccount, playerSecret: this.config.playerSecret };
    const moves = entries.map((e) => ({
      from: chainAccountFor(e.sender, names, this.db),
      to: chainAccountFor(e.receiver, names, this.db),
      amount: String(e.amount),
      memo: `${e.reason} ${e.id}`.slice(0, 120),
    }));

    try {
      const hash = await this.client.settle(batch, moves);
      this.markSettled(batch, hash);
      console.log(`[chain] batch ${batch}: ${moves.length} moves settled, tx ${hash}`);
      return batch;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.db.prepare('UPDATE chain_batches SET error = ? WHERE batch = ?').run(message.slice(0, 500), batch);
      // A contract refusal means the books disagree; a network error is retried next tick.
      if (/Insufficient balance|out of order|Only the game account/.test(message)) {
        this.halt(`batch ${batch} refused by the contract: ${message}`);
      } else {
        console.warn(`[chain] batch ${batch} not confirmed, will check and retry: ${message}`);
      }
      return null;
    }
  }

  private markSettled(batch: number, hash: string | null): void {
    this.db
      .prepare("UPDATE chain_batches SET status = 'settled', tx_hash = COALESCE(?, tx_hash), settled_at = ?, error = NULL WHERE batch = ?")
      .run(hash, Date.now(), batch);
  }

  private halt(reason: string): void {
    this.halted = reason;
    console.error(`[chain] SETTLEMENT STOPPED: ${reason}`);
  }

  status(playerId?: string) {
    const last = this.db
      .prepare("SELECT batch, tx_hash, settled_at FROM chain_batches WHERE status = 'settled' ORDER BY batch DESC LIMIT 1")
      .get() as { batch: number; tx_hash: string | null; settled_at: number } | undefined;
    const settledTo = this.db
      .prepare("SELECT COALESCE(MAX(last_rowid), 0) AS r FROM chain_batches WHERE status = 'settled'")
      .get() as { r: number };
    const waiting = this.db
      .prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE rowid > ? AND reason != 'genesis'")
      .get(settledTo.r) as { n: number };
    const explorer = this.config.explorerUrl;
    const player = playerId ? playerImplicitAccount(this.config.playerSecret, playerId) : null;
    return {
      network: this.config.network,
      contract: this.config.contractId,
      contractUrl: `${explorer}/token/${this.config.contractId}`,
      lastBatch: last?.batch ?? 0,
      lastTx: last?.tx_hash ? `${explorer}/txns/${last.tx_hash}` : null,
      lastSettledAt: last?.settled_at ?? null,
      waiting: waiting.n,
      halted: this.halted,
      player: player ? { account: player, url: `${explorer}/address/${player}` } : null,
    };
  }
}
