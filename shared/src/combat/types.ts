export const ELEMENTS = ['AQUES', 'IGNIS', 'AURA', 'TERRA'] as const;
export type Element = typeof ELEMENTS[number];
export const WEAPONS = ['sword', 'spear', 'axe', 'twin', 'staff'] as const;
export type Weapon = typeof WEAPONS[number];
/** Weapon swings: their numbers come from the fighter's weapon. */
export const WEAPON_MOVE_IDS = ['light_1', 'light_2', 'light_3', 'heavy_1', 'heavy_2'] as const;
/** Bending slots: throw, sweep, rise, ground, move, ultimate. Their numbers come from the element. */
export const BEND_MOVE_IDS = ['bend_palm', 'bend_sweep', 'uppercut', 'ground_pound', 'dash_strike', 'ultimate'] as const;
/** Moves every fighter shares whatever the element or weapon. */
export const STARTER_MOVE_IDS = [
  'dodge',
  'bare_light_1', 'bare_light_2', 'bare_light_3', 'bare_heavy_1',
  'leg_light_1', 'leg_light_2', 'leg_heavy_1',
  'shard_spark',
] as const;
export const MOVE_IDS = [...WEAPON_MOVE_IDS, ...BEND_MOVE_IDS, ...STARTER_MOVE_IDS] as const;
export type WeaponMoveId = typeof WEAPON_MOVE_IDS[number];
export type BendMoveId = typeof BEND_MOVE_IDS[number];
export type StarterMoveId = typeof STARTER_MOVE_IDS[number];
export type MoveId = typeof MOVE_IDS[number];
export interface MoveDefinition {
  readonly kind: string;
  readonly damage: number;
  readonly reach: number;
  readonly cooldownSeconds: number;
  readonly name?: string;
  readonly heal?: number;
  readonly charges?: number;
}
export interface BurnConfig {
  readonly damagePerSecond: number;
  readonly tickSeconds: number;
  readonly patchDurationMin: number;
  readonly patchDurationMax: number;
  readonly patchRadius: number;
  readonly maxPatches: number;
  readonly villainBurnDuration: number;
}
export interface MeterConfig {
  readonly max: number;
  readonly gainHit: number;
  readonly gainParry: number;
  readonly gainBlocked: number;
  readonly drainDelay: number;
  readonly drainPerSecond: number;
  readonly chainCost: number;
  readonly weakBelow: number;
  readonly weakScale: number;
  readonly chainBonus: number;
  readonly costs: Readonly<Record<BendMoveId, number>>;
}
export interface SituationalCounterRule {
  readonly advantageOver: Element;
  readonly terrains?: readonly string[];
  readonly weathers?: readonly string[];
}
export interface SituationalCountersConfig {
  readonly enabled: boolean;
  readonly edgeMultiplier: number;
  readonly situations: Readonly<Record<Element, SituationalCounterRule>>;
}
export type CombatTerrain = 'neutral' | 'wet' | 'river' | 'coastal' | 'volcanic' | 'scorched' | 'slag' | 'elevated' | 'cliff' | 'rooftop' | 'rocky' | 'canyon' | 'bedrock';
export type CombatWeather = 'neutral' | 'clear' | 'rain' | 'storm' | 'ash' | 'heatwave' | 'gale' | 'high_winds' | 'drought' | 'sandstorm';
export interface CombatSituation {
  readonly terrain?: CombatTerrain | string;
  readonly weather?: CombatWeather | string;
  readonly moveModifier?: number;
  readonly isFullMoon?: boolean;
  readonly lunarPhase?: 'full_moon' | 'new_moon' | 'waxing' | 'waning';
  readonly waterQuality?: 'waterskin' | 'natural' | 'spirit_water';
}
export interface TierConfig {
  readonly names: readonly string[];
  /** Lowest tier that may use each move; 'chain' gates meter combos. */
  readonly required: Readonly<Partial<Record<MoveId | 'chain', number>>>;
  /** Bending damage scale from these tiers up. */
  readonly bendScale: Readonly<Record<string, number>>;
}
export interface CombatBalance {
  readonly rules: {
    readonly armourScale: number;
    readonly damageWindowSeconds: number;
    readonly maxDamagePerSecond: number;
    readonly defaultMaxHealth: number;
    readonly defaultArmour: number;
    readonly litDamageMultiplier?: number;
    readonly litCooldownMultiplier?: number;
  };
  readonly burn?: BurnConfig;
  readonly starterMoves: Readonly<Record<StarterMoveId, MoveDefinition>>;
  readonly weapons: Readonly<Record<Weapon, Readonly<Record<WeaponMoveId, MoveDefinition>>>>;
  readonly nationWeapon: Readonly<Record<Element, Weapon>>;
  readonly bendWithWeapon?: Readonly<Record<Element, 'any' | readonly string[]>>;
  readonly elements: Readonly<Record<Element, Readonly<Record<BendMoveId, MoveDefinition>>>>;
  readonly meter: MeterConfig;
  readonly parry: { readonly window: number; readonly stagger: number; readonly hushWindow: number; readonly hushStagger: number };
  readonly shardSpark: { readonly damageScale: number; readonly cooldownSeconds: number; readonly testShards: number };
  readonly tiers: TierConfig;
  readonly situationalCounters?: SituationalCountersConfig;
}
/** What a fighter carries into a fight: the moves are looked up through it. */
export interface Kit {
  readonly element: Element;
  readonly weapon: Weapon;
  /** The Hush never bend; they throw a Shard Spark of the shard's element instead. */
  readonly hush?: boolean;
}
export interface Position { readonly x: number; readonly y: number; readonly z: number }
export interface Health {
  readonly current: number;
  readonly maximum: number;
  readonly scars?: number;
}
export interface Combatant {
  readonly element: Element;
  readonly position: Position;
  readonly health: Health;
  readonly armour: number;
  readonly weapon?: Weapon;
  readonly hush?: boolean;
}
export interface DamageEvent { readonly at: number; readonly damage: number }
/** Server-owned, per attacker, shared across every target. All times are seconds. */
export interface ActionState {
  readonly lastActionAt: number | null;
  readonly cooldowns: Readonly<Partial<Record<MoveId, number>>>;
  readonly damageHistory: readonly DamageEvent[];
}
export type RejectionReason = 'invalid_input' | 'unknown_move' | 'not_attack' | 'wrong_element' | 'attacker_dead' | 'target_dead' | 'clock_reversed' | 'out_of_reach' | 'cooldown' | 'damage_cap';
export interface HitInput {
  readonly attacker: Combatant;
  readonly target: Combatant;
  readonly moveId: string;
  readonly now: number;
  readonly state: ActionState;
  /** When this swing started. Every target one swing touches shares its single cooldown. */
  readonly swingAt?: number;
  readonly isLit?: boolean;
  /** Bending strength from the meter and tier, 1 at full strength. */
  readonly bendScale?: number;
  /** A bending move chained from another with the meter; it skips the cooldown. */
  readonly chained?: boolean;
  /** Situational conditions (terrain, weather, move modifiers) for situational counters. */
  readonly situation?: CombatSituation;
}
export type MoveStartResult = { readonly accepted: true; readonly state: ActionState } | { readonly accepted: false; readonly reason: RejectionReason };
export type HitResult = { readonly accepted: false; readonly reason: RejectionReason } | {
  readonly accepted: true;
  /** Damage actually removed from health, after armour and overkill clipping. */
  readonly damage: number;
  readonly target: Combatant;
  readonly state: ActionState;
};
