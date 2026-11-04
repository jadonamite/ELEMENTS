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
  type ShopOwnershipRecord,
  type ShopSaleRecord,
  type ShopOwnershipAction,
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
  /** Fighting tier, 1 (Tiro) to 7 (Primus): which moves the player may use. */
  tier?: number;
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
  const risingColumns = database.prepare('PRAGMA table_info(risings)').all() as Array<{ name: string }>;
  if (!risingColumns.some((c) => c.name === 'tier')) {
    database.exec('ALTER TABLE risings ADD COLUMN tier INTEGER NOT NULL DEFAULT 5');
  }

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

    CREATE TABLE IF NOT EXISTS merchant_demand (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      action TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_demand_merchant_item ON merchant_demand(merchant_id, item_type);
    CREATE INDEX IF NOT EXISTS idx_demand_timestamp ON merchant_demand(timestamp);

    CREATE TABLE IF NOT EXISTS loot_piles (
      id TEXT PRIMARY KEY,
      x REAL NOT NULL,
      z REAL NOT NULL,
      zone TEXT NOT NULL,
      contents TEXT NOT NULL,
      dropped_at INTEGER NOT NULL,
      owner_id TEXT,
      owner_until INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      claimed INTEGER NOT NULL DEFAULT 0,
      claimed_by TEXT,
      claimed_at INTEGER,
      expired INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_loot_piles_zone ON loot_piles(zone);
    CREATE INDEX IF NOT EXISTS idx_loot_piles_expires ON loot_piles(expires_at);
    CREATE INDEX IF NOT EXISTS idx_loot_piles_claimed ON loot_piles(claimed);

    CREATE TABLE IF NOT EXISTS merchant_agent_mind (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      thought TEXT NOT NULL,
      actions TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_mind_merchant ON merchant_agent_mind(merchant_id, timestamp);

    CREATE TABLE IF NOT EXISTS shop_ownership (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      action TEXT NOT NULL,
      price_multipliers TEXT NOT NULL DEFAULT '{}',
      unpaid_upkeep_days INTEGER NOT NULL DEFAULT 0,
      last_upkeep_at INTEGER NOT NULL DEFAULT 0,
      amount INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      timestamp INTEGER NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_shop_ownership_merchant ON shop_ownership(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_shop_ownership_owner ON shop_ownership(owner_id);
    CREATE INDEX IF NOT EXISTS idx_shop_ownership_active ON shop_ownership(active);

    CREATE TABLE IF NOT EXISTS shop_sales (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      buyer_id TEXT,
      seller_id TEXT,
      item_type TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      price INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_shop_sales_merchant ON shop_sales(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_shop_sales_buyer ON shop_sales(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_shop_sales_item ON shop_sales(item_type);

    CREATE TABLE IF NOT EXISTS player_items (
      account_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity >= 0),
      PRIMARY KEY (account_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS item_ledger (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      reason TEXT NOT NULL,
      ref_id TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_item_ledger_from ON item_ledger(from_id);
    CREATE INDEX IF NOT EXISTS idx_item_ledger_to ON item_ledger(to_id);
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

// Opened on first use, so importing this module (as every test does) never touches the file.
let activeDb: DatabaseSync | null = null;

export function setDatabase(db: DatabaseSync): void {
  activeDb = db;
}

export function getDatabase(): DatabaseSync {
  activeDb ??= createDatabase();
  return activeDb;
}

export function getAccount(id: string, db: DatabaseSync = getDatabase()): AccountRecord | null {
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

export function createOrGetAccount(id: string, db: DatabaseSync = getDatabase()): AccountRecord {
  const existing = getAccount(id, db);
  if (existing) return existing;

  const created_at = Date.now();
  db.prepare('INSERT INTO accounts (id, role, element, created_at) VALUES (?, NULL, NULL, ?)').run(
    id,
    created_at,
  );
  return { id, role: null, element: null, created_at };
}

export function getRising(accountId: string, db: DatabaseSync = getDatabase()): RisingRecord | null {
  const row = db
    .prepare('SELECT account_id, role, element, created_at, tier FROM risings WHERE account_id = ?')
    .get(accountId) as { account_id: string; role: string; element: string | null; created_at: number; tier: number } | undefined;

  if (!row) return null;
  return {
    account_id: row.account_id,
    role: row.role as RisingRole,
    element: (row.element as Element) ?? null,
    created_at: row.created_at,
    tier: row.tier,
  };
}

/** A uniform number in [0, 1) from the operating system's secure random source. */
const secureRandom = (): number => randomInt(0, 2 ** 47) / 2 ** 47;

export function createOrGetRising(
  accountId: string,
  rand: () => number = secureRandom,
  db: DatabaseSync = getDatabase(),
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
  db: DatabaseSync = getDatabase(),
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

export function saveMerchantMindEntry(
  entry: {
    merchantId: string;
    thought: string;
    actions: unknown[];
    timestamp: number;
  },
  db: DatabaseSync = getDatabase(),
): void {
  const id = `${entry.merchantId}:${entry.timestamp}:${Math.random().toString(36).slice(2, 9)}`;
  db.prepare(
    `INSERT INTO merchant_agent_mind (id, merchant_id, thought, actions, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.merchantId,
    entry.thought,
    JSON.stringify(entry.actions),
    entry.timestamp,
  );
}

export function getMerchantMindHistory(
  merchantId: string,
  limit = 10,
  db: DatabaseSync = getDatabase(),
): {
  latestThought: string;
  actions: Array<{ action: unknown; reasoning?: string; timestamp: number }>;
  timestamp: number;
} | null {
  const rows = (db
    .prepare(
      `SELECT thought, actions, timestamp
       FROM merchant_agent_mind
       WHERE merchant_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(merchantId, limit) as unknown) as Array<{
    thought: string;
    actions: string;
    timestamp: number;
  }>;

  if (!rows || rows.length === 0) return null;

  const latestThought = rows[0]?.thought ?? '';
  const latestTimestamp = rows[0]?.timestamp ?? 0;

  const allActions: Array<{ action: unknown; reasoning?: string; timestamp: number }> = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.actions) as unknown[];
      if (Array.isArray(parsed)) {
        for (const act of parsed) {
          allActions.push({
            action: act,
            reasoning: row.thought,
            timestamp: row.timestamp,
          });
          if (allActions.length >= limit) break;
        }
      }
    } catch {
      // Ignore parse failure
    }
    if (allActions.length >= limit) break;
  }

  return {
    latestThought,
    actions: allActions,
    timestamp: latestTimestamp,
  };
}

export function insertShopOwnership(
  entry: {
    merchantId: string;
    ownerId: string;
    action: ShopOwnershipAction;
    priceMultipliers?: Record<string, number>;
    unpaidUpkeepDays?: number;
    lastUpkeepAt?: number;
    amount?: number;
    active?: boolean;
    timestamp: number;
    metadata?: Record<string, unknown>;
  },
  db: DatabaseSync = getDatabase(),
): ShopOwnershipRecord {
  const id = `so_${entry.merchantId}_${entry.timestamp}_${Math.random().toString(36).slice(2, 9)}`;
  const priceMultipliers = entry.priceMultipliers ?? {};
  const unpaidUpkeepDays = entry.unpaidUpkeepDays ?? 0;
  const lastUpkeepAt = entry.lastUpkeepAt ?? entry.timestamp;
  const amount = entry.amount ?? 0;
  const active = entry.active !== false;

  db.prepare(
    `INSERT INTO shop_ownership (
       id, merchant_id, owner_id, action, price_multipliers,
       unpaid_upkeep_days, last_upkeep_at, amount, active, timestamp, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.merchantId,
    entry.ownerId,
    entry.action,
    JSON.stringify(priceMultipliers),
    unpaidUpkeepDays,
    lastUpkeepAt,
    amount,
    active ? 1 : 0,
    entry.timestamp,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
  );

  return {
    id,
    merchantId: entry.merchantId,
    ownerId: entry.ownerId,
    action: entry.action,
    priceMultipliers,
    unpaidUpkeepDays,
    lastUpkeepAt,
    amount,
    active,
    timestamp: entry.timestamp,
    metadata: entry.metadata,
  };
}

export function getActiveShopOwnership(
  merchantId: string,
  db: DatabaseSync = getDatabase(),
): ShopOwnershipRecord | null {
  const row = db
    .prepare(
      `SELECT id, merchant_id, owner_id, action, price_multipliers,
              unpaid_upkeep_days, last_upkeep_at, amount, active, timestamp, metadata
       FROM shop_ownership
       WHERE merchant_id = ?
       ORDER BY timestamp DESC, rowid DESC
       LIMIT 1`,
    )
    .get(merchantId) as
    | {
        id: string;
        merchant_id: string;
        owner_id: string;
        action: string;
        price_multipliers: string;
        unpaid_upkeep_days: number;
        last_upkeep_at: number;
        amount: number;
        active: number;
        timestamp: number;
        metadata: string | null;
      }
    | undefined;

  if (!row || row.active !== 1) return null;

  let priceMultipliers: Record<string, number> = {};
  try {
    priceMultipliers = JSON.parse(row.price_multipliers);
  } catch {
    priceMultipliers = {};
  }

  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: row.id,
    merchantId: row.merchant_id,
    ownerId: row.owner_id,
    action: row.action as ShopOwnershipAction,
    priceMultipliers,
    unpaidUpkeepDays: row.unpaid_upkeep_days,
    lastUpkeepAt: row.last_upkeep_at,
    amount: row.amount,
    active: true,
    timestamp: row.timestamp,
    metadata,
  };
}

export function getPlayerOwnedShops(
  ownerId: string,
  db: DatabaseSync = getDatabase(),
): ShopOwnershipRecord[] {
  // Query all distinct merchants and check if latest record belongs to this owner and is active
  const merchantRows = db
    .prepare('SELECT DISTINCT merchant_id FROM shop_ownership')
    .all() as Array<{ merchant_id: string }>;

  const results: ShopOwnershipRecord[] = [];
  for (const m of merchantRows) {
    const active = getActiveShopOwnership(m.merchant_id, db);
    if (active && active.ownerId === ownerId) {
      results.push(active);
    }
  }
  return results;
}

export function insertShopSale(
  entry: {
    merchantId: string;
    buyerId?: string | null;
    sellerId?: string | null;
    itemType: string;
    quantity?: number;
    price: number;
    timestamp: number;
    metadata?: Record<string, unknown>;
  },
  db: DatabaseSync = getDatabase(),
): ShopSaleRecord {
  const id = `ss_${entry.merchantId}_${entry.timestamp}_${Math.random().toString(36).slice(2, 9)}`;
  const quantity = entry.quantity ?? 1;

  db.prepare(
    `INSERT INTO shop_sales (
       id, merchant_id, buyer_id, seller_id, item_type, quantity, price, timestamp, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.merchantId,
    entry.buyerId ?? null,
    entry.sellerId ?? null,
    entry.itemType,
    quantity,
    entry.price,
    entry.timestamp,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
  );

  return {
    id,
    merchantId: entry.merchantId,
    buyerId: entry.buyerId ?? null,
    sellerId: entry.sellerId ?? null,
    itemType: entry.itemType,
    quantity,
    price: entry.price,
    timestamp: entry.timestamp,
    metadata: entry.metadata,
  };
}

export function getShopSales(
  merchantId?: string,
  limit = 50,
  db: DatabaseSync = getDatabase(),
): ShopSaleRecord[] {
  let rows: Array<{
    id: string;
    merchant_id: string;
    buyer_id: string | null;
    seller_id: string | null;
    item_type: string;
    quantity: number;
    price: number;
    timestamp: number;
    metadata: string | null;
  }>;

  if (merchantId) {
    rows = db
      .prepare(
        `SELECT id, merchant_id, buyer_id, seller_id, item_type, quantity, price, timestamp, metadata
         FROM shop_sales
         WHERE merchant_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(merchantId, limit) as typeof rows;
  } else {
    rows = db
      .prepare(
        `SELECT id, merchant_id, buyer_id, seller_id, item_type, quantity, price, timestamp, metadata
         FROM shop_sales
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit) as typeof rows;
  }

  return rows.map((r) => {
    let metadata: Record<string, unknown> | undefined;
    if (r.metadata) {
      try {
        metadata = JSON.parse(r.metadata);
      } catch {
        metadata = undefined;
      }
    }
    return {
      id: r.id,
      merchantId: r.merchant_id,
      buyerId: r.buyer_id,
      sellerId: r.seller_id,
      itemType: r.item_type,
      quantity: r.quantity,
      price: r.price,
      timestamp: r.timestamp,
      metadata,
    };
  });
}


