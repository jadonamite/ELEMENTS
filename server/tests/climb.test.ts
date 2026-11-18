import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CLIMB } from '@elements/shared';
import { getRising, migrateDatabase, setDatabase, createOrGetRising } from '../src/db.js';
import { getAccountBalance, grantPlayerStartingPurse, recordTransaction } from '../src/economy/ledgerService.js';
import { climbTerms, enrol, recordWin, trialWon } from '../src/economy/climbService.js';
import { TREASURY_ACCOUNT_ID } from '@elements/shared';

const HOUR = 60 * 60 * 1000;
const WEEK = CLIMB.feeWeekHours * HOUR;

function fighter(db: DatabaseSync, id: string, role: 'Shaper' | 'Hush' = 'Shaper', element: string | null = 'IGNIS'): void {
  createOrGetRising(id, () => 0, db);
  db.prepare('UPDATE risings SET role = ?, element = ? WHERE account_id = ?').run(role, element, id);
  grantPlayerStartingPurse(id, db);
}

function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  return db;
}

test('A new character starts at the bottom of the climb', () => {
  const db = fresh();
  fighter(db, 'p1');
  assert.equal(getRising('p1', db)?.tier, CLIMB.startTier);
});

test('Fight enough, pay your master, win the trial: the tier rises for good', () => {
  const db = fresh();
  fighter(db, 'p1');
  const need = CLIMB.winsToQualify['2']!;
  const fee = CLIMB.fee['2']!;
  const now = 10 * WEEK;

  assert.deepEqual(enrol('p1', db, now), { outcome: 'refused', reason: 'not_qualified', fee });
  for (let i = 0; i < need; i++) recordWin('p1', db);
  assert.equal(climbTerms('p1', db, now).qualified, true);

  const purse = getAccountBalance('p1', db);
  const master = getAccountBalance('master_ignis', db);
  assert.deepEqual(enrol('p1', db, now), { outcome: 'accepted', fee, next: 2 });
  assert.equal(getAccountBalance('p1', db), purse - fee);
  assert.equal(getAccountBalance('master_ignis', db), master + fee);
  // Asking again after paying never charges twice.
  assert.deepEqual(enrol('p1', db, now), { outcome: 'accepted', fee: 0, next: 2 });

  assert.deepEqual(trialWon('p1', db, now), { tier: 2 });
  assert.equal(getRising('p1', db)?.tier, 2);
  const after = climbTerms('p1', db, now);
  assert.equal(after.wins, 0);
  assert.equal(after.paid, false);
  assert.throws(() => trialWon('p1', db, now), /No trial/);
});

test('The master refuses a fighter who cannot pay, and a Hush, who climbs with a master smith', () => {
  const db = fresh();
  fighter(db, 'poor');
  for (let i = 0; i < CLIMB.winsToQualify['2']!; i++) recordWin('poor', db);
  recordTransaction({ from: 'poor', to: TREASURY_ACCOUNT_ID, amount: getAccountBalance('poor', db), reason: 'edict_fine' }, db);
  assert.equal(enrol('poor', db, WEEK).outcome, 'refused');
  assert.equal((enrol('poor', db, WEEK) as { reason: string }).reason, 'short');

  fighter(db, 'hush', 'Hush', null);
  assert.deepEqual(enrol('hush', db, WEEK), { outcome: 'refused', reason: 'no_master', fee: 0 });
});

test("A master's fee rises a step a week while more students climb than the week before, and the fighter hears it rose", () => {
  const db = fresh();
  const base = CLIMB.fee['2']!;
  fighter(db, 'seen');
  assert.equal(climbTerms('seen', db, 0).fee, base);
  assert.equal(climbTerms('seen', db, 0).feeRose, false);
  // One student climbs this week (none the week before).
  fighter(db, 'climber');
  for (let i = 0; i < CLIMB.winsToQualify['2']!; i++) recordWin('climber', db);
  enrol('climber', db, 0);
  trialWon('climber', db, 0);
  const next = climbTerms('seen', db, WEEK);
  assert.equal(next.fee, Math.round(base * (1 + CLIMB.feeWeeklyStep)));
  assert.equal(next.feeRose, true);
  // A quiet week after: it falls back, never below the base.
  assert.equal(climbTerms('seen', db, 2 * WEEK).fee, base);
  assert.equal(climbTerms('seen', db, 3 * WEEK).fee, base);
});
