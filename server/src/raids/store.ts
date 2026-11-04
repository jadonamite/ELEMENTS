import type { DatabaseSync } from 'node:sqlite';

/** Raid and society records as JSON rows by kind and id, plus each agent's thought log. */
export function migrateRaids(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS raid_records (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (kind, id)
    );
    CREATE TABLE IF NOT EXISTS raid_minds (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      thought TEXT NOT NULL,
      actions TEXT NOT NULL,
      dropped TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_raid_minds_agent ON raid_minds(agent_id, seq);
  `);
}

export type RecordKind = 'hall' | 'fighter' | 'salvage' | 'party' | 'run' | 'pack' | 'meta';

export class RaidStore {
  constructor(readonly db: DatabaseSync) { migrateRaids(db); }

  get<T>(kind: RecordKind, id: string): T | null {
    const row = this.db.prepare('SELECT body FROM raid_records WHERE kind = ? AND id = ?').get(kind, id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as T) : null;
  }

  put<T>(kind: RecordKind, id: string, body: T, now: number): T {
    this.db.prepare('INSERT INTO raid_records (kind, id, body, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
      .run(kind, id, JSON.stringify(body), now);
    return body;
  }

  all<T>(kind: RecordKind): T[] {
    return (this.db.prepare('SELECT body FROM raid_records WHERE kind = ? ORDER BY id').all(kind) as Array<{ body: string }>).map((r) => JSON.parse(r.body) as T);
  }

  remove(kind: RecordKind, id: string): void {
    this.db.prepare('DELETE FROM raid_records WHERE kind = ? AND id = ?').run(kind, id);
  }

  think(agentId: string, thought: string, actions: unknown[], dropped: unknown[], at: number): void {
    this.db.prepare('INSERT INTO raid_minds (agent_id, thought, actions, dropped, at) VALUES (?, ?, ?, ?, ?)')
      .run(agentId, thought, JSON.stringify(actions), JSON.stringify(dropped), at);
  }

  minds(agentId: string, limit = 10): Array<{ thought: string; actions: unknown[]; dropped: unknown[]; at: number }> {
    const rows = this.db.prepare('SELECT thought, actions, dropped, at FROM raid_minds WHERE agent_id = ? ORDER BY seq DESC LIMIT ?').all(agentId, limit) as Array<{ thought: string; actions: string; dropped: string; at: number }>;
    return rows.map((r) => ({ thought: r.thought, actions: JSON.parse(r.actions) as unknown[], dropped: JSON.parse(r.dropped) as unknown[], at: r.at }));
  }
}
