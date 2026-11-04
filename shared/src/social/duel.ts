import { fail, ok, type Result, type SocialConfig } from './config.js';

export type DuelState = 'offered' | 'accepted' | 'declined' | 'expired' | 'done';

export interface Stake { chroma: number; items: Record<string, number> }

export interface Duel {
  id: string;
  challenger: string;
  target: string;
  /** Each side's stake; both are held from acceptance until the end. */
  stakes: Record<string, Stake>;
  state: DuelState;
  offeredAt: number;
  startedAt: number | null;
  winner: string | null;
  how: 'beaten' | 'fled' | 'disconnected' | 'draw' | null;
}

export interface Holding { chroma: number; items: Record<string, number> }

const covers = (h: Holding, s: Stake): boolean =>
  h.chroma >= s.chroma && Object.entries(s.items).every(([k, q]) => (h.items[k] ?? 0) >= q);

const validStake = (s: Stake, cfg: SocialConfig): string | null => {
  if (!Number.isInteger(s.chroma) || s.chroma < 0 || s.chroma > cfg.duel.maxStake) return 'Bad stake';
  if (Object.values(s.items).some((q) => !Number.isInteger(q) || q <= 0)) return 'Bad stake';
  return null;
};

/** A challenge names both stakes up front; the target sees exactly what they risk. */
export function challenge(p: { id: string; challenger: string; target: string; challengerStake: Stake; targetStake: Stake; challengerHolds: Holding; busy: readonly string[]; now: number }, cfg: SocialConfig): Result<Duel> {
  if (p.challenger === p.target) return fail('You cannot duel yourself');
  if (p.busy.includes(p.challenger) || p.busy.includes(p.target)) return fail('One of you is already in a duel or a raid');
  const bad = validStake(p.challengerStake, cfg) ?? validStake(p.targetStake, cfg);
  if (bad) return fail(bad);
  if (!covers(p.challengerHolds, p.challengerStake)) return fail('You do not carry your stake');
  return ok({ id: p.id, challenger: p.challenger, target: p.target, stakes: { [p.challenger]: p.challengerStake, [p.target]: p.targetStake }, state: 'offered', offeredAt: p.now, startedAt: null, winner: null, how: null });
}

/** Accepting holds both stakes; the caller moves them into escrow. */
export function answerDuel(d: Duel, by: string, accept: boolean, targetHolds: Holding, challengerHolds: Holding, now: number, cfg: SocialConfig): Result<Duel> {
  if (by !== d.target) return fail('Only the one challenged answers');
  if (d.state !== 'offered') return fail('Nothing to answer');
  if (now - d.offeredAt > cfg.duel.acceptSeconds * 1000) return ok({ ...d, state: 'expired' });
  if (!accept) return ok({ ...d, state: 'declined' });
  if (!covers(targetHolds, d.stakes[d.target]!)) return fail('You do not carry your stake');
  if (!covers(challengerHolds, d.stakes[d.challenger]!)) return fail('The challenger no longer carries their stake');
  return ok({ ...d, state: 'accepted', startedAt: now });
}

export interface DuelSignal {
  /** Who went down, if anyone. */
  beaten?: string;
  /** Distance of each duellist from the arena's centre. */
  distance?: Record<string, number>;
  /** Seconds each duellist has been disconnected. */
  offline?: Record<string, number>;
  now: number;
}

/**
 * Ends a running duel: a beaten fighter loses; running beyond the arena or staying disconnected forfeits;
 * the time limit with nobody down is a draw and both stakes go back.
 */
export function resolveDuel(d: Duel, s: DuelSignal, cfg: SocialConfig): Duel | null {
  if (d.state !== 'accepted') return null;
  const other = (id: string): string => (id === d.challenger ? d.target : d.challenger);
  if (s.beaten && (s.beaten === d.challenger || s.beaten === d.target)) return { ...d, state: 'done', winner: other(s.beaten), how: 'beaten' };
  for (const id of [d.challenger, d.target]) {
    if ((s.distance?.[id] ?? 0) > cfg.duel.fleeRadius) return { ...d, state: 'done', winner: other(id), how: 'fled' };
    if ((s.offline?.[id] ?? 0) > cfg.duel.disconnectForfeitSeconds) return { ...d, state: 'done', winner: other(id), how: 'disconnected' };
  }
  if (d.startedAt !== null && s.now - d.startedAt > cfg.duel.timeLimitSeconds * 1000) return { ...d, state: 'done', winner: null, how: 'draw' };
  return null;
}

export interface Transfer { from: string; to: string; chroma: number; items: Record<string, number> }

/** Only the agreed stakes change hands (LORE 11). A draw returns each stake to its owner. */
export function duelPayout(d: Duel): Transfer[] {
  if (d.state !== 'done') return [];
  if (!d.winner) return [d.challenger, d.target].map((id) => ({ from: 'escrow', to: id, ...d.stakes[id]! }));
  return [d.challenger, d.target].map((id) => ({ from: 'escrow', to: d.winner!, ...d.stakes[id]! }));
}
