import type { DatabaseSync } from 'node:sqlite';
import {
  type MerchantState,
  type MerchantStatus,
  type MerchantInventoryItem,
  calculateQuote,
  updateMerchantSolvency,
  applyMerchantBailout,
  TREASURY_ACCOUNT_ID,
  TAX_RATES,
} from '@elements/shared';
import { getDatabase } from '../db.js';
import { recordTransaction } from './ledgerService.js';
import { getNpcMemory } from './npcMemoryService.js';

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
  const rows = (db
    .prepare(
      'SELECT id, nation, balance, status, days_broke, inventory, updated_at FROM merchant_states ORDER BY id ASC',
    )
    .all() as unknown) as RawMerchantRow[];

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

export function quoteMerchantTrade(
  params: {
    merchantId: string;
    itemType: string;
    action: 'buy' | 'sell';
    quantity: number;
    isOutsider?: boolean;
    buyerAccountId?: string;
  },
  db: DatabaseSync = getDatabase(),
): { unitPrice: number; totalPrice: number; canExecute: boolean; reason?: string } {
  const merchant = getMerchant(params.merchantId, db);
  if (!merchant) {
    return { unitPrice: 0, totalPrice: 0, canExecute: false, reason: 'Merchant not found' };
  }

  if (merchant.status === 'closed') {
    return { unitPrice: 0, totalPrice: 0, canExecute: false, reason: 'Merchant shop is closed' };
  }

  if (params.action === 'sell' && merchant.status === 'broke_buying_paused') {
    return {
      unitPrice: 0,
      totalPrice: 0,
      canExecute: false,
      reason: 'Merchant has insufficient funds and has paused purchases',
    };
  }

  const invItem = merchant.inventory[params.itemType];
  if (!invItem) {
    return { unitPrice: 0, totalPrice: 0, canExecute: false, reason: 'Item not traded by merchant' };
  }

  let memoryScore = 0;
  if (params.buyerAccountId) {
    const mem = getNpcMemory(params.merchantId, params.buyerAccountId, db);
    memoryScore = mem.score;
  }

  const quote = calculateQuote({
    itemType: params.itemType,
    action: params.action,
    stock: invItem.stock,
    maxStock: invItem.maxStock,
    basePrice: invItem.basePrice,
    isOutsider: params.isOutsider ?? false,
    npcMemoryScore: memoryScore,
  });

  if (!quote.canExecute) {
    return {
      unitPrice: 0,
      totalPrice: 0,
      canExecute: false,
      reason: quote.reason ?? 'Cannot execute quote',
    };
  }

  return {
    unitPrice: quote.unitPrice,
    totalPrice: quote.unitPrice * params.quantity,
    canExecute: true,
  };
}

export function buyFromMerchant(
  params: {
    merchantId: string;
    buyerAccountId: string;
    itemType: string;
    quantity: number;
    isOutsider?: boolean;
  },
  db: DatabaseSync = getDatabase(),
): { unitPrice: number; totalPrice: number; taxAmount: number } {
  const merchant = getMerchant(params.merchantId, db);
  if (!merchant) throw new Error('Merchant not found');

  const invItem = merchant.inventory[params.itemType];
  if (!invItem) throw new Error(`Merchant does not stock ${params.itemType}`);
  if (invItem.stock < params.quantity) throw new Error('Insufficient merchant stock');

  const quoteParams: {
    merchantId: string;
    itemType: string;
    action: 'buy' | 'sell';
    quantity: number;
    isOutsider?: boolean;
    buyerAccountId?: string;
  } = {
    merchantId: params.merchantId,
    itemType: params.itemType,
    action: 'buy',
    quantity: params.quantity,
  };
  if (params.isOutsider) quoteParams.isOutsider = true;
  if (params.buyerAccountId) quoteParams.buyerAccountId = params.buyerAccountId;

  const quote = quoteMerchantTrade(quoteParams, db);
  if (!quote.canExecute) {
    throw new Error(quote.reason ?? 'Trade cannot be executed');
  }

  const totalPrice = quote.totalPrice;
  const salesTax = Math.max(1, Math.round(totalPrice * TAX_RATES.merchantSalesTax));

  // 1. Player pays merchant
  recordTransaction(
    {
      from: params.buyerAccountId,
      to: merchant.id,
      amount: totalPrice,
      reason: 'merchant_buy',
      refId: `${merchant.id}:${params.itemType}:${params.quantity}`,
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
    },
    db,
  );

  // 3. Update stock and merchant balance
  invItem.stock -= params.quantity;
  merchant.balance += totalPrice - salesTax;
  saveMerchant(merchant, db);

  return { unitPrice: quote.unitPrice, totalPrice, taxAmount: salesTax };
}

export function sellToMerchant(
  params: {
    merchantId: string;
    sellerAccountId: string;
    itemType: string;
    quantity: number;
    isOutsider?: boolean;
  },
  db: DatabaseSync = getDatabase(),
): { unitPrice: number; totalPrice: number } {
  const merchant = getMerchant(params.merchantId, db);
  if (!merchant) throw new Error('Merchant not found');

  const invItem = merchant.inventory[params.itemType];
  if (!invItem) throw new Error(`Merchant does not buy ${params.itemType}`);

  const quoteParams: {
    merchantId: string;
    itemType: string;
    action: 'buy' | 'sell';
    quantity: number;
    isOutsider?: boolean;
    buyerAccountId?: string;
  } = {
    merchantId: params.merchantId,
    itemType: params.itemType,
    action: 'sell',
    quantity: params.quantity,
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

  // 1. Merchant pays player
  recordTransaction(
    {
      from: merchant.id,
      to: params.sellerAccountId,
      amount: totalPrice,
      reason: 'merchant_sell',
      refId: `${merchant.id}:${params.itemType}:${params.quantity}`,
    },
    db,
  );

  // 2. Update stock and merchant balance
  invItem.stock += params.quantity;
  merchant.balance -= totalPrice;

  const solvency = updateMerchantSolvency(merchant, false);
  saveMerchant(solvency.state, db);

  return { unitPrice: quote.unitPrice, totalPrice };
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
