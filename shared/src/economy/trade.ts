import { TAX_RATES } from './constants.js';
import type { TradeTaxResult } from './types.js';

export type PlayerEconomyRole = 'Shaper' | 'Hush' | 'Vakna';

export function calculateTradeTax(
  amount: number,
  roleA: PlayerEconomyRole,
  roleB: PlayerEconomyRole,
): TradeTaxResult {
  if (amount <= 0) {
    return { taxRate: 0, taxAmount: 0, sellerReceives: 0 };
  }

  const isLitToLit = roleA === 'Shaper' && roleB === 'Shaper';
  const taxRate = isLitToLit ? TAX_RATES.litToLitTradeTax : TAX_RATES.dimTradeTax;
  const taxAmount = Math.max(1, Math.round(amount * taxRate));
  const sellerReceives = Math.max(0, amount - taxAmount);

  return {
    taxRate,
    taxAmount,
    sellerReceives,
  };
}
