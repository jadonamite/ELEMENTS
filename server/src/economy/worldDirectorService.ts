import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  DIRECTOR_CONFIG,
  GAME_HOUR_MS,
  CARAVANS_CONFIG,
  SINDR_MERCHANTS,
} from '@elements/shared';
import { getDatabase } from '../db.js';

export interface NationDominationReport {
  evaluatedAt: number;
  lookbackMs: number;
  totalVolume: number;
  nationVolumes: Record<string, number>;
  nationShares: Record<string, number>;
  nationPlayerCounts: Record<string, number>;
  dominantNation: string | null;
  dominantShare: number;
  threshold: number;
  minActivePlayers: number;
}

export interface DirectorEvent {
  id: string;
  nation: string;
  eventType: string;
  closedRoute: string | null;
  startedAt: number;
  expiresAt: number;
  active: boolean;
}


/**
 * Maps any merchant or account to its world nation.
 */
export function nationForAccount(id: string): string | null {
  if (id.startsWith('sindr_') || id === 'merchant_ignis' || id === 'master_ignis' || id.includes('ignis')) {
    return 'IGNIS';
  }
  if (id === 'merchant_aques' || id === 'master_aques' || id.includes('aques')) {
    return 'AQUES';
  }
  if (id === 'merchant_terra' || id === 'master_terra' || id.includes('terra')) {
    return 'TERRA';
  }
  if (id === 'merchant_aura' || id === 'master_aura' || id.includes('aura')) {
    return 'AURA';
  }
  if (id === 'merchant_chromara' || id.includes('chromara')) {
    return 'CHROMARA';
  }
  return null;
}

/**
 * Evaluates whether one nation dominates the world economy based on player CHROMA earnings.
 * As stipulated in LORE 15 ("the world pushes back"): domination reflects a nation's people
 * growing strong, not keeper shelves.
 * Groups earnings by player's element (accounts.element / risings.element).
 * Requires at least minActivePlayers to avoid a single lone player triggering pushback.
 */
export function evaluateNationDomination(
  now: number,
  db: DatabaseSync = getDatabase(),
): NationDominationReport {
  const lookbackMs = DIRECTOR_CONFIG.lookbackDays * 24 * GAME_HOUR_MS;
  const cutoff = now - lookbackMs;

  const rows = db
    .prepare(
      `SELECT
         l.receiver AS account_id,
         UPPER(COALESCE(a.element, r.element)) AS element,
         l.amount,
         l.timestamp
       FROM ledger_entries l
       LEFT JOIN accounts a ON a.id = l.receiver
       LEFT JOIN risings r ON r.account_id = l.receiver
       WHERE l.timestamp >= ? AND l.timestamp <= ? AND l.reason NOT IN ('genesis', 'player_starting_grant')`,
    )
    .all(cutoff, now) as Array<{
    account_id: string;
    element: string | null;
    amount: number;
    timestamp: number;
  }>;

  // Earnings a storm already answered are spent: each nation counts only what it earned after its last storm ended.
  const answeredUntil = new Map(
    (db.prepare("SELECT nation, MAX(expires_at) AS until FROM world_director_events WHERE event_type = 'firestorm' AND started_at <= ? GROUP BY nation")
      .all(now) as Array<{ nation: string; until: number }>).map((r) => [r.nation, r.until]),
  );
  // A lead must be sustained: a nation is judged only on a full lookback window since the world began or its last storm.
  const firstEarning = (db.prepare("SELECT MIN(timestamp) AS t FROM ledger_entries WHERE reason NOT IN ('genesis', 'player_starting_grant')")
    .get() as { t: number | null }).t ?? now;
  const judged = (nation: string): boolean => now - Math.max(firstEarning, answeredUntil.get(nation) ?? 0) >= lookbackMs;

  const nationVolumes: Record<string, number> = {
    IGNIS: 0,
    AQUES: 0,
    TERRA: 0,
    AURA: 0,
  };

  const activePlayersByNation: Record<string, Set<string>> = {
    IGNIS: new Set(),
    AQUES: new Set(),
    TERRA: new Set(),
    AURA: new Set(),
  };

  let totalVolume = 0;

  for (const row of rows) {
    const nation = row.element;
    if (nation && nationVolumes[nation] !== undefined) {
      totalVolume += row.amount;
      if (row.timestamp < (answeredUntil.get(nation) ?? 0)) continue;
      nationVolumes[nation] += row.amount;
      activePlayersByNation[nation]?.add(row.account_id);
    }
  }

  const threshold = DIRECTOR_CONFIG.dominationThreshold;
  const minActivePlayers = DIRECTOR_CONFIG.minActivePlayers;
  const nationShares: Record<string, number> = {};
  const nationPlayerCounts: Record<string, number> = {};
  let dominantNation: string | null = null;
  let dominantShare = 0;

  for (const [nat, vol] of Object.entries(nationVolumes)) {
    const share = totalVolume > 0 ? vol / totalVolume : 0;
    const activeCount = activePlayersByNation[nat]?.size ?? 0;
    nationShares[nat] = share;
    nationPlayerCounts[nat] = activeCount;

    if (judged(nat) && activeCount >= minActivePlayers && share >= threshold && share > dominantShare) {
      dominantNation = nat;
      dominantShare = share;
    }
  }

  return {
    evaluatedAt: now,
    lookbackMs,
    totalVolume,
    nationVolumes,
    nationShares,
    nationPlayerCounts,
    dominantNation,
    dominantShare,
    threshold,
    minActivePlayers,
  };
}

/**
 * Checks if a specific caravan route is closed by an active firestorm.
 */
export function isRouteClosedByDirector(
  routeId: string,
  now: number,
  db: DatabaseSync = getDatabase(),
): boolean {
  const row = db
    .prepare(
      'SELECT id FROM world_director_events WHERE active = 1 AND expires_at > ? AND (closed_route = ? OR closed_route = \'ALL\') LIMIT 1',
    )
    .get(now, routeId) as { id: string } | undefined;

  return !!row;
}

/**
 * Returns any active firestorm event affecting a nation.
 */
export function getActiveFirestorm(
  nation: string,
  now: number,
  db: DatabaseSync = getDatabase(),
): DirectorEvent | null {
  const row = db
    .prepare(
      "SELECT id, nation, event_type, closed_route, started_at, expires_at, active FROM world_director_events WHERE nation = ? AND event_type = 'firestorm' AND active = 1 AND expires_at > ? LIMIT 1",
    )
    .get(nation, now) as
    | {
        id: string;
        nation: string;
        event_type: string;
        closed_route: string | null;
        started_at: number;
        expires_at: number;
        active: number;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    nation: row.nation,
    eventType: row.event_type,
    closedRoute: row.closed_route,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    active: row.active === 1,
  };
}

/**
 * Triggers a firestorm for the dominant nation, closing its trade route and moving its prices.
 * As stipulated in LORE 15 ("the world pushes back") and AGENTS.md item 22.
 */
export function triggerFirestormPushback(
  params: {
    nation: string;
    now: number;
    closedRoute?: string;
  },
  db: DatabaseSync = getDatabase(),
): DirectorEvent {
  const durationMs = DIRECTOR_CONFIG.firestormDurationHours * GAME_HOUR_MS;
  const expiresAt = params.now + durationMs;

  // Pick route connecting to this nation if not specified
  let closedRoute = params.closedRoute;
  if (!closedRoute) {
    const route = CARAVANS_CONFIG.routes.find(
      (r) => r.fromNation === params.nation || r.toNation === params.nation,
    );
    closedRoute = route ? route.id : 'route_ignis_chromara';
  }

  const event: DirectorEvent = {
    id: `director_firestorm_${randomUUID().slice(0, 8)}`,
    nation: params.nation,
    eventType: 'firestorm',
    closedRoute,
    startedAt: params.now,
    expiresAt,
    active: true,
  };

  db.prepare(
    `INSERT INTO world_director_events (id, nation, event_type, closed_route, started_at, expires_at, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    event.id,
    event.nation,
    event.eventType,
    event.closedRoute,
    event.startedAt,
    event.expiresAt,
  );

  return event;
}

/**
 * Ticks the world director: evaluates nation dominance from the ledger,
 * and if one nation exceeds the domination threshold, triggers a firestorm.
 */
export function tickWorldDirector(
  params: { now: number },
  db: DatabaseSync = getDatabase(),
): { report: NationDominationReport; triggeredEvent: DirectorEvent | null } {
  // Deactivate expired events first
  db.prepare('UPDATE world_director_events SET active = 0 WHERE active = 1 AND expires_at <= ?').run(
    params.now,
  );

  const report = evaluateNationDomination(params.now, db);

  // One storm in the world at a time, and the world rests between storms.
  const lastEnd = (db.prepare("SELECT MAX(expires_at) AS t FROM world_director_events WHERE event_type = 'firestorm' AND started_at <= ?")
    .get(params.now) as { t: number | null }).t;
  const resting = lastEnd !== null && params.now < lastEnd + DIRECTOR_CONFIG.restHoursBetweenStorms * GAME_HOUR_MS;

  let triggeredEvent: DirectorEvent | null = null;
  if (report.dominantNation && !resting) {
    const existing = getActiveFirestorm(report.dominantNation, params.now, db);
    if (!existing) {
      triggeredEvent = triggerFirestormPushback(
        { nation: report.dominantNation, now: params.now },
        db,
      );
    }
  }

  return { report, triggeredEvent };
}
