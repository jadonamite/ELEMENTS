import {
  EconomyError,
  buy,
  claimLoot,
  depositCountingHouse,
  fetchAccountNotes,
  sell,
  setWornArmour,
  withdrawCountingHouse,
  type CountingHouseNote,
  type LootContents,
} from './api.js';

/** The result of a stall trade, as the merchant service reports it. */
export interface StallResult {
  totalPrice: number;
  itemId?: string;
}

export interface TradeSide {
  chroma: number;
  items: Record<string, number>;
  accepted: boolean;
}

export interface TradeState {
  open: boolean;
  with?: string;
  mine?: TradeSide;
  theirs?: TradeSide | null;
  error?: string;
  done?: boolean;
  incoming?: string;
}

/**
 * Where the player's money moves. Offline it is the server's HTTP routes; online it is the
 * zone room, which knows who and where the player is, so a message only names the choice.
 */
export interface MoneyDoor {
  readonly online: boolean;
  claim(pileId: string, x: number, z: number): Promise<LootContents>;
  trade(action: 'buy' | 'sell', merchantId: string, item: string, quantity: number): Promise<StallResult>;
  deposit(houseId: string, amount: number): Promise<CountingHouseNote>;
  withdraw(houseId: string, noteId: string): Promise<{ withdrawnAmount: number; note: CountingHouseNote }>;
  notes(houseId: string, accountId?: string): Promise<CountingHouseNote[]>;
  offerTrade(partnerId: string, chroma: number, items: Record<string, number>): void;
  acceptTrade(): void;
  cancelTrade(): void;
  listenTrade(listener: ((state: TradeState) => void) | null): void;
  wear(item: string | null): Promise<{ item: string | null; outfit: string; armour: number }>;
}

export const httpDoor: MoneyDoor = {
  online: false,
  claim: async (pileId, x, z) => (await claimLoot(pileId, x, z)).contents,
  trade: (action, merchantId, item, quantity) => (action === 'buy' ? buy(merchantId, item, quantity) : sell(merchantId, item, quantity)),
  deposit: async (houseId, amount) => (await depositCountingHouse(houseId, amount)).note,
  withdraw: (houseId, noteId) => withdrawCountingHouse(houseId, noteId),
  notes: (_houseId, accountId) => (accountId ? fetchAccountNotes(accountId) : Promise.resolve([])),
  offerTrade: () => {},
  acceptTrade: () => {},
  cancelTrade: () => {},
  listenTrade: () => {},
  wear: (item) => setWornArmour(item),
};

/** The part of the room connection the money needs. */
export interface RoomChannel {
  on(type: string, handler: (message: unknown) => void): void;
  send(type: string, message: unknown): void;
}

const ANSWER_TIMEOUT_MS = 8000;

/** The room's money messages, each answer matched to its question. */
export class RoomDoor implements MoneyDoor {
  readonly online = true;
  private nextReq = 1;
  private readonly replies = new Map<number, (body: Record<string, unknown>) => void>();
  private readonly claims = new Map<string, (body: Record<string, unknown>) => void>();
  private readonly wearResolvers: Array<(body: { item?: string | null; outfit?: string; armour?: number; error?: string }) => void> = [];
  private tradeListener: ((state: TradeState) => void) | null = null;

  constructor(private readonly room: RoomChannel) {
    room.on('econ_reply', (m) => {
      const body = m as Record<string, unknown>;
      const answer = this.replies.get(body.req as number);
      this.replies.delete(body.req as number);
      answer?.(body);
    });
    room.on('loot_result', (m) => {
      const body = m as Record<string, unknown>;
      const answer = this.claims.get(body.pile as string);
      this.claims.delete(body.pile as string);
      answer?.(body);
    });
    room.on('trade', (m) => {
      this.tradeListener?.(m as TradeState);
    });
    room.on('outfit', (m) => {
      const body = m as { item?: string | null; outfit?: string; armour?: number; error?: string };
      const resolver = this.wearResolvers.shift();
      resolver?.(body);
    });
  }

  claim(pileId: string): Promise<LootContents> {
    return this.ask(this.claims, pileId, 'loot_claim', { pile: pileId }).then((body) => body.contents as LootContents);
  }

  trade(action: 'buy' | 'sell', merchantId: string, item: string, quantity: number): Promise<StallResult> {
    const req = this.nextReq++;
    return this.ask(this.replies, req, 'shop', { req, action, merchant: merchantId, item, qty: quantity })
      .then((body) => body.result as StallResult);
  }

  deposit(houseId: string, amount: number): Promise<CountingHouseNote> {
    const req = this.nextReq++;
    return this.ask(this.replies, req, 'bank', { req, house: houseId, action: 'deposit', amount })
      .then((body) => body.note as CountingHouseNote);
  }

  withdraw(houseId: string, noteId: string): Promise<{ withdrawnAmount: number; note: CountingHouseNote }> {
    const req = this.nextReq++;
    return this.ask(this.replies, req, 'bank', { req, house: houseId, action: 'withdraw', note: noteId })
      .then((body) => body as unknown as { withdrawnAmount: number; note: CountingHouseNote });
  }

  notes(houseId: string): Promise<CountingHouseNote[]> {
    const req = this.nextReq++;
    return this.ask(this.replies, req, 'bank', { req, house: houseId, action: 'notes' })
      .then((body) => ((body.notes as CountingHouseNote[]) ?? []));
  }

  offerTrade(partnerId: string, chroma: number, items: Record<string, number>): void {
    this.room.send('trade_offer', { with: partnerId, chroma, items });
  }

  acceptTrade(): void {
    this.room.send('trade_accept', {});
  }

  cancelTrade(): void {
    this.room.send('trade_cancel', {});
  }

  listenTrade(listener: ((state: TradeState) => void) | null): void {
    this.tradeListener = listener;
  }

  wear(item: string | null): Promise<{ item: string | null; outfit: string; armour: number }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.wearResolvers.indexOf(handle);
        if (idx !== -1) this.wearResolvers.splice(idx, 1);
        reject(new EconomyError('The world server did not answer', 504));
      }, ANSWER_TIMEOUT_MS);
      const handle = (body: { item?: string | null; outfit?: string; armour?: number; error?: string }): void => {
        clearTimeout(timer);
        if (body.error) reject(new EconomyError(body.error, 400));
        else resolve({ item: body.item ?? null, outfit: body.outfit ?? 'rags', armour: body.armour ?? 0 });
      };
      this.wearResolvers.push(handle);
      this.room.send('wear', { item });
    });
  }

  private ask<K>(waiting: Map<K, (body: Record<string, unknown>) => void>, key: K, type: string, message: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(key);
        reject(new EconomyError('The world server did not answer', 504));
      }, ANSWER_TIMEOUT_MS);
      waiting.set(key, (body) => {
        clearTimeout(timer);
        if (body.ok) resolve(body);
        else reject(new EconomyError(String(body.error ?? 'Refused'), 400));
      });
      this.room.send(type, message);
    });
  }
}
