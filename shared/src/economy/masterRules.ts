import { MASTERS_CONFIG } from './constants.js';

export interface TrainingFeeCalculationResult {
  fee: number;
  growthFactor: number;
  reason: string;
}

/**
 * Calculates master training fee scaled to rising or falling student counts.
 * In accordance with AGENTS.md item 9: +10% a week while students rise, down when they fall.
 * Clamped strictly within the rule-file boundaries.
 */
export function calculateMasterTrainingFee(params: {
  baseFee?: number;
  currentStudents: number;
  priorStudents: number;
  weeks?: number;
}): TrainingFeeCalculationResult {
  const baseFee = params.baseFee ?? MASTERS_CONFIG.baseTrainingFee;
  const current = Math.max(0, params.currentStudents);
  const prior = Math.max(0, params.priorStudents);
  const weeks = Math.max(1, params.weeks ?? 1);
  const weeklyRate = MASTERS_CONFIG.weeklyGrowthRate;

  let growthFactor = 1.0;
  let reason = 'Student rolls are steady; training fees remain at the standard rate.';

  if (current > prior) {
    const studentIncreaseRatio = prior === 0 ? 1.0 : (current - prior) / prior;
    const effectiveWeeklyGrowth = weeklyRate * Math.min(2.0, Math.max(0.1, studentIncreaseRatio));
    growthFactor = Math.pow(1 + effectiveWeeklyGrowth, weeks);
    reason = `Student intake has grown from ${prior} to ${current}; training tithe has increased by ${Math.round((growthFactor - 1) * 100)}%.`;
  } else if (current < prior) {
    const studentDeclineRatio = (prior - current) / Math.max(1, prior);
    const effectiveWeeklyDecline = weeklyRate * Math.min(1.0, Math.max(0.1, studentDeclineRatio));
    growthFactor = Math.pow(1 - effectiveWeeklyDecline, weeks);
    reason = `Student attendance has fallen from ${prior} to ${current}; training tithe is reduced to encourage new applicants.`;
  }

  const rawFee = Math.round(baseFee * growthFactor);
  const fee = Math.max(MASTERS_CONFIG.minFee, Math.min(MASTERS_CONFIG.maxFee, rawFee));

  return {
    fee,
    growthFactor,
    reason,
  };
}
