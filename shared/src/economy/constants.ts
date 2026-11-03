import { readFileSync } from 'node:fs';

function loadEconomyBalance() {
  try {
    const raw = readFileSync(new URL('../../balance.json', import.meta.url), 'utf-8');
    return JSON.parse(raw)?.economy;
  } catch {
    return null;
  }
}

const economyBalance = loadEconomyBalance();

export const TOTAL_CHROMA_SUPPLY = economyBalance?.totalSupply ?? 10_000_000;
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
  treasury: economyBalance?.initialBalances?.treasury ?? 7_000_000,
  merchantPerStore: economyBalance?.initialBalances?.merchants ?? 300_000,
  masterPerNation: economyBalance?.initialBalances?.masters ?? 250_000,
  rivalGuild: economyBalance?.initialBalances?.rivalGuild ?? 500_000,
  playerStartingPurse: economyBalance?.startingPurse ?? 100,
} as const;

export const TREASURY_PAYOUT_BASELINE = economyBalance?.treasuryBaseline ?? 7_000_000;

export const GAME_HOUR_MS = 60 * 60 * 1000;

export const DEMAND_CONFIG = {
  windowHours: economyBalance?.merchant?.demand?.windowHours ?? 24,
  windowMs: (economyBalance?.merchant?.demand?.windowHours ?? 24) * GAME_HOUR_MS,
  maxDemandFactor: economyBalance?.merchant?.demand?.maxDemandFactor ?? 0.3,
} as const;

export const COLOR_BALANCE_CONFIG = {
  windowHours: economyBalance?.merchant?.colorBalance?.windowHours ?? 48,
  windowMs: (economyBalance?.merchant?.colorBalance?.windowHours ?? 48) * GAME_HOUR_MS,
  thresholdRatio: economyBalance?.merchant?.colorBalance?.thresholdRatio ?? 0.4,
  discountRate: economyBalance?.merchant?.colorBalance?.discountRate ?? 0.2,
  counterPremiumRate: economyBalance?.merchant?.colorBalance?.counterPremiumRate ?? 0.2,
} as const;

export const MERCHANT_CONFIG = {
  brokeThreshold: economyBalance?.merchant?.brokeThreshold ?? 1_000,
  closureDays: economyBalance?.merchant?.closureDays ?? 3,
  bailoutGrant: economyBalance?.merchant?.bailoutGrant ?? 100_000,
  outsiderBuySurcharge: economyBalance?.merchant?.outsiderBuySurcharge ?? 0.2,
  outsiderSellDiscount: economyBalance?.merchant?.outsiderSellDiscount ?? 0.1,
  defaultSellMargin: economyBalance?.merchant?.defaultSellMargin ?? 0.8,
  maxPriceMultiplier: economyBalance?.merchant?.maxPriceMultiplier ?? 3.9,
  minPrice: economyBalance?.merchant?.minPrice ?? 1,
  basePrices: {
    shard: economyBalance?.merchant?.basePrices?.shard ?? 10,
    potion: economyBalance?.merchant?.basePrices?.potion ?? 20,
    item: economyBalance?.merchant?.basePrices?.item ?? 150,
  },
  defaultMaxStock: {
    shard: 200,
    potion: 100,
    item: 50,
  },
  demand: DEMAND_CONFIG,
  colorBalance: COLOR_BALANCE_CONFIG,
} as const;

export const TAX_RATES = {
  dimTradeTax: economyBalance?.taxes?.dimTradeTaxRate ?? 0.05,
  litToLitTradeTax: economyBalance?.taxes?.litToLitTaxRate ?? 0.2,
  merchantSalesTax: economyBalance?.taxes?.merchantSalesTaxRate ?? 0.05,
} as const;

export const CRIME_CONFIG = {
  redFlagDurationMs: economyBalance?.crime?.redFlagDurationMs ?? 30 * 60 * 1000,
  flagsToBounty: economyBalance?.crime?.flagsToBounty ?? 3,
  bountyStartingReward: 150,
  jailSeizureRate: economyBalance?.crime?.jailSeizureRate ?? 0.4,
  jailBaseFine: economyBalance?.crime?.jailBaseFine ?? 50,
} as const;

export const DEATH_CONFIG = {
  carriedShardLossRate: economyBalance?.death?.carriedShardLossRate ?? 0.25,
} as const;

export const DROPS_CONFIG = {
  ownerSeconds: economyBalance?.drops?.ownerSeconds ?? 60,
  expireMinutes: economyBalance?.drops?.expireMinutes ?? 15,
  claimRadius: economyBalance?.drops?.claimRadius ?? 1.5,
  monsterNationDropChance: economyBalance?.drops?.monsterNationDropChance ?? 0.4,
  monsterChromaraDropChance: economyBalance?.drops?.monsterChromaraDropChance ?? 0.3,
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

export interface SindrMerchantConfig {
  id: string;
  name: string;
  nation: string;
  personality: string;
  startingPurse: number;
  inventory: Record<string, { stock: number; maxStock: number; basePrice: number }>;
}

export const SINDR_MERCHANTS: SindrMerchantConfig[] = economyBalance?.merchants?.sindr ?? [
  {
    id: 'sindr_shards',
    name: 'Sindr Shards and Materials',
    nation: 'IGNIS',
    personality: 'A keen-eyed trader with charcoal-stained fingers who knows the true weight of every rough shard.',
    startingPurse: 20000,
    inventory: {
      shard: { stock: 100, maxStock: 200, basePrice: 10 },
      material: { stock: 50, maxStock: 100, basePrice: 15 },
    },
  },
  {
    id: 'sindr_supplies',
    name: 'Sindr Potions and Supplies',
    nation: 'IGNIS',
    personality: 'A calm apothecary measuring every tincture by the drop, wary of waste and sudden shortages.',
    startingPurse: 20000,
    inventory: {
      potion: { stock: 50, maxStock: 100, basePrice: 20 },
      supplies: { stock: 50, maxStock: 100, basePrice: 25 },
    },
  },
  {
    id: 'sindr_arms',
    name: 'Sindr Arms and Armour',
    nation: 'IGNIS',
    personality: 'A weathered veteran smith who judges folk by the balance of their blade and the firmness of their purse.',
    startingPurse: 20000,
    inventory: {
      item: { stock: 25, maxStock: 50, basePrice: 150 },
      armour: { stock: 25, maxStock: 50, basePrice: 150 },
    },
  },
];

export const AGENT_CONFIG = {
  tickGameMinutes: economyBalance?.agents?.tickGameMinutes ?? 30,
  dayStartHour: economyBalance?.agents?.dayStartHour ?? 6,
  nightStartHour: economyBalance?.agents?.nightStartHour ?? 20,
  minOpenHour: economyBalance?.agents?.minOpenHour ?? 6,
  maxCloseHour: economyBalance?.agents?.maxCloseHour ?? 22,
  restockStockRatio: economyBalance?.agents?.restockStockRatio ?? 0.3,
  tributeStockRatio: economyBalance?.agents?.tributeStockRatio ?? 0.9,
  // Share of base price the Lord pays for goods shipped as tribute.
  tributePriceRatio: economyBalance?.agents?.tributePriceRatio ?? 0.25,
} as const;

export const SHOPS_CONFIG = {
  salePrice: economyBalance?.shops?.salePrice ?? 2_000,
  saleDays: economyBalance?.shops?.saleDays ?? 3,
  maxPerPlayer: economyBalance?.shops?.maxPerPlayer ?? 1,
  upkeepPerDay: economyBalance?.shops?.upkeepPerDay ?? 10,
  minPriceMultiplier: economyBalance?.shops?.minPriceMultiplier ?? 0.6,
  maxPriceMultiplier: economyBalance?.shops?.maxPriceMultiplier ?? 2.5,
  unpaidUpkeepDaysToForfeit: economyBalance?.shops?.unpaidUpkeepDaysToForfeit ?? 7,
} as const;


