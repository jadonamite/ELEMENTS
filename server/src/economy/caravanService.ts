import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  CARAVANS_CONFIG,
  GAME_HOUR_MS,
  type CaravanRouteConfig,
  shardItemId,
  stockKeyForItem,
} from '@elements/shared';
import { getDatabase } from '../db.js';
import { getMerchant, saveMerchant } from './merchantService.js';
import { recordTransaction } from './ledgerService.js';
import { recordItemMove, withSavepoint } from './satchelService.js';
import { isRouteClosedByDirector } from './worldDirectorService.js';

export interface CaravanDispatchResult {
  dispatched: boolean;
  routeId: string;
  routeName: string;
  fromMerchant: string;
  toMerchant: string;
  itemType: string;
  quantity: number;
  totalPrice: number;
  skippedReason?: string;
}

/**
 * Checks when the last caravan was dispatched from ledger history.
 * Returns the timestamp of the last caravan row, or null if no caravan has ever been dispatched.
 */
export function getLastCaravanTime(db: DatabaseSync = getDatabase()): number | null {
  const row = db
    .prepare(
      "SELECT timestamp FROM ledger_entries WHERE reason = 'trade_payment' AND ref_id LIKE 'caravan:%' ORDER BY timestamp DESC LIMIT 1",
    )
    .get() as { timestamp: number } | undefined;
  return row !== undefined ? row.timestamp : null;
}

/**
 * Runs a single caravan route between two keepers if conditions are met.
 * Follows LORE 15 and AGENTS.md item 3:
 * - Items move keeper -> keeper.
 * - Coin is paid the other way (toMerchant pays fromMerchant).
 * - Sender of coin gives coin up; sender of goods gives goods up.
 */
export function dispatchCaravanRoute(
  route: CaravanRouteConfig,
  now: number,
  db: DatabaseSync = getDatabase(),
): CaravanDispatchResult {
  // Check if route is closed by a world director firestorm
  if (isRouteClosedByDirector(route.id, now, db)) {
    return {
      dispatched: false,
      routeId: route.id,
      routeName: route.name,
      fromMerchant: route.fromMerchant,
      toMerchant: route.toMerchant,
      itemType: route.itemType,
      quantity: 0,
      totalPrice: 0,
      skippedReason: `Route ${route.id} is blocked by an active firestorm.`,
    };
  }

  const fromMerchant = getMerchant(route.fromMerchant, db);
  const toMerchant = getMerchant(route.toMerchant, db);

  if (!fromMerchant || !toMerchant) {
    return {
      dispatched: false,
      routeId: route.id,
      routeName: route.name,
      fromMerchant: route.fromMerchant,
      toMerchant: route.toMerchant,
      itemType: route.itemType,
      quantity: 0,
      totalPrice: 0,
      skippedReason: 'One or both merchants do not exist in world data.',
    };
  }

  if (fromMerchant.status === 'closed' || toMerchant.status === 'closed') {
    return {
      dispatched: false,
      routeId: route.id,
      routeName: route.name,
      fromMerchant: route.fromMerchant,
      toMerchant: route.toMerchant,
      itemType: route.itemType,
      quantity: 0,
      totalPrice: 0,
      skippedReason: 'A participating merchant shop is currently closed.',
    };
  }

  const fromStockKey = stockKeyForItem(route.itemType, fromMerchant.inventory) ?? route.itemType;
  const toStockKey = stockKeyForItem(route.itemType, toMerchant.inventory) ?? route.itemType;

  const fromInv = fromMerchant.inventory[fromStockKey];
  const toInv = toMerchant.inventory[toStockKey];

  if (!fromInv || !toInv) {
    return {
      dispatched: false,
      routeId: route.id,
      routeName: route.name,
      fromMerchant: route.fromMerchant,
      toMerchant: route.toMerchant,
      itemType: route.itemType,
      quantity: 0,
      totalPrice: 0,
      skippedReason: `One or both merchants do not stock ${route.itemType}.`,
    };
  }

  const quantity = Math.min(route.cargoQuantity, fromInv.stock);
  if (quantity <= 0) {
    return {
      dispatched: false,
      routeId: route.id,
      routeName: route.name,
      fromMerchant: route.fromMerchant,
      toMerchant: route.toMerchant,
      itemType: route.itemType,
      quantity: 0,
      totalPrice: 0,
      skippedReason: 'Source keeper has no stock to dispatch in caravan.',
    };
  }

  // Cost per unit based on source merchant's base price
  const unitPrice = fromInv.basePrice;
  const totalPrice = unitPrice * quantity;

  if (toMerchant.balance < totalPrice) {
    return {
      dispatched: false,
      routeId: route.id,
      routeName: route.name,
      fromMerchant: route.fromMerchant,
      toMerchant: route.toMerchant,
      itemType: route.itemType,
      quantity: 0,
      totalPrice: 0,
      skippedReason: `Destination keeper has insufficient purse (${toMerchant.balance} < ${totalPrice}).`,
    };
  }

  const caravanId = `caravan:${route.id}:${now}:${randomUUID().slice(0, 8)}`;
  const itemId = route.itemType === 'shard' ? shardItemId(fromMerchant.nation) : route.itemType;

  return withSavepoint(db, () => {
    // 1. Coin paid from destination keeper to source keeper
    recordTransaction(
      {
        from: toMerchant.id,
        to: fromMerchant.id,
        amount: totalPrice,
        reason: 'trade_payment',
        refId: caravanId,
        metadata: {
          routeId: route.id,
          itemType: route.itemType,
          quantity,
          unitPrice,
        },
        timestamp: now,
      },
      db,
    );

    // 2. Item moves from source keeper to destination keeper
    recordItemMove(
      db,
      fromMerchant.id,
      toMerchant.id,
      { itemId, quantity },
      'trade',
      caravanId,
      now,
    );

    // 3. Update inventory and balances
    fromInv.stock -= quantity;
    toInv.stock += quantity;
    fromMerchant.balance += totalPrice;
    toMerchant.balance -= totalPrice;

    saveMerchant(fromMerchant, db);
    saveMerchant(toMerchant, db);

    return {
      dispatched: true,
      routeId: route.id,
      routeName: route.name,
      fromMerchant: route.fromMerchant,
      toMerchant: route.toMerchant,
      itemType: route.itemType,
      quantity,
      totalPrice,
    };
  });
}

/**
 * Ticks caravans on schedule: checks if the caravan interval has passed,
 * and dispatches eligible routes from the rule file.
 */
export function tickCaravans(
  params: { now: number; force?: boolean },
  db: DatabaseSync = getDatabase(),
): CaravanDispatchResult[] {
  const intervalMs = CARAVANS_CONFIG.intervalHours * GAME_HOUR_MS;
  const lastTime = getLastCaravanTime(db);

  if (!params.force && lastTime !== null && params.now - lastTime < intervalMs) {
    return [];
  }

  const results: CaravanDispatchResult[] = [];
  for (const route of CARAVANS_CONFIG.routes) {
    const res = dispatchCaravanRoute(route, params.now, db);
    results.push(res);
  }

  return results;
}
