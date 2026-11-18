import type { DatabaseSync } from 'node:sqlite';
import { CLIMB, climbStanding, masterFor, nextFeeMultiplier, trainingFee, type ClimbStanding } from '@elements/shared';
import { getDatabase, getRising } from '../db.js';
import { getAccountBalance, recordTransaction } from './ledgerService.js';

/** What a fighter's master says about the climb to their next tier, and what it costs today. */
export interface ClimbTerms extends ClimbStanding {
  master: string | null;
  fee: number;
  /** The fee was paid for `next`; the trial waits. */
  paid: boolean;
  /** The fee is higher than when this fighter last asked. */
  feeRose: boolean;
  purse: number;
}

export type EnrolOutcome =
  | { outcome: 'accepted'; fee: number; next: number }
  | { outcome: 'refused'; reason: 'no_master' | 'top' | 'not_qualified' | 'short' | 'no_trials'; fee: number };

const weekOf = (now: number): number => Math.floor(now / (CLIMB.feeWeekHours * 60 * 60 * 1000));

/** A master's fee multiplier, moved for every week that has turned since it was last read. */
function masterMultiplier(masterId: string, db: DatabaseSync, now: number): number {
  const week = weekOf(now);
  const row = db.prepare('SELECT multiplier, week, climbs_this, climbs_last FROM master_fees WHERE master_id = ?').get(masterId) as
    { multiplier: number; week: number; climbs_this: number; climbs_last: number } | undefined;
  if (!row) {
    db.prepare('INSERT INTO master_fees (master_id, multiplier, week) VALUES (?, 1, ?)').run(masterId, week);
    return 1;
  }
  if (row.week >= week) return row.multiplier;
  let { multiplier, climbs_this: last, climbs_last: before } = row;
  for (let w = row.week; w < week; w++) {
    multiplier = nextFeeMultiplier(multiplier, last, before);
    before = last;
    last = 0;
  }
  db.prepare('UPDATE master_fees SET multiplier = ?, week = ?, climbs_this = 0, climbs_last = ? WHERE master_id = ?').run(multiplier, week, before, masterId);
  return multiplier;
}

function climbRow(accountId: string, db: DatabaseSync): { wins: number; paid_for: number | null; fee_seen: number | null } {
  db.prepare('INSERT OR IGNORE INTO tier_climb (account_id) VALUES (?)').run(accountId);
  return db.prepare('SELECT wins, paid_for, fee_seen FROM tier_climb WHERE account_id = ?').get(accountId) as
    { wins: number; paid_for: number | null; fee_seen: number | null };
}

/** A fight this account won (the killing blow): one more toward the next tier. */
export function recordWin(accountId: string, db: DatabaseSync = getDatabase()): void {
  if (!getRising(accountId, db)) return;
  climbRow(accountId, db);
  db.prepare('UPDATE tier_climb SET wins = wins + 1 WHERE account_id = ?').run(accountId);
}

/** The fighter's standing on the climb and the master's terms; remembers the fee seen, to tell next time if it rose. */
export function climbTerms(accountId: string, db: DatabaseSync = getDatabase(), now = Date.now()): ClimbTerms {
  const rising = getRising(accountId, db);
  const tier = rising?.tier ?? CLIMB.startTier;
  const row = climbRow(accountId, db);
  const standing = climbStanding(tier, row.wins);
  const master = rising ? masterFor(rising.role, rising.element) : null;
  const fee = master && standing.next ? trainingFee(standing.next, masterMultiplier(master, db, now)) : 0;
  const feeRose = row.fee_seen !== null && fee > row.fee_seen;
  if (master && standing.next) db.prepare('UPDATE tier_climb SET fee_seen = ? WHERE account_id = ?').run(fee, accountId);
  return { ...standing, master, fee, paid: standing.next !== null && row.paid_for === standing.next, feeRose, purse: getAccountBalance(accountId, db) };
}

/**
 * Asks the master to take the fighter on for the next tier: qualified and able to pay, the fee goes to the master.
 * The fee is only taken where the trial it pays for can be recorded (`trialsRecorded`).
 */
export function enrol(accountId: string, trialsRecorded: boolean, db: DatabaseSync = getDatabase(), now = Date.now()): EnrolOutcome {
  const t = climbTerms(accountId, db, now);
  if (!t.master) return { outcome: 'refused', reason: 'no_master', fee: 0 };
  if (!trialsRecorded) return { outcome: 'refused', reason: 'no_trials', fee: t.fee };
  if (t.next === null) return { outcome: 'refused', reason: 'top', fee: 0 };
  if (t.paid) return { outcome: 'accepted', fee: 0, next: t.next };
  if (!t.qualified) return { outcome: 'refused', reason: 'not_qualified', fee: t.fee };
  if (t.purse < t.fee) return { outcome: 'refused', reason: 'short', fee: t.fee };
  if (t.fee > 0) recordTransaction({ from: accountId, to: t.master, amount: t.fee, reason: 'training_tithe', metadata: { tier: t.next } }, db);
  db.prepare('UPDATE tier_climb SET paid_for = ? WHERE account_id = ?').run(t.next, accountId);
  return { outcome: 'accepted', fee: t.fee, next: t.next };
}

/** The fighter won the trial they paid for: the tier rises for good, wins start again, the master counts a climb. */
export function trialWon(accountId: string, db: DatabaseSync = getDatabase(), now = Date.now()): { tier: number } {
  const t = climbTerms(accountId, db, now);
  if (!t.master || t.next === null || !t.paid) throw new Error('No trial was paid for');
  db.prepare('UPDATE risings SET tier = ? WHERE account_id = ?').run(t.next, accountId);
  db.prepare('UPDATE tier_climb SET wins = 0, paid_for = NULL WHERE account_id = ?').run(accountId);
  masterMultiplier(t.master, db, now);
  db.prepare('UPDATE master_fees SET climbs_this = climbs_this + 1 WHERE master_id = ?').run(t.master);
  return { tier: t.next };
}
