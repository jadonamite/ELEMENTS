import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  type LedgerEntry,
  type LedgerReason,
  TOTAL_CHROMA_SUPPLY,
  TREASURY_ACCOUNT_ID,
  INITIAL_BALANCES,
  validateLedgerEntry,
} from '@elements/shared';
import { getDatabase } from '../db.js';

interface RawLedgerRow {
  id: string;
  sender: string;
  receiver: string;
  amount: number;
  reason: string;
  ref_id: string | null;
  metadata: string | null;
  timestamp: number;
}

function mapRowToEntry(row: RawLedgerRow): LedgerEntry {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = undefined;
    }
  }

  const entry: LedgerEntry = {
    id: row.id,
    from: row.sender,
    to: row.receiver,
    amount: row.amount,
    reason: row.reason as LedgerReason,
    timestamp: row.timestamp,
  };

  if (row.ref_id) {
    entry.refId = row.ref_id;
  }
  if (metadata) {
    entry.metadata = metadata;
  }

  return entry;
}

export function getAllAccountBalances(db: DatabaseSync = getDatabase()): Map<string, number> {
  const balances = new Map<string, number>();

  const rows = db.prepare('SELECT sender, receiver, amount, reason FROM ledger_entries').all() as Array<{
    sender: string;
    receiver: string;
    amount: number;
    reason: string;
  }>;

  for (const row of rows) {
    if (row.reason !== 'genesis') {
      const fromBal = balances.get(row.sender) ?? 0;
      balances.set(row.sender, fromBal - row.amount);
    }
    const toBal = balances.get(row.receiver) ?? 0;
    balances.set(row.receiver, toBal + row.amount);
  }

  return balances;
}

export function getAccountBalance(accountId: string, db: DatabaseSync = getDatabase()): number {
  const incoming = db
    .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM ledger_entries WHERE receiver = ?')
    .get(accountId) as { total: number };

  const outgoing = db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM ledger_entries WHERE sender = ? AND reason != ?',
    )
    .get(accountId, 'genesis') as { total: number };

  return (incoming.total ?? 0) - (outgoing.total ?? 0);
}

export function verifyWorldSupply(db: DatabaseSync = getDatabase()): boolean {
  const balances = getAllAccountBalances(db);
  let total = 0;
  for (const b of balances.values()) {
    total += b;
  }
  return total === TOTAL_CHROMA_SUPPLY;
}

export function recordTransaction(
  params: {
    from: string;
    to: string;
    amount: number;
    reason: LedgerReason;
    refId?: string;
    metadata?: Record<string, unknown>;
    id?: string;
    timestamp?: number;
  },
  db: DatabaseSync = getDatabase(),
): LedgerEntry {
  const entry: LedgerEntry = {
    id: params.id ?? `tx_${randomUUID()}`,
    from: params.from,
    to: params.to,
    amount: params.amount,
    reason: params.reason,
    timestamp: params.timestamp ?? Date.now(),
  };

  if (params.refId) {
    entry.refId = params.refId;
  }
  if (params.metadata) {
    entry.metadata = params.metadata;
  }

  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
    throw new Error('Ledger validation error: Amount must be a positive integer');
  }
  if (!entry.from || !entry.to) {
    throw new Error('Ledger validation error: Both sender and receiver are required');
  }
  if (entry.from === entry.to) {
    throw new Error('Ledger validation error: Sender and receiver cannot be the same');
  }

  if (entry.reason !== 'genesis') {
    const senderBal = getAccountBalance(entry.from, db);
    if (senderBal < entry.amount) {
      throw new Error(
        `Ledger validation error: Insufficient balance: ${entry.from} has ${senderBal}, needs ${entry.amount}`,
      );
    }
  }

  db.prepare(
    'INSERT INTO ledger_entries (id, sender, receiver, amount, reason, ref_id, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    entry.id,
    entry.from,
    entry.to,
    entry.amount,
    entry.reason,
    entry.refId ?? null,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
    entry.timestamp,
  );

  return entry;
}

export function grantPlayerStartingPurse(
  accountId: string,
  db: DatabaseSync = getDatabase(),
): LedgerEntry | null {
  const existingGrant = db
    .prepare(
      "SELECT id FROM ledger_entries WHERE receiver = ? AND reason = 'player_starting_grant'",
    )
    .get(accountId) as { id: string } | undefined;

  if (existingGrant) {
    return null;
  }

  return recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: accountId,
      amount: INITIAL_BALANCES.playerStartingPurse,
      reason: 'player_starting_grant',
      refId: accountId,
      metadata: { note: 'Starting purse from The Lord Treasury' },
    },
    db,
  );
}

export function getLedgerHistory(
  accountId?: string,
  limit = 100,
  db: DatabaseSync = getDatabase(),
): LedgerEntry[] {
  let rows: RawLedgerRow[];
  if (accountId) {
    rows = (db
      .prepare(
        'SELECT id, sender, receiver, amount, reason, ref_id, metadata, timestamp FROM ledger_entries WHERE sender = ? OR receiver = ? ORDER BY timestamp DESC LIMIT ?',
      )
      .all(accountId, accountId, limit) as unknown) as RawLedgerRow[];
  } else {
    rows = (db
      .prepare(
        'SELECT id, sender, receiver, amount, reason, ref_id, metadata, timestamp FROM ledger_entries ORDER BY timestamp DESC LIMIT ?',
      )
      .all(limit) as unknown) as RawLedgerRow[];
  }

  return rows.map(mapRowToEntry);
}
