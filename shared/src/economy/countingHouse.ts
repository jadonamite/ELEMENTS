import { COUNTING_HOUSES } from './constants.js';
import type { CountingHouseNote } from './types.js';

export function isKnownCountingHouse(id: string): boolean {
  return COUNTING_HOUSES.some((ch) => ch.id === id);
}

export function canAccessCountingHouse(opts: {
  hasActiveRedFlag: boolean;
  hasActiveBounty: boolean;
}): { allowed: boolean; reason?: string } {
  if (opts.hasActiveBounty) {
    return {
      allowed: false,
      reason: 'Under the Edict, counting houses refuse all services to persons with an active bounty',
    };
  }
  if (opts.hasActiveRedFlag) {
    return {
      allowed: false,
      reason: 'Under the Edict, counting houses refuse all services to persons bearing a red flag',
    };
  }
  return { allowed: true };
}

export function createDepositNote(params: {
  noteId: string;
  accountId: string;
  amount: number;
  countingHouseId: string;
  timestamp?: number;
}): CountingHouseNote {
  if (!Number.isSafeInteger(params.amount) || params.amount <= 0) {
    throw new Error('Deposit amount must be a positive integer');
  }
  if (!isKnownCountingHouse(params.countingHouseId)) {
    throw new Error(`Unknown counting house: ${params.countingHouseId}`);
  }

  return {
    noteId: params.noteId,
    accountId: params.accountId,
    amount: params.amount,
    issuedAt: params.timestamp ?? Date.now(),
    issuedBy: params.countingHouseId,
    status: 'active',
  };
}

export function validateNoteRedemption(params: {
  note: CountingHouseNote;
  redeemingAccountId: string;
  countingHouseId: string;
  hasActiveRedFlag: boolean;
  hasActiveBounty: boolean;
}): { valid: boolean; error?: string } {
  const access = canAccessCountingHouse({
    hasActiveRedFlag: params.hasActiveRedFlag,
    hasActiveBounty: params.hasActiveBounty,
  });
  if (!access.allowed) {
    return { valid: false, error: access.reason ?? 'Access denied' };
  }

  if (params.note.status !== 'active') {
    return { valid: false, error: `Note is ${params.note.status}` };
  }
  if (params.note.accountId !== params.redeemingAccountId) {
    return { valid: false, error: 'Bearer account does not match note seal' };
  }
  if (!isKnownCountingHouse(params.countingHouseId)) {
    return { valid: false, error: `Invalid redemption point: ${params.countingHouseId}` };
  }

  return { valid: true };
}
