/** Shapes of the raids block in shared/balance.json. Every item kind, key and material is data. */

export type ItemCategory = 'material' | 'shard' | 'gear';
export type LootRule = 'equal' | 'need' | 'leader';
export type LitElement = 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA';

export interface ItemKindDef {
  name: string;
  kind: ItemCategory;
  basePrice: number;
  rarity: string;
  use?: string;
  stats?: Record<string, number>;
}

export interface KeyDef {
  name: string;
  dungeon: string;
  basePrice: number;
  maxStock: number;
  startStock: number;
  /** What the Hall pays a Dim crafter for one key. */
  craftCost: number;
  craftedBy: string;
}

export interface HallConfig {
  startingPurse: number;
  hireCut: number;
  keyPriceSlope: number;
  keyDemandWindowHours: number;
  keyDemandStep: number;
  keyDemandMax: number;
  keyPriceMin: number;
  keyPriceMax: number;
  restockBelow: number;
  complaintWindowDays: number;
  barAfterUpheld: number;
  barDays: number;
  jobRewardMax: number;
  maxOpenJobs: number;
  rosterSize: number;
  recruitPurse: number;
}

export interface FighterTemplate {
  id: string;
  name: string;
  element: LitElement;
  skill: number;
  courage: number;
  purse: number;
}

export interface FightersConfig {
  wageBase: number;
  wagePerSkill: number;
  wageCurve: number;
  skillMin: number;
  skillMax: number;
  healthBase: number;
  healthPerSkill: number;
  damageBase: number;
  damagePerSkill: number;
  fleeBelow: number;
  fleeChancePerCheck: number;
  fleeCheckSeconds: number;
  trainingCostPerSkill: number;
  refuseBelowScore: number;
  dangerTolerance: number;
  roster: FighterTemplate[];
  recruitNames: string[];
  recruitElements: LitElement[];
}

export interface EnemyGroupDef {
  kind: string;
  count: number;
  health: number;
  boss?: string;
}

export interface RoomDef {
  name: string;
  kind: 'entry' | 'fight' | 'boss';
  enemies: EnemyGroupDef[];
  carving?: string;
}

export interface LootEntry {
  item: string;
  chance: number;
  min: number;
  max: number;
}

export interface DungeonDef {
  name: string;
  nation: string;
  minPlayers: number;
  maxPlayers: number;
  roomsPerRun: number;
  entry: string;
  /** No fight room can honestly be cleared faster than this; quicker reports are refused. */
  minClearSeconds: number;
  danger: number;
  rooms: Record<string, RoomDef>;
  boss: { id: string; name: string; scale: number; damage: number; speed: number };
  loot: { fight: LootEntry[]; boss: LootEntry[] };
  carvings: Record<string, string>;
}

export interface LossConfig {
  carriedShare: number;
  gearWear: number;
  lostCoinTo: string;
}

export interface SalvageConfig {
  id: string;
  name: string;
  startingPurse: number;
  baseDiscount: number;
  minDiscount: number;
  maxDiscount: number;
  underBestMerchant: number;
  holdPenalty: number;
  maxHold: Record<ItemCategory, number>;
  shipOnwardAbove: number;
}

export interface RaidsConfig {
  placeholder: boolean;
  party: { maxSize: number; inviteSeconds: number; lootRules: LootRule[] };
  itemKinds: Record<string, ItemKindDef>;
  keys: Record<string, KeyDef>;
  hall: HallConfig;
  fighters: FightersConfig;
  dungeons: Record<string, DungeonDef>;
  loss: LossConfig;
  salvage: SalvageConfig;
}

/** A stack of one item kind. */
export type Bag = Record<string, number>;

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(reason: string): Result<T> => ({ ok: false, reason });
