import type { DatabaseSync } from 'node:sqlite';
import {
  type LedgerEntry,
  calculateTradeTax,
  TREASURY_ACCOUNT_ID,
  type PlayerEconomyRole,
} from '@elements/shared';
import { getDatabase, getRising } from '../db.js';
import { getAccountBalance, recordTransaction } from './ledgerService.js';

export function executePlayerTrade(
  params: {
    buyerId: string;
    sellerId: string;
    amount: number;
    refId?: string;
    metadata?: Record<string, unknown>;
  },
  db: DatabaseSync = getDatabase(),
): {
  tradeEntry: LedgerEntry;
  taxEntry: LedgerEntry;
  taxAmount: number;
  sellerReceives: number;
} {
  if (params.amount <= 0) {
    throw new Error('Trade amount must be a positive integer');
  }
  if (params.buyerId === params.sellerId) {
    throw new Error('Cannot trade with oneself');
  }

  const buyerBalance = getAccountBalance(params.buyerId, db);
  if (buyerBalance < params.amount) {
    throw new Error(`Insufficient funds: buyer has ${buyerBalance}, trade needs ${params.amount}`);
  }

  const buyerRising = getRising(params.buyerId, db);
  const sellerRising = getRising(params.sellerId, db);

  const buyerRole: PlayerEconomyRole = buyerRising?.role === 'Hush' ? 'Hush' : 'Shaper';
  const sellerRole: PlayerEconomyRole = sellerRising?.role === 'Hush' ? 'Hush' : 'Shaper';

  const tax = calculateTradeTax(params.amount, buyerRole, sellerRole);

  // 1. Transfer net payment to seller
  const tradeParams: {
    from: string;
    to: string;
    amount: number;
    reason: 'trade_payment';
    refId?: string;
    metadata?: Record<string, unknown>;
  } = {
    from: params.buyerId,
    to: params.sellerId,
    amount: tax.sellerReceives,
    reason: 'trade_payment',
  };
  if (params.refId) tradeParams.refId = params.refId;
  if (params.metadata) tradeParams.metadata = params.metadata;

  const tradeEntry = recordTransaction(tradeParams, db);

  // 2. Transfer market tax to Treasury
  const taxEntry = recordTransaction(
    {
      from: params.buyerId,
      to: TREASURY_ACCOUNT_ID,
      amount: tax.taxAmount,
      reason: 'market_tax',
      refId: params.refId ?? `tax:${tradeEntry.id}`,
      metadata: {
        buyerRole,
        sellerRole,
        grossAmount: params.amount,
        rate: tax.taxRate,
      },
    },
    db,
  );

  return {
    tradeEntry,
    taxEntry,
    taxAmount: tax.taxAmount,
    sellerReceives: tax.sellerReceives,
  };
}
