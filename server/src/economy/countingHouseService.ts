import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  type CountingHouseNote,
  type CountingHouseNoteStatus,
  canAccessCountingHouse,
  createDepositNote,
  validateNoteRedemption,
} from '@elements/shared';
import { getDatabase } from '../db.js';
import { recordTransaction } from './ledgerService.js';
import { getActiveRedFlags, hasActiveBounty } from './crimeService.js';

interface RawNoteRow {
  note_id: string;
  account_id: string;
  amount: number;
  issued_at: number;
  issued_by: string;
  status: string;
  redeemed_at: number | null;
  redeemed_by: string | null;
}

function mapRowToNote(row: RawNoteRow): CountingHouseNote {
  return {
    noteId: row.note_id,
    accountId: row.account_id,
    amount: row.amount,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by,
    status: row.status as CountingHouseNoteStatus,
  };
}

export function depositToCountingHouse(
  params: {
    accountId: string;
    amount: number;
    countingHouseId: string;
  },
  db: DatabaseSync = getDatabase(),
): CountingHouseNote {
  const flags = getActiveRedFlags(params.accountId, db);
  const bountyActive = hasActiveBounty(params.accountId, db);

  const access = canAccessCountingHouse({
    hasActiveRedFlag: flags.length > 0,
    hasActiveBounty: bountyActive,
  });
  if (!access.allowed) {
    throw new Error(access.reason ?? 'Counting house access denied');
  }

  const noteId = `note_${randomUUID()}`;
  const now = Date.now();
  const note = createDepositNote({
    noteId,
    accountId: params.accountId,
    amount: params.amount,
    countingHouseId: params.countingHouseId,
    timestamp: now,
  });

  // Transfer CHROMA from player into depository
  recordTransaction(
    {
      from: params.accountId,
      to: params.countingHouseId,
      amount: params.amount,
      reason: 'counting_house_deposit',
      refId: noteId,
    },
    db,
  );

  db.prepare(
    `INSERT INTO counting_house_notes (note_id, account_id, amount, issued_at, issued_by, status, redeemed_at, redeemed_by)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(note.noteId, note.accountId, note.amount, note.issuedAt, note.issuedBy, note.status);

  return note;
}

export function withdrawFromCountingHouse(
  params: {
    accountId: string;
    noteId: string;
    countingHouseId: string;
  },
  db: DatabaseSync = getDatabase(),
): { withdrawnAmount: number; note: CountingHouseNote } {
  const row = db
    .prepare('SELECT note_id, account_id, amount, issued_at, issued_by, status FROM counting_house_notes WHERE note_id = ?')
    .get(params.noteId) as RawNoteRow | undefined;

  if (!row) {
    throw new Error('Sealed note not found');
  }

  const note = mapRowToNote(row);
  const flags = getActiveRedFlags(params.accountId, db);
  const bountyActive = hasActiveBounty(params.accountId, db);

  const check = validateNoteRedemption({
    note,
    redeemingAccountId: params.accountId,
    countingHouseId: params.countingHouseId,
    hasActiveRedFlag: flags.length > 0,
    hasActiveBounty: bountyActive,
  });

  if (!check.valid) {
    throw new Error(check.error ?? 'Redemption validation failed');
  }

  const now = Date.now();

  // Transfer CHROMA from depository back to player
  recordTransaction(
    {
      from: note.issuedBy,
      to: params.accountId,
      amount: note.amount,
      reason: 'counting_house_withdrawal',
      refId: note.noteId,
    },
    db,
  );

  db.prepare(
    `UPDATE counting_house_notes SET status = 'redeemed', redeemed_at = ?, redeemed_by = ? WHERE note_id = ?`,
  ).run(now, params.countingHouseId, note.noteId);

  return {
    withdrawnAmount: note.amount,
    note: { ...note, status: 'redeemed' },
  };
}

export function getAccountNotes(
  accountId: string,
  db: DatabaseSync = getDatabase(),
): CountingHouseNote[] {
  const rows = (db
    .prepare(
      'SELECT note_id, account_id, amount, issued_at, issued_by, status, redeemed_at, redeemed_by FROM counting_house_notes WHERE account_id = ? ORDER BY issued_at DESC',
    )
    .all(accountId) as unknown) as RawNoteRow[];

  return rows.map(mapRowToNote);
}
