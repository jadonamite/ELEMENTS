export const TOTAL_CHROMA_SUPPLY = 10_000_000;
export const TREASURY_ACCOUNT_ID = 'treasury';
export const RIVAL_GUILD_ACCOUNT_ID = 'rival_guild';

export const MERCHANT_ACCOUNT_IDS = [
  'merchant_ignis',
  'merchant_aques',
  'merchant_terra',
  'merchant_aura',
  'merchant_chromara',
] as const;

export const MASTER_ACCOUNT_IDS = [
  'master_ignis',
  'master_aques',
  'master_terra',
  'master_aura',
] as const;

export const INITIAL_BALANCES = {
  treasury: 7_000_000,
  merchantPerStore: 300_000,
  masterPerNation: 250_000,
  rivalGuild: 500_000,
  playerStartingPurse: 100,
} as const;

export const TREASURY_PAYOUT_BASELINE = 7_000_000;

export const MERCHANT_CONFIG = {
  brokeThreshold: 1_000,
  closureDays: 3,
  bailoutGrant: 100_000,
  outsiderBuySurcharge: 0.2,
  outsiderSellDiscount: 0.1,
  basePrices: {
    shard: 10,
    potion: 20,
    item: 150,
  },
  defaultMaxStock: {
    shard: 200,
    potion: 100,
    item: 50,
  },
} as const;

export const TAX_RATES = {
  dimTradeTax: 0.05,
  litToLitTradeTax: 0.2,
  merchantSalesTax: 0.05,
} as const;

export const CRIME_CONFIG = {
  redFlagDurationMs: 30 * 60 * 1000, // 30 minutes
  flagsToBounty: 3,
  bountyStartingReward: 150,
  jailSeizureRate: 0.4,
  jailBaseFine: 50,
} as const;

export const COUNTING_HOUSES = [
  { id: 'bank_chromara_main', nation: 'CHROMARA', name: 'Chromara Central Bank' },
  { id: 'ch_chromara_north', nation: 'CHROMARA', name: 'Chromara North Vault' },
  { id: 'ch_chromara_south', nation: 'CHROMARA', name: 'Chromara Canal Branch' },
  { id: 'ch_chromara_market', nation: 'CHROMARA', name: 'Chromara High Market Branch' },
  { id: 'ch_ignis_sindr_upper', nation: 'IGNIS', name: 'Sindr Upper Ledger' },
  { id: 'ch_ignis_sindr_lower', nation: 'IGNIS', name: 'Sindr Low Gate Vault' },
  { id: 'ch_aques_delta_1', nation: 'AQUES', name: 'Aques Grand Stilt Counter' },
  { id: 'ch_aques_delta_2', nation: 'AQUES', name: 'Aques Canal Weighhouse' },
  { id: 'ch_terra_canyon_1', nation: 'TERRA', name: 'Terra Cliff Depository' },
  { id: 'ch_terra_canyon_2', nation: 'TERRA', name: 'Terra Red Ochre Hall' },
  { id: 'ch_aura_spire_1', nation: 'AURA', name: 'Aura High Span Counter' },
  { id: 'ch_aura_spire_2', nation: 'AURA', name: 'Aura Wind Gate Vault' },
] as const;
