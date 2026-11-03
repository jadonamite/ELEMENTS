import {
  MERCHANT_CONFIG,
  DEMAND_CONFIG,
  COLOR_BALANCE_CONFIG,
  TAX_RATES,
} from './constants.js';
import type {
  DemandEntry,
  DemandWindow,
  QuoteStep,
  Quote,
  ShardSaleEntry,
} from './types.js';
import {
  voiceScarcity,
  voiceDemand,
  voiceColorBalance,
  voiceOutsider,
  voiceNpcMemory,
} from './merchantVoice.js';

export const ELEMENT_COUNTERS: Record<string, string> = {
  IGNIS: 'AQUES',
  AQUES: 'TERRA',
  TERRA: 'AURA',
  AURA: 'IGNIS',
};

export const ELEMENT_COLORS: Record<string, string> = {
  IGNIS: 'Crimson',
  AQUES: 'Azure',
  TERRA: 'Ochre',
  AURA: 'Pale white',
};

export function getElementFromItemType(itemType: string, fallbackNation?: string): string | null {
  const normalized = itemType.toLowerCase();
  if (normalized.includes('ignis') || normalized.includes('crimson')) return 'IGNIS';
  if (normalized.includes('aques') || normalized.includes('azure')) return 'AQUES';
  if (normalized.includes('terra') || normalized.includes('ochre')) return 'TERRA';
  if (normalized.includes('aura') || normalized.includes('white')) return 'AURA';
  if (normalized === 'shard' && fallbackNation) {
    const nationUpper = fallbackNation.toUpperCase();
    if (ELEMENT_COUNTERS[nationUpper]) return nationUpper;
  }
  return null;
}

// Low stock makes goods cost more; full shelves bring the price down to base.
export function calculateScarcityPrice(
  basePrice: number,
  stock: number,
  maxStock: number,
): { price: number; scarcity: number; factor: number } {
  if (basePrice <= 0) return { price: 0, scarcity: 0, factor: 0 };
  const safeMax = Math.max(1, maxStock);
  const clampedStock = Math.max(0, Math.min(stock, safeMax));
  const scarcity = 1 - clampedStock / safeMax;
  const factor = 1 + 2 * scarcity;
  const price = Math.max(1, Math.round(basePrice * factor));
  return { price, scarcity, factor };
}

// Records a player trade in the rolling demand window.
export function recordDemand(
  window: DemandWindow | undefined,
  itemTypeOrEntry: string | { itemType: string; action: 'buy' | 'sell'; quantity: number; timestamp: number },
  actionOrNow?: 'buy' | 'sell' | number,
  quantity?: number,
  timestamp?: number,
): DemandWindow {
  const result: DemandWindow = {};
  if (window) {
    for (const [key, entries] of Object.entries(window)) {
      result[key] = [...entries];
    }
  }

  let itemType: string;
  let action: 'buy' | 'sell';
  let qty: number;
  let time: number;

  if (typeof itemTypeOrEntry === 'object') {
    itemType = itemTypeOrEntry.itemType;
    action = itemTypeOrEntry.action;
    qty = itemTypeOrEntry.quantity;
    time = itemTypeOrEntry.timestamp;
  } else {
    itemType = itemTypeOrEntry;
    action = actionOrNow as 'buy' | 'sell';
    qty = quantity ?? 1;
    time = timestamp ?? 0;
  }

  const list = result[itemType] ?? [];
  list.push({
    action,
    quantity: qty,
    timestamp: time,
  });
  result[itemType] = list;

  return result;
}

// Heavy buying by players drives prices up; heavy selling floods the stalls and drives prices down.
export function calculateDemandFactor(
  window: DemandWindow | undefined,
  itemType: string,
  action: 'buy' | 'sell',
  maxStock: number,
  now: number,
): { factor: number; netUnits: number } {
  if (!window) return { factor: 1.0, netUnits: 0 };

  let entries = window[itemType];
  if (!entries && Array.isArray(window)) {
    entries = window as unknown as DemandEntry[];
  }
  if (!entries || entries.length === 0) {
    return { factor: 1.0, netUnits: 0 };
  }

  const cutoff = now - DEMAND_CONFIG.windowMs;
  let soldByPlayers = 0;
  let boughtByPlayers = 0;

  for (const entry of entries) {
    if (entry.timestamp >= cutoff && entry.timestamp <= now) {
      if (entry.action === 'sell') {
        soldByPlayers += entry.quantity;
      } else if (entry.action === 'buy') {
        boughtByPlayers += entry.quantity;
      }
    }
  }

  const netSelling = soldByPlayers - boughtByPlayers;
  const safeMax = Math.max(1, maxStock);
  const maxFactor = DEMAND_CONFIG.maxDemandFactor;

  if (action === 'sell') {
    if (netSelling > 0) {
      const drop = Math.min(maxFactor, (netSelling / safeMax) * maxFactor);
      return { factor: Math.max(0.1, 1 - drop), netUnits: netSelling };
    }
    if (netSelling < 0) {
      const netBuying = -netSelling;
      const bonus = Math.min(maxFactor, (netBuying / safeMax) * maxFactor);
      return { factor: 1 + bonus, netUnits: netSelling };
    }
    return { factor: 1.0, netUnits: 0 };
  } else {
    if (netSelling < 0) {
      const netBuying = -netSelling;
      const hike = Math.min(maxFactor, (netBuying / safeMax) * maxFactor);
      return { factor: 1 + hike, netUnits: netSelling };
    }
    if (netSelling > 0) {
      const discount = Math.min(maxFactor, (netSelling / safeMax) * maxFactor);
      return { factor: Math.max(0.1, 1 - discount), netUnits: netSelling };
    }
    return { factor: 1.0, netUnits: 0 };
  }
}

export function demandFactor(
  window: DemandWindow | undefined,
  itemType: string,
  action: 'buy' | 'sell',
  maxStock: number,
  now: number,
): number {
  return calculateDemandFactor(window, itemType, action, maxStock, now).factor;
}

// When one shard colour exceeds forty percent of recent sales, merchants discount it and pay a premium for its counter colour.
export function calculateColorBalanceFactor(
  itemType: string,
  action: 'buy' | 'sell',
  shardSales: Record<string, number> | ShardSaleEntry[] | undefined,
  now: number,
  fallbackNation?: string,
): {
  factor: number;
  dominantElement: string | null;
  dominantColor: string | null;
  counterElement: string | null;
  counterColor: string | null;
  dominantShare: number;
  isDominant: boolean;
  isCounter: boolean;
} {
  const neutral = {
    factor: 1.0,
    dominantElement: null,
    dominantColor: null,
    counterElement: null,
    counterColor: null,
    dominantShare: 0,
    isDominant: false,
    isCounter: false,
  };

  if (!shardSales) return neutral;

  const elementCounts: Record<string, number> = {
    IGNIS: 0,
    AQUES: 0,
    TERRA: 0,
    AURA: 0,
  };

  if (Array.isArray(shardSales)) {
    const cutoff = now - COLOR_BALANCE_CONFIG.windowMs;
    for (const entry of shardSales) {
      if (entry.timestamp >= cutoff && entry.timestamp <= now) {
        const el = getElementFromItemType(entry.element);
        if (el && elementCounts[el] !== undefined) {
          elementCounts[el] += entry.quantity;
        }
      }
    }
  } else {
    for (const [key, count] of Object.entries(shardSales)) {
      const el = getElementFromItemType(key);
      if (el && elementCounts[el] !== undefined) {
        elementCounts[el] += count;
      }
    }
  }

  const totalSales = Object.values(elementCounts).reduce((sum, n) => sum + n, 0);
  if (totalSales <= 0) return neutral;

  let dominantElement: string | null = null;
  let dominantShare = 0;

  for (const [el, count] of Object.entries(elementCounts)) {
    const share = count / totalSales;
    if (share > COLOR_BALANCE_CONFIG.thresholdRatio) {
      dominantElement = el;
      dominantShare = share;
      break;
    }
  }

  if (!dominantElement) return neutral;

  const counterElement: string | null = ELEMENT_COUNTERS[dominantElement] ?? null;
  const dominantColor: string | null = ELEMENT_COLORS[dominantElement] ?? dominantElement;
  const counterColor: string | null = counterElement ? (ELEMENT_COLORS[counterElement] ?? counterElement) : null;

  const thisElement = getElementFromItemType(itemType, fallbackNation);
  if (!thisElement) {
    return {
      factor: 1.0,
      dominantElement,
      dominantColor,
      counterElement,
      counterColor,
      dominantShare,
      isDominant: false,
      isCounter: false,
    };
  }

  const isDominant = thisElement === dominantElement;
  const isCounter = counterElement !== null && thisElement === counterElement;

  let factor = 1.0;
  if (action === 'sell') {
    if (isDominant) {
      factor = 1 - COLOR_BALANCE_CONFIG.discountRate;
    } else if (isCounter) {
      factor = 1 + COLOR_BALANCE_CONFIG.counterPremiumRate;
    }
  }

  return {
    factor,
    dominantElement,
    dominantColor,
    counterElement,
    counterColor,
    dominantShare,
    isDominant,
    isCounter,
  };
}

// Outsiders from rival lands pay twenty percent more when buying and accept ten percent less when selling.
export function calculateOutsiderFactor(
  action: 'buy' | 'sell',
  isOutsider: boolean,
): { factor: number } {
  if (!isOutsider) return { factor: 1.0 };
  if (action === 'buy') {
    return { factor: 1 + MERCHANT_CONFIG.outsiderBuySurcharge };
  }
  return { factor: 1 - MERCHANT_CONFIG.outsiderSellDiscount };
}

// Merchants remember past deeds: trusted friends gain discounts while troublemakers pay surcharges.
export function calculateNpcMemoryFactor(
  action: 'buy' | 'sell',
  score = 0,
): { factor: number } {
  if (action === 'buy') {
    if (score > 30) {
      const discount = Math.min(0.1, ((score - 30) / 70) * 0.1);
      return { factor: 1 - discount };
    }
    if (score < -30) {
      const surcharge = Math.min(0.25, (Math.abs(score + 30) / 70) * 0.25);
      return { factor: 1 + surcharge };
    }
    return { factor: 1.0 };
  } else {
    if (score > 30) {
      const bonus = Math.min(0.08, ((score - 30) / 70) * 0.08);
      return { factor: 1 + bonus };
    }
    if (score < -30) {
      const penalty = Math.min(0.15, (Math.abs(score + 30) / 70) * 0.15);
      return { factor: 1 - penalty };
    }
    return { factor: 1.0 };
  }
}

// Five percent of every purchase in the merchant stalls goes directly to the Lord's treasury.
export function calculateSalesTax(
  totalPrice: number,
): { taxAmount: number; netMerchantReceives: number; taxRate: number } {
  const taxRate = TAX_RATES.merchantSalesTax;
  const taxAmount = Math.max(1, Math.round(totalPrice * taxRate));
  return {
    taxAmount,
    netMerchantReceives: totalPrice - taxAmount,
    taxRate,
  };
}

export function calculateMerchantPrice(
  basePrice: number,
  stock: number,
  maxStock: number,
  colorMod = 1.0,
): number {
  if (basePrice <= 0) return 0;
  const { price } = calculateScarcityPrice(basePrice, stock, maxStock);
  const withColor = Math.round(price * colorMod);
  const maxPrice = Math.round(basePrice * MERCHANT_CONFIG.maxPriceMultiplier);
  return Math.max(MERCHANT_CONFIG.minPrice, Math.min(maxPrice, withColor));
}

export interface QuoteEvaluationParams {
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
  ownerMultiplier?: number | undefined;
}

export function evaluateMerchantQuote(params: QuoteEvaluationParams): Quote {
  const {
    itemType,
    action,
    stock,
    maxStock,
    basePrice,
    isOutsider = false,
    colorMod = 1.0,
    npcMemoryScore = 0,
    demandWindow,
    shardSales,
    now = 0,
    nation = 'IGNIS',
  } = params;

  if (action === 'buy' && stock <= 0) {
    const emptyWords = "The shelves are bare; not a single piece remains.";
    return {
      unitPrice: 0,
      canExecute: false,
      reason: 'Out of stock',
      steps: [
        {
          rule: 'scarcity',
          effect: 1.0,
          words: emptyWords,
        },
      ],
      summary: emptyWords,
    };
  }

  const steps: QuoteStep[] = [];

  // Rule 1: Scarcity
  const scarcity = calculateScarcityPrice(basePrice, stock, maxStock);
  const baseQuote = scarcity.price;
  let startingPrice = baseQuote;
  if (action === 'sell') {
    startingPrice = Math.round(baseQuote * MERCHANT_CONFIG.defaultSellMargin);
  }

  const scarcityWords = voiceScarcity({
    action,
    stock,
    maxStock,
    itemType,
    nation,
  });
  steps.push({
    rule: 'scarcity',
    effect: scarcity.factor - 1,
    words: scarcityWords,
  });

  let runningPrice = startingPrice;

  // Rule 2: Recent demand
  const demand = calculateDemandFactor(demandWindow, itemType, action, maxStock, now);
  if (demand.factor !== 1.0) {
    runningPrice = Math.round(runningPrice * demand.factor);
    const demandWords = voiceDemand({
      action,
      netUnits: demand.netUnits,
      itemType,
      nation,
    });
    steps.push({
      rule: 'recent_demand',
      effect: demand.factor - 1,
      words: demandWords,
    });
  }

  // Rule 3: Colour balance
  const color = calculateColorBalanceFactor(itemType, action, shardSales, now, nation);
  let effectiveColorFactor = color.factor;
  if (colorMod !== 1.0 && color.factor === 1.0) {
    effectiveColorFactor = colorMod;
  }
  if (effectiveColorFactor !== 1.0) {
    runningPrice = Math.round(runningPrice * effectiveColorFactor);
    const colorWords = voiceColorBalance({
      action,
      dominantColor: color.dominantColor ?? 'Crimson',
      counterColor: color.counterColor ?? 'Azure',
      isDominant: color.isDominant,
      isCounter: color.isCounter,
    });
    steps.push({
      rule: 'color_balance',
      effect: effectiveColorFactor - 1,
      words: colorWords,
    });
  }

  // Rule 4: Outsider
  const outsider = calculateOutsiderFactor(action, isOutsider);
  if (outsider.factor !== 1.0) {
    runningPrice = Math.round(runningPrice * outsider.factor);
    const outsiderWords = voiceOutsider({
      action,
      isOutsider,
    });
    steps.push({
      rule: 'outsider',
      effect: outsider.factor - 1,
      words: outsiderWords,
    });
  }

  // Rule 5: NPC Memory
  const memory = calculateNpcMemoryFactor(action, npcMemoryScore);
  if (memory.factor !== 1.0) {
    runningPrice = Math.round(runningPrice * memory.factor);
    const memoryWords = voiceNpcMemory({
      action,
      score: npcMemoryScore,
    });
    steps.push({
      rule: 'npc_memory',
      effect: memory.factor - 1,
      words: memoryWords,
    });
  }

  // Clamping: prices never go below 1 or above 3.9 x base after all rules
  const minPrice = MERCHANT_CONFIG.minPrice;
  const maxPrice = Math.round(basePrice * MERCHANT_CONFIG.maxPriceMultiplier);
  let finalPrice = Math.max(minPrice, Math.min(maxPrice, runningPrice));

  // Rule 6: Owner multiplier (applied last on top of the rule price)
  if (typeof params.ownerMultiplier === 'number') {
    const ownerMult = params.ownerMultiplier;
    finalPrice = Math.max(1, Math.round(finalPrice * ownerMult));
    const ownerWords = 'The owner sets this price.';
    steps.push({
      rule: 'owner_multiplier',
      effect: ownerMult - 1,
      words: ownerWords,
    });
  }

  // Determine summary: step with the biggest absolute effect
  let biggestStep = steps[0];
  let biggestEffect = biggestStep ? Math.abs(biggestStep.effect) : 0;
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];
    if (step) {
      const eff = Math.abs(step.effect);
      if (eff > biggestEffect) {
        biggestEffect = eff;
        biggestStep = step;
      }
    }
  }

  const summary = biggestStep ? biggestStep.words : scarcityWords;

  return {
    unitPrice: finalPrice,
    canExecute: true,
    steps,
    summary,
  };
}

export { evaluateMerchantQuote as calculateQuote };

