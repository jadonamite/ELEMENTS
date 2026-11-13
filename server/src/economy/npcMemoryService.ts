import type { DatabaseSync } from 'node:sqlite';
import { type CustomerMemorySummary, type NpcMemory, adjustNpcMemory } from '@elements/shared';
import { getDatabase } from '../db.js';

interface RawNpcMemoryRow {
  npc_id: string;
  account_id: string;
  score: number;
  updated_at: number;
}

export function getNpcMemory(
  npcId: string,
  accountId: string,
  db: DatabaseSync = getDatabase(),
): NpcMemory {
  const row = db
    .prepare('SELECT npc_id, account_id, score, updated_at FROM npc_memories WHERE npc_id = ? AND account_id = ?')
    .get(npcId, accountId) as RawNpcMemoryRow | undefined;

  if (!row) {
    return {
      npcId,
      accountId,
      score: 0,
      updatedAt: Date.now(),
    };
  }

  return {
    npcId: row.npc_id,
    accountId: row.account_id,
    score: row.score,
    updatedAt: row.updated_at,
  };
}

export function recordNpcInteraction(
  npcId: string,
  accountId: string,
  delta: number,
  db: DatabaseSync = getDatabase(),
): NpcMemory {
  const current = getNpcMemory(npcId, accountId, db);
  const now = Date.now();
  const adjusted = adjustNpcMemory(current, delta, npcId, accountId, now);

  db.prepare(
    `INSERT INTO npc_memories (npc_id, account_id, score, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(npc_id, account_id) DO UPDATE SET
       score = excluded.score,
       updated_at = excluded.updated_at`,
  ).run(adjusted.npcId, adjusted.accountId, adjusted.score, adjusted.updatedAt);

  return adjusted;
}

export function getNpcMemorySummary(
  npcId: string,
  db: DatabaseSync = getDatabase(),
): CustomerMemorySummary {
  const row = (db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN score >= 30 THEN 1 ELSE 0 END) as friendly,
         SUM(CASE WHEN score <= -30 THEN 1 ELSE 0 END) as hostile,
         SUM(CASE WHEN score > -30 AND score < 30 THEN 1 ELSE 0 END) as neutral
       FROM npc_memories
       WHERE npc_id = ?`,
    )
    .get(npcId) as unknown) as {
    total?: number;
    friendly?: number;
    hostile?: number;
    neutral?: number;
  } | undefined;

  return {
    friendlyPatrons: Number(row?.friendly ?? 0),
    hostileCustomers: Number(row?.hostile ?? 0),
    neutralCustomers: Number(row?.neutral ?? 0),
    recentInteractionsCount: Number(row?.total ?? 0),
  };
}
