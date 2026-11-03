export interface SentryEncounterResult {
  action: 'ignore' | 'fine' | 'arrest';
  fineAmount: number;
  reason?: string;
}

export function evaluateSentryAction(params: {
  hasActiveBounty: boolean;
  bountyReward?: number;
  activeRedFlagsCount: number;
  inProtectedZone: boolean;
}): SentryEncounterResult {
  if (!params.inProtectedZone) {
    // Sentry only patrols Chromara gates and near roads; far roads are lawless
    return { action: 'ignore', fineAmount: 0 };
  }

  if (params.hasActiveBounty) {
    return {
      action: 'arrest',
      fineAmount: params.bountyReward ?? 150,
      reason: 'Active bounty under Edict decree; subject must be remanded to jail',
    };
  }

  if (params.activeRedFlagsCount > 0) {
    return {
      action: 'fine',
      fineAmount: 25 * params.activeRedFlagsCount,
      reason: 'Civil breach in protected Sentry precinct; fine payable to the Lord Treasury',
    };
  }

  return { action: 'ignore', fineAmount: 0 };
}
