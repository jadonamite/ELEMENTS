import { withSavepoint } from '../economy/satchelService.js';
import { baseDecode } from 'near-api-js';
import { legacyCaps, legacyGrant, migrateLegacyTables } from './legacy.js';
import { playerImplicitAccount } from './keys.js';
import type { DatabaseSync } from 'node:sqlite';
import { Account, JsonRpcProvider, KeyPairSigner, nearToYocto, type KeyPairString } from 'near-api-js';
import { getDatabase } from '../db.js';
import { chainAccountFor, isPlayer, worldKeyPair } from './accounts.js';
import type { ChainConfig } from './config.js';
import { signWorldGrant, type LiveGrant } from './grants.js';
import type { SignedSessionGrant } from '@elements/shared';

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
  settle(batch: number, moves: unknown[]): Promise<string>;
  sessionGrant(holder: string): Promise<LiveGrant | null>;
  submitGrant(signed: SignedSessionGrant): Promise<void>;
  registerWorld(ledgerId: string, holder: string): Promise<void>;
}

export type LedgerKind = 'coin' | 'items';

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
  db.exec(`CREATE TABLE IF NOT EXISTS items_chain_batches (
    batch INTEGER PRIMARY KEY, first_rowid INTEGER NOT NULL, last_rowid INTEGER NOT NULL, moves INTEGER NOT NULL,
    status TEXT NOT NULL, tx_hash TEXT, error TEXT, created_at INTEGER NOT NULL, settled_at INTEGER
  );`);
  for (const table of ['chain_batches','items_chain_batches']) {
    const columns=db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>;
    if (!columns.some(c=>c.name==='moves_json')) db.exec(`ALTER TABLE ${table} ADD COLUMN moves_json TEXT`);
    if (!columns.some(c=>c.name==='legacy_holder')) db.exec(`ALTER TABLE ${table} ADD COLUMN legacy_holder TEXT`);
  }
  migrateLegacyTables(db);

}

export function nearClient(config: ChainConfig, kind: LedgerKind = 'coin'): ChainClient {
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
    async sessionGrant(holder) {
      return await provider.callFunction({ contractId: config.contractId, method: 'session_grant', args: { holder_id: holder } }) as LiveGrant | null;
    },
    async submitGrant(signed) {
      await account.callFunction({ contractId: config.contractId, methodName: 'grant', args: signed, gas: 50_000_000_000_000n, waitUntil: 'FINAL' });
    },
    async registerWorld(ledgerId, holder) {
      const key = worldKeyPair(config.playerSecret, ledgerId);
      let balance: bigint | null = null;
      try { balance = BigInt((await provider.viewAccount({ accountId: holder })).amount); }
      catch (error) { if (!/UNKNOWN_ACCOUNT|does not exist/.test(String(error))) throw error; }
      if (balance === null || balance < nearToYocto('0.05')) {
        if (!config.worldProvisionerKey) throw new Error(`World holder ${holder} needs provisioning; configure NEAR_WORLD_PROVISIONER_KEY`);
        const provisioner = new Account(config.gameAccount, provider, KeyPairSigner.fromSecretKey(config.worldProvisionerKey as KeyPairString));
        if (balance === null) await provisioner.createAccount({ newAccountId: holder, publicKey: key.publicKey, nearToTransfer: nearToYocto('0.1') });
        else await provisioner.transfer({ receiverId: holder, amount: nearToYocto('0.1') });
      }
      const world = new Account(holder, provider, KeyPairSigner.fromSecretKey(key.secretKey));
      try {
        await world.callFunction({ contractId: config.contractId, methodName: 'register_key', args: { public_key: key.publicKey }, gas: 30_000_000_000_000n, waitUntil: 'FINAL' });
      } catch (error) {
        if (!/Key already registered/.test(String(error))) throw error;
      }
    },
    async settle(batch, moves) {
      const result = await account.callFunctionRaw({
        contractId: config.contractId,
        methodName: 'settle',
        args: kind === 'coin' ? { batch, moves } : { batch, ops: moves },
        gas: 300_000_000_000_000n,
        waitUntil: 'FINAL',
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
  legacy_holder?: string | null;
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
  private held: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ChainConfig,
    private readonly client: ChainClient,
    private readonly db: DatabaseSync = getDatabase(),
    private readonly kind: LedgerKind = 'coin',
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
      const table = this.batchTable;
      const pending = this.db
        .prepare(`SELECT batch, first_rowid, last_rowid, status, legacy_holder FROM ${table} WHERE status = 'sent' ORDER BY batch LIMIT 1`)
        .get() as BatchRow | undefined;
      const onChain = await this.client.lastBatch();

      if (pending) {
        if (onChain >= pending.batch) {
          this.markSettled(pending.batch, null);
          return pending.batch;
        }
        if (pending.legacy_holder) return await this.sendLegacy(pending.batch,pending.legacy_holder);
        return await this.send(pending.batch, pending.first_rowid, pending.last_rowid);
      }

      const localLast = this.db.prepare(`SELECT COALESCE(MAX(batch), 0) AS b FROM ${table}`).get() as { b: number };
      if (onChain !== localLast.b) {
        this.halt(`contract is at batch ${onChain} but this server's books are at ${localLast.b}; the contract belongs to another ledger`);
        return null;
      }

      const settledTo = this.db
        .prepare(`SELECT COALESCE(MAX(last_rowid), 0) AS r FROM ${table} WHERE status = 'settled'`)
        .get() as { r: number };
      const legacy = this.prepareLegacy();
      if (legacy) {
        const batch=localLast.b+1;
        withSavepoint(this.db,()=>{
        this.db.prepare(`INSERT INTO ${table} (batch,first_rowid,last_rowid,moves,status,created_at,legacy_holder) VALUES (?,?,?,?,'sent',?,?)`)
          .run(batch,settledTo.r,settledTo.r,legacy.moves,Date.now(),legacy.holder);
        this.db.prepare("UPDATE legacy_chain_claims SET batch=?,status='sent' WHERE contract=? AND holder=?").run(batch,this.config.contractId,legacy.holder);
        });
        return await this.sendLegacy(batch,legacy.holder);
      }
      const rows = this.db
        .prepare(this.kind === 'coin'
          ? "SELECT rowid FROM ledger_entries WHERE rowid > ? AND reason != 'genesis' ORDER BY rowid LIMIT ?"
          : 'SELECT rowid FROM item_ledger WHERE rowid > ? ORDER BY rowid LIMIT ?')
        .all(settledTo.r, this.config.batchSize) as Array<{ rowid: number }>;
      if (rows.length === 0) return null;

      const batch = localLast.b + 1;
      const first = rows[0]!.rowid;
      const last = rows[rows.length - 1]!.rowid;
      this.db
        .prepare(
          `INSERT INTO ${table} (batch, first_rowid, last_rowid, moves, status, created_at) VALUES (?, ?, ?, ?, 'sent', ?)`,
        )
        .run(batch, first, last, rows.length, Date.now());
      return await this.send(batch, first, last);
    } finally {
      this.busy = false;
    }
  }

  async submitGrant(signed: SignedSessionGrant): Promise<void> { await this.client.submitGrant(signed); }

  get contractId(): string { return this.config.contractId; }

  private async send(batch: number, first: number, last: number): Promise<number | null> {
    const entries = this.kind === 'coin'
      ? this.db.prepare("SELECT rowid, id, sender, receiver, amount, reason FROM ledger_entries WHERE rowid BETWEEN ? AND ? AND reason != 'genesis' ORDER BY rowid").all(first,last) as unknown as LedgerRow[]
      : this.db.prepare('SELECT rowid,id,from_id,to_id,item_id,quantity,reason FROM item_ledger WHERE rowid BETWEEN ? AND ? ORDER BY rowid').all(first,last) as unknown as Array<{rowid:number;id:string;from_id:string;to_id:string;item_id:string;quantity:number;reason:string}>;
    const saved=this.db.prepare(`SELECT moves_json FROM ${this.batchTable} WHERE batch=?`).get(batch) as {moves_json:string|null};
    const assigned=this.db.prepare('SELECT holder,moves_json FROM legacy_chain_claims WHERE contract=? AND batch=?').get(this.config.contractId,batch) as {holder:string;moves_json:string}|undefined;
    const claim=assigned?{holder:assigned.holder,moves:(JSON.parse(assigned.moves_json) as unknown[]).length}:saved.moves_json?null:this.prepareLegacy();
    const names = {...this.config,...(claim?{claimHolder:claim.holder}:{})};
    try {
    const moves = saved.moves_json ? (JSON.parse(saved.moves_json) as Array<{from:string|null;to:string|null;token_id?:string;amount:string;memo:string}>).slice(claim?.moves??0) : this.kind === 'coin'
      ? (entries as LedgerRow[]).map((e) => ({ from: chainAccountFor(e.sender,names,this.db), to: chainAccountFor(e.receiver,names,this.db), amount: String(e.amount), memo: `${e.reason} ${e.id}`.slice(0,120) }))
        : (entries as Array<{id:string;from_id:string;to_id:string;item_id:string;quantity:number;reason:string}>).map((e) => ({ from: e.from_id === 'world' ? null : chainAccountFor(e.from_id,names,this.db), to: e.to_id === 'world' ? null : chainAccountFor(e.to_id,names,this.db), token_id:e.item_id, amount:String(e.quantity), memo:`${e.reason} ${e.id}`.slice(0,120) }));

      const needed = new Map<string, { ledgerId: string; caps: Record<string, bigint> }>();
      for (let i = 0; i < moves.length; i++) {
        const move = moves[i]!;
        if (!move.from) continue;
        const entry = entries[i]!;
        const ledgerId = 'sender' in entry ? entry.sender : entry.from_id;
        const token = 'token_id' in move ? (move.token_id ?? 'CHROMA') : 'CHROMA';
        const holder = needed.get(move.from) ?? { ledgerId, caps: {} };
        holder.caps[token] = (holder.caps[token] ?? 0n) + BigInt(move.amount);
        needed.set(move.from, holder);
      }
      for (const [holder, request] of needed) {
        let grant = await this.client.sessionGrant(holder);
        const covered = () => grant && BigInt(grant.expires_at) > BigInt(Date.now() + 30_000) * 1_000_000n
          && Object.entries(request.caps).every(([token, amount]) => BigInt(grant!.caps[token] ?? '0') >= amount);
        if (!covered() && !isPlayer(request.ledgerId, this.db)) {
          if (!grant) await this.client.registerWorld(request.ledgerId, holder);
          const caps = Object.fromEntries(Object.entries(request.caps).map(([token, amount]) => [token, (amount + 10_000_000n).toString()]));
          await this.client.submitGrant(signWorldGrant(this.config.playerSecret, request.ledgerId, holder, this.config.contractId, caps));
          grant = await this.client.sessionGrant(holder);
        }
        if (!covered()) throw new Error(`No live grant covering ${holder}; renew the session`);
      }
      this.held = null;
      let outgoing: unknown[]=moves;
      if (claim) {
        await this.ensureLegacyGrant(claim.holder);
        const stored=this.db.prepare('SELECT moves_json FROM legacy_chain_claims WHERE contract=? AND holder=?').get(this.config.contractId,claim.holder) as {moves_json:string};
        outgoing=[...(JSON.parse(stored.moves_json) as unknown[]),...moves];
      }
      withSavepoint(this.db,()=>{
        this.db.prepare(`UPDATE ${this.batchTable} SET moves_json=?,moves=? WHERE batch=?`).run(JSON.stringify(outgoing),outgoing.length,batch);
        if(claim) this.db.prepare("UPDATE legacy_chain_claims SET batch=?,status='sent' WHERE contract=? AND holder=?").run(batch,this.config.contractId,claim.holder);
      });
      const hash = await this.client.settle(batch, outgoing);
      this.markSettled(batch, hash);
      console.log(`[chain] batch ${batch}: ${moves.length} moves settled, tx ${hash}`);
      return batch;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.db.prepare(`UPDATE ${this.batchTable} SET error = ? WHERE batch = ?`).run(message.slice(0, 500), batch);
      if (/No live grant|Grant expired|Grant cap exceeded|Token not granted|has no holder key|needs provisioning/.test(message)) {
        this.held = message;
        console.warn(`[chain] batch ${batch} held: ${message}`);
        return null;
      }
      // A contract refusal means the books disagree; a network error is retried next tick.
      if (/Insufficient balance|Supply underflow|Amount must be positive|Operation has no source or destination|Sender and receiver cannot be the same|out of order|Only the game account|overflow|underflow/i.test(message)) {
        this.halt(`batch ${batch} refused by the contract: ${message}`);
      } else {
        console.warn(`[chain] batch ${batch} not confirmed, will check and retry: ${message}`);
      }
      return null;
    }
  }

  private prepareLegacy(): {holder:string;moves:number}|null {
    const list=this.config.legacyClaims;
    if (!list) return null;
    const accounts=this.db.prepare('SELECT id,chain_public_key FROM accounts WHERE chain_public_key IS NOT NULL').all() as Array<{id:string;chain_public_key:string}>;
    for (const account of accounts) {
      const holder=playerImplicitAccount(this.config.playerSecret,account.id);
      const caps=legacyCaps(list,this.config.contractId,holder);
      if (!caps) continue;
      const existing=this.db.prepare('SELECT status,moves_json FROM legacy_chain_claims WHERE contract=? AND holder=?').get(this.config.contractId,holder) as {status:string;moves_json:string}|undefined;
      if (existing?.status==='settled') continue;
      if (existing) return {holder,moves:(JSON.parse(existing.moves_json) as unknown[]).length};
      const destination=Buffer.from(baseDecode(account.chain_public_key.replace(/^ed25519:/,''))).toString('hex');
      if (destination===holder) throw new Error('Legacy claim destination must be a player-owned key');
      const moves=Object.entries(caps).map(([token,amount])=>({from:holder,to:destination,amount,memo:'legacy claim',...(this.kind==='items'?{token_id:token}:{})}));
      this.db.prepare("INSERT INTO legacy_chain_claims (contract,holder,destination,status,grant_json,moves_json) VALUES (?,?,?,'queued',?,?)")
        .run(this.config.contractId,holder,destination,JSON.stringify(legacyGrant(this.config.playerSecret,account.id,this.config.contractId,list)),JSON.stringify(moves));
      return {holder,moves:moves.length};
    }
    return null;
  }

  private async ensureLegacyGrant(holder:string):Promise<void> {
    const row=this.db.prepare('SELECT grant_json FROM legacy_chain_claims WHERE contract=? AND holder=?').get(this.config.contractId,holder) as {grant_json:string};
    const signed=JSON.parse(row.grant_json) as SignedSessionGrant;
    const grant=await this.client.sessionGrant(holder);
    if (!grant || JSON.stringify(grant.nonce)!==JSON.stringify(signed.payload.nonce)) await this.client.submitGrant(signed);
  }

  private async sendLegacy(batch:number,holder:string): Promise<number|null> {
    const row=this.db.prepare('SELECT grant_json,moves_json FROM legacy_chain_claims WHERE contract=? AND holder=?').get(this.config.contractId,holder) as {grant_json:string;moves_json:string};
    try {
      await this.ensureLegacyGrant(holder);
      const hash=await this.client.settle(batch,JSON.parse(row.moves_json) as unknown[]);
      this.markSettled(batch,hash);
      return batch;
    } catch(error) {
      const message=error instanceof Error?error.message:String(error);
      this.db.prepare(`UPDATE ${this.batchTable} SET error=? WHERE batch=?`).run(message.slice(0,500),batch);
      this.held=`Legacy claim ${holder}: ${message}`;
      return null;
    }
  }

  private markSettled(batch: number, hash: string | null): void {
    withSavepoint(this.db,()=>{
    this.db
      .prepare(`UPDATE ${this.batchTable} SET status = 'settled', tx_hash = COALESCE(?, tx_hash), settled_at = ?, error = NULL WHERE batch = ?`)
      .run(hash, Date.now(), batch);
    this.db.prepare("UPDATE legacy_chain_claims SET status='settled',tx_hash=COALESCE(?,tx_hash) WHERE contract=? AND batch=?").run(hash,this.config.contractId,batch);
    });
    this.held=null;
  }

  private get batchTable(): string { return this.kind === 'coin' ? 'chain_batches' : 'items_chain_batches'; }

  private halt(reason: string): void {
    this.halted = reason;
    console.error(`[chain] SETTLEMENT STOPPED: ${reason}`);
  }

  status(playerId?: string) {
    const last = this.db
      .prepare(`SELECT batch, tx_hash, settled_at FROM ${this.batchTable} WHERE status = 'settled' ORDER BY batch DESC LIMIT 1`)
      .get() as { batch: number; tx_hash: string | null; settled_at: number } | undefined;
    const settledTo = this.db
      .prepare(`SELECT COALESCE(MAX(last_rowid), 0) AS r FROM ${this.batchTable} WHERE status = 'settled'`)
      .get() as { r: number };
    const waiting = this.db
      .prepare(this.kind === 'coin' ? "SELECT COUNT(*) AS n FROM ledger_entries WHERE rowid > ? AND reason != 'genesis'" : 'SELECT COUNT(*) AS n FROM item_ledger WHERE rowid > ?')
      .get(settledTo.r) as { n: number };
    const explorer = this.config.explorerUrl;
    let player: string | null = null;
    if (playerId) {
      try { player = chainAccountFor(playerId, this.config, this.db); } catch { /* A session has not bound a holder key yet. */ }
    }
    return {
      network: this.config.network,
      contract: this.config.contractId,
      contractUrl: `${explorer}/token/${this.config.contractId}`,
      lastBatch: last?.batch ?? 0,
      lastTx: last?.tx_hash ? `${explorer}/txns/${last.tx_hash}` : null,
      lastSettledAt: last?.settled_at ?? null,
      waiting: waiting.n,
      halted: this.halted,
      held: this.held,
      player: player ? { account: player, url: `${explorer}/address/${player}` } : null,
    };
  }
}
