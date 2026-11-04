import { getNpcPriceMultiplier } from '../economy/npcMemory.js';
import type { HallConfig, KeyDef } from './config.js';

export type ComplaintKind = 'fighter_fled' | 'bad_split' | 'cheated_buyer' | 'left_to_die';
export type ComplaintStatus = 'open' | 'upheld' | 'dismissed';

export interface Complaint {
  id: string;
  kind: ComplaintKind;
  /** Who filed it: a player id, or the Hall itself for what it saw. */
  by: string;
  /** A player id or a fighter id. */
  against: string;
  runId: string | null;
  note: string;
  at: number;
  status: ComplaintStatus;
  ruling?: string;
}

export interface PartyJob {
  id: string;
  dungeon: string;
  title: string;
  reward: number;
  postedAt: number;
  takenBy: string | null;
}

export interface KeySale { keyId: string; at: number }

export interface HallState {
  id: string;
  nation: string;
  purse: number;
  keyStock: Record<string, number>;
  sales: KeySale[];
  complaints: Complaint[];
  /** Player or fighter id to the time the bar lifts. */
  barred: Record<string, number>;
  jobs: PartyJob[];
  /** One feeling score per player (LORE 15). */
  memory: Record<string, number>;
}

export const GAME_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Key price: scarcity (fewer keys on the shelf costs more), recent demand (each sale in the window adds a step,
 * capped), the Hall's feeling for the buyer, all clamped to a band around the base price.
 */
export function keyPrice(hall: HallState, keyId: string, key: KeyDef, cfg: HallConfig, now: number, buyerId?: string): number {
  const stock = hall.keyStock[keyId] ?? 0;
  const scarcity = cfg.keyPriceSlope * (1 - stock / key.maxStock) * 0.5;
  const windowMs = cfg.keyDemandWindowHours * 60 * 60 * 1000;
  const recent = hall.sales.filter((s) => s.keyId === keyId && now - s.at < windowMs).length;
  const demand = Math.min(cfg.keyDemandMax, recent * cfg.keyDemandStep);
  const feeling = buyerId ? getNpcPriceMultiplier(hall.memory[buyerId] ?? 0, 'buy') : 1;
  const mult = Math.min(cfg.keyPriceMax, Math.max(cfg.keyPriceMin, (1 + scarcity + demand) * feeling));
  return Math.max(1, Math.round(key.basePrice * mult));
}

export function isBarred(hall: HallState, id: string, now: number): boolean {
  return (hall.barred[id] ?? 0) > now;
}

export function upheldAgainst(hall: HallState, id: string, now: number, cfg: HallConfig): number {
  const windowMs = cfg.complaintWindowDays * GAME_DAY_MS;
  return hall.complaints.filter((c) => c.against === id && c.status === 'upheld' && now - c.at < windowMs).length;
}

export interface RunFacts {
  runId: string;
  members: string[];
  fighters: string[];
  /** Fighters who ran, from the run record. */
  fled: string[];
  /** Fighters left alive when the party walked out or wiped. */
  abandoned: string[];
  /** Each member's share value, for judging a split. */
  shareValues?: Record<string, number>;
  lootRule?: string;
}

/**
 * The Hall rules only on what its records show. A fighter who ran is upheld when the run record has them fleeing;
 * a bad split when the agreed rule was equal and the complainant got under half the fair share;
 * left-to-die when the record shows the fighter standing as the party left; a cheated buyer needs a matching sale record.
 */
export function judgeComplaint(c: Complaint, facts: RunFacts | null, saleProven = false): { uphold: boolean; ruling: string } {
  if (c.kind === 'cheated_buyer') {
    return saleProven ? { uphold: true, ruling: 'The sale record bears it out.' } : { uphold: false, ruling: 'No sale on record between you.' };
  }
  if (!facts) return { uphold: false, ruling: 'The Hall has no record of that run.' };
  if (c.by !== 'hall' && !facts.members.includes(c.by)) return { uphold: false, ruling: 'You were not on that run.' };
  if (c.kind === 'fighter_fled') {
    return facts.fled.includes(c.against)
      ? { uphold: true, ruling: 'The run record shows them running. It goes on their name.' }
      : { uphold: false, ruling: 'They stood to the end by every account the Hall has.' };
  }
  if (c.kind === 'left_to_die') {
    return facts.abandoned.includes(c.against) || (facts.members.includes(c.against) && facts.abandoned.length > 0)
      ? { uphold: true, ruling: 'The party walked out with a hired blade still standing.' }
      : { uphold: false, ruling: 'Nobody was left behind.' };
  }
  // bad_split
  if (facts.lootRule !== 'equal' || !facts.shareValues) return { uphold: false, ruling: 'The split followed the rule you all agreed before going in.' };
  const values = Object.values(facts.shareValues);
  const fair = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const got = facts.shareValues[c.by] ?? 0;
  return got < fair / 2
    ? { uphold: true, ruling: `You were owed about ${Math.round(fair)} and got ${got}.` }
    : { uphold: false, ruling: 'Your share was near enough to the others.' };
}

export type HallAction =
  | { type: 'restock_keys'; keyId: string; quantity: number }
  | { type: 'post_job'; dungeon: string; title: string; reward: number }
  | { type: 'withdraw_job'; jobId: string }
  | { type: 'rule'; complaintId: string; uphold: boolean; ruling: string }
  | { type: 'bar'; id: string; days: number }
  | { type: 'say'; line: string };

export interface HallObservation {
  hall: HallState;
  keys: Record<string, KeyDef>;
  cfg: HallConfig;
  now: number;
  /** The Hall's own judgement of each open complaint, worked out from the run records. */
  judgements: Record<string, { uphold: boolean; ruling: string }>;
}

/** The Hall's rule file: what any decider, rules or model, may do. Prices are never set directly. */
export function validateHallAction(obs: HallObservation, a: HallAction, purse = obs.hall.purse): { valid: boolean; reason?: string } {
  const raw = a as Record<string, unknown>;
  if (raw.price !== undefined || raw.wage !== undefined) return { valid: false, reason: 'The Hall cannot set prices or wages; they come from the rules' };
  switch (a.type) {
    case 'restock_keys': {
      const key = obs.keys[a.keyId];
      if (!key) return { valid: false, reason: 'Unknown key' };
      if (!Number.isInteger(a.quantity) || a.quantity <= 0) return { valid: false, reason: 'Quantity must be a positive whole number' };
      if ((obs.hall.keyStock[a.keyId] ?? 0) + a.quantity > key.maxStock) return { valid: false, reason: 'More keys than the shelf holds' };
      if (a.quantity * key.craftCost > purse) return { valid: false, reason: 'Not enough in the purse to pay the crafters' };
      return { valid: true };
    }
    case 'post_job': {
      if (!Number.isInteger(a.reward) || a.reward <= 0 || a.reward > obs.cfg.jobRewardMax) return { valid: false, reason: 'Reward out of range' };
      if (a.reward > purse) return { valid: false, reason: 'The purse cannot cover the reward' };
      if (obs.hall.jobs.filter((j) => !j.takenBy).length >= obs.cfg.maxOpenJobs) return { valid: false, reason: 'Too many open jobs' };
      if (!a.title || a.title.length > 120) return { valid: false, reason: 'A job needs a short title' };
      return { valid: true };
    }
    case 'withdraw_job':
      return obs.hall.jobs.some((j) => j.id === a.jobId && !j.takenBy) ? { valid: true } : { valid: false, reason: 'No such open job' };
    case 'rule': {
      const c = obs.hall.complaints.find((x) => x.id === a.complaintId);
      if (!c || c.status !== 'open') return { valid: false, reason: 'No such open complaint' };
      const j = obs.judgements[c.id];
      // The decider may word the ruling, but may not uphold what the record does not show.
      if (a.uphold && !j?.uphold) return { valid: false, reason: 'The record does not support upholding it' };
      return { valid: true };
    }
    case 'bar': {
      if (upheldAgainst(obs.hall, a.id, obs.now, obs.cfg) < obs.cfg.barAfterUpheld) return { valid: false, reason: 'Not enough upheld complaints to bar them' };
      if (a.days <= 0 || a.days > obs.cfg.barDays) return { valid: false, reason: 'Bar length out of range' };
      return { valid: true };
    }
    case 'say':
      return typeof a.line === 'string' && a.line.trim() && a.line.length <= 300 ? { valid: true } : { valid: false, reason: 'Bad line' };
    default:
      return { valid: false, reason: 'Unknown action' };
  }
}

/** The rule decider: rules on open complaints, bars repeat offenders, keeps keys on the shelf, keeps jobs posted. */
export function decideHall(obs: HallObservation): { actions: HallAction[]; reasoning: string } {
  const { hall, keys, cfg, now } = obs;
  const actions: HallAction[] = [];
  const notes: string[] = [];
  for (const c of hall.complaints.filter((x) => x.status === 'open')) {
    const j = obs.judgements[c.id] ?? { uphold: false, ruling: 'No record.' };
    actions.push({ type: 'rule', complaintId: c.id, uphold: j.uphold, ruling: j.ruling });
  }
  const pending = new Map<string, number>();
  for (const c of hall.complaints) {
    const willUphold = c.status === 'upheld' || (c.status === 'open' && obs.judgements[c.id]?.uphold);
    if (willUphold && now - c.at < cfg.complaintWindowDays * GAME_DAY_MS) pending.set(c.against, (pending.get(c.against) ?? 0) + 1);
  }
  for (const [id, n] of pending) {
    if (n >= cfg.barAfterUpheld && !isBarred(hall, id, now)) {
      actions.push({ type: 'bar', id, days: cfg.barDays });
      notes.push(`barred ${id} after ${n} upheld complaints`);
    }
  }
  let purse = hall.purse;
  for (const [keyId, key] of Object.entries(keys)) {
    const stock = hall.keyStock[keyId] ?? 0;
    if (stock < key.maxStock * cfg.restockBelow) {
      const want = Math.min(key.maxStock - stock, Math.floor(purse / key.craftCost));
      if (want > 0) {
        actions.push({ type: 'restock_keys', keyId, quantity: want });
        purse -= want * key.craftCost;
        notes.push(`ordered ${want} ${key.name}s from the crafters`);
      }
    }
  }
  const open = hall.jobs.filter((j) => !j.takenBy).length;
  if (open < 2) {
    const dungeon = Object.values(keys)[0]?.dungeon;
    const reward = Math.min(cfg.jobRewardMax, Math.max(20, Math.floor(purse * 0.02)));
    if (dungeon && reward <= purse) {
      actions.push({ type: 'post_job', dungeon, title: 'Bring back a Warden\'s Core from the Undervault', reward });
      notes.push(`posted a job for ${reward}`);
    }
  }
  return { actions, reasoning: notes.length ? `The Hall ${notes.join('; ')}.` : 'The Hall keeps its books and waits for parties.' };
}

/** Applies validated actions to the Hall's state; returns coin the Hall paid out to crafters and job holds. */
export function applyHallActions(obs: HallObservation, actions: readonly HallAction[], newId: () => string): { hall: HallState; applied: HallAction[]; dropped: Array<{ action: HallAction; reason: string }>; craftSpend: number } {
  let hall: HallState = { ...obs.hall, keyStock: { ...obs.hall.keyStock }, complaints: [...obs.hall.complaints], barred: { ...obs.hall.barred }, jobs: [...obs.hall.jobs] };
  const applied: HallAction[] = [];
  const dropped: Array<{ action: HallAction; reason: string }> = [];
  let craftSpend = 0;
  for (const a of actions) {
    const v = validateHallAction({ ...obs, hall }, a, hall.purse - craftSpend);
    if (!v.valid) { dropped.push({ action: a, reason: v.reason ?? 'invalid' }); continue; }
    if (a.type === 'restock_keys') {
      hall.keyStock[a.keyId] = (hall.keyStock[a.keyId] ?? 0) + a.quantity;
      craftSpend += a.quantity * obs.keys[a.keyId]!.craftCost;
    } else if (a.type === 'post_job') {
      hall.jobs.push({ id: newId(), dungeon: a.dungeon, title: a.title, reward: a.reward, postedAt: obs.now, takenBy: null });
    } else if (a.type === 'withdraw_job') {
      hall.jobs = hall.jobs.filter((j) => j.id !== a.jobId);
    } else if (a.type === 'rule') {
      hall.complaints = hall.complaints.map((c) => c.id === a.complaintId ? { ...c, status: a.uphold ? 'upheld' : 'dismissed', ruling: a.ruling } : c);
    } else if (a.type === 'bar') {
      hall.barred[a.id] = obs.now + a.days * GAME_DAY_MS;
    }
    applied.push(a);
  }
  hall = { ...hall, purse: hall.purse - craftSpend };
  return { hall, applied, dropped, craftSpend };
}
