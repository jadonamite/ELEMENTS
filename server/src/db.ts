import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { roll, type Element, type RisingRole } from '@elements/shared';

export interface AccountRecord {
  id: string;
  role?: RisingRole | null;
  element?: Element | null;
  created_at: number;
}

export interface RisingRecord {
  account_id: string;
  role: RisingRole;
  element?: Element | null;
  created_at: number;
}

export function migrateDatabase(database: DatabaseSync): void {
  const tableCheck = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
    .get();

  if (tableCheck) {
    const columns = database
      .prepare('PRAGMA table_info(accounts)')
      .all() as Array<{ name: string; notnull: number }>;
    const roleCol = columns.find((c) => c.name === 'role');
    if (roleCol && roleCol.notnull === 1) {
      database.exec(`
        PRAGMA foreign_keys=off;
        CREATE TABLE accounts_new (
          id TEXT PRIMARY KEY,
          role TEXT,
          element TEXT,
          created_at INTEGER NOT NULL
        );
        INSERT INTO accounts_new (id, role, element, created_at)
          SELECT id, role, element, created_at FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_new RENAME TO accounts;
        CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role);
        PRAGMA foreign_keys=on;
      `);
    }
  } else {
    database.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        role TEXT,
        element TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role);
    `);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS risings (
      account_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      element TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_risings_role ON risings(role);
  `);

  database.exec(`
    INSERT OR IGNORE INTO risings (account_id, role, element, created_at)
      SELECT id, role, element, created_at FROM accounts WHERE role IN ('Shaper', 'Hush');
  `);
}

export function createDatabase(dbPath?: string): DatabaseSync {
  const resolvedPath = dbPath ?? path.resolve(process.cwd(), 'elements-server.sqlite');
  const db = new DatabaseSync(resolvedPath);
  migrateDatabase(db);
  return db;
}

let activeDb: DatabaseSync = createDatabase();

export function setDatabase(db: DatabaseSync): void {
  activeDb = db;
}

export function getDatabase(): DatabaseSync {
  return activeDb;
}

export function getAccount(id: string, db: DatabaseSync = activeDb): AccountRecord | null {
  const row = db
    .prepare('SELECT id, role, element, created_at FROM accounts WHERE id = ?')
    .get(id) as { id: string; role: string | null; element: string | null; created_at: number } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    role: (row.role as RisingRole) ?? null,
    element: (row.element as Element) ?? null,
    created_at: row.created_at,
  };
}

export function createOrGetAccount(id: string, db: DatabaseSync = activeDb): AccountRecord {
  const existing = getAccount(id, db);
  if (existing) return existing;

  const created_at = Date.now();
  db.prepare('INSERT INTO accounts (id, role, element, created_at) VALUES (?, NULL, NULL, ?)').run(
    id,
    created_at,
  );
  return { id, role: null, element: null, created_at };
}

export function getRising(accountId: string, db: DatabaseSync = activeDb): RisingRecord | null {
  const row = db
    .prepare('SELECT account_id, role, element, created_at FROM risings WHERE account_id = ?')
    .get(accountId) as { account_id: string; role: string; element: string | null; created_at: number } | undefined;

  if (!row) return null;
  return {
    account_id: row.account_id,
    role: row.role as RisingRole,
    element: (row.element as Element) ?? null,
    created_at: row.created_at,
  };
}

/** A uniform number in [0, 1) from the operating system's secure random source. */
const secureRandom = (): number => randomInt(0, 2 ** 47) / 2 ** 47;

export function createOrGetRising(
  accountId: string,
  rand: () => number = secureRandom,
  db: DatabaseSync = activeDb,
): RisingRecord {
  const existing = getRising(accountId, db);
  if (existing) {
    return existing;
  }

  createOrGetAccount(accountId, db);

  const rolled = roll(rand);
  const now = Date.now();

  try {
    db.prepare('INSERT INTO risings (account_id, role, element, created_at) VALUES (?, ?, ?, ?)').run(
      accountId,
      rolled.role,
      rolled.element ?? null,
      now,
    );
    db.prepare('UPDATE accounts SET role = ?, element = ? WHERE id = ?').run(
      rolled.role,
      rolled.element ?? null,
      accountId,
    );
    return {
      account_id: accountId,
      role: rolled.role,
      element: rolled.element ?? null,
      created_at: now,
    };
  } catch {
    const current = getRising(accountId, db);
    if (current) {
      return current;
    }
    throw new Error(`Failed to store rising for ${accountId}`);
  }
}

export interface SavedAccountRecord extends AccountRecord {
  role: RisingRole;
}

export function saveAccount(
  id: string,
  role: 'Shaper' | 'Hush',
  element?: 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA' | null,
  db: DatabaseSync = activeDb,
): SavedAccountRecord {
  const existing = getAccount(id, db);
  if (existing && existing.role) {
    return {
      id: existing.id,
      role: existing.role,
      element: existing.element ?? null,
      created_at: existing.created_at,
    };
  }

  const created_at = Date.now();
  if (existing) {
    db.prepare('UPDATE accounts SET role = ?, element = ? WHERE id = ?').run(
      role,
      element ?? null,
      id,
    );
  } else {
    db.prepare('INSERT INTO accounts (id, role, element, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      role,
      element ?? null,
      created_at,
    );
  }

  try {
    db.prepare('INSERT OR IGNORE INTO risings (account_id, role, element, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      role,
      element ?? null,
      created_at,
    );
  } catch {
    // If rising already exists, ignore
  }

  return { id, role, element: element ?? null, created_at: existing?.created_at ?? created_at };
}
