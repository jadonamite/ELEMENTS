import {
  INITIAL_BALANCES,
  MASTER_ACCOUNT_IDS,
  MERCHANT_ACCOUNT_IDS,
  RIVAL_GUILD_ACCOUNT_ID,
  TOTAL_CHROMA_SUPPLY,
  TREASURY_ACCOUNT_ID,
  TREASURY_PAYOUT_BASELINE,
} from './constants.js';
import type { LedgerEntry, LedgerReason } from './types.js';

export function calculateTreasuryPayout(
  basePayout: number,
  treasuryBalance: number,
  baseline = TREASURY_PAYOUT_BASELINE,
): number {
  if (basePayout <= 0 || treasuryBalance <= 0 || baseline <= 0) {
    return 0;
  }
  const scaled = Math.round(basePayout * (treasuryBalance / baseline));
  return Math.max(1, scaled);
}

export function validateLedgerEntry(
  balances: ReadonlyMap<string, number>,
  entry: LedgerEntry,
  expectedTotalSupply = TOTAL_CHROMA_SUPPLY,
): { valid: boolean; error?: string } {
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
    return { valid: false, error: 'Amount must be a positive integer' };
  }
  if (!entry.from || !entry.to) {
    return { valid: false, error: 'Both sender and receiver are required' };
  }
  if (entry.from === entry.to) {
    return { valid: false, error: 'Sender and receiver cannot be the same' };
  }

  // Genesis mint is only from 'system' or 'genesis' to initial holders
  if (entry.reason === 'genesis') {
    if (entry.from !== 'genesis' && entry.from !== 'system') {
      return { valid: false, error: 'Genesis entries must originate from genesis' };
    }
    return { valid: true };
  }

  const senderBalance = balances.get(entry.from) ?? 0;
  if (senderBalance < entry.amount) {
    return {
      valid: false,
      error: `Insufficient balance: ${entry.from} has ${senderBalance}, needs ${entry.amount}`,
    };
  }

  // Verify total supply invariant after hypothetical application
  const total = computeTotalSupply(balances);
  if (total !== expectedTotalSupply) {
    return {
      valid: false,
      error: `Supply invariant violated: current total ${total} != expected ${expectedTotalSupply}`,
    };
  }

  return { valid: true };
}

export function computeTotalSupply(balances: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const b of balances.values()) {
    sum += b;
  }
  return sum;
}

export function applyLedgerEntry(
  balances: Map<string, number>,
  entry: LedgerEntry,
): void {
  const currentFrom = balances.get(entry.from) ?? 0;
  const currentTo = balances.get(entry.to) ?? 0;

  if (entry.reason !== 'genesis') {
    balances.set(entry.from, currentFrom - entry.amount);
  }
  balances.set(entry.to, currentTo + entry.amount);
}

export function deriveBalances(entries: readonly LedgerEntry[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const entry of entries) {
    const currentFrom = balances.get(entry.from) ?? 0;
    const currentTo = balances.get(entry.to) ?? 0;
    if (entry.reason !== 'genesis') {
      balances.set(entry.from, currentFrom - entry.amount);
    }
    balances.set(entry.to, currentTo + entry.amount);
  }
  return balances;
}

export function createGenesisEntries(timestamp = Date.now()): LedgerEntry[] {
  const entries: LedgerEntry[] = [];

  // Treasury
  entries.push({
    id: 'genesis_treasury',
    from: 'genesis',
    to: TREASURY_ACCOUNT_ID,
    amount: INITIAL_BALANCES.treasury,
    reason: 'genesis',
    timestamp,
    metadata: { holder: 'The Lord Treasury' },
  });

  // 5 merchants
  for (const merchantId of MERCHANT_ACCOUNT_IDS) {
    entries.push({
      id: `genesis_${merchantId}`,
      from: 'genesis',
      to: merchantId,
      amount: INITIAL_BALANCES.merchantPerStore,
      reason: 'genesis',
      timestamp,
      metadata: { holder: 'NPC Merchant' },
    });
  }

  // 4 masters
  for (const masterId of MASTER_ACCOUNT_IDS) {
    entries.push({
      id: `genesis_${masterId}`,
      from: 'genesis',
      to: masterId,
      amount: INITIAL_BALANCES.masterPerNation,
      reason: 'genesis',
      timestamp,
      metadata: { holder: 'Elemental Master' },
    });
  }

  // Rival guild
  entries.push({
    id: 'genesis_rival_guild',
    from: 'genesis',
    to: RIVAL_GUILD_ACCOUNT_ID,
    amount: INITIAL_BALANCES.rivalGuild,
    reason: 'genesis',
    timestamp,
    metadata: { holder: 'Rival Clan' },
  });

  return entries;
}

export function createPlayerGrantEntry(
  playerId: string,
  timestamp = Date.now(),
  amount = INITIAL_BALANCES.playerStartingPurse,
): LedgerEntry {
  return {
    id: `grant_${playerId}_${timestamp}`,
    from: TREASURY_ACCOUNT_ID,
    to: playerId,
    amount,
    reason: 'player_starting_grant',
    timestamp,
    refId: playerId,
  };
}
