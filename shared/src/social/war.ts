import { fail, ok, type Result, type SocialConfig } from './config.js';
import { rankOf, type Group } from './group.js';

export type WarState = 'declared' | 'active' | 'declined' | 'expired' | 'ended';

export interface War {
  id: string;
  attacker: string;
  defender: string;
  state: WarState;
  declaredAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Peace offered by one side; it ends when the other accepts. */
  peaceOfferedBy: string | null;
  surrenderedBy: string | null;
}

const isLeader = (g: Group, id: string): boolean => rankOf(g, id) === 'leader';

/** Wars are declared by one group's leader and only begin when the other leader accepts (LORE 13). */
export function declareWar(p: { id: string; attacker: Group; defender: Group; by: string; now: number; wars: readonly War[] }, cfg: SocialConfig): Result<War> {
  if (!isLeader(p.attacker, p.by)) return fail('Only the leader declares war');
  if (p.attacker.id === p.defender.id) return fail('A group cannot war with itself');
  if (p.defender.disbanded) return fail('That group is gone');
  const between = p.wars.filter((w) => (w.attacker === p.attacker.id && w.defender === p.defender.id) || (w.attacker === p.defender.id && w.defender === p.attacker.id));
  if (between.some((w) => w.state === 'active' || (w.state === 'declared' && !expired(w, p.now, cfg)))) return fail('Already at war or waiting on an answer');
  const ends = between.filter((w) => w.state === 'ended').map((w) => w.endedAt ?? 0);
  if (ends.length && p.now - Math.max(...ends) < cfg.war.redeclareCooldownSeconds * 1000) return fail('Too soon after the last war');
  return ok({ id: p.id, attacker: p.attacker.id, defender: p.defender.id, state: 'declared', declaredAt: p.now, startedAt: null, endedAt: null, peaceOfferedBy: null, surrenderedBy: null });
}

const expired = (w: War, now: number, cfg: SocialConfig): boolean => w.state === 'declared' && now - w.declaredAt > cfg.war.acceptSeconds * 1000;

export function answerWar(w: War, defender: Group, by: string, accept: boolean, now: number, cfg: SocialConfig): Result<War> {
  if (w.defender !== defender.id || !isLeader(defender, by)) return fail('Only the other leader answers');
  if (w.state !== 'declared') return fail('Nothing to answer');
  if (expired(w, now, cfg)) return ok({ ...w, state: 'expired', endedAt: now });
  return ok(accept ? { ...w, state: 'active', startedAt: now } : { ...w, state: 'declined', endedAt: now });
}

/** Either leader offers peace; it holds when the other leader accepts, after the war's minimum length. */
export function offerPeace(w: War, side: Group, by: string): Result<War> {
  if (w.state !== 'active') return fail('No war to end');
  if (side.id !== w.attacker && side.id !== w.defender) return fail('Not your war');
  if (!isLeader(side, by)) return fail('Only a leader offers peace');
  return ok({ ...w, peaceOfferedBy: side.id });
}

export function acceptPeace(w: War, side: Group, by: string, now: number, cfg: SocialConfig): Result<War> {
  if (w.state !== 'active' || !w.peaceOfferedBy) return fail('No peace on offer');
  if (side.id === w.peaceOfferedBy || (side.id !== w.attacker && side.id !== w.defender)) return fail('The other side must accept');
  if (!isLeader(side, by)) return fail('Only a leader accepts');
  if (w.startedAt !== null && now - w.startedAt < cfg.war.minDurationSeconds * 1000) return fail('The war is too young to end by treaty');
  return ok({ ...w, state: 'ended', endedAt: now });
}

/** Surrender ends it at once, any time. */
export function surrender(w: War, side: Group, by: string, now: number): Result<War> {
  if (w.state !== 'active') return fail('No war to end');
  if (side.id !== w.attacker && side.id !== w.defender) return fail('Not your war');
  if (!isLeader(side, by)) return fail('Only a leader surrenders');
  return ok({ ...w, state: 'ended', endedAt: now, surrenderedBy: side.id });
}

export function atWar(wars: readonly War[], a: string | null, b: string | null): boolean {
  if (!a || !b || a === b) return false;
  return wars.some((w) => w.state === 'active' && ((w.attacker === a && w.defender === b) || (w.attacker === b && w.defender === a)));
}
