import { EconomyError, buy, claimLoot, sell, type LootContents } from './api.js';

/** The result of a stall trade, as the merchant service reports it. */
export interface StallResult {
  totalPrice: number;
  itemId?: string;
}

/**
 * Where the player's money moves. Offline it is the server's HTTP routes; online it is the
 * zone room, which knows who and where the player is, so a message only names the choice.
 */
export interface MoneyDoor {
  readonly online: boolean;
  claim(pileId: string, x: number, z: number): Promise<LootContents>;
  trade(action: 'buy' | 'sell', merchantId: string, item: string, quantity: number): Promise<StallResult>;
}

export const httpDoor: MoneyDoor = {
  online: false,
  claim: async (pileId, x, z) => (await claimLoot(pileId, x, z)).contents,
  trade: (action, merchantId, item, quantity) => (action === 'buy' ? buy(merchantId, item, quantity) : sell(merchantId, item, quantity)),
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
  }

  claim(pileId: string): Promise<LootContents> {
    return this.ask(this.claims, pileId, 'loot_claim', { pile: pileId }).then((body) => body.contents as LootContents);
  }

  trade(action: 'buy' | 'sell', merchantId: string, item: string, quantity: number): Promise<StallResult> {
    const req = this.nextReq++;
    return this.ask(this.replies, req, 'shop', { req, action, merchant: merchantId, item, qty: quantity })
      .then((body) => body.result as StallResult);
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
