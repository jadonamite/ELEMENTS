import { SHOPS_CONFIG, MERCHANT_CONFIG } from './constants.js';
import type { QuoteStep } from './types.js';

export interface ShopPurchaseValidationParams {
  buyerAccountId: string;
  shopId: string;
  isClosedOrForSale: boolean;
  buyerBalance: number;
  hasRedFlag: boolean;
  hasBounty: boolean;
  currentlyOwnedCount: number;
  salePrice?: number;
  maxPerPlayer?: number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// Validates whether a player is eligible to purchase a shop that is currently on sale.
export function validateShopPurchase(
  params: ShopPurchaseValidationParams,
): ValidationResult {
  const salePrice = params.salePrice ?? SHOPS_CONFIG.salePrice;
  const maxPerPlayer = params.maxPerPlayer ?? SHOPS_CONFIG.maxPerPlayer;

  if (!params.isClosedOrForSale) {
    return {
      valid: false,
      reason: 'Shop is not currently closed or listed for sale',
    };
  }

  if (params.hasRedFlag) {
    return {
      valid: false,
      reason: 'Players bearing a red flag are barred from acquiring merchant shops',
    };
  }

  if (params.hasBounty) {
    return {
      valid: false,
      reason: 'Hunted outlaws with an active bounty cannot own property in Sindr',
    };
  }

  if (params.currentlyOwnedCount >= maxPerPlayer) {
    return {
      valid: false,
      reason: `Players may own at most ${maxPerPlayer} shop at a time`,
    };
  }

  if (params.buyerBalance < salePrice) {
    return {
      valid: false,
      reason: `Insufficient CHROMA to buy shop: requires ${salePrice}, available ${params.buyerBalance}`,
    };
  }

  return { valid: true };
}

// Validates a price multiplier within the allowable bounds.
export function validatePriceMultiplier(
  multiplier: number,
  config?: { minPriceMultiplier?: number; maxPriceMultiplier?: number },
): ValidationResult {
  const min = config?.minPriceMultiplier ?? SHOPS_CONFIG.minPriceMultiplier;
  const max = config?.maxPriceMultiplier ?? SHOPS_CONFIG.maxPriceMultiplier;

  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
    return {
      valid: false,
      reason: 'Price multiplier must be a valid finite number',
    };
  }

  if (multiplier < min || multiplier > max) {
    return {
      valid: false,
      reason: `Price multiplier ${multiplier} is outside allowed range [${min}, ${max}]`,
    };
  }

  return { valid: true };
}

// Validates a full dictionary of price multipliers for shop items.
export function validatePriceMultipliers(
  multipliers: Record<string, number>,
  config?: { minPriceMultiplier?: number; maxPriceMultiplier?: number },
): ValidationResult & { sanitized?: Record<string, number> } {
  if (!multipliers || typeof multipliers !== 'object' || Array.isArray(multipliers)) {
    return {
      valid: false,
      reason: 'Price multipliers must be an object mapping item types to numeric multipliers',
    };
  }

  const sanitized: Record<string, number> = {};
  for (const [itemType, mult] of Object.entries(multipliers)) {
    const check = validatePriceMultiplier(mult, config);
    if (!check.valid) {
      return {
        valid: false,
        reason: `Invalid multiplier for ${itemType}: ${check.reason}`,
      };
    }
    sanitized[itemType] = Number(mult.toFixed(4));
  }

  return { valid: true, sanitized };
}

// Applies the owner's price multiplier to a base rule quote price.
export function applyOwnerPriceMultiplier(
  baseQuotePrice: number,
  multiplier?: number,
): { price: number; step?: QuoteStep } {
  if (multiplier === undefined || multiplier === null) {
    return { price: baseQuotePrice };
  }

  const effectivePrice = Math.max(1, Math.round(baseQuotePrice * multiplier));
  const step: QuoteStep = {
    rule: 'owner_multiplier',
    effect: multiplier - 1,
    words: 'The owner sets this price.',
  };

  return { price: effectivePrice, step };
}

// Evaluates shop sale window status and checks whether the listing has expired unsold.
export function checkShopSaleExpiry(params: {
  daysOnSale: number;
  saleDays?: number;
}): { expired: boolean; remainingDays: number } {
  const saleDays = params.saleDays ?? SHOPS_CONFIG.saleDays;
  const remainingDays = Math.max(0, saleDays - params.daysOnSale);
  const expired = params.daysOnSale >= saleDays;
  return { expired, remainingDays };
}

// Evaluates whether a player-owned shop has forfeited ownership due to unpaid daily upkeep.
export function checkUpkeepStatus(params: {
  unpaidDays: number;
  maxUnpaidDays?: number;
}): { forfeited: boolean; remainingDays: number } {
  const maxUnpaidDays =
    params.maxUnpaidDays ?? SHOPS_CONFIG.unpaidUpkeepDaysToForfeit;
  const remainingDays = Math.max(0, maxUnpaidDays - params.unpaidDays);
  const forfeited = params.unpaidDays >= maxUnpaidDays;
  return { forfeited, remainingDays };
}

// Validates a stock deposit into the shop's inventory.
export function validateStockDeposit(params: {
  itemType: string;
  quantity: number;
}): ValidationResult {
  if (!params.itemType || typeof params.itemType !== 'string') {
    return { valid: false, reason: 'Invalid or missing item type' };
  }
  if (
    typeof params.quantity !== 'number' ||
    !Number.isInteger(params.quantity) ||
    params.quantity <= 0
  ) {
    return {
      valid: false,
      reason: 'Deposit quantity must be a positive integer',
    };
  }
  return { valid: true };
}

// Validates a profit withdrawal from the shop purse to the owner.
export function validateWithdrawal(params: {
  merchantBalance: number;
  requestedAmount?: number | undefined;
}): ValidationResult & { amount: number } {
  const amount =
    params.requestedAmount !== undefined
      ? params.requestedAmount
      : params.merchantBalance;

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return {
      valid: false,
      amount: 0,
      reason: 'Withdrawal amount must be a positive integer',
    };
  }

  if (amount > params.merchantBalance) {
    return {
      valid: false,
      amount: 0,
      reason: `Cannot withdraw ${amount} CHROMA: shop purse only holds ${params.merchantBalance}`,
    };
  }

  return { valid: true, amount };
}
