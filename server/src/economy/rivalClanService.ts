import type { DatabaseSync } from 'node:sqlite';
import {
  RIVAL_CLAN_CONFIG,
  RIVAL_GUILD_ACCOUNT_ID,
  GAME_HOUR_MS,
  type MerchantState,
} from '@elements/shared';
import { getDatabase } from '../db.js';
import { getAccountBalance } from './ledgerService.js';
import { getAllMerchants, buyFromMerchant, quoteMerchantTrade } from './merchantService.js';

export interface RivalClanTradeResult {
  executed: boolean;
  action: 'buy' | 'sell';
  merchantId: string;
  itemType: string;
  quantity: number;
  totalPrice: number;
  rivalBalanceAfter: number;
  skippedReason?: string;
}

/**
 * Returns when the rival clan last traded with a keeper from the ledger.
 */
export function getLastRivalTradeTime(db: DatabaseSync = getDatabase()): number {
  const row = db
    .prepare(
      `SELECT timestamp
       FROM ledger_entries
       WHERE (sender = ? OR receiver = ?)
         AND reason IN ('merchant_buy', 'merchant_sell')
         AND (ref_id LIKE 'rival:%' OR sender = ?)
       ORDER BY timestamp DESC LIMIT 1`,
    )
    .get(RIVAL_GUILD_ACCOUNT_ID, RIVAL_GUILD_ACCOUNT_ID, RIVAL_GUILD_ACCOUNT_ID) as
    | { timestamp: number }
    | undefined;

  return row?.timestamp ?? 0;
}

/**
 * Executes an autonomous trade for the rival clan on its own ledger/NEAR account.
 * Follows AGENTS.md item 21 and the 14 Nov genesis account.
 */
export function tickRivalClanTrade(
  params: { now: number; force?: boolean },
  db: DatabaseSync = getDatabase(),
): RivalClanTradeResult {
  const intervalMs = RIVAL_CLAN_CONFIG.tradeIntervalHours * GAME_HOUR_MS;
  const lastTime = getLastRivalTradeTime(db);

  if (!params.force && lastTime > 0 && params.now - lastTime < intervalMs) {
    return {
      executed: false,
      action: 'buy',
      merchantId: '',
      itemType: '',
      quantity: 0,
      totalPrice: 0,
      rivalBalanceAfter: getAccountBalance(RIVAL_GUILD_ACCOUNT_ID, db),
      skippedReason: 'Trade interval has not yet elapsed for rival clan.',
    };
  }

  const rivalBalance = getAccountBalance(RIVAL_GUILD_ACCOUNT_ID, db);
  if (rivalBalance < 50) {
    return {
      executed: false,
      action: 'buy',
      merchantId: '',
      itemType: '',
      quantity: 0,
      totalPrice: 0,
      rivalBalanceAfter: rivalBalance,
      skippedReason: 'Rival clan purse is too low for market operations.',
    };
  }

  // Find open merchants with inventory
  const merchants = getAllMerchants(db).filter((m) => m.status === 'open');
  if (merchants.length === 0) {
    return {
      executed: false,
      action: 'buy',
      merchantId: '',
      itemType: '',
      quantity: 0,
      totalPrice: 0,
      rivalBalanceAfter: rivalBalance,
      skippedReason: 'No merchant counters are open for trade.',
    };
  }

  // Pick a merchant and an available preferred item
  for (const m of merchants) {
    for (const prefItem of RIVAL_CLAN_CONFIG.preferredItems) {
      const invItem =
        m.inventory[prefItem] ??
        (prefItem === 'shard' ? m.inventory['shard'] : undefined);

      if (invItem && invItem.stock > 2) {
        const quote = quoteMerchantTrade(
          {
            merchantId: m.id,
            itemType: prefItem,
            action: 'buy',
            quantity: 1,
            buyerAccountId: RIVAL_GUILD_ACCOUNT_ID,
            now: params.now,
          },
          db,
        );

        if (quote.canExecute && quote.unitPrice <= RIVAL_CLAN_CONFIG.maxTradeSpend && rivalBalance >= quote.unitPrice) {
          const qty = Math.min(
            2,
            Math.min(
              invItem.stock - 1,
              Math.floor(RIVAL_CLAN_CONFIG.maxTradeSpend / quote.unitPrice),
            ),
          );
          if (qty <= 0) continue;

          try {
            const result = buyFromMerchant(
              {
                merchantId: m.id,
                buyerAccountId: RIVAL_GUILD_ACCOUNT_ID,
                itemType: prefItem,
                quantity: qty,
                now: params.now,
              },
              db,
            );

            return {
              executed: true,
              action: 'buy',
              merchantId: m.id,
              itemType: prefItem,
              quantity: qty,
              totalPrice: result.totalPrice,
              rivalBalanceAfter: getAccountBalance(RIVAL_GUILD_ACCOUNT_ID, db),
            };
          } catch (err) {
            // If quote succeeded but purchase failed, continue to next candidate
            continue;
          }
        }
      }
    }
  }

  return {
    executed: false,
    action: 'buy',
    merchantId: '',
    itemType: '',
    quantity: 0,
    totalPrice: 0,
    rivalBalanceAfter: rivalBalance,
    skippedReason: 'No suitable goods within trade spend limit found on merchant shelves.',
  };
}
