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
  | 'merchant_restock'
  | 'merchant_tribute'
  | 'counting_house_deposit'
  | 'counting_house_withdrawal'
  | 'counting_house_fee'
  | 'edict_fine'
  | 'jail_seizure'
  | 'jail_fine'
  | 'robbery'
  | 'loot_drop'
  | 'loot_claim'
  | 'loot_expired'
  | 'training_tithe'
  | 'repair_fee'
  | 'upkeep_fee'
  | 'shop_purchase'
  | 'shop_upkeep'
  | 'shop_withdrawal';

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

export interface QuoteStep {
  rule: string;
  effect: number;
  words: string;
}

export interface Quote {
  unitPrice: number;
  canExecute: boolean;
  reason?: string;
  steps: QuoteStep[];
  summary: string;
}

export interface DemandEntry {
  action: 'buy' | 'sell';
  quantity: number;
  timestamp: number;
}

export type DemandWindow = Record<string, DemandEntry[]>;

export interface ShardSaleEntry {
  element: string;
  quantity: number;
  timestamp: number;
}

export type Colour = 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA';

export type LootSource = 'villain' | 'monster' | 'player_death';

export interface LootContents {
  chroma: number;
  shards: Record<Colour, number>;
  materials: Record<string, number>;
}

export interface LootPile {
  id: string;
  x: number;
  z: number;
  zone: string;
  contents: LootContents;
  droppedAt: number;
  ownerId: string | null;
  ownerUntil: number;
  expiresAt: number;
  source: LootSource;
  claimed?: boolean | undefined;
  claimedBy?: string | null | undefined;
  claimedAt?: number | null | undefined;
  expired?: boolean | undefined;
}

export type ShopOwnershipAction =
  | 'purchase'
  | 'set_prices'
  | 'stock'
  | 'upkeep'
  | 'withdraw'
  | 'forfeit'
  | 'relinquish';

export interface ShopOwnershipRecord {
  id: string;
  merchantId: string;
  ownerId: string;
  action: ShopOwnershipAction;
  priceMultipliers: Record<string, number>;
  unpaidUpkeepDays: number;
  lastUpkeepAt: number;
  amount: number;
  active: boolean;
  timestamp: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface ShopSaleRecord {
  id: string;
  merchantId: string;
  buyerId?: string | null | undefined;
  sellerId?: string | null | undefined;
  itemType: string;
  quantity: number;
  price: number;
  timestamp: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface ShopForSale {
  merchantId: string;
  name: string;
  nation: string;
  salePrice: number;
  daysOnSale: number;
  remainingDays: number;
  inventory: Record<string, MerchantInventoryItem>;
  listedAt: number;
}

