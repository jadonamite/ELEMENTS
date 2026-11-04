import { isBendMove, MOVE_IDS, type ActionState, type Element, type MoveId, type Weapon } from '@elements/shared';
import { balance, rules } from './balance.js';
import type { ServerEnemy } from './enemies.js';
import type { PoseHistory } from './history.js';

/** How far back a hit may be judged, seconds. Matches the client's MAX_REWIND plus one snapshot of slack. */
export const REWIND_LIMIT = 0.35 + 0.1;
/** Slack on reach for the gap between what the attacker saw and what the server holds, metres. */
export const REACH_SLACK = 0.35;
/** Half-angle in front of the attacker a blow can land in, radians. */
export const STRIKE_ARC = 1.6;
/** Moves that reach all the way round the attacker. */
const ALL_ROUND = new Set<string>(['ground_pound', 'ultimate']);

export interface Attacker {
  id: string;
  element: Element;
  weapon: Weapon;
  hush: boolean;
  /** Fighting tier: moves above it never land. */
  tier: number;
  alive: boolean;
  history: PoseHistory;
  action: ActionState;
  /** Swings already seen: number to start time, move, and enemies already struck. */
  swings: Map<number, { at: number; move: string; struck: Set<string> }>;
  lastSwing: number;
}

export interface HitClaim {
  e: string;
  m: string;
  sw: number;
  t: number;
  v: number;
  lit: boolean;
}

export type HitVerdict =
  | { ok: true; damage: number; killed: boolean; action: ActionState }
  | { ok: false; reason: string };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Reads an untrusted hit message; null when any field is missing or the wrong type. */
export function parseHit(raw: unknown): HitClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.e !== 'string' || m.e.length > 40 || typeof m.m !== 'string' || m.m.length > 40) return null;
  if (!finite(m.sw) || !Number.isInteger(m.sw) || m.sw < 0 || !finite(m.t) || !finite(m.v)) return null;
  return { e: m.e, m: m.m, sw: m.sw, t: m.t, v: m.v, lit: m.lit === true };
}

/** Extra scale a hound takes: from behind, and against fire or water bending. */
export function houndScale(enemy: ServerEnemy, ax: number, az: number, element: Element, move: string): number {
  const t = balance.monsters.emberHound;
  const back = enemy.facing + Math.PI;
  const fromBehind = Math.abs(wrap(Math.atan2(ax - enemy.x, az - enemy.z) - back)) <= (t.weakSpotAngleDeg * Math.PI) / 180;
  let scale = fromBehind ? t.weakSpotMultiplier : 1;
  if (isBendMove(move)) {
    if (element === 'IGNIS') scale *= t.fireResistance;
    else if (element === 'AQUES') scale *= t.waterVulnerability;
  }
  return scale;
}

/**
 * Judges a player's claim to have struck an enemy, using only what the server holds:
 * the attacker's kit and recorded positions, the enemy's recorded positions, and the
 * shared combat rules for reach, cooldown and damage. Nothing in the claim sets damage.
 */
export function judgeHit(attacker: Attacker, enemy: ServerEnemy | undefined, claim: HitClaim, now: number): HitVerdict {
  if (!enemy) return { ok: false, reason: 'target_missing' };
  if (!attacker.alive) return { ok: false, reason: 'attacker_dead' };
  if (!enemy.alive) return { ok: false, reason: 'target_dead' };
  if (!(MOVE_IDS as readonly string[]).includes(claim.m)) return { ok: false, reason: 'unknown_move' };
  const move = claim.m as MoveId;
  if (move === 'dodge') return { ok: false, reason: 'not_attack' };
  if (!rules.tierAllows(move, attacker.tier)) return { ok: false, reason: 'tier' };
  // Timing: the pose seen and the swing start must be recent, in order, and not in the future.
  if (claim.v > now + 0.05 || claim.v < now - REWIND_LIMIT) return { ok: false, reason: 'stale' };
  if (claim.t > claim.v + 0.05 || claim.t < now - REWIND_LIMIT - 1.5) return { ok: false, reason: 'stale' };

  const seen = attacker.swings.get(claim.sw);
  if (seen) {
    if (seen.move !== move) return { ok: false, reason: 'swing_mismatch' };
    if (seen.struck.has(enemy.id)) return { ok: false, reason: 'repeat' };
  } else if (claim.sw <= attacker.lastSwing) {
    return { ok: false, reason: 'swing_reused' };
  }
  const swingAt = seen ? seen.at : Math.max(0, Math.min(claim.t, now));

  const me = attacker.history.at(claim.v);
  const them = enemy.history.at(claim.v);
  if (!me || !them) return { ok: false, reason: 'no_record' };
  const dx = them.x - me.x;
  const dz = them.z - me.z;
  const dist = Math.hypot(dx, dz);
  // Line: the target must be in front of the attacker unless the move reaches all round.
  if (!ALL_ROUND.has(move) && dist > enemy.tune.radius && Math.abs(wrap(Math.atan2(dx, dz) - me.f)) > STRIKE_ARC) {
    return { ok: false, reason: 'out_of_line' };
  }
  // Reach is measured to the enemy's body, not its centre, with a little slack for the network.
  const gap = Math.max(0, dist - enemy.tune.radius - REACH_SLACK);
  const along = dist > 0 ? gap / dist : 0;
  const lit = claim.lit && !attacker.hush;
  const result = rules.checkHit({
    attacker: {
      element: attacker.element,
      weapon: attacker.weapon,
      hush: attacker.hush,
      position: { x: me.x, y: 0, z: me.z },
      health: { current: 1, maximum: 1 },
      armour: 0,
    },
    target: {
      element: enemy.tune.element as Element,
      position: { x: me.x + dx * along, y: 0, z: me.z + dz * along },
      health: { current: enemy.hp, maximum: enemy.tune.maxHealth },
      armour: 0,
    },
    moveId: move,
    now,
    state: attacker.action,
    swingAt,
    isLit: lit,
  });
  if (!result.accepted) return { ok: false, reason: result.reason };

  let damage = result.damage;
  if (enemy.kind === 'hound') damage *= houndScale(enemy, me.x, me.z, attacker.element, move);
  damage = Math.min(enemy.hp, Math.max(1, Math.round(damage)));
  if (seen) seen.struck.add(enemy.id);
  else {
    attacker.swings.set(claim.sw, { at: swingAt, move, struck: new Set([enemy.id]) });
    attacker.lastSwing = claim.sw;
    for (const key of attacker.swings.keys()) if (key < claim.sw - 8) attacker.swings.delete(key);
  }
  return { ok: true, damage, killed: false, action: result.state };
}
