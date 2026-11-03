import { MERCHANT_CONFIG } from './constants.js';
import type {
  MerchantInventoryItem,
  MerchantState,
  Quote,
  QuoteStep,
  DemandWindow,
  ShardSaleEntry,
} from './types.js';
import {
  calculateMerchantPrice as rulesCalculateMerchantPrice,
  evaluateMerchantQuote,
} from './merchantRules.js';

export function calculateMerchantPrice(
  basePrice: number,
  stock: number,
  maxStock: number,
  colorMod = 1.0,
): number {
  return rulesCalculateMerchantPrice(basePrice, stock, maxStock, colorMod);
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
  demandWindow?: DemandWindow;
  shardSales?: Record<string, number> | ShardSaleEntry[];
  now?: number;
  nation?: string;
}

export function calculateQuote(params: QuoteParams): Quote {
  return evaluateMerchantQuote(params);
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
