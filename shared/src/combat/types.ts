export const ELEMENTS = ['AQUES', 'IGNIS', 'AURA', 'TERRA'] as const;
export type Element = typeof ELEMENTS[number];
export const IGNIS_MOVE_IDS = ['light_1', 'light_2', 'light_3', 'heavy_1', 'dodge', 'uppercut', 'ground_pound', 'dash_strike'] as const;
export type IgnisMoveId = typeof IGNIS_MOVE_IDS[number];
export interface MoveDefinition {
  readonly kind: string;
  readonly damage: number;
  readonly reach: number;
  readonly cooldownSeconds: number;
}
export interface CombatBalance {
  readonly rules: {
    readonly counterBonus: number;
    readonly armourScale: number;
    readonly damageWindowSeconds: number;
    readonly maxDamagePerSecond: number;
    readonly defaultMaxHealth: number;
    readonly defaultArmour: number;
  };
  readonly ignisStarterMoves: Readonly<Record<IgnisMoveId, MoveDefinition>>;
}
export interface Position { readonly x: number; readonly y: number; readonly z: number }
export interface Health { readonly current: number; readonly maximum: number }
export interface Combatant {
  readonly element: Element;
  readonly position: Position;
  readonly health: Health;
  readonly armour: number;
}
export interface DamageEvent { readonly at: number; readonly damage: number }
/** Server-owned, per attacker, shared across every target. All times are seconds. */
export interface ActionState {
  readonly lastActionAt: number | null;
  readonly cooldowns: Readonly<Partial<Record<IgnisMoveId, number>>>;
  readonly damageHistory: readonly DamageEvent[];
}
export type RejectionReason = 'invalid_input' | 'unknown_move' | 'not_attack' | 'wrong_element' | 'attacker_dead' | 'target_dead' | 'clock_reversed' | 'out_of_reach' | 'cooldown' | 'damage_cap';
export interface HitInput {
  readonly attacker: Combatant;
  readonly target: Combatant;
  readonly moveId: string;
  readonly now: number;
  readonly state: ActionState;
}
export type HitResult = { readonly accepted: false; readonly reason: RejectionReason } | {
  readonly accepted: true;
  /** Damage actually removed from health, after armour and overkill clipping. */
  readonly damage: number;
  readonly target: Combatant;
  readonly state: ActionState;
};
