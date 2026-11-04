import type { DatabaseSync } from 'node:sqlite';
import { atPlace, isValidQuantity, type LootPile, placesFor, TRADE_REACH } from '@elements/shared';
import { getActiveShopOwnership, getDatabase } from '../db.js';
import {
  addItems,
  buyFromMerchant,
  claimLootPile,
  depositToCountingHouse,
  executePlayerTrade,
  getAccountBalance,
  getMerchant,
  getSatchel,
  listLootPiles,
  quoteMerchantTrade,
  removeItems,
  sellToMerchant,
  withSavepoint,
  withdrawFromCountingHouse,
} from '../economy/index.js';
import { onKill, type KillReport } from './kill-hook.js';
import { dropForDeath, dropForKill, isGuest, isOutsider, lockedPurse, tradeableChroma } from './money.js';
import type { ServerPlayer, ZoneWorld } from './world.js';

/** A message for one player (`to`) or for everyone in the room. */
export type EconEvent =
  | { to: string; type: string; body: Record<string, unknown> }
  | { to?: undefined; type: string; body: Record<string, unknown> };

/** The parts of a pile a browser draws. */
export const pileView = (p: LootPile): Record<string, unknown> => ({
  id: p.id, x: p.x, z: p.z, contents: p.contents, ownerId: p.ownerId, ownerUntil: p.ownerUntil, expiresAt: p.expiresAt,
});

interface Offer {
  with: string;
  chroma: number;
  items: Record<string, number>;
  accepted: boolean;
}

/** Largest stack a single message may move. */
const MAX_QUANTITY = 1000;

const asRecord = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' ? raw as Record<string, unknown> : {});
const reqId = (m: Record<string, unknown>): number | null => (typeof m.req === 'number' && Number.isFinite(m.req) ? m.req : null);

/**
 * The room's door for everything that moves CHROMA or items. The account and position are
 * the room's own record for the connection; a message only says what the player chooses.
 */
export class ZoneEconomy {
  /** Unclaimed piles in this zone the room has told its players about. */
  readonly piles = new Map<string, LootPile>();
  private readonly offers = new Map<string, Offer>();
  private readonly stopKills: () => void;
  /** Events raised outside a message (a kill), waiting for the room to send them. */
  private pending: EconEvent[] = [];

  constructor(
    private readonly world: ZoneWorld,
    private readonly db: DatabaseSync = getDatabase(),
    private readonly clock: () => number = Date.now,
    private readonly rng: () => number = Math.random,
  ) {
    for (const p of listLootPiles({ zone: world.zone, now: clock() }, db)) this.piles.set(p.id, p);
    // Kills reach the economy only through the server's kill hook, and only this world's.
    this.stopKills = onKill((k) => { if (k.worldId === world.id) this.pending.push(...this.kill(k)); });
  }

  dispose(): void {
    this.stopKills();
  }

  /** Events raised since the last call, for the room to deliver. */
  drain(): EconEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** What a joining player is told: the piles lying in the zone and their own purse. */
  join(id: string): EconEvent[] {
    return [{ to: id, type: 'loot', body: { piles: [...this.piles.values()].map(pileView) } }, ...this.purse(id)];
  }

  leave(id: string): EconEvent[] {
    return this.cancelTrade(id);
  }

  /** The player's coin and satchel as the server holds them. Guests carry nothing. */
  purse(id: string): EconEvent[] {
    const p = this.world.players.get(id);
    if (!p) return [];
    if (isGuest(p.accountId)) return [{ to: id, type: 'purse', body: { guest: true, chroma: 0, items: {}, locked: 0 } }];
    const now = this.clock();
    return [{
      to: id,
      type: 'purse',
      body: { chroma: getAccountBalance(p.accountId, this.db), items: getSatchel(p.accountId, this.db), locked: lockedPurse(p.accountId, now, this.db) },
    }];
  }

  /** What a player carries, as robbers judge it. */
  carried(p: ServerPlayer): { chroma: number; weight: number } {
    if (isGuest(p.accountId)) return { chroma: 0, weight: 0 };
    const weight = Object.values(getSatchel(p.accountId, this.db)).reduce((a, b) => a + b, 0);
    return { chroma: getAccountBalance(p.accountId, this.db), weight };
  }

  kill(k: KillReport): EconEvent[] {
    const pile = dropForKill(k, this.rng, this.db);
    if (!pile) return [];
    this.piles.set(pile.id, pile);
    return [{ type: 'loot_new', body: { pile: pileView(pile) } }];
  }

  /** The room saw this player fall: their carried goods drop where the room has them. */
  death(id: string): EconEvent[] {
    const p = this.world.players.get(id);
    if (!p) return [];
    const pile = dropForDeath(p.accountId, this.world.zone, p.x, p.z, this.db);
    if (!pile) return [];
    this.piles.set(pile.id, pile);
    return [{ type: 'loot_new', body: { pile: pileView(pile) } }, ...this.purse(id)];
  }

  /** "Pick up pile N": checked against where the room has the player. */
  claim(id: string, raw: unknown): EconEvent[] {
    const m = asRecord(raw);
    const p = this.world.players.get(id);
    const pileId = typeof m.pile === 'string' ? m.pile : '';
    const fail = (error: string): EconEvent[] => [{ to: id, type: 'loot_result', body: { pile: pileId, ok: false, error } }];
    if (!p || !pileId) return fail('invalid_input');
    if (isGuest(p.accountId)) return fail('Sign in to keep what you find');
    if (!p.alive) return fail('You have fallen');
    if (!this.piles.has(pileId)) return fail('Loot pile not found');
    try {
      const { contents } = claimLootPile({ pileId, accountId: p.accountId, x: p.x, z: p.z, now: this.clock() }, this.db);
      this.piles.delete(pileId);
      return [
        { to: id, type: 'loot_result', body: { pile: pileId, ok: true, contents } },
        { type: 'loot_gone', body: { id: pileId, by: id } },
        ...this.purse(id),
      ];
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Claim failed';
      if (/already been claimed|expired|not found/.test(error)) {
        this.piles.delete(pileId);
        return [...fail(error), { type: 'loot_gone', body: { id: pileId } }];
      }
      return fail(error);
    }
  }

  /** Buy or sell at a stall the player is standing at. Outsider and price come from the server. */
  shop(id: string, raw: unknown): EconEvent[] {
    const m = asRecord(raw);
    const req = reqId(m);
    const p = this.world.players.get(id);
    const reply = (ok: boolean, data: Record<string, unknown>): EconEvent[] =>
      [{ to: id, type: 'econ_reply', body: { req, ok, ...data } }, ...(ok ? this.purse(id) : [])];
    const action = m.action === 'sell' ? 'sell' : m.action === 'buy' ? 'buy' : null;
    const merchantId = typeof m.merchant === 'string' ? m.merchant : '';
    const item = typeof m.item === 'string' ? m.item.slice(0, 64) : '';
    const quantity = typeof m.qty === 'number' ? m.qty : 1;
    if (!p || !action || !merchantId || !item) return reply(false, { error: 'invalid_input' });
    if (isGuest(p.accountId)) return reply(false, { error: 'Sign in to trade' });
    if (!isValidQuantity(quantity) || quantity > MAX_QUANTITY) return reply(false, { error: 'Invalid quantity' });
    const stall = placesFor(this.world.zone).stalls.find((s) => s.id === merchantId);
    if (!stall) return reply(false, { error: 'No such stall here' });
    if (!atPlace(stall, p.x, p.z)) return reply(false, { error: 'Stand at the stall to trade' });
    const merchant = getMerchant(merchantId, this.db);
    if (!merchant) return reply(false, { error: 'Merchant not found' });
    const outsider = isOutsider(p.accountId, merchant.nation, this.db);
    try {
      if (action === 'buy') {
        // Buying from a shop another player owns pays that player: the starting purse can't go there.
        const owner = getActiveShopOwnership(merchantId, this.db);
        if (owner?.active && owner.ownerId !== p.accountId) {
          const quote = quoteMerchantTrade({ merchantId, itemType: item, action: 'buy', quantity, isOutsider: outsider, buyerAccountId: p.accountId }, this.db);
          if (quote.canExecute && quote.totalPrice > tradeableChroma(p.accountId, this.clock(), this.db)) {
            return reply(false, { error: 'Your starting purse can only be spent at the town\'s own merchants for now' });
          }
        }
        const result = buyFromMerchant({ merchantId, buyerAccountId: p.accountId, itemType: item, quantity, isOutsider: outsider }, this.db);
        return reply(true, { result });
      }
      const result = sellToMerchant({ merchantId, sellerAccountId: p.accountId, itemType: item, quantity, isOutsider: outsider }, this.db);
      return reply(true, { result });
    } catch (err) {
      return reply(false, { error: err instanceof Error ? err.message : 'Trade failed' });
    }
  }

  /** Deposit at, or draw from, a counting house the player is standing in. */
  bank(id: string, raw: unknown): EconEvent[] {
    const m = asRecord(raw);
    const req = reqId(m);
    const p = this.world.players.get(id);
    const reply = (ok: boolean, data: Record<string, unknown>): EconEvent[] =>
      [{ to: id, type: 'econ_reply', body: { req, ok, ...data } }, ...(ok ? this.purse(id) : [])];
    const houseId = typeof m.house === 'string' ? m.house : '';
    if (!p || !houseId) return reply(false, { error: 'invalid_input' });
    if (isGuest(p.accountId)) return reply(false, { error: 'Sign in to bank' });
    const house = placesFor(this.world.zone).countingHouses.find((h) => h.id === houseId);
    if (!house) return reply(false, { error: 'No such counting house here' });
    if (!atPlace(house, p.x, p.z)) return reply(false, { error: 'Stand in the counting house' });
    try {
      if (m.action === 'deposit') {
        const amount = typeof m.amount === 'number' ? m.amount : NaN;
        if (!isValidQuantity(amount)) return reply(false, { error: 'Invalid amount' });
        const note = depositToCountingHouse({ accountId: p.accountId, amount, countingHouseId: house.id }, this.db);
        return reply(true, { note });
      }
      if (m.action === 'withdraw') {
        const noteId = typeof m.note === 'string' ? m.note : '';
        if (!noteId) return reply(false, { error: 'invalid_input' });
        const result = withdrawFromCountingHouse({ accountId: p.accountId, noteId, countingHouseId: house.id }, this.db);
        return reply(true, { ...result });
      }
      return reply(false, { error: 'invalid_input' });
    } catch (err) {
      return reply(false, { error: err instanceof Error ? err.message : 'Counting house refused' });
    }
  }

  // --- Trade hand to hand: both put up their side, both accept, the room swaps them at once. ---

  private tradeView(id: string): EconEvent[] {
    const mine = this.offers.get(id);
    if (!mine) return [{ to: id, type: 'trade', body: { open: false } }];
    const theirs = this.offers.get(mine.with);
    const side = (o: Offer | undefined) => (o && o.with === id ? { chroma: o.chroma, items: o.items, accepted: o.accepted } : null);
    return [{ to: id, type: 'trade', body: { open: true, with: mine.with, mine: { chroma: mine.chroma, items: mine.items, accepted: mine.accepted }, theirs: side(theirs) } }];
  }

  /** "I offer this to player X." Any change clears both acceptances. */
  offer(id: string, raw: unknown): EconEvent[] {
    const m = asRecord(raw);
    const p = this.world.players.get(id);
    const partnerId = typeof m.with === 'string' ? m.with : '';
    const partner = this.world.players.get(partnerId);
    const fail = (error: string): EconEvent[] => [{ to: id, type: 'trade', body: { open: false, error } }];
    if (!p || !partner || partnerId === id) return fail('No one to trade with');
    if (isGuest(p.accountId) || isGuest(partner.accountId)) return fail('Guests can\'t trade');
    if (p.accountId === partner.accountId) return fail('Cannot trade with oneself');
    const chroma = typeof m.chroma === 'number' ? m.chroma : 0;
    if (!(chroma === 0 || isValidQuantity(chroma))) return fail('Invalid amount');
    const items: Record<string, number> = {};
    for (const [itemId, n] of Object.entries(asRecord(m.items))) {
      if (typeof n !== 'number' || !isValidQuantity(n) || n > MAX_QUANTITY || itemId.length > 64) return fail('Invalid quantity');
      items[itemId] = n;
    }
    const now = this.clock();
    if (chroma > tradeableChroma(p.accountId, now, this.db)) return fail('Not enough coin you may trade');
    const satchel = getSatchel(p.accountId, this.db);
    for (const [itemId, n] of Object.entries(items)) if ((satchel[itemId] ?? 0) < n) return fail(`Not enough ${itemId}`);
    // A new offer to someone else drops the old one.
    const old = this.offers.get(id);
    const events: EconEvent[] = [];
    if (old && old.with !== partnerId) events.push(...this.cancelTrade(id));
    this.offers.set(id, { with: partnerId, chroma, items, accepted: false });
    const back = this.offers.get(partnerId);
    if (back?.with === id) back.accepted = false;
    return [...events, ...this.tradeView(id), ...this.tradeView(partnerId)];
  }

  accept(id: string): EconEvent[] {
    const mine = this.offers.get(id);
    if (!mine) return [{ to: id, type: 'trade', body: { open: false, error: 'No trade open' } }];
    const theirs = this.offers.get(mine.with);
    if (!theirs || theirs.with !== id) return [{ to: id, type: 'trade', body: { open: true, error: 'Waiting for their side' } }];
    mine.accepted = true;
    if (!theirs.accepted) return [...this.tradeView(id), ...this.tradeView(mine.with)];
    return this.settle(id, mine.with);
  }

  cancelTrade(id: string): EconEvent[] {
    const mine = this.offers.get(id);
    if (!mine) return [];
    this.offers.delete(id);
    const theirs = this.offers.get(mine.with);
    const events: EconEvent[] = [{ to: id, type: 'trade', body: { open: false } }];
    if (theirs?.with === id) {
      this.offers.delete(mine.with);
      events.push({ to: mine.with, type: 'trade', body: { open: false, error: 'They walked away' } });
    }
    return events;
  }

  /** Both accepted: check everything again from the room's own record, then swap in one step. */
  private settle(aId: string, bId: string): EconEvent[] {
    const a = this.world.players.get(aId);
    const b = this.world.players.get(bId);
    const oa = this.offers.get(aId)!;
    const ob = this.offers.get(bId)!;
    const fail = (error: string): EconEvent[] => {
      oa.accepted = false;
      ob.accepted = false;
      return [{ to: aId, type: 'trade', body: { open: true, error } }, { to: bId, type: 'trade', body: { open: true, error } }];
    };
    if (!a || !b) return this.cancelTrade(aId);
    if (!a.alive || !b.alive) return fail('A fallen player can\'t trade');
    if (Math.hypot(a.x - b.x, a.z - b.z) > TRADE_REACH) return fail('Stand together to trade');
    const now = this.clock();
    if (oa.chroma > tradeableChroma(a.accountId, now, this.db) || ob.chroma > tradeableChroma(b.accountId, now, this.db)) {
      return fail('Not enough coin you may trade');
    }
    const ref = `trade_${aId}_${bId}_${now}`;
    try {
      withSavepoint(this.db, () => {
        for (const [from, to, o] of [[a, b, oa], [b, a, ob]] as const) {
          if (o.chroma > 0) executePlayerTrade({ buyerId: from.accountId, sellerId: to.accountId, amount: o.chroma, refId: `${ref}:${from.accountId}` }, this.db);
          const stacks = Object.entries(o.items).map(([itemId, quantity]) => ({ itemId, quantity }));
          if (stacks.length === 0) continue;
          removeItems({ accountId: from.accountId, to: to.accountId, stacks, reason: 'trade', refId: ref, now }, this.db);
          addItems({ accountId: to.accountId, from: from.accountId, stacks, reason: 'trade', refId: ref, now }, this.db);
        }
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'Trade failed');
    }
    this.offers.delete(aId);
    this.offers.delete(bId);
    return [
      { to: aId, type: 'trade', body: { open: false, done: true } },
      { to: bId, type: 'trade', body: { open: false, done: true } },
      ...this.purse(aId),
      ...this.purse(bId),
    ];
  }

  /** Re-reads the zone's piles: any that expired or were taken elsewhere vanish, new ones appear. */
  refresh(): EconEvent[] {
    const live = new Map(listLootPiles({ zone: this.world.zone, now: this.clock() }, this.db).map((p) => [p.id, p]));
    const events: EconEvent[] = [];
    for (const id of this.piles.keys()) {
      if (!live.has(id)) {
        this.piles.delete(id);
        events.push({ type: 'loot_gone', body: { id } });
      }
    }
    for (const [id, pile] of live) {
      if (!this.piles.has(id)) {
        this.piles.set(id, pile);
        events.push({ type: 'loot_new', body: { pile: pileView(pile) } });
      }
    }
    return events;
  }
}
