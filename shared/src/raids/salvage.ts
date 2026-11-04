import type { Bag, ItemKindDef, SalvageConfig } from './config.js';

export interface SalvageState {
  id: string;
  purse: number;
  holdings: Bag;
  /** Today's discount under base price, set by the buyer's own decision inside the rule band. */
  discount: number;
}

export interface SalvageQuote {
  kind: string;
  unitPrice: number;
  /** How many it will take at that price right now. */
  accepts: number;
  reason?: string;
}

const held = (s: SalvageState, kinds: Record<string, ItemKindDef>, category: string): number =>
  Object.entries(s.holdings).reduce((n, [k, q]) => n + (kinds[k]?.kind === category ? q : 0), 0);

/**
 * The general market's offer (AGENTS 2): base price less today's discount, less more as it fills up,
 * and always under the best merchant price for that kind. It refuses only when full or out of coin.
 */
export function salvageQuote(s: SalvageState, kind: string, qty: number, kinds: Record<string, ItemKindDef>, cfg: SalvageConfig, bestMerchant?: number): SalvageQuote {
  const def = kinds[kind];
  if (!def) return { kind, unitPrice: 0, accepts: 0, reason: 'Not something the buyer knows' };
  const cap = cfg.maxHold[def.kind] ?? 0;
  const have = held(s, kinds, def.kind);
  const room = Math.max(0, cap - have);
  if (room === 0) return { kind, unitPrice: 0, accepts: 0, reason: `Full up on ${def.kind}s today` };
  const fill = have / Math.max(1, cap);
  let unit = def.basePrice * (1 - s.discount) * (1 - cfg.holdPenalty * fill);
  if (bestMerchant !== undefined) unit = Math.min(unit, bestMerchant * (1 - cfg.underBestMerchant));
  const unitPrice = Math.max(1, Math.floor(unit));
  const affordable = Math.floor(s.purse / unitPrice);
  const accepts = Math.min(qty, room, affordable);
  return accepts > 0 ? { kind, unitPrice, accepts } : { kind, unitPrice, accepts: 0, reason: 'Out of coin until the stock moves on' };
}

export type SalvageAction =
  | { type: 'set_discount'; discount: number }
  | { type: 'ship_onward'; kind: string; quantity: number };

export function validateSalvageAction(s: SalvageState, a: SalvageAction, cfg: SalvageConfig): { valid: boolean; reason?: string } {
  if (a.type === 'set_discount') {
    return a.discount >= cfg.minDiscount && a.discount <= cfg.maxDiscount ? { valid: true } : { valid: false, reason: 'Discount outside the band' };
  }
  if (a.type === 'ship_onward') {
    return Number.isInteger(a.quantity) && a.quantity > 0 && (s.holdings[a.kind] ?? 0) >= a.quantity ? { valid: true } : { valid: false, reason: 'Not holding that many' };
  }
  return { valid: false, reason: 'Unknown action' };
}

/**
 * The buyer's daily decision: discount deeper the fuller it is (it pays less when it has plenty),
 * and ship stock onward to the merchants once a category passes the line, to free room and recover coin.
 */
export function decideSalvage(s: SalvageState, kinds: Record<string, ItemKindDef>, cfg: SalvageConfig): { actions: SalvageAction[]; reasoning: string } {
  const actions: SalvageAction[] = [];
  const fills = (['material', 'shard', 'gear'] as const).map((c) => held(s, kinds, c) / Math.max(1, cfg.maxHold[c]));
  const fullest = Math.max(...fills);
  const discount = Math.round((cfg.minDiscount + (cfg.maxDiscount - cfg.minDiscount) * fullest) * 100) / 100;
  if (Math.abs(discount - s.discount) >= 0.01) actions.push({ type: 'set_discount', discount });
  for (const [k, q] of Object.entries(s.holdings)) {
    const def = kinds[k];
    if (!def) continue;
    if (held(s, kinds, def.kind) / Math.max(1, cfg.maxHold[def.kind]) > cfg.shipOnwardAbove && q > 0) {
      actions.push({ type: 'ship_onward', kind: k, quantity: Math.ceil(q / 2) });
    }
  }
  return { actions, reasoning: fullest > 0.5 ? 'The back room is filling; offers drop until the carts take some away.' : 'Room to spare; buying at a fair cut.' };
}
