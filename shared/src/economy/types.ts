export type AccountRole = 'treasury' | 'merchant' | 'master' | 'rival_guild' | 'player';

export type LedgerReason =
  | 'genesis'
  | 'player_starting_grant'
  | 'bounty_payout'
  | 'boss_reward'
  | 'trade_payment'
  | 'market_tax'
  | 'merchant_buy'
  | 'merchant_sell'
  | 'merchant_sales_tax'
  | 'merchant_bailout'
  | 'counting_house_deposit'
  | 'counting_house_withdrawal'
  | 'counting_house_fee'
  | 'edict_fine'
  | 'jail_seizure'
  | 'jail_fine'
  | 'robbery'
  | 'loot_drop'
  | 'training_tithe'
  | 'repair_fee'
  | 'upkeep_fee';

export interface LedgerEntry {
  id: string;
  from: string;
  to: string;
  amount: number;
  reason: LedgerReason;
  timestamp: number;
  refId?: string;
  metadata?: Record<string, unknown>;
}

export type MerchantStatus = 'open' | 'broke_buying_paused' | 'closed';

export interface MerchantInventoryItem {
  stock: number;
  maxStock: number;
  basePrice: number;
}

export interface MerchantState {
  id: string;
  nation: string;
  balance: number;
  status: MerchantStatus;
  daysBroke: number;
  inventory: Record<string, MerchantInventoryItem>;
}

export type CountingHouseNoteStatus = 'active' | 'redeemed' | 'cancelled';

export interface CountingHouseNote {
  noteId: string;
  accountId: string;
  amount: number;
  issuedAt: number;
  issuedBy: string;
  status: CountingHouseNoteStatus;
}

export interface RedFlag {
  id: string;
  accountId: string;
  reason: string;
  issuedAt: number;
  expiresAt: number;
  active: boolean;
}

export type BountyStatus = 'open' | 'claimed' | 'pardoned';

export interface Bounty {
  id: string;
  targetAccountId: string;
  rewardChroma: number;
  reason: string;
  issuerId: string;
  issuedAt: number;
  status: BountyStatus;
  claimedBy?: string;
  claimedAt?: number;
}

export interface NpcMemory {
  npcId: string;
  accountId: string;
  score: number;
  updatedAt: number;
}

export interface JailSeizureResult {
  seizedChroma: number;
  seizedVaultChroma: number;
  seizedMaterialsCount: number;
  seizedGearCount: number;
  landSeized: number;
  fineToLeave: number;
  remainingChroma: number;
  remainingVaultChroma: number;
  remainingMaterialsCount: number;
  remainingGearCount: number;
}

export interface TradeTaxResult {
  taxRate: number;
  taxAmount: number;
  sellerReceives: number;
}
