import { AGENT_CONFIG, MERCHANT_CONFIG, formatItemDisplay } from '@elements/shared';
import type { QueuedEventOptions } from '../plans/eventQueue.js';
import { keepersIn, merchantsFor, mindPlaces, shopsNear, stockKeys } from '../minds.js';

/**
 * Where the game's own events reach the minds. The economy and the rooms call these after something has
 * happened; each one only queues a line for the minds that would notice (never a model call). Events name what
 * happened and how far away, never which player.
 */
export type AgentEventSink = (place: string, agentId: string, event: QueuedEventOptions & { timestamp: number }) => void;

let sink: AgentEventSink | null = null;

/** Sets where events go (the running mind loop); returns a function that removes it. */
export function setAgentEventSink(next: AgentEventSink): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = null;
  };
}

function emit(place: string, agentId: string, event: QueuedEventOptions & { timestamp: number }): void {
  if (!sink) return;
  try {
    sink(place, agentId, event);
  } catch (err) {
    console.error('Agent event sink failed:', err);
  }
}

/** An item's name in the town's words, by its own colour (shard_aques reads as Azure shards). */
function itemName(itemType: string): string {
  const colour = /^shard_([a-z]+)$/.exec(itemType)?.[1];
  return formatItemDisplay(itemType, colour ? colour.toUpperCase() : 'IGNIS');
}

/** The place a merchant trades in, from the world data. */
export function placeOfMerchant(merchantId: string): string | null {
  return mindPlaces().find((p) => merchantsFor(p).some((m) => m.id === merchantId)) ?? null;
}

/** Keepers in the same place who carry a stock key, other than `except`. */
function rivals(place: string, stockKey: string, except: string): string[] {
  return keepersIn(place)
    .filter((k) => k.id !== except && k.merchant && stockKeys(k.merchant).includes(stockKey))
    .map((k) => k.id);
}

/** Robbers struck, or someone took a fallen traveller's goods, at (x, z): news to every keeper near enough. */
export function reportCrimeNear(params: { zone: string; x: number; z: number; kind: 'robbery' | 'theft'; now: number }): string[] {
  const told: string[] = [];
  const keepers = new Set(keepersIn(params.zone).map((k) => k.id));
  for (const shop of shopsNear(params.zone, params.x, params.z, AGENT_CONFIG.events.nearStallMetres)) {
    if (!keepers.has(shop.id)) continue;
    const metres = Math.round(shop.distance);
    emit(params.zone, shop.id, {
      tier: 'significant',
      type: params.kind,
      description: params.kind === 'robbery'
        ? `Robbers attacked a traveller ${metres} m from your counter.`
        : `Someone carried off a fallen traveller's goods ${metres} m from your counter.`,
      metadata: { metres },
      timestamp: params.now,
    });
    told.push(shop.id);
  }
  return told;
}

/** The last buy price each rival heard for a merchant's stock key. */
const heardPrice = new Map<string, number>();

export interface TradeReport {
  merchantId: string;
  action: 'buy' | 'sell';
  itemType: string;
  stockKey: string;
  quantity: number;
  purseBefore: number;
  purseAfter: number;
  /** Net units of this item sold to the merchant in the demand window, before and after this trade. */
  netSoldBefore: number;
  netSoldAfter: number;
  /** The merchant's buy price for one unit of the stock key after this trade. */
  unitPrice: number;
  now: number;
}

/**
 * A trade at a counter. The sale itself is ordinary (folded into the keeper's next plan). Crossing the broke
 * warning line, a flood of one colour past the threshold, and a price swing that rivals would notice are
 * significant and mark the keepers dirty.
 */
export function reportMerchantTrade(t: TradeReport): void {
  const place = placeOfMerchant(t.merchantId);
  if (!place) return;
  const what = itemName(t.itemType);

  emit(place, t.merchantId, {
    tier: 'ordinary',
    type: t.action === 'buy' ? 'sale' : 'purchase',
    description: t.action === 'buy' ? `Sold ${t.quantity} ${what} to a customer.` : `Bought ${t.quantity} ${what} from a customer.`,
    timestamp: t.now,
  });

  const warn = MERCHANT_CONFIG.brokeThreshold * AGENT_CONFIG.events.brokeWarnRatio;
  if (t.purseBefore >= warn && t.purseAfter < warn) {
    emit(place, t.merchantId, {
      tier: 'significant',
      type: 'purse_low',
      description: `Your purse fell to ${t.purseAfter} CHROMA, near the broke line of ${MERCHANT_CONFIG.brokeThreshold}.`,
      metadata: { purse: t.purseAfter },
      timestamp: t.now,
    });
  }

  const flood = AGENT_CONFIG.events.floodNet;
  if (t.netSoldBefore < flood && t.netSoldAfter >= flood) {
    const shop = merchantsFor(place).find((m) => m.id === t.merchantId)?.name ?? 'a counter nearby';
    const line = `${what} are flooding in: ${t.netSoldAfter} more sold than bought at ${shop} lately.`;
    for (const id of [t.merchantId, ...rivals(place, t.stockKey, t.merchantId)]) {
      emit(place, id, { tier: 'significant', type: 'flood', description: line, metadata: { itemType: t.itemType, net: t.netSoldAfter }, timestamp: t.now });
    }
  }

  notePrice(place, t.merchantId, t.stockKey, t.unitPrice, t.now);
}

/** A rival's price moved past the swing threshold since the others last heard it: a price war. */
function notePrice(place: string, merchantId: string, stockKey: string, price: number, now: number): void {
  const key = `${merchantId}:${stockKey}`;
  const last = heardPrice.get(key);
  if (last === undefined) {
    heardPrice.set(key, price);
    return;
  }
  if (last <= 0 || Math.abs(price - last) / last < AGENT_CONFIG.events.priceSwing) return;
  heardPrice.set(key, price);
  const shop = merchantsFor(place).find((m) => m.id === merchantId)?.name ?? merchantId;
  const direction = price < last ? 'cut' : 'raised';
  for (const id of rivals(place, stockKey, merchantId)) {
    emit(place, id, {
      tier: 'significant',
      type: 'rival_price',
      description: `${shop} ${direction} its ${formatItemDisplay(stockKey)} price from ${last} to ${price}.`,
      metadata: { rival: merchantId, from: last, to: price, stockKey },
      timestamp: now,
    });
  }
}

/** A shop's owner set new price multipliers: rivals stocking those goods hear of it. */
export function reportPricesSet(params: { merchantId: string; multipliers: Record<string, number>; now: number }): void {
  const place = placeOfMerchant(params.merchantId);
  if (!place) return;
  const shop = merchantsFor(place).find((m) => m.id === params.merchantId)?.name ?? params.merchantId;
  for (const [stockKey, mult] of Object.entries(params.multipliers)) {
    if (Math.abs(mult - 1) < AGENT_CONFIG.events.priceSwing) continue;
    for (const id of rivals(place, stockKey, params.merchantId)) {
      emit(place, id, {
        tier: 'significant',
        type: 'rival_price',
        description: `${shop} now asks ${Math.round(mult * 100)}% of the usual price for ${formatItemDisplay(stockKey)}.`,
        metadata: { rival: params.merchantId, multiplier: mult, stockKey },
        timestamp: params.now,
      });
    }
  }
}

/** Forgets the prices rivals heard (tests). */
export function resetHeardPrices(): void {
  heardPrice.clear();
}
