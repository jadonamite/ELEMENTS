import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { PublicKey, baseDecode } from 'near-api-js';
import { MARKET_RULES, marketQuote, marketTax, marketPayload, marketSigningBytes, offerIntents, type MarketIntent, type MarketTerms, type SignedMarketIntent } from '@elements/shared';
import { chainAccountFor, isPlayer } from '../chain/accounts.js';
import { migrateChainTables } from '../chain/settler.js';
import type { MarketConfig } from '../chain/marketConfig.js';
import { worldKeyPair } from '../chain/keys.js';
import { KeyPairSigner, baseEncode } from 'near-api-js';
import { delegateFor, signWorldIntent, verifyDelegate, type DepositAction, type MarketChain, type PreparedMarketTx } from '../chain/marketClient.js';
import { getAccountBalance, recordTransaction } from './ledgerService.js';
import { getItemCount, recordItemMove, withSavepoint } from './satchelService.js';

type Side = 'sell' | 'buy';
export interface OfferRequest { side: Side; item: string; quantity: number; price: number; target?: string }
interface OfferRow { id: string; owner: string; holder: string; side: Side; item: string; quantity: number; price: number; target: string | null; lit_pair: number; signed: string; expires: number; status: string; tx_hash: string | null }
interface Operation { id: string; kind: 'deposit' | 'swap' | 'return'; data: string; tx: string | null; status: string; error: string | null }
interface DepositData { owner: string; holder: string; token: string; amount: number; action: DepositAction; signature?: string }
interface SwapData { sell: string; buy: string; signed: SignedMarketIntent[] }
interface ReturnData { owner: string; holder: string; token: string; amount: number; signed: SignedMarketIntent }
export class MarketService {
  private running = false;
  constructor(readonly db: DatabaseSync, readonly config: MarketConfig, readonly chain: MarketChain) {
    migrateChainTables(db);
    db.exec(`CREATE TABLE IF NOT EXISTS market_balances (owner TEXT NOT NULL, token TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0), PRIMARY KEY(owner, token));
      CREATE TABLE IF NOT EXISTS market_offers (id TEXT PRIMARY KEY, owner TEXT NOT NULL, holder TEXT NOT NULL, side TEXT NOT NULL, item TEXT NOT NULL, quantity INTEGER NOT NULL, price INTEGER NOT NULL, target TEXT, lit_pair INTEGER NOT NULL, signed TEXT NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL, tx_hash TEXT);
      CREATE TABLE IF NOT EXISTS market_operations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, tx TEXT, status TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS market_quotes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL);`);
  }
  get coinToken() { return `nep141:${this.config.contractId}`; }
  itemToken(item: string) {
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(item)) throw new Error('Invalid item');
    const token = `nep245:${this.config.items}:${item}`;
    if (token.length > 127) throw new Error('Item identifier is too long');
    return token;
  }
  private itemFor(token: string): string | null {
    if (token === this.coinToken) return null;
    const prefix = `nep245:${this.config.items}:`;
    if (!token.startsWith(prefix) || this.itemToken(token.slice(prefix.length)) !== token) throw new Error('Unsupported market token');
    return token.slice(prefix.length);
  }
  identity(owner: string) {
    const holder = chainAccountFor(owner, this.config, this.db);
    const row = this.db.prepare('SELECT chain_public_key FROM accounts WHERE id=?').get(owner) as {chain_public_key:string|null}|undefined;
    if (isPlayer(owner, this.db) && (!row?.chain_public_key || Buffer.from(baseDecode(row.chain_public_key.replace(/^ed25519:/, ''))).toString('hex') !== holder)) throw new Error('Wait for your signed game holdings to settle');
    return { holder, publicKey: row?.chain_public_key ?? null };
  }
  private lit(owner: string): boolean {
    const row = this.db.prepare('SELECT role FROM risings WHERE account_id=?').get(owner) as {role:string}|undefined;
    if (isPlayer(owner, this.db) && !row) throw new Error('Complete your rising before trading');
    return row?.role === 'Shaper';
  }
  balance(owner: string, token: string): number {
    return (this.db.prepare('SELECT amount FROM market_balances WHERE owner=? AND token=?').get(owner, token) as {amount:number}|undefined)?.amount ?? 0;
  }
  private change(owner: string, token: string, delta: number) {
    const next = this.balance(owner, token) + delta;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error('Not enough goods on the board');
    this.db.prepare('INSERT INTO market_balances (owner,token,amount) VALUES (?,?,?) ON CONFLICT(owner,token) DO UPDATE SET amount=excluded.amount').run(owner,token,next);
  }
  private expire() { this.db.prepare("UPDATE market_offers SET status='expired' WHERE status='open' AND expires<=?").run(Date.now()); }
  available(owner: string, token: string): number {
    this.expire();
    const offers = this.db.prepare("SELECT * FROM market_offers WHERE owner=? AND status IN ('open','executing')").all(owner) as unknown as OfferRow[];
    let held = 0;
    for (const offer of offers) {
      if (offer.side === 'sell' && token === this.itemToken(offer.item)) held += offer.quantity;
      if (offer.side === 'buy' && token === this.coinToken) held += offer.price + marketTax(offer.price, offer.lit_pair === 1);
    }
    for (const op of this.db.prepare("SELECT data FROM market_operations WHERE kind='return' AND status IN ('reserved','sent','review')").all() as Array<{data:string}>) {
      const data = JSON.parse(op.data) as ReturnData;
      if (data.owner === owner && data.token === token) held += data.amount;
    }
    return this.balance(owner, token) - held;
  }
  async view(owner?: string) {
    this.expire();
    const state = await this.chain.state();
    if (state.fee !== MARKET_RULES.feePips) throw new Error('The board fee has changed; trading is paused');
    const offers = this.db.prepare("SELECT id,owner,side,item,quantity,price,expires,status,tx_hash FROM market_offers WHERE status='open' ORDER BY rowid DESC LIMIT 100").all();
    const balances = owner ? (this.db.prepare('SELECT token,amount FROM market_balances WHERE owner=? AND amount>0').all(owner) as Array<{token:string;amount:number}>).map(r => ({ ...r, available: this.available(owner, r.token) })) : [];
    return { verifier: this.config.verifier, coinToken: this.coinToken, itemsContract: this.config.items, treasury: this.config.treasury, salt: state.current_salt, rules: MARKET_RULES, offers, balances, identity: owner ? this.identity(owner) : null,
      operations: owner ? this.db.prepare("SELECT id,kind,status,error FROM market_operations WHERE json_extract(data,'$.owner')=? ORDER BY rowid DESC LIMIT 20").all(owner) : [] };
  }
  private verify(signed: SignedMarketIntent, holder: string, expected: MarketIntent[]): MarketTerms {
    if (signed.standard !== 'nep413' || signed.payload.recipient !== this.config.verifier || !signed.public_key.startsWith('ed25519:')) throw new Error('Invalid market signature domain');
    const terms = JSON.parse(signed.payload.message) as MarketTerms;
    const deadline = Date.parse(terms.deadline);
    if (terms.signer_id !== holder || !Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + MARKET_RULES.offerLifetimeMs + 10_000) throw new Error('Offer has expired or names another holder');
    if (JSON.stringify(terms.intents) !== JSON.stringify(expected)) throw new Error('Signed terms do not match the board quote');
    const valid = PublicKey.fromString(signed.public_key).verify(createHash('sha256').update(marketSigningBytes(signed.payload)).digest(), baseDecode(signed.signature.replace(/^ed25519:/, '')));
    if (!valid) throw new Error('Invalid holder signature');
    if (/^[0-9a-f]{64}$/.test(holder) && Buffer.from(baseDecode(signed.public_key.slice(8))).toString('hex') !== holder) throw new Error('Signature belongs to another holder');
    return terms;
  }
  async depositQuote(owner: string, token: string, amount: number) {
    this.itemFor(token); this.whole(amount);
    const identity = this.identity(owner);
    const publicKey = identity.publicKey ?? worldKeyPair(this.config.playerSecret,owner).publicKey;
    const action = await this.chain.prepareDeposit(identity.holder, publicKey, token, amount);
    const id = randomUUID();
    this.db.prepare('INSERT INTO market_quotes VALUES (?,?,?,?)').run(id,owner,JSON.stringify({ owner,holder:identity.holder,token,amount,action }),Date.now()+60_000);
    return { id, action };
  }
  async deposit(owner: string, quoteId: string, signature: string) {
    const quote = this.db.prepare('SELECT data,expires FROM market_quotes WHERE id=? AND owner=?').get(quoteId,owner) as {data:string;expires:number}|undefined;
    if (!quote || quote.expires < Date.now()) throw new Error('Refresh the deposit quote');
    const data = JSON.parse(quote.data) as DepositData;
    if (this.identity(owner).holder !== data.holder || !verifyDelegate(data.action, signature)) throw new Error('Invalid deposit authorisation');
    data.signature = signature;
    withSavepoint(this.db, () => {
      if (this.db.prepare('SELECT 1 FROM market_operations WHERE id=?').get(quoteId)) throw new Error('Deposit already submitted');
      this.physical(owner, this.config.verifier, data.token, data.amount, quoteId);
      this.db.prepare("INSERT INTO market_operations VALUES (?,'deposit',?,NULL,'reserved',NULL)").run(quoteId,JSON.stringify(data));
      this.db.prepare('DELETE FROM market_quotes WHERE id=?').run(quoteId);
    });
    await this.tick();
    return this.operation(quoteId);
  }
  async depositWorld(owner: string, token: string, amount: number) {
    if (isPlayer(owner,this.db)) throw new Error('Players sign their own deposits');
    const quote = await this.depositQuote(owner,token,amount);
    const key = worldKeyPair(this.config.playerSecret,owner);
    const result = await KeyPairSigner.fromSecretKey(key.secretKey).signDelegateAction(delegateFor(quote.action));
    return this.deposit(owner,quote.id,`ed25519:${baseEncode(result.signedDelegate.signature.data)}`);
  }
  async postWorldOffer(owner: string, request: OfferRequest) {
    if (isPlayer(owner,this.db)) throw new Error('Players sign their own offers');
    const { holder } = this.identity(owner);
    const terms = this.offerTerms(owner,request);
    const state = await this.chain.state();
    const key = worldKeyPair(this.config.playerSecret,owner);
    return this.postOffer(owner,request,await signWorldIntent(holder,key.secretKey,marketPayload(holder,this.config.verifier,state.current_salt,terms.intents)));
  }
  offerTerms(owner: string, request: OfferRequest) {
    if (request.side !== 'sell' && request.side !== 'buy') throw new Error('Invalid offer side');
    this.whole(request.quantity); this.whole(request.price);
    let litPair = false;
    if (request.side === 'buy') {
      const sell = this.offer(request.target ?? '');
      if (!sell || sell.status !== 'open' || sell.side !== 'sell' || sell.expires <= Date.now() || sell.owner === owner || sell.item !== request.item || sell.quantity !== request.quantity || sell.price !== request.price) throw new Error('Choose a matching open offer');
      litPair = this.lit(owner) && this.lit(sell.owner);
    } else this.lit(owner);
    return { litPair, intents: offerIntents(request.side,this.itemToken(request.item),this.coinToken,request.quantity,request.price,this.config.treasury,litPair) };
  }
  postOffer(owner: string, request: OfferRequest, signed: SignedMarketIntent) {
    this.expire();
    const { holder } = this.identity(owner);
    const terms = this.offerTerms(owner,request);
    const verified = this.verify(signed,holder,terms.intents);
    const token = request.side === 'sell' ? this.itemToken(request.item) : this.coinToken;
    const debit = request.side === 'sell' ? request.quantity : request.price + marketTax(request.price, terms.litPair);
    if (this.available(owner,token) < debit) throw new Error('Put enough goods on the board first');
    const id = createHash('sha256').update(JSON.stringify(signed)).digest('hex');
    this.db.prepare("INSERT INTO market_offers VALUES (?,?,?,?,?,?,?,?,?,?,?, 'open',NULL)").run(id,owner,holder,request.side,request.item,request.quantity,request.price,request.target??null,Number(terms.litPair),JSON.stringify(signed),Date.parse(verified.deadline));
    return id;
  }
  private whole(amount: number) { if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a positive whole amount'); }
  private offer(id: string) { return this.db.prepare('SELECT * FROM market_offers WHERE id=?').get(id) as unknown as OfferRow|undefined; }
  operation(id: string) { return this.db.prepare('SELECT id,kind,status,error,tx FROM market_operations WHERE id=?').get(id); }
  async returnGoods(owner: string, token: string, amount: number, signed: SignedMarketIntent) {
    const item = this.itemFor(token); this.whole(amount);
    const { holder } = this.identity(owner);
    const intent: MarketIntent = item === null
      ? { intent:'ft_withdraw',token:this.config.contractId,receiver_id:holder,amount:String(amount) }
      : { intent:'mt_withdraw',token:this.config.items,receiver_id:holder,token_ids:[item],amounts:[String(amount)] };
    this.verify(signed,holder,[intent]);
    if (this.available(owner,token) < amount) throw new Error('Goods are reserved by an offer or return');
    const id = createHash('sha256').update(JSON.stringify(signed)).digest('hex');
    this.db.prepare("INSERT INTO market_operations VALUES (?,'return',?,NULL,'reserved',NULL)").run(id,JSON.stringify({ owner,holder,token,amount,signed }));
    await this.tick(); return this.operation(id);
  }
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.expire();
      let op = this.db.prepare("SELECT * FROM market_operations WHERE status IN ('reserved','sent') ORDER BY rowid LIMIT 1").get() as unknown as Operation|undefined;
      if (!op) {
        const buyers = this.db.prepare("SELECT * FROM market_offers WHERE side='buy' AND status='open' ORDER BY rowid").all() as unknown as OfferRow[];
        for (const buy of buyers) {
          const sell = this.offer(buy.target ?? '');
          if (!sell || sell.status !== 'open') continue;
          const signed = [JSON.parse(sell.signed), JSON.parse(buy.signed)] as SignedMarketIntent[];
          try { await this.chain.simulate(signed); }
          catch (error) {
            this.db.prepare("UPDATE market_offers SET status='refused' WHERE id=?").run(buy.id);
            throw error;
          }
          const id = randomUUID();
          withSavepoint(this.db, () => {
            this.db.prepare("UPDATE market_offers SET status='executing' WHERE id IN (?,?)").run(sell.id,buy.id);
            this.db.prepare("INSERT INTO market_operations VALUES (?,'swap',?,NULL,'reserved',NULL)").run(id,JSON.stringify({sell:sell.id,buy:buy.id,signed}));
          });
          op = this.db.prepare('SELECT * FROM market_operations WHERE id=?').get(id) as unknown as Operation; break;
        }
      }
      if (op) await this.process(op);
    } finally { this.running = false; }
  }
  private async process(op: Operation) {
    let tx: PreparedMarketTx;
    const data = JSON.parse(op.data) as DepositData & SwapData & ReturnData;
    try {
      if (!op.tx) {
        if (op.kind === 'deposit') {
          this.requireSettled(data.owner, data.token);
          tx = await this.chain.depositTransaction(data.action,data.signature!);
        }
        else {
          const signed = op.kind === 'swap' ? data.signed as unknown as SignedMarketIntent[] : [data.signed as unknown as SignedMarketIntent];
          await this.chain.simulate(signed);
          tx = await this.chain.executeTransaction(signed);
        }
        this.db.prepare("UPDATE market_operations SET tx=?,status='sent',error=NULL WHERE id=?").run(JSON.stringify(tx),op.id);
      } else tx = JSON.parse(op.tx) as PreparedMarketTx;
      const result = await this.chain.submit(tx,op.kind === 'deposit' ? data.action.contract : undefined);
      if (op.kind === 'deposit') {
        const used = result.failed ? 0 : result.used;
        if (used === undefined || used < 0 || used > data.amount) throw new Error('Deposit resolver result is unknown; retained for reconciliation');
        withSavepoint(this.db, () => {
          if (used < data.amount) this.physical(this.config.verifier,data.owner,data.token,data.amount-used,op.id);
          if (used) this.change(data.owner,data.token,used);
          this.finish(op.id,used ? 'settled':'refunded',tx.hash);
        });
      } else if (result.failed) {
        withSavepoint(this.db, () => {
          if (op.kind === 'swap') this.db.prepare("UPDATE market_offers SET status='refused' WHERE id IN (?,?)").run(data.sell,data.buy);
          this.finish(op.id,'failed',tx.hash);
        });
      } else if (result.receiptFailures && op.kind === 'return') {
        this.db.prepare("UPDATE market_operations SET status='review',error='Return receipt failed; reconcile verifier and token balances before releasing goods' WHERE id=?").run(op.id);
      } else withSavepoint(this.db, () => {
        if (op.kind === 'swap') this.applySwap(data,tx.hash);
        else { this.change(data.owner,data.token,-data.amount); this.physical(this.config.verifier,data.owner,data.token,data.amount,op.id); }
        this.finish(op.id,'settled',tx.hash);
      });
    } catch (error) {
      this.db.prepare('UPDATE market_operations SET error=? WHERE id=?').run(String(error).slice(0,500),op.id);
      throw error;
    }
  }
  /** A deposit spends the holder's balance on chain, so every earlier move of theirs must have settled first. */
  private requireSettled(owner: string, token: string) {
    const coin = this.itemFor(token) === null;
    const batches = coin ? 'chain_batches' : 'items_chain_batches';
    const settled = (this.db.prepare(`SELECT COALESCE(MAX(last_rowid), 0) AS r FROM ${batches} WHERE status = 'settled'`).get() as { r: number }).r;
    const waiting = coin
      ? this.db.prepare("SELECT 1 FROM ledger_entries WHERE rowid > ? AND chain_route = 'settle' AND reason != 'genesis' AND (sender = ? OR receiver = ?) LIMIT 1").get(settled, owner, owner)
      : this.db.prepare("SELECT 1 FROM item_ledger WHERE rowid > ? AND chain_route = 'settle' AND (from_id = ? OR to_id = ?) LIMIT 1").get(settled, owner, owner);
    if (waiting) throw new Error('Waiting for your carried goods to settle on NEAR before they go on the board');
  }

  private finish(id: string, status: string, hash: string) {
    this.db.prepare('UPDATE market_operations SET status=?,error=NULL WHERE id=?').run(status,id);
    for (const table of ['ledger_entries','item_ledger']) this.db.prepare(`UPDATE ${table} SET chain_tx=? WHERE ref_id=? AND chain_route='market'`).run(hash,id);
  }
  private applySwap(data: SwapData, hash: string) {
    const sell = this.offer(data.sell)!; const buy = this.offer(data.buy)!;
    const item = this.itemToken(sell.item);
    const legs: Array<[string,string,string,number]> = [
      [sell.owner,buy.owner,item,sell.quantity],
      [buy.owner,sell.owner,this.coinToken,sell.price],
      [buy.owner,this.config.treasury,this.coinToken,marketTax(buy.price,buy.lit_pair === 1)],
    ];
    for (const [from,to,token,amount] of legs) {
      this.change(from,token,-amount); this.change(to,token,amount);
      const id = randomUUID(); const itemId = this.itemFor(token);
      if (itemId === null) this.db.prepare("INSERT INTO ledger_entries (id,sender,receiver,amount,reason,ref_id,metadata,timestamp,chain_route,chain_tx) VALUES (?,?,?,?,'trade_payment',?,?,?,'market',?)").run(id,this.config.verifier,this.config.verifier,amount,hash,JSON.stringify({from,to,token}),Date.now(),hash);
      else this.db.prepare("INSERT INTO item_ledger (id,from_id,to_id,item_id,quantity,reason,ref_id,timestamp,chain_route,chain_tx) VALUES (?,?,?,?,?,'trade',?,?,'market',?)").run(id,this.config.verifier,this.config.verifier,itemId,amount,hash,Date.now(),hash);
    }
    this.db.prepare("UPDATE market_offers SET status='filled',tx_hash=? WHERE id IN (?,?)").run(hash,sell.id,buy.id);
  }
  private physical(from: string, to: string, token: string, amount: number, ref: string) {
    const item = this.itemFor(token);
    if (item === null) {
      if (getAccountBalance(from,this.db) < amount) throw new Error('Wait for enough carried CHROMA');
      const entry = recordTransaction({from,to,amount,reason:'trade_payment',refId:ref},this.db);
      this.db.prepare("UPDATE ledger_entries SET chain_route='market' WHERE id=?").run(entry.id);
    } else {
      if (getItemCount(from,item,this.db) < amount) throw new Error('Wait for enough carried items');
      this.db.prepare('UPDATE player_items SET quantity=quantity-? WHERE account_id=? AND item_id=?').run(amount,from,item);
      this.db.prepare('INSERT INTO player_items VALUES (?,?,?) ON CONFLICT(account_id,item_id) DO UPDATE SET quantity=quantity+excluded.quantity').run(to,item,amount);
      recordItemMove(this.db,from,to,{itemId:item,quantity:amount},'trade',ref,Date.now());
      this.db.prepare("UPDATE item_ledger SET chain_route='market' WHERE ref_id=?").run(ref);
    }
  }
}
