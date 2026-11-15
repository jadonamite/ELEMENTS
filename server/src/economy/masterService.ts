import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  MASTER_ACCOUNT_IDS,
  MASTERS_CONFIG,
  calculateMasterTrainingFee,
  type TrainingFeeCalculationResult,
} from '@elements/shared';
import { getDatabase } from '../db.js';
import { getAccountBalance, recordTransaction } from './ledgerService.js';

export interface MasterState {
  id: string;
  nation: string;
  balance: number;
}

/**
 * Maps a master account ID to its nation.
 */
export function nationForMaster(masterId: string): string {
  if (masterId.includes('ignis')) return 'IGNIS';
  if (masterId.includes('aques')) return 'AQUES';
  if (masterId.includes('terra')) return 'TERRA';
  if (masterId.includes('aura')) return 'AURA';
  return 'IGNIS';
}

/**
 * Returns all master accounts and their current ledger balances.
 */
export function getAllMasters(db: DatabaseSync = getDatabase()): MasterState[] {
  return MASTER_ACCOUNT_IDS.map((id) => ({
    id,
    nation: nationForMaster(id),
    balance: getAccountBalance(id, db),
  }));
}

/**
 * Checks student count registered under a master in the server.
 * Note: Checked against database schema as instructed by Lane C task.
 * Currently, the server has no student tracking table or tier enrollment records.
 */
export function getMasterStudentCount(
  masterId: string,
  db: DatabaseSync = getDatabase(),
): { currentStudents: number; priorStudents: number; studentsImplemented: boolean } {
  // As instructed: build only on what exists, never fake one.
  // The server has no student table or relationship to masters.
  return {
    currentStudents: 0,
    priorStudents: 0,
    studentsImplemented: false,
  };
}

/**
 * Computes training fee for a master according to student count changes.
 * Fees rise +10% a week while students rise, down when they fall (AGENTS.md item 9).
 */
export function getMasterTrainingFee(params: {
  masterId: string;
  currentStudents?: number;
  priorStudents?: number;
  weeks?: number;
}): TrainingFeeCalculationResult {
  const current = params.currentStudents ?? 0;
  const prior = params.priorStudents ?? 0;
  const weeks = params.weeks ?? 1;

  return calculateMasterTrainingFee({
    baseFee: MASTERS_CONFIG.baseTrainingFee,
    currentStudents: current,
    priorStudents: prior,
    weeks,
  });
}

/**
 * Collects a training tithe from a student to a master's purse.
 * Authorized move: student is the sender who gives coin up.
 */
export function collectMasterTrainingFee(
  params: {
    masterId: string;
    studentAccountId: string;
    fee?: number;
    now?: number;
  },
  db: DatabaseSync = getDatabase(),
): { fee: number; txId: string; masterBalance: number } {
  const fee = params.fee ?? MASTERS_CONFIG.baseTrainingFee;
  const now = params.now ?? Date.now();

  const entry = recordTransaction(
    {
      from: params.studentAccountId,
      to: params.masterId,
      amount: fee,
      reason: 'training_tithe',
      refId: `trial:${params.masterId}:${params.studentAccountId}:${now}`,
      timestamp: now,
    },
    db,
  );

  return {
    fee,
    txId: entry.id,
    masterBalance: getAccountBalance(params.masterId, db),
  };
}
