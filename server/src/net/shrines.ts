import type { DatabaseSync } from 'node:sqlite';
import { FIRST_SHRINE, shrineAt, shrineById, shrineToLight, travelRefusal, TRAVEL_CONFIG, wakeShrine, type Shrine } from '@elements/shared';
import { getDatabase } from '../db.js';
import { getAccountBalance, getSatchel, hasActiveBounty } from '../economy/index.js';
import { isGuest } from './money.js';
import { lastNationalPosition, resumeAt } from './coordinates.js';

/** The shrines an account has lit, from the server's own books. Guests light nothing that lasts. */
export function litShrinesOf(accountId: string, db: DatabaseSync = getDatabase()): Set<string> {
  const lit = new Set<string>([FIRST_SHRINE]);
  if (isGuest(accountId)) return lit;
  const rows = db.prepare('SELECT shrine_id FROM lit_shrines WHERE account_id = ?').all(accountId) as { shrine_id: string }[];
  for (const r of rows) if (shrineById(r.shrine_id)) lit.add(r.shrine_id);
  return lit;
}

/**
 * Lights the shrine a player at nation-global (x, z) has reached, if any and if not in a fight.
 * Returns the shrine lit, recorded for signed-in accounts.
 */
export function reachShrine(
  accountId: string, lit: Set<string>, x: number, z: number, inFight: boolean, now = Date.now(), db: DatabaseSync = getDatabase(),
): Shrine | null {
  if (inFight) return null;
  const shrine = shrineToLight(lit, x, z);
  if (!shrine) return null;
  lit.add(shrine.id);
  if (!isGuest(accountId)) {
    db.prepare('INSERT OR IGNORE INTO lit_shrines (account_id, shrine_id, lit_at) VALUES (?, ?, ?)').run(accountId, shrine.id, now);
  }
  return shrine;
}

/** Where a player who fell at nation-global (x, z) wakes. */
export const wakeFor = (lit: Set<string>, x: number, z: number): Shrine => wakeShrine(lit, x, z);

/**
 * Whether a player standing at nation-global (x, z) may travel to `to`: they stand at a lit shrine, the
 * target is lit and another, and the rules allow it (no fight, no bounty, no shards, little coin).
 */
export function travelCheck(
  accountId: string, lit: Set<string>, x: number, z: number, to: string, inFight: boolean, db: DatabaseSync = getDatabase(),
): { ok: true; shrine: Shrine } | { ok: false; error: string } {
  if (isGuest(accountId)) return { ok: false, error: 'Sign in to travel between shrines' };
  const from = shrineAt(lit, x, z);
  if (!from) return { ok: false, error: 'Stand at a lit shrine to travel' };
  const shrine = shrineById(to);
  if (!shrine || !lit.has(to)) return { ok: false, error: 'You have not lit that shrine' };
  if (shrine.id === from.id) return { ok: false, error: 'You are already here' };
  const satchel = getSatchel(accountId, db);
  const shards = Object.entries(satchel).filter(([id]) => id.startsWith('shard_')).reduce((a, [, n]) => a + n, 0);
  const error = travelRefusal(
    { inFight, bounty: hasActiveBounty(accountId, db), shards, coin: getAccountBalance(accountId, db) },
    TRAVEL_CONFIG.coinAllowance,
  );
  return error ? { ok: false, error } : { ok: true, shrine };
}

/**
 * Where a returning account resumes in the nation: where the server last saw it, or, after a restart,
 * at the shrine it lit last. Undefined means the first shrine's region.
 */
export function resumeOf(accountId: string, db: DatabaseSync = getDatabase()): ReturnType<typeof lastNationalPosition> {
  const seen = lastNationalPosition(accountId);
  if (seen || isGuest(accountId)) return seen;
  const row = db.prepare('SELECT shrine_id FROM lit_shrines WHERE account_id = ? ORDER BY lit_at DESC LIMIT 1').get(accountId) as { shrine_id: string } | undefined;
  const shrine = row ? shrineById(row.shrine_id) : undefined;
  if (!shrine) return undefined;
  resumeAt(accountId, { x: shrine.wake.x, y: shrine.y, z: shrine.wake.z });
  return lastNationalPosition(accountId);
}
