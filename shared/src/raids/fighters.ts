import { NPC_MEMORY_LIMITS } from '../economy/npcMemory.js';
import type { FightersConfig, FighterTemplate, LitElement } from './config.js';
import { rollInt, type Rng } from './rng.js';

export type FighterStatus = 'available' | 'hired' | 'dead';

/** What a fighter remembers of one employer. */
export interface EmployerMemory {
  score: number;
  runs: number;
  paid: number;
  /** Runs where the employer's party wiped or left this fighter to die. */
  abandoned: number;
}

export interface Fighter {
  id: string;
  name: string;
  /** Hired fighters are Lit NPCs; no NPC is a Vakna. */
  element: LitElement;
  skill: number;
  courage: number;
  purse: number;
  status: FighterStatus;
  hiredBy: string | null;
  memory: Record<string, EmployerMemory>;
  record: { runs: number; fled: number; kills: number; bossKills: number };
}

export function fighterFromTemplate(t: FighterTemplate): Fighter {
  return {
    id: t.id, name: t.name, element: t.element, skill: t.skill, courage: t.courage, purse: t.purse,
    status: 'available', hiredBy: null, memory: {}, record: { runs: 0, fled: 0, kills: 0, bossKills: 0 },
  };
}

/** Wage per run rises faster than skill: wageBase + wagePerSkill x skill^wageCurve. */
export function fighterWage(f: Pick<Fighter, 'skill'>, cfg: FightersConfig): number {
  return Math.round(cfg.wageBase + cfg.wagePerSkill * Math.pow(f.skill, cfg.wageCurve));
}

export function fighterHealth(f: Pick<Fighter, 'skill'>, cfg: FightersConfig): number {
  return Math.round(cfg.healthBase + cfg.healthPerSkill * f.skill);
}

export function fighterDamage(f: Pick<Fighter, 'skill'>, cfg: FightersConfig): number {
  return Math.round(cfg.damageBase + cfg.damagePerSkill * f.skill);
}

export interface JobOffer {
  employerIds: string[];
  /** The dungeon's danger, 1 (easy) upward. */
  danger: number;
  /** Upheld complaints against anyone in the party, from the Hall's record. */
  partyComplaints: number;
}

/**
 * Whether a fighter takes the job. They refuse a party with anyone they hold a grudge against,
 * a party with a bad name at the Hall, and a dungeon too dangerous for their skill and nerve.
 */
export function decideJob(f: Fighter, offer: JobOffer, cfg: FightersConfig): { accept: boolean; reason: string } {
  if (f.status === 'dead') return { accept: false, reason: `${f.name} is dead.` };
  if (f.status === 'hired') return { accept: false, reason: `${f.name} is already on a job.` };
  const grudge = offer.employerIds.find((id) => (f.memory[id]?.score ?? 0) <= cfg.refuseBelowScore);
  if (grudge) return { accept: false, reason: `${f.name} won't fight for someone who left them to die.` };
  if (offer.partyComplaints >= 2) return { accept: false, reason: `${f.name} has heard what the Hall says about this party.` };
  const nerve = f.skill * (0.5 + f.courage) * cfg.dangerTolerance;
  if (offer.danger > nerve) return { accept: false, reason: `${f.name} says the place is too deep for them.` };
  return { accept: true, reason: `${f.name} takes the job.` };
}

export interface FightSituation {
  /** The fighter's own health, 0 to 1. */
  health: number;
  /** Share of the party (players and other fighters) still standing, 0 to 1. */
  partyStanding: number;
  /** Fellow fighters killed in this run. */
  fightersDown: number;
  /** Players down right now. */
  playersDown: number;
  bossRoom: boolean;
  /** The worst-off enemy's health fraction: a nearly dead boss holds people in. */
  foesHealth: number;
  /** Feeling toward the employer, -100 to 100. */
  loyalty: number;
}

/** Morale 0 to 1: nerve, own wounds, how the party is holding, and loyalty to the employer. */
export function morale(f: Fighter, s: FightSituation): number {
  const m = 0.35 * f.courage
    + 0.3 * s.health
    + 0.25 * s.partyStanding
    + 0.1 * (1 - s.foesHealth)
    - 0.12 * s.fightersDown
    - 0.1 * s.playersDown
    - (s.bossRoom ? 0.06 : 0)
    + 0.1 * (s.loyalty / NPC_MEMORY_LIMITS.maxScore);
  return Math.max(0, Math.min(1, m));
}

/** Checked every few seconds in a fight. Below the line, each check is a roll to break and run. */
export function decideFlee(f: Fighter, s: FightSituation, cfg: FightersConfig, roll: number): { flee: boolean; morale: number } {
  const m = morale(f, s);
  if (m >= cfg.fleeBelow) return { flee: false, morale: m };
  const chance = cfg.fleeChancePerCheck * (1 - m / cfg.fleeBelow) + 0.15;
  return { flee: roll < chance, morale: m };
}

export type FighterOutcome = 'stayed' | 'fled' | 'died';

export interface RunSettlement {
  outcome: FighterOutcome;
  won: boolean;
  wage: number;
  hallCut: number;
  /** The party wiped or walked out while this fighter still stood. */
  abandoned: boolean;
  kills: number;
  bossKill: boolean;
}

/**
 * After a run: the fighter remembers the employer, takes their wage if they stayed, and spends
 * savings on training when they can afford the next skill step, so one who did well comes back better.
 * A dead fighter is gone for good.
 */
export function settleFighter(f: Fighter, employers: readonly string[], s: RunSettlement, cfg: FightersConfig): { fighter: Fighter; paid: number; trained: boolean } {
  const memory = { ...f.memory };
  const delta = s.outcome === 'fled' ? -5 : s.abandoned ? -40 : s.won ? 15 : 5;
  for (const id of employers) {
    const m = memory[id] ?? { score: 0, runs: 0, paid: 0, abandoned: 0 };
    memory[id] = {
      score: Math.max(NPC_MEMORY_LIMITS.minScore, Math.min(NPC_MEMORY_LIMITS.maxScore, m.score + delta)),
      runs: m.runs + 1,
      paid: m.paid + (s.outcome === 'stayed' ? s.wage : 0),
      abandoned: m.abandoned + (s.abandoned ? 1 : 0),
    };
  }
  const record = {
    runs: f.record.runs + 1,
    fled: f.record.fled + (s.outcome === 'fled' ? 1 : 0),
    kills: f.record.kills + s.kills,
    bossKills: f.record.bossKills + (s.bossKill ? 1 : 0),
  };
  if (s.outcome === 'died') {
    return { fighter: { ...f, status: 'dead', hiredBy: null, memory, record }, paid: 0, trained: false };
  }
  const paid = s.outcome === 'stayed' ? s.wage - s.hallCut : 0;
  let purse = f.purse + paid;
  let skill = f.skill;
  const cost = cfg.trainingCostPerSkill * (skill + 1);
  const trained = s.outcome === 'stayed' && s.won && skill < cfg.skillMax && purse >= cost;
  if (trained) { purse -= cost; skill += 1; }
  return { fighter: { ...f, purse, skill, status: 'available', hiredBy: null, memory, record }, paid, trained };
}

/** A new recruit to replace the dead: low skill, a little savings, a name from the pool. */
export function recruit(id: string, cfg: FightersConfig, purse: number, rng: Rng, taken: ReadonlySet<string>): Fighter {
  const free = cfg.recruitNames.filter((n) => !taken.has(n));
  const name = free.length ? free[Math.floor(rng() * free.length)]! : `Sellsword ${id.slice(-4)}`;
  const element = cfg.recruitElements[Math.floor(rng() * cfg.recruitElements.length)] ?? 'IGNIS';
  return fighterFromTemplate({ id, name, element, skill: rollInt(rng, cfg.skillMin, cfg.skillMin + 2), courage: 0.3 + rng() * 0.6, purse });
}
