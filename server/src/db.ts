import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import {
  roll,
  type Element,
  type RisingRole,
  createGenesisEntries,
  MERCHANT_ACCOUNT_IDS,
  INITIAL_BALANCES,
  MERCHANT_CONFIG,
} from '@elements/shared';

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

  database.exec(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_id TEXT,
      metadata TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_sender ON ledger_entries(sender);
    CREATE INDEX IF NOT EXISTS idx_ledger_receiver ON ledger_entries(receiver);
    CREATE INDEX IF NOT EXISTS idx_ledger_reason ON ledger_entries(reason);
    CREATE INDEX IF NOT EXISTS idx_ledger_timestamp ON ledger_entries(timestamp);

    CREATE TABLE IF NOT EXISTS merchant_states (
      id TEXT PRIMARY KEY,
      nation TEXT NOT NULL,
      balance INTEGER NOT NULL,
      status TEXT NOT NULL,
      days_broke INTEGER NOT NULL DEFAULT 0,
      inventory TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counting_house_notes (
      note_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      issued_at INTEGER NOT NULL,
      issued_by TEXT NOT NULL,
      status TEXT NOT NULL,
      redeemed_at INTEGER,
      redeemed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notes_account ON counting_house_notes(account_id);

    CREATE TABLE IF NOT EXISTS red_flags (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_red_flags_account ON red_flags(account_id);

    CREATE TABLE IF NOT EXISTS bounties (
      id TEXT PRIMARY KEY,
      target_account_id TEXT NOT NULL,
      reward_chroma INTEGER NOT NULL,
      reason TEXT NOT NULL,
      issuer_id TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      claimed_by TEXT,
      claimed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bounties_target ON bounties(target_account_id);
    CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);

    CREATE TABLE IF NOT EXISTS npc_memories (
      npc_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (npc_id, account_id)
    );
  `);

  const ledgerCount = database
    .prepare('SELECT count(*) as count FROM ledger_entries')
    .get() as { count: number };

  if (ledgerCount.count === 0) {
    const genesis = createGenesisEntries();
    const insertLedger = database.prepare(
      'INSERT INTO ledger_entries (id, sender, receiver, amount, reason, ref_id, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const entry of genesis) {
      insertLedger.run(
        entry.id,
        entry.from,
        entry.to,
        entry.amount,
        entry.reason,
        entry.refId ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.timestamp,
      );
    }

    const insertMerchant = database.prepare(
      'INSERT OR IGNORE INTO merchant_states (id, nation, balance, status, days_broke, inventory, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );

    const defaultInventory = JSON.stringify({
      shard: {
        stock: MERCHANT_CONFIG.defaultMaxStock.shard,
        maxStock: MERCHANT_CONFIG.defaultMaxStock.shard,
        basePrice: MERCHANT_CONFIG.basePrices.shard,
      },
      potion: {
        stock: MERCHANT_CONFIG.defaultMaxStock.potion,
        maxStock: MERCHANT_CONFIG.defaultMaxStock.potion,
        basePrice: MERCHANT_CONFIG.basePrices.potion,
      },
      item: {
        stock: MERCHANT_CONFIG.defaultMaxStock.item,
        maxStock: MERCHANT_CONFIG.defaultMaxStock.item,
        basePrice: MERCHANT_CONFIG.basePrices.item,
      },
    });

    const now = Date.now();
    insertMerchant.run('merchant_ignis', 'IGNIS', INITIAL_BALANCES.merchantPerStore, 'open', 0, defaultInventory, now);
    insertMerchant.run('merchant_aques', 'AQUES', INITIAL_BALANCES.merchantPerStore, 'open', 0, defaultInventory, now);
    insertMerchant.run('merchant_terra', 'TERRA', INITIAL_BALANCES.merchantPerStore, 'open', 0, defaultInventory, now);
    insertMerchant.run('merchant_aura', 'AURA', INITIAL_BALANCES.merchantPerStore, 'open', 0, defaultInventory, now);
    insertMerchant.run('merchant_chromara', 'CHROMARA', INITIAL_BALANCES.merchantPerStore, 'open', 0, defaultInventory, now);
  }
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
