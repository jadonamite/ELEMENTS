import type { DatabaseSync } from 'node:sqlite';
import {
  type MerchantState,
  type MerchantStatus,
  type MerchantInventoryItem,
  type QuoteStep,
  type DemandWindow,
  calculateQuote,
  updateMerchantSolvency,
  applyMerchantBailout,
  TREASURY_ACCOUNT_ID,
  TAX_RATES,
  DEMAND_CONFIG,
  COLOR_BALANCE_CONFIG,
  getElementFromItemType,
  shardItemId,
  stockKeyForItem,
} from '@elements/shared';
import { getDatabase, getActiveShopOwnership, insertShopSale } from '../db.js';
import { recordTransaction } from './ledgerService.js';
import { getNpcMemory } from './npcMemoryService.js';
import { addItems, removeItems, withSavepoint } from './satchelService.js';

interface RawMerchantRow {
  id: string;
  nation: string;
  balance: number;
  status: string;
  days_broke: number;
  inventory: string;
  updated_at: number;
}

function mapRowToMerchant(row: RawMerchantRow): MerchantState {
  let inventory: Record<string, MerchantInventoryItem> = {};
  try {
    inventory = JSON.parse(row.inventory) as Record<string, MerchantInventoryItem>;
  } catch {
    inventory = {};
  }

  return {
    id: row.id,
    nation: row.nation,
    balance: row.balance,
    status: row.status as MerchantStatus,
    daysBroke: row.days_broke,
    inventory,
  };
}

export function getMerchant(id: string, db: DatabaseSync = getDatabase()): MerchantState | null {
  const row = db
    .prepare(
      'SELECT id, nation, balance, status, days_broke, inventory, updated_at FROM merchant_states WHERE id = ?',
    )
    .get(id) as RawMerchantRow | undefined;

  if (!row) return null;
  return mapRowToMerchant(row);
}

export function getAllMerchants(db: DatabaseSync = getDatabase()): MerchantState[] {
  const rows = db
    .prepare(
      'SELECT id, nation, balance, status, days_broke, inventory, updated_at FROM merchant_states ORDER BY id ASC',
    )
    .all() as unknown as RawMerchantRow[];

  return rows.map(mapRowToMerchant);
}

export function saveMerchant(merchant: MerchantState, db: DatabaseSync = getDatabase()): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO merchant_states (id, nation, balance, status, days_broke, inventory, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       balance = excluded.balance,
       status = excluded.status,
       days_broke = excluded.days_broke,
       inventory = excluded.inventory,
       updated_at = excluded.updated_at`,
  ).run(
    merchant.id,
    merchant.nation,
    merchant.balance,
    merchant.status,
    merchant.daysBroke,
    JSON.stringify(merchant.inventory),
    now,
  );
}

export function recordMerchantDemand(
  params: {
    merchantId: string;
    itemType: string;
    action: 'buy' | 'sell';
    quantity: number;
    timestamp?: number;
  },
  db: DatabaseSync = getDatabase(),
): void {
  const now = params.timestamp ?? Date.now();
  const id = `${params.merchantId}:${now}:${Math.random().toString(36).slice(2, 9)}`;
  db.prepare(
    `INSERT INTO merchant_demand (id, merchant_id, item_type, action, quantity, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, params.merchantId, params.itemType, params.action, params.quantity, now);
}

export function getMerchantDemandWindow(
  merchantId: string,
  now = Date.now(),
  db: DatabaseSync = getDatabase(),
): DemandWindow {
  const cutoff = now - DEMAND_CONFIG.windowMs;
  const rows = db
    .prepare(
      `SELECT item_type, action, quantity, timestamp
       FROM merchant_demand
       WHERE merchant_id = ? AND timestamp >= ? AND timestamp <= ?`,
    )
    .all(merchantId, cutoff, now) as unknown as Array<{
    item_type: string;
    action: 'buy' | 'sell';
    quantity: number;
    timestamp: number;
  }>;

  const window: DemandWindow = {};
  for (const row of rows) {
    if (!window[row.item_type]) {
      window[row.item_type] = [];
    }
    const list = window[row.item_type];
    if (list) {
      list.push({
        action: row.action,
        quantity: row.quantity,
        timestamp: row.timestamp,
      });
    }
  }
  return window;
}

export function getRecentShardSales(
  now = Date.now(),
  db: DatabaseSync = getDatabase(),
): Record<string, number> {
  const cutoff = now - COLOR_BALANCE_CONFIG.windowMs;
  const rows = db
    .prepare(
      `SELECT d.item_type, m.nation, SUM(d.quantity) as total
       FROM merchant_demand d
       JOIN merchant_states m ON d.merchant_id = m.id
       WHERE d.action = 'sell' AND d.timestamp >= ? AND d.timestamp <= ?
       GROUP BY d.item_type, m.nation`,
    )
    .all(cutoff, now) as unknown as Array<{
    item_type: string;
    nation: string;
    total: number;
  }>;

  const counts: Record<string, number> = {
    IGNIS: 0,
    AQUES: 0,
    TERRA: 0,
    AURA: 0,
  };

  for (const row of rows) {
    const el = getElementFromItemType(row.item_type, row.nation);
    if (el && counts[el] !== undefined) {
      counts[el] = (counts[el] ?? 0) + Number(row.total);
    }
  }

  return counts;
}

export function quoteMerchantTrade(
  params: {
    merchantId: string;
    itemType: string;
    action: 'buy' | 'sell';
    quantity: number;
    isOutsider?: boolean;
    buyerAccountId?: string;
    now?: number;
    shardSales?: Record<string, number>;
  },
  db: DatabaseSync = getDatabase(),
): {
  unitPrice: number;
  totalPrice: number;
  canExecute: boolean;
  reason?: string;
  steps: QuoteStep[];
  summary: string;
} {
  const merchant = getMerchant(params.merchantId, db);
  if (!merchant) {
    const reason = 'Merchant not found';
    return {
      unitPrice: 0,
      totalPrice: 0,
      canExecute: false,
      reason,
      steps: [
        {
          rule: 'not_found',
          effect: 0,
          words: 'No merchant by that name trades in this district.',
        },
      ],
      summary: 'No merchant by that name trades in this district.',
    };
  }

  if (merchant.status === 'closed') {
    const reason = 'Merchant shop is closed';
    return {
      unitPrice: 0,
      totalPrice: 0,
      canExecute: false,
      reason,
      steps: [
        {
          rule: 'closed',
          effect: 0,
          words: 'The shop is shuttered; no coin or goods move here today.',
        },
      ],
      summary: 'The shop is shuttered; no coin or goods move here today.',
    };
  }

  if (params.action === 'sell' && merchant.status === 'broke_buying_paused') {
    const reason = 'Merchant has insufficient funds and has paused purchases';
    return {
      unitPrice: 0,
      totalPrice: 0,
      canExecute: false,
      reason,
      steps: [
        {
          rule: 'paused',
          effect: 0,
          words: 'My purse is drained dry; I cannot buy more goods today.',
        },
      ],
      summary: 'My purse is drained dry; I cannot buy more goods today.',
    };
  }

  const invItem =
    merchant.inventory[params.itemType] ??
    (params.itemType.startsWith('shard') ? merchant.inventory['shard'] : undefined);
  if (!invItem) {
    const reason = 'Item not traded by merchant';
    return {
      unitPrice: 0,
      totalPrice: 0,
      canExecute: false,
      reason,
      steps: [
        {
          rule: 'untraded',
          effect: 0,
          words: 'I do not trade in those goods.',
        },
      ],
      summary: 'I do not trade in those goods.',
    };
  }

  let memoryScore = 0;
  if (params.buyerAccountId) {
    const mem = getNpcMemory(params.merchantId, params.buyerAccountId, db);
    memoryScore = mem.score;
  }

  const now = params.now ?? Date.now();
  const demandWindow = getMerchantDemandWindow(params.merchantId, now, db);
  const shardSales = params.shardSales ?? getRecentShardSales(now, db);

  const ownership = getActiveShopOwnership(params.merchantId, db);
  const ownerMultiplier =
    ownership?.priceMultipliers?.[params.itemType] ??
    (params.itemType.startsWith('shard') ? ownership?.priceMultipliers?.['shard'] : undefined);

  const quote = calculateQuote({
    itemType: params.itemType,
    action: params.action,
    stock: invItem.stock,
    maxStock: invItem.maxStock,
    basePrice: invItem.basePrice,
    isOutsider: params.isOutsider ?? false,
    npcMemoryScore: memoryScore,
    demandWindow,
    shardSales,
    now,
    nation: merchant.nation,
    ownerMultiplier,
  });

  if (!quote.canExecute) {
    return {
      unitPrice: 0,
      totalPrice: 0,
      canExecute: false,
      reason: quote.reason ?? 'Cannot execute quote',
      steps: quote.steps,
      summary: quote.summary,
    };
  }

  return {
    unitPrice: quote.unitPrice,
    totalPrice: quote.unitPrice * params.quantity,
    canExecute: true,
    steps: quote.steps,
    summary: quote.summary,
  };
}

export function buyFromMerchant(
  params: {
    merchantId: string;
    buyerAccountId: string;
    itemType: string;
    quantity: number;
    isOutsider?: boolean;
    now?: number;
  },
  db: DatabaseSync = getDatabase(),
): {
  unitPrice: number;
  totalPrice: number;
  taxAmount: number;
  itemId: string;
} {
  const merchant = getMerchant(params.merchantId, db);
  if (!merchant) throw new Error('Merchant not found');

  const stockKey = stockKeyForItem(params.itemType, merchant.inventory);
  const invItem = stockKey ? merchant.inventory[stockKey] : undefined;
  if (!invItem) throw new Error(`Merchant does not stock ${params.itemType}`);
  if (invItem.stock < params.quantity) throw new Error('Insufficient merchant stock');

  const now = params.now ?? Date.now();
  const quoteParams: {
    merchantId: string;
    itemType: string;
    action: 'buy' | 'sell';
    quantity: number;
    isOutsider?: boolean;
    buyerAccountId?: string;
    now?: number;
  } = {
    merchantId: params.merchantId,
    itemType: params.itemType,
    action: 'buy',
    quantity: params.quantity,
    now,
  };
  if (params.isOutsider) quoteParams.isOutsider = true;
  if (params.buyerAccountId) quoteParams.buyerAccountId = params.buyerAccountId;

  const quote = quoteMerchantTrade(quoteParams, db);
  if (!quote.canExecute) {
    throw new Error(quote.reason ?? 'Trade cannot be executed');
  }

  const totalPrice = quote.totalPrice;
  const salesTax = Math.max(1, Math.round(totalPrice * TAX_RATES.merchantSalesTax));
  // A plain "shard" bought here is this merchant's own nation's colour.
  const boughtItemId =
    stockKey === 'shard'
      ? shardItemId(getElementFromItemType(params.itemType, merchant.nation) ?? merchant.nation)
      : params.itemType;

  return withSavepoint(db, () => {
    // 1. Player pays merchant
    recordTransaction(
      {
        from: params.buyerAccountId,
        to: merchant.id,
        amount: totalPrice,
        reason: 'merchant_buy',
        refId: `${merchant.id}:${params.itemType}:${params.quantity}`,
        timestamp: now,
      },
      db,
    );

    // 2. Merchant pays 5% sales tax to the Lord Treasury
    recordTransaction(
      {
        from: merchant.id,
        to: TREASURY_ACCOUNT_ID,
        amount: salesTax,
        reason: 'merchant_sales_tax',
        refId: `tax:${merchant.id}:${params.itemType}`,
        timestamp: now,
      },
      db,
    );

    // 3. Update stock and merchant balance
    invItem.stock -= params.quantity;
    merchant.balance += totalPrice - salesTax;
    saveMerchant(merchant, db);

    // 4. Record demand
    recordMerchantDemand(
      {
        merchantId: params.merchantId,
        itemType: params.itemType,
        action: 'buy',
        quantity: params.quantity,
        timestamp: now,
      },
      db,
    );

    insertShopSale(
      {
        merchantId: params.merchantId,
        buyerId: params.buyerAccountId,
        sellerId: merchant.id,
        itemType: params.itemType,
        quantity: params.quantity,
        price: totalPrice,
        timestamp: now,
      },
      db,
    );

    addItems(
      {
        accountId: params.buyerAccountId,
        from: merchant.id,
        stacks: [{ itemId: boughtItemId, quantity: params.quantity }],
        reason: 'merchant_buy',
        refId: merchant.id,
        now,
      },
      db,
    );

    return {
      unitPrice: quote.unitPrice,
      totalPrice,
      taxAmount: salesTax,
      itemId: boughtItemId,
    };
  });
}

export function sellToMerchant(
  params: {
    merchantId: string;
    sellerAccountId: string;
    itemType: string;
    quantity: number;
    isOutsider?: boolean;
    now?: number;
  },
  db: DatabaseSync = getDatabase(),
): { unitPrice: number; totalPrice: number } {
  const merchant = getMerchant(params.merchantId, db);
  if (!merchant) throw new Error('Merchant not found');

  const stockKey = stockKeyForItem(params.itemType, merchant.inventory);
  const invItem = stockKey ? merchant.inventory[stockKey] : undefined;
  if (!invItem) throw new Error(`Merchant does not buy ${params.itemType}`);

  const now = params.now ?? Date.now();
  const quoteParams: {
    merchantId: string;
    itemType: string;
    action: 'buy' | 'sell';
    quantity: number;
    isOutsider?: boolean;
    buyerAccountId?: string;
    now?: number;
  } = {
    merchantId: params.merchantId,
    itemType: params.itemType,
    action: 'sell',
    quantity: params.quantity,
    now,
  };
  if (params.isOutsider) quoteParams.isOutsider = true;
  if (params.sellerAccountId) quoteParams.buyerAccountId = params.sellerAccountId;

  const quote = quoteMerchantTrade(quoteParams, db);
  if (!quote.canExecute) {
    throw new Error(quote.reason ?? 'Trade cannot be executed');
  }

  const totalPrice = quote.totalPrice;
  if (merchant.balance < totalPrice) {
    throw new Error('Merchant has insufficient CHROMA to purchase this item');
  }

  return withSavepoint(db, () => {
    removeItems(
      {
        accountId: params.sellerAccountId,
        to: merchant.id,
        stacks: [{ itemId: params.itemType, quantity: params.quantity }],
        reason: 'merchant_sell',
        refId: merchant.id,
        now,
      },
      db,
    );

    // 1. Merchant pays player
    recordTransaction(
      {
        from: merchant.id,
        to: params.sellerAccountId,
        amount: totalPrice,
        reason: 'merchant_sell',
        refId: `${merchant.id}:${params.itemType}:${params.quantity}`,
        timestamp: now,
      },
      db,
    );

    // 2. Update stock and merchant balance
    invItem.stock += params.quantity;
    merchant.balance -= totalPrice;

    const solvency = updateMerchantSolvency(merchant, false);
    saveMerchant(solvency.state, db);

    // 3. Record demand
    recordMerchantDemand(
      {
        merchantId: params.merchantId,
        itemType: params.itemType,
        action: 'sell',
        quantity: params.quantity,
        timestamp: now,
      },
      db,
    );

    return { unitPrice: quote.unitPrice, totalPrice };
  });
}

export function tickAllMerchantsDay(db: DatabaseSync = getDatabase()): {
  closed: string[];
  reopened: string[];
} {
  const merchants = getAllMerchants(db);
  const closed: string[] = [];
  const reopened: string[] = [];

  for (const m of merchants) {
    const prevStatus = m.status;
    const { state } = updateMerchantSolvency(m, true);

    if (state.status === 'closed' && prevStatus !== 'closed') {
      closed.push(m.id);
      // Automatically bailout from treasury after closure period
      const revived = applyMerchantBailout(state);
      recordTransaction(
        {
          from: TREASURY_ACCOUNT_ID,
          to: m.id,
          amount: 100_000,
          reason: 'merchant_bailout',
          refId: m.id,
        },
        db,
      );
      saveMerchant(revived, db);
      reopened.push(m.id);
    } else {
      saveMerchant(state, db);
    }
  }

  return { closed, reopened };
}
