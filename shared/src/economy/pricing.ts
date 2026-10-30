import { MERCHANT_CONFIG } from './constants.js';
import type { MerchantInventoryItem, MerchantState } from './types.js';

export function calculateMerchantPrice(
  basePrice: number,
  stock: number,
  maxStock: number,
  colorMod = 1.0,
): number {
  if (basePrice <= 0) return 0;
  const safeMax = Math.max(1, maxStock);
  const clampedStock = Math.max(0, Math.min(stock, safeMax));
  const scarcity = 1 - clampedStock / safeMax;
  const rawPrice = basePrice * (1 + 2 * scarcity) * colorMod;
  return Math.max(1, Math.round(rawPrice));
}

export interface QuoteParams {
  itemType: string;
  action: 'buy' | 'sell';
  stock: number;
  maxStock: number;
  basePrice: number;
  isOutsider?: boolean;
  colorMod?: number;
  npcMemoryScore?: number;
}

export function calculateQuote(params: QuoteParams): {
  unitPrice: number;
  canExecute: boolean;
  reason?: string;
} {
  const {
    action,
    stock,
    maxStock,
    basePrice,
    isOutsider = false,
    colorMod = 1.0,
    npcMemoryScore = 0,
  } = params;

  if (action === 'buy' && stock <= 0) {
    return { unitPrice: 0, canExecute: false, reason: 'Out of stock' };
  }

  const baseQuote = calculateMerchantPrice(basePrice, stock, maxStock, colorMod);

  let finalPrice = baseQuote;

  if (action === 'buy') {
    // Player buying from merchant
    if (isOutsider) {
      finalPrice = Math.round(finalPrice * (1 + MERCHANT_CONFIG.outsiderBuySurcharge));
    }
    if (npcMemoryScore > 30) {
      const discount = Math.min(0.1, ((npcMemoryScore - 30) / 70) * 0.1);
      finalPrice = Math.round(finalPrice * (1 - discount));
    } else if (npcMemoryScore < -30) {
      const surcharge = Math.min(0.25, (Math.abs(npcMemoryScore + 30) / 70) * 0.25);
      finalPrice = Math.round(finalPrice * (1 + surcharge));
    }
    finalPrice = Math.max(1, finalPrice);
  } else {
    // Player selling to merchant
    // Merchant buying base is typically around half to 80% of current retail price, but by default sell margin:
    let sellPrice = Math.round(baseQuote * 0.8);
    if (isOutsider) {
      sellPrice = Math.round(sellPrice * (1 - MERCHANT_CONFIG.outsiderSellDiscount));
    }
    if (npcMemoryScore > 30) {
      const bonus = Math.min(0.08, ((npcMemoryScore - 30) / 70) * 0.08);
      sellPrice = Math.round(sellPrice * (1 + bonus));
    } else if (npcMemoryScore < -30) {
      const penalty = Math.min(0.15, (Math.abs(npcMemoryScore + 30) / 70) * 0.15);
      sellPrice = Math.round(sellPrice * (1 - penalty));
    }
    finalPrice = Math.max(1, sellPrice);
  }

  return { unitPrice: finalPrice, canExecute: true };
}

export function updateMerchantSolvency(
  merchant: MerchantState,
  dayTick = false,
): { state: MerchantState; reopened: boolean; bailoutNeeded: boolean } {
  let { balance, status, daysBroke } = merchant;
  let reopened = false;
  let bailoutNeeded = false;

  if (balance < MERCHANT_CONFIG.brokeThreshold) {
    if (status === 'open') {
      status = 'broke_buying_paused';
    }
    if (dayTick) {
      daysBroke += 1;
      if (daysBroke >= MERCHANT_CONFIG.closureDays) {
        status = 'closed';
      }
    }
  } else {
    if (status === 'broke_buying_paused') {
      status = 'open';
      daysBroke = 0;
    }
  }

  return {
    state: {
      ...merchant,
      balance,
      status,
      daysBroke,
    },
    reopened,
    bailoutNeeded,
  };
}

export function applyMerchantBailout(merchant: MerchantState): MerchantState {
  return {
    ...merchant,
    balance: merchant.balance + MERCHANT_CONFIG.bailoutGrant,
    status: 'open',
    daysBroke: 0,
  };
}
