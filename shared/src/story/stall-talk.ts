import type { Facts } from './speech.js';

/** The parts of a stall the keeper talks about, as the shop reads them from the server. */
export interface StallState {
  nation: string;
  /** 'open', 'broke_buying_paused' (short of coin: still sells, buys nothing from players) or 'closed'. */
  status: string;
  inventory: Record<string, { stock: number }>;
}

/** The parts of a buy quote that say why the price moved. */
export interface StallQuote {
  steps?: readonly { rule: string; effect: number }[];
}

/** Quote rules that move with trade (what players bought and sold lately, which shard colour floods in), not the stall's fixed level. */
const MARKET_RULES = new Set(['recent_demand', 'color_balance']);

/** The dialogue group of a stall's keeper: merchant_<nation>. */
export function merchantRole(nation: string): string {
  return `merchant_${nation.toLowerCase()}`;
}

/**
 * Facts about a stall for its keeper's "talk" rules: whether the purse is too short to buy, whether a shelf is bare, and whether trade has pushed the
 * buy prices up or down by more than `priceMoved` (0.1 = 10%) on average over the stocked shelves.
 */
export function stallFacts(stall: StallState, buyQuotes: readonly (StallQuote | null)[], priceMoved: number): Facts {
  const shelves = Object.values(stall.inventory);
  let sum = 0, n = 0;
  shelves.forEach((shelf, i) => {
    if (shelf.stock <= 0) return;
    let factor = 1;
    for (const step of buyQuotes[i]?.steps ?? []) if (MARKET_RULES.has(step.rule)) factor *= 1 + step.effect;
    sum += factor;
    n++;
  });
  const mean = n > 0 ? sum / n : 1;
  return {
    'stall.short': stall.status === 'broke_buying_paused',
    'stall.emptyShelf': shelves.some(s => s.stock <= 0),
    'stall.prices': mean >= 1 + priceMoved ? 'rising' : mean <= 1 - priceMoved ? 'falling' : 'steady',
  };
}
