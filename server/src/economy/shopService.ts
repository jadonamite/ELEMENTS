import type { DatabaseSync } from 'node:sqlite';
import {
  type ShopOwnershipRecord,
  type ShopSaleRecord,
  type ShopForSale,
  type MerchantState,
  SHOPS_CONFIG,
  MERCHANT_CONFIG,
  TREASURY_ACCOUNT_ID,
  GAME_HOUR_MS,
  validateShopPurchase,
  validatePriceMultipliers,
  validateStockDeposit,
  validateWithdrawal,
  checkShopSaleExpiry,
  checkUpkeepStatus,
  applyMerchantBailout,
} from '@elements/shared';
import {
  getDatabase,
  getActiveShopOwnership,
  getPlayerOwnedShops,
  insertShopOwnership,
  insertShopSale,
  getShopSales,
} from '../db.js';
import { getAccountBalance, recordTransaction } from './ledgerService.js';
import { getMerchant, getAllMerchants, saveMerchant } from './merchantService.js';
import { getActiveRedFlags, hasActiveBounty } from './crimeService.js';

// Lists all closed shops currently offered for player acquisition.
export function getShopsForSale(
  now: number = Date.now(),
  db: DatabaseSync = getDatabase(),
): ShopForSale[] {
  const merchants = getAllMerchants(db);
  const forSale: ShopForSale[] = [];

  for (const m of merchants) {
    if (m.status === 'closed') {
      const activeOwnership = getActiveShopOwnership(m.id, db);
      if (!activeOwnership) {
        // Calculate days on sale from recent shop_sales listing or days broke
        const recentSales = getShopSales(m.id, 10, db);
        const lastListing = recentSales.find(
          (s) => s.itemType === 'shop_listing' || s.itemType === 'shop',
        );

        let listedAt = now;
        let daysOnSale = 0;
        if (lastListing) {
          listedAt = lastListing.timestamp;
          daysOnSale = Math.max(
            0,
            Math.floor((now - listedAt) / (24 * GAME_HOUR_MS)),
          );
        } else if (m.daysBroke >= MERCHANT_CONFIG.closureDays) {
          daysOnSale = Math.max(0, m.daysBroke - MERCHANT_CONFIG.closureDays);
        }

        const remainingDays = Math.max(0, SHOPS_CONFIG.saleDays - daysOnSale);

        forSale.push({
          merchantId: m.id,
          name: m.id,
          nation: m.nation,
          salePrice: SHOPS_CONFIG.salePrice,
          daysOnSale,
          remainingDays,
          inventory: m.inventory,
          listedAt,
        });
      }
    }
  }

  return forSale;
}

// Retrieves current active ownership for a given merchant shop.
export function getShopOwnership(
  merchantId: string,
  db: DatabaseSync = getDatabase(),
): ShopOwnershipRecord | null {
  return getActiveShopOwnership(merchantId, db);
}

// Executes a player's purchase of an on-sale merchant shop.
export function buyShop(
  params: {
    merchantId: string;
    buyerAccountId: string;
    now?: number;
  },
  db: DatabaseSync = getDatabase(),
): {
  success: boolean;
  ownership: ShopOwnershipRecord;
  merchant: MerchantState;
} {
  const now = params.now ?? Date.now();
  const merchant = getMerchant(params.merchantId, db);
  if (!merchant) {
    throw new Error(`Merchant ${params.merchantId} not found`);
  }

  const activeOwnership = getActiveShopOwnership(params.merchantId, db);
  const isClosedOrForSale = merchant.status === 'closed' && !activeOwnership;

  const redFlags = getActiveRedFlags(params.buyerAccountId, db, now);
  const bountyActive = hasActiveBounty(params.buyerAccountId, db);
  const balance = getAccountBalance(params.buyerAccountId, db);
  const ownedShops = getPlayerOwnedShops(params.buyerAccountId, db);

  const validation = validateShopPurchase({
    buyerAccountId: params.buyerAccountId,
    shopId: params.merchantId,
    isClosedOrForSale,
    buyerBalance: balance,
    hasRedFlag: redFlags.length > 0,
    hasBounty: bountyActive,
    currentlyOwnedCount: ownedShops.length,
    salePrice: SHOPS_CONFIG.salePrice,
    maxPerPlayer: SHOPS_CONFIG.maxPerPlayer,
  });

  if (!validation.valid) {
    throw new Error(validation.reason ?? 'Failed shop purchase validation');
  }

  // 1. Transfer purchase price from buyer to treasury
  recordTransaction(
    {
      from: params.buyerAccountId,
      to: TREASURY_ACCOUNT_ID,
      amount: SHOPS_CONFIG.salePrice,
      reason: 'shop_purchase',
      refId: params.merchantId,
      timestamp: now,
    },
    db,
  );

  // 2. Record sale event in append-only table
  insertShopSale(
    {
      merchantId: params.merchantId,
      buyerId: params.buyerAccountId,
      sellerId: TREASURY_ACCOUNT_ID,
      itemType: 'shop',
      quantity: 1,
      price: SHOPS_CONFIG.salePrice,
      timestamp: now,
    },
    db,
  );

  // 3. Record ownership acquisition in append-only table
  const ownership = insertShopOwnership(
    {
      merchantId: params.merchantId,
      ownerId: params.buyerAccountId,
      action: 'purchase',
      priceMultipliers: {},
      unpaidUpkeepDays: 0,
      lastUpkeepAt: now,
      amount: SHOPS_CONFIG.salePrice,
      active: true,
      timestamp: now,
    },
    db,
  );

  // 4. Reopen merchant shop under player ownership
  merchant.status = 'open';
  merchant.daysBroke = 0;
  saveMerchant(merchant, db);

  return {
    success: true,
    ownership,
    merchant,
  };
}

// Configures price multipliers for a player-owned shop.
export function setShopPrices(
  params: {
    merchantId: string;
    ownerAccountId: string;
    multipliers: Record<string, number>;
    now?: number;
  },
  db: DatabaseSync = getDatabase(),
): {
  success: boolean;
  multipliers: Record<string, number>;
} {
  const now = params.now ?? Date.now();
  const active = getActiveShopOwnership(params.merchantId, db);
  if (!active || active.ownerId !== params.ownerAccountId) {
    throw new Error('Account is not the active owner of this shop');
  }

  const validation = validatePriceMultipliers(params.multipliers);
  if (!validation.valid || !validation.sanitized) {
    throw new Error(validation.reason ?? 'Invalid price multipliers');
  }

  const mergedMultipliers = {
    ...active.priceMultipliers,
    ...validation.sanitized,
  };

  insertShopOwnership(
    {
      merchantId: params.merchantId,
      ownerId: params.ownerAccountId,
      action: 'set_prices',
      priceMultipliers: mergedMultipliers,
      unpaidUpkeepDays: active.unpaidUpkeepDays,
      lastUpkeepAt: active.lastUpkeepAt,
      amount: 0,
      active: true,
      timestamp: now,
    },
    db,
  );

  return {
    success: true,
    multipliers: mergedMultipliers,
  };
}

// Stocks items into a player-owned shop at zero tax.
export function stockShop(
  params: {
    merchantId: string;
    ownerAccountId: string;
    itemType: string;
    quantity: number;
    now?: number;
  },
  db: DatabaseSync = getDatabase(),
): {
  success: boolean;
  itemType: string;
  newStock: number;
} {
  const now = params.now ?? Date.now();
  const active = getActiveShopOwnership(params.merchantId, db);
  if (!active || active.ownerId !== params.ownerAccountId) {
    throw new Error('Account is not the active owner of this shop');
  }

  const validation = validateStockDeposit({
    itemType: params.itemType,
    quantity: params.quantity,
  });
  if (!validation.valid) {
    throw new Error(validation.reason ?? 'Invalid stock deposit parameters');
  }

  const merchant = getMerchant(params.merchantId, db);
  if (!merchant) {
    throw new Error(`Merchant ${params.merchantId} not found`);
  }

  const invItem =
    merchant.inventory[params.itemType] ??
    (params.itemType.startsWith('shard') ? merchant.inventory['shard'] : undefined);

  if (invItem) {
    invItem.stock += params.quantity;
    invItem.maxStock = Math.max(invItem.maxStock, invItem.stock);
  } else {
    merchant.inventory[params.itemType] = {
      stock: params.quantity,
      maxStock: Math.max(100, params.quantity * 2),
      basePrice: 10,
    };
  }

  saveMerchant(merchant, db);

  insertShopOwnership(
    {
      merchantId: params.merchantId,
      ownerId: params.ownerAccountId,
      action: 'stock',
      priceMultipliers: active.priceMultipliers,
      unpaidUpkeepDays: active.unpaidUpkeepDays,
      lastUpkeepAt: active.lastUpkeepAt,
      amount: 0,
      active: true,
      timestamp: now,
      metadata: {
        itemType: params.itemType,
        quantity: params.quantity,
      },
    },
    db,
  );

  const finalStock =
    merchant.inventory[params.itemType]?.stock ??
    (merchant.inventory['shard']?.stock || params.quantity);

  return {
    success: true,
    itemType: params.itemType,
    newStock: finalStock,
  };
}

// Withdraws accumulated shop profit to the owner's purse.
export function withdrawShopProfit(
  params: {
    merchantId: string;
    ownerAccountId: string;
    amount?: number | undefined;
    now?: number | undefined;
  },
  db: DatabaseSync = getDatabase(),
): {
  success: boolean;
  amount: number;
  remainingPurse: number;
  ownerBalance: number;
} {
  const now = params.now ?? Date.now();
  const active = getActiveShopOwnership(params.merchantId, db);
  if (!active || active.ownerId !== params.ownerAccountId) {
    throw new Error('Account is not the active owner of this shop');
  }

  const merchant = getMerchant(params.merchantId, db);
  if (!merchant) {
    throw new Error(`Merchant ${params.merchantId} not found`);
  }

  const withdrawal = validateWithdrawal({
    merchantBalance: merchant.balance,
    requestedAmount: params.amount,
  });

  if (!withdrawal.valid) {
    throw new Error(withdrawal.reason ?? 'Invalid withdrawal amount');
  }

  // 1. Transfer CHROMA from merchant purse to owner
  recordTransaction(
    {
      from: merchant.id,
      to: params.ownerAccountId,
      amount: withdrawal.amount,
      reason: 'shop_withdrawal',
      refId: params.merchantId,
      timestamp: now,
    },
    db,
  );

  // 2. Deduct from merchant balance
  merchant.balance -= withdrawal.amount;
  saveMerchant(merchant, db);

  // 3. Append ownership ledger event
  insertShopOwnership(
    {
      merchantId: params.merchantId,
      ownerId: params.ownerAccountId,
      action: 'withdraw',
      priceMultipliers: active.priceMultipliers,
      unpaidUpkeepDays: active.unpaidUpkeepDays,
      lastUpkeepAt: active.lastUpkeepAt,
      amount: withdrawal.amount,
      active: true,
      timestamp: now,
    },
    db,
  );

  const ownerBalance = getAccountBalance(params.ownerAccountId, db);

  return {
    success: true,
    amount: withdrawal.amount,
    remainingPurse: merchant.balance,
    ownerBalance,
  };
}

// Pays daily shop upkeep from owner's purse to the Lord treasury.
export function payShopUpkeep(
  params: {
    merchantId: string;
    ownerAccountId: string;
    days?: number;
    now?: number;
  },
  db: DatabaseSync = getDatabase(),
): {
  success: boolean;
  amount: number;
} {
  const now = params.now ?? Date.now();
  const active = getActiveShopOwnership(params.merchantId, db);
  if (!active || active.ownerId !== params.ownerAccountId) {
    throw new Error('Account is not the active owner of this shop');
  }

  const days = params.days ?? 1;
  const upkeepAmount = days * SHOPS_CONFIG.upkeepPerDay;
  const ownerBalance = getAccountBalance(params.ownerAccountId, db);

  if (ownerBalance < upkeepAmount) {
    throw new Error(
      `Insufficient funds for upkeep: requires ${upkeepAmount}, available ${ownerBalance}`,
    );
  }

  recordTransaction(
    {
      from: params.ownerAccountId,
      to: TREASURY_ACCOUNT_ID,
      amount: upkeepAmount,
      reason: 'shop_upkeep',
      refId: params.merchantId,
      timestamp: now,
    },
    db,
  );

  insertShopOwnership(
    {
      merchantId: params.merchantId,
      ownerId: params.ownerAccountId,
      action: 'upkeep',
      priceMultipliers: active.priceMultipliers,
      unpaidUpkeepDays: 0,
      lastUpkeepAt: now,
      amount: upkeepAmount,
      active: true,
      timestamp: now,
    },
    db,
  );

  return {
    success: true,
    amount: upkeepAmount,
  };
}

// Processes daily economic upkeep and sale window progression for a shop.
export function tickShopDay(
  params: {
    merchantId: string;
    now: number;
  },
  db: DatabaseSync = getDatabase(),
): {
  merchantId: string;
  forfeited: boolean;
  bailoutReopened: boolean;
  unpaidUpkeepDays: number;
} {
  const active = getActiveShopOwnership(params.merchantId, db);

  if (active) {
    // Player-owned shop: attempt daily upkeep deduction
    const ownerBalance = getAccountBalance(active.ownerId, db);
    const upkeepAmount = SHOPS_CONFIG.upkeepPerDay;

    if (ownerBalance >= upkeepAmount) {
      // Upkeep successfully paid
      recordTransaction(
        {
          from: active.ownerId,
          to: TREASURY_ACCOUNT_ID,
          amount: upkeepAmount,
          reason: 'shop_upkeep',
          refId: params.merchantId,
          timestamp: params.now,
        },
        db,
      );

      insertShopOwnership(
        {
          merchantId: params.merchantId,
          ownerId: active.ownerId,
          action: 'upkeep',
          priceMultipliers: active.priceMultipliers,
          unpaidUpkeepDays: 0,
          lastUpkeepAt: params.now,
          amount: upkeepAmount,
          active: true,
          timestamp: params.now,
        },
        db,
      );

      return {
        merchantId: params.merchantId,
        forfeited: false,
        bailoutReopened: false,
        unpaidUpkeepDays: 0,
      };
    } else {
      // Upkeep unpaid
      const newUnpaidDays = active.unpaidUpkeepDays + 1;
      const upkeepCheck = checkUpkeepStatus({ unpaidDays: newUnpaidDays });

      if (upkeepCheck.forfeited) {
        // Shop forfeited back to sale
        insertShopOwnership(
          {
            merchantId: params.merchantId,
            ownerId: active.ownerId,
            action: 'forfeit',
            priceMultipliers: active.priceMultipliers,
            unpaidUpkeepDays: newUnpaidDays,
            lastUpkeepAt: active.lastUpkeepAt,
            amount: 0,
            active: false,
            timestamp: params.now,
          },
          db,
        );

        const merchant = getMerchant(params.merchantId, db);
        if (merchant) {
          merchant.status = 'closed';
          merchant.daysBroke = MERCHANT_CONFIG.closureDays;
          saveMerchant(merchant, db);
        }

        insertShopSale(
          {
            merchantId: params.merchantId,
            sellerId: active.ownerId,
            itemType: 'shop_listing',
            price: SHOPS_CONFIG.salePrice,
            timestamp: params.now,
          },
          db,
        );

        return {
          merchantId: params.merchantId,
          forfeited: true,
          bailoutReopened: false,
          unpaidUpkeepDays: newUnpaidDays,
        };
      } else {
        insertShopOwnership(
          {
            merchantId: params.merchantId,
            ownerId: active.ownerId,
            action: 'upkeep',
            priceMultipliers: active.priceMultipliers,
            unpaidUpkeepDays: newUnpaidDays,
            lastUpkeepAt: active.lastUpkeepAt,
            amount: 0,
            active: true,
            timestamp: params.now,
          },
          db,
        );

        return {
          merchantId: params.merchantId,
          forfeited: false,
          bailoutReopened: false,
          unpaidUpkeepDays: newUnpaidDays,
        };
      }
    }
  }

  // Not player-owned: check if closed and on sale
  const merchant = getMerchant(params.merchantId, db);
  if (merchant && merchant.status === 'closed') {
    const newDaysBroke = merchant.daysBroke + 1;
    merchant.daysBroke = newDaysBroke;
    saveMerchant(merchant, db);

    const daysOnSale = Math.max(1, newDaysBroke - MERCHANT_CONFIG.closureDays);
    const expiryCheck = checkShopSaleExpiry({ daysOnSale });
    if (expiryCheck.expired) {
      // Unsold after sale window: new NPC arrives with bailout grant from treasury
      const revived = applyMerchantBailout(merchant);
      recordTransaction(
        {
          from: TREASURY_ACCOUNT_ID,
          to: merchant.id,
          amount: MERCHANT_CONFIG.bailoutGrant,
          reason: 'merchant_bailout',
          refId: merchant.id,
          timestamp: params.now,
        },
        db,
      );
      saveMerchant(revived, db);

      insertShopSale(
        {
          merchantId: params.merchantId,
          sellerId: TREASURY_ACCOUNT_ID,
          itemType: 'shop_bailout',
          price: 0,
          timestamp: params.now,
          metadata: { outcome: 'unsold_new_npc' },
        },
        db,
      );

      return {
        merchantId: params.merchantId,
        forfeited: false,
        bailoutReopened: true,
        unpaidUpkeepDays: 0,
      };
    }
  }

  return {
    merchantId: params.merchantId,
    forfeited: false,
    bailoutReopened: false,
    unpaidUpkeepDays: 0,
  };
}

// Ticks daily shop status across all merchants in the market.
export function tickAllShopsDay(
  now: number,
  db: DatabaseSync = getDatabase(),
): {
  forfeited: string[];
  bailoutReopened: string[];
} {
  const merchants = getAllMerchants(db);
  const forfeited: string[] = [];
  const bailoutReopened: string[] = [];

  for (const m of merchants) {
    const res = tickShopDay({ merchantId: m.id, now }, db);
    if (res.forfeited) forfeited.push(m.id);
    if (res.bailoutReopened) bailoutReopened.push(m.id);
  }

  return { forfeited, bailoutReopened };
}
