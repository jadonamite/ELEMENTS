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
  dominantNation: string | null;
  dominantShare: number;
  threshold: number;
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

export function ensureDirectorTables(db: DatabaseSync = getDatabase()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_director_events (
      id TEXT PRIMARY KEY,
      nation TEXT NOT NULL,
      event_type TEXT NOT NULL,
      closed_route TEXT,
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      active INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_director_events ON world_director_events(nation, active, expires_at);
  `);
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
 * Evaluates whether one nation dominates the world economy based on recent ledger transactions.
 * Uses trade volume over the lookback window specified in the rule file.
 */
export function evaluateNationDomination(
  now: number,
  db: DatabaseSync = getDatabase(),
): NationDominationReport {
  const lookbackMs = DIRECTOR_CONFIG.lookbackDays * 24 * GAME_HOUR_MS;
  const cutoff = now - lookbackMs;

  const rows = db
    .prepare(
      `SELECT sender, receiver, amount, reason
       FROM ledger_entries
       WHERE timestamp >= ? AND timestamp <= ? AND reason != 'genesis'`,
    )
    .all(cutoff, now) as Array<{
    sender: string;
    receiver: string;
    amount: number;
    reason: string;
  }>;

  const nationVolumes: Record<string, number> = {
    IGNIS: 0,
    AQUES: 0,
    TERRA: 0,
    AURA: 0,
    CHROMARA: 0,
  };

  let totalVolume = 0;

  for (const row of rows) {
    const nationSender = nationForAccount(row.sender);
    const nationReceiver = nationForAccount(row.receiver);

    const nation = nationSender ?? nationReceiver;
    if (nation && nationVolumes[nation] !== undefined) {
      nationVolumes[nation] += row.amount;
      totalVolume += row.amount;
    }
  }

  const threshold = DIRECTOR_CONFIG.dominationThreshold;
  const nationShares: Record<string, number> = {};
  let dominantNation: string | null = null;
  let dominantShare = 0;

  for (const [nat, vol] of Object.entries(nationVolumes)) {
    const share = totalVolume > 0 ? vol / totalVolume : 0;
    nationShares[nat] = share;
    if (share >= threshold && share > dominantShare) {
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
    dominantNation,
    dominantShare,
    threshold,
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
  ensureDirectorTables(db);
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
  ensureDirectorTables(db);
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
  ensureDirectorTables(db);
  const durationMs = DIRECTOR_CONFIG.firestormDurationHours * GAME_HOUR_MS;
  const expiresAt = params.now + durationMs;

  // Pick route connecting to this nation if not specified
  let closedRoute = params.closedRoute;
  if (!closedRoute) {
    const route = CARAVANS_CONFIG.routes.find(
      (r) => r.fromNation === params.nation || r.toNation === params.nation,
    );
    closedRoute = route ? route.id : 'route_sindr_chromara';
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
  ensureDirectorTables(db);
  const report = evaluateNationDomination(params.now, db);

  let triggeredEvent: DirectorEvent | null = null;
  if (report.dominantNation) {
    const existing = getActiveFirestorm(report.dominantNation, params.now, db);
    if (!existing) {
      triggeredEvent = triggerFirestormPushback(
        { nation: report.dominantNation, now: params.now },
        db,
      );
    }
  }

  // Deactivate expired events
  db.prepare('UPDATE world_director_events SET active = 0 WHERE active = 1 AND expires_at <= ?').run(
    params.now,
  );

  return { report, triggeredEvent };
}
