import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  type Bounty,
  type BountyStatus,
  type RedFlag,
  type JailSeizureResult,
  CRIME_CONFIG,
  TREASURY_ACCOUNT_ID,
  calculateJailSeizure,
  evaluateRedFlagThreshold,
} from '@elements/shared';
import { getDatabase } from '../db.js';
import { getAccountBalance, recordTransaction } from './ledgerService.js';

interface RawRedFlagRow {
  id: string;
  account_id: string;
  reason: string;
  issued_at: number;
  expires_at: number;
  active: number;
}

interface RawBountyRow {
  id: string;
  target_account_id: string;
  reward_chroma: number;
  reason: string;
  issuer_id: string;
  issued_at: number;
  status: string;
  claimed_by: string | null;
  claimed_at: number | null;
}

function mapRowToFlag(row: RawRedFlagRow): RedFlag {
  return {
    id: row.id,
    accountId: row.account_id,
    reason: row.reason,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    active: row.active === 1,
  };
}

function mapRowToBounty(row: RawBountyRow): Bounty {
  const bounty: Bounty = {
    id: row.id,
    targetAccountId: row.target_account_id,
    rewardChroma: row.reward_chroma,
    reason: row.reason,
    issuerId: row.issuer_id,
    issuedAt: row.issued_at,
    status: row.status as BountyStatus,
  };
  if (row.claimed_by) bounty.claimedBy = row.claimed_by;
  if (row.claimed_at) bounty.claimedAt = row.claimed_at;
  return bounty;
}

export function getActiveRedFlags(
  accountId: string,
  db: DatabaseSync = getDatabase(),
  now = Date.now(),
): RedFlag[] {
  const rows = (db
    .prepare(
      'SELECT id, account_id, reason, issued_at, expires_at, active FROM red_flags WHERE account_id = ? AND active = 1 AND expires_at > ?',
    )
    .all(accountId, now) as unknown) as RawRedFlagRow[];

  return rows.map(mapRowToFlag);
}

/** Where a player stands with the town watch: live red flags and whether a bounty is open on them. */
export function getStanding(
  accountId: string,
  db: DatabaseSync = getDatabase(),
  now = Date.now(),
): { redFlags: number; hasBounty: boolean } {
  return { redFlags: getActiveRedFlags(accountId, db, now).length, hasBounty: hasActiveBounty(accountId, db) };
}

export function hasActiveBounty(accountId: string, db: DatabaseSync = getDatabase()): boolean {
  const row = db
    .prepare("SELECT id FROM bounties WHERE target_account_id = ? AND status = 'open'")
    .get(accountId);

  return !!row;
}

export function createBounty(
  params: {
    targetAccountId: string;
    rewardChroma: number;
    reason: string;
    issuerId: string;
  },
  db: DatabaseSync = getDatabase(),
): Bounty {
  const id = `bounty_${randomUUID()}`;
  const now = Date.now();
  const bounty: Bounty = {
    id,
    targetAccountId: params.targetAccountId,
    rewardChroma: params.rewardChroma,
    reason: params.reason,
    issuerId: params.issuerId,
    issuedAt: now,
    status: 'open',
  };

  db.prepare(
    `INSERT INTO bounties (id, target_account_id, reward_chroma, reason, issuer_id, issued_at, status, claimed_by, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    bounty.id,
    bounty.targetAccountId,
    bounty.rewardChroma,
    bounty.reason,
    bounty.issuerId,
    bounty.issuedAt,
    bounty.status,
  );

  return bounty;
}

export function addRedFlag(
  accountId: string,
  reason: string,
  db: DatabaseSync = getDatabase(),
): { flag: RedFlag; convertedToBounty: boolean; bounty?: Bounty } {
  const now = Date.now();
  const flag: RedFlag = {
    id: `flag_${randomUUID()}`,
    accountId,
    reason,
    issuedAt: now,
    expiresAt: now + CRIME_CONFIG.redFlagDurationMs,
    active: true,
  };

  const existing = getActiveRedFlags(accountId, db, now);
  const evalResult = evaluateRedFlagThreshold(existing, flag, now);

  if (evalResult.convertedToBounty && evalResult.bounty) {
    // Save new flag as inactive/consumed
    db.prepare(
      `INSERT INTO red_flags (id, account_id, reason, issued_at, expires_at, active)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(flag.id, flag.accountId, flag.reason, flag.issuedAt, flag.expiresAt);

    // Deactivate previous active flags
    db.prepare(`UPDATE red_flags SET active = 0 WHERE account_id = ? AND active = 1`).run(
      accountId,
    );

    // Create bounty in DB
    const savedBounty = createBounty(
      {
        targetAccountId: evalResult.bounty.targetAccountId,
        rewardChroma: evalResult.bounty.rewardChroma,
        reason: evalResult.bounty.reason,
        issuerId: evalResult.bounty.issuerId,
      },
      db,
    );

    return {
      flag: { ...flag, active: false },
      convertedToBounty: true,
      bounty: savedBounty,
    };
  }

  db.prepare(
    `INSERT INTO red_flags (id, account_id, reason, issued_at, expires_at, active)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(flag.id, flag.accountId, flag.reason, flag.issuedAt, flag.expiresAt);

  return { flag, convertedToBounty: false };
}

export function getOpenBounties(db: DatabaseSync = getDatabase()): Bounty[] {
  const rows = (db
    .prepare(
      "SELECT id, target_account_id, reward_chroma, reason, issuer_id, issued_at, status, claimed_by, claimed_at FROM bounties WHERE status = 'open' ORDER BY reward_chroma DESC",
    )
    .all() as unknown) as RawBountyRow[];

  return rows.map(mapRowToBounty);
}

export function claimBounty(
  params: { bountyId: string; claimantId: string },
  db: DatabaseSync = getDatabase(),
): Bounty {
  const row = db
    .prepare('SELECT id, target_account_id, reward_chroma, reason, issuer_id, issued_at, status, claimed_by, claimed_at FROM bounties WHERE id = ?')
    .get(params.bountyId) as RawBountyRow | undefined;

  if (!row) throw new Error('Bounty not found');
  if (row.status !== 'open') throw new Error(`Bounty is already ${row.status}`);
  if (row.target_account_id === params.claimantId) {
    throw new Error('A bounty target cannot claim their own bounty');
  }

  const now = Date.now();

  // Payout from the Lord Treasury to claimant
  recordTransaction(
    {
      from: TREASURY_ACCOUNT_ID,
      to: params.claimantId,
      amount: row.reward_chroma,
      reason: 'bounty_payout',
      refId: row.id,
      metadata: { target: row.target_account_id },
    },
    db,
  );

  db.prepare(
    "UPDATE bounties SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ?",
  ).run(params.claimantId, now, row.id);

  return {
    ...mapRowToBounty(row),
    status: 'claimed',
    claimedBy: params.claimantId,
    claimedAt: now,
  };
}

export function pardonBounty(
  params: { bountyId: string; payerId: string },
  db: DatabaseSync = getDatabase(),
): Bounty {
  const row = db
    .prepare('SELECT id, target_account_id, reward_chroma, reason, issuer_id, issued_at, status, claimed_by, claimed_at FROM bounties WHERE id = ?')
    .get(params.bountyId) as RawBountyRow | undefined;

  if (!row) throw new Error('Bounty not found');
  if (row.status !== 'open') throw new Error(`Bounty is already ${row.status}`);

  // Criminal pays off bounty to Treasury
  recordTransaction(
    {
      from: params.payerId,
      to: TREASURY_ACCOUNT_ID,
      amount: row.reward_chroma,
      reason: 'edict_fine',
      refId: row.id,
      metadata: { action: 'pardon_fine' },
    },
    db,
  );

  db.prepare("UPDATE bounties SET status = 'pardoned' WHERE id = ?").run(row.id);

  return {
    ...mapRowToBounty(row),
    status: 'pardoned',
  };
}

export function processJailSentence(
  params: {
    accountId: string;
    vaultChroma?: number;
    materialsCount: number;
    gearCount: number;
    hasLand: boolean;
  },
  db: DatabaseSync = getDatabase(),
): JailSeizureResult {
  const currentChroma = getAccountBalance(params.accountId, db);
  const currentVault = params.vaultChroma ?? 0;

  const seizure = calculateJailSeizure({
    chroma: currentChroma,
    vaultChroma: currentVault,
    materialsCount: params.materialsCount,
    gearCount: params.gearCount,
    hasLand: params.hasLand,
  });

  // Seize 40% of liquid CHROMA to Treasury
  if (seizure.seizedChroma > 0) {
    recordTransaction(
      {
        from: params.accountId,
        to: TREASURY_ACCOUNT_ID,
        amount: seizure.seizedChroma,
        reason: 'jail_seizure',
        refId: `jail:${params.accountId}`,
      },
      db,
    );
  }

  // Collect fine if available
  const postSeizureBalance = getAccountBalance(params.accountId, db);
  const payableFine = Math.min(postSeizureBalance, seizure.fineToLeave);
  if (payableFine > 0) {
    recordTransaction(
      {
        from: params.accountId,
        to: TREASURY_ACCOUNT_ID,
        amount: payableFine,
        reason: 'jail_fine',
        refId: `fine:${params.accountId}`,
      },
      db,
    );
  }

  // Sentence served: clear red flags and close open bounties
  db.prepare('UPDATE red_flags SET active = 0 WHERE account_id = ?').run(params.accountId);
  db.prepare("UPDATE bounties SET status = 'pardoned' WHERE target_account_id = ? AND status = 'open'").run(
    params.accountId,
  );

  return seizure;
}
