import balance from '../../balance.json' with { type: 'json' };

/**
 * The tier climb (LORE 7 and 11): each tier from 2 to 7 takes fighting enough to qualify, paying your nation's
 * master in CHROMA, then winning the master's trial. Tiers are permanent. The numbers live in balance.json
 * (combat.tiers.climb).
 */
export interface ClimbConfig {
  startTier: number;
  winsToQualify: Record<string, number>;
  fee: Record<string, number>;
  /** How much a master's fee moves in a week: up while more students climb than the week before, down when fewer. */
  feeWeeklyStep: number;
  feeWeekHours: number;
  /** The opponent the master sets for a trial, and its health per tier. */
  trialKind: string;
  trialHealth: Record<string, number>;
}

export const CLIMB: ClimbConfig = balance.combat.tiers.climb;
export const TOP_TIER = 7;

/** Where a fighter stands on the climb to their next tier. */
export interface ClimbStanding {
  tier: number;
  /** The tier the trial would raise them to; null at the top. */
  next: number | null;
  wins: number;
  winsNeeded: number;
  qualified: boolean;
}

export function climbStanding(tier: number, wins: number, cfg: ClimbConfig = CLIMB): ClimbStanding {
  if (tier >= TOP_TIER) return { tier, next: null, wins, winsNeeded: 0, qualified: false };
  const next = tier + 1;
  const winsNeeded = cfg.winsToQualify[String(next)] ?? 0;
  return { tier, next, wins, winsNeeded, qualified: wins >= winsNeeded };
}

/** The fee for training toward `next` at a master whose fee multiplier is `multiplier`. */
export function trainingFee(next: number, multiplier: number, cfg: ClimbConfig = CLIMB): number {
  return Math.round((cfg.fee[String(next)] ?? 0) * multiplier);
}

/**
 * A master's fee multiplier for a new week: up a step if more students climbed last week than the week
 * before, down a step if fewer, never below 1 (the base fee).
 */
export function nextFeeMultiplier(multiplier: number, climbsLastWeek: number, climbsWeekBefore: number, cfg: ClimbConfig = CLIMB): number {
  const step = climbsLastWeek > climbsWeekBefore ? 1 + cfg.feeWeeklyStep : climbsLastWeek < climbsWeekBefore ? 1 - cfg.feeWeeklyStep : 1;
  return Math.max(1, Math.round(multiplier * step * 1000) / 1000);
}

/** The master who trains a fighter: their nation's (master_<element>). A Hush has none: the Dim climb with a master smith. */
export function masterFor(role: string, element: string | null | undefined): string | null {
  return role === 'Shaper' && element ? `master_${element.toLowerCase()}` : null;
}
