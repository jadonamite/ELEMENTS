import { CRIME_CONFIG } from './constants.js';
import type { Bounty, JailSeizureResult, RedFlag } from './types.js';

export function isRedFlagActive(flag: RedFlag, now = Date.now()): boolean {
  return flag.active && flag.expiresAt > now;
}

export function filterActiveRedFlags(flags: readonly RedFlag[], now = Date.now()): RedFlag[] {
  return flags.filter((f) => isRedFlagActive(f, now));
}

export function evaluateRedFlagThreshold(
  existingFlags: readonly RedFlag[],
  newFlag: RedFlag,
  now = Date.now(),
): {
  flagsToRetain: RedFlag[];
  convertedToBounty: boolean;
  bounty?: Bounty;
} {
  const activeExisting = filterActiveRedFlags(existingFlags, now);
  const updatedFlags = [...activeExisting, newFlag];

  if (updatedFlags.length >= CRIME_CONFIG.flagsToBounty) {
    // Convert 3 red flags to a bounty
    const bounty: Bounty = {
      id: `bounty_from_flags_${newFlag.accountId}_${now}`,
      targetAccountId: newFlag.accountId,
      rewardChroma: CRIME_CONFIG.bountyStartingReward,
      reason: 'Repeated civil offences under the Edict (accumulated 3 red flags)',
      issuerId: 'sentry_command',
      issuedAt: now,
      status: 'open',
    };

    // Mark the flags as consumed
    const consumedFlags = updatedFlags.map((f) => ({ ...f, active: false }));
    return {
      flagsToRetain: consumedFlags,
      convertedToBounty: true,
      bounty,
    };
  }

  return {
    flagsToRetain: updatedFlags,
    convertedToBounty: false,
  };
}

export function calculateJailSeizure(assets: {
  chroma: number;
  vaultChroma: number;
  materialsCount: number;
  gearCount: number;
  hasLand: boolean;
}): JailSeizureResult {
  const seizureRate = CRIME_CONFIG.jailSeizureRate; // 0.40
  const fine = CRIME_CONFIG.jailBaseFine;

  const safeChroma = Math.max(0, assets.chroma);
  const safeVault = Math.max(0, assets.vaultChroma);
  const safeMaterials = Math.max(0, assets.materialsCount);
  const safeGear = Math.max(0, assets.gearCount);

  const seizedChroma = Math.floor(safeChroma * seizureRate);
  const seizedVaultChroma = Math.floor(safeVault * seizureRate);
  const seizedMaterialsCount = Math.floor(safeMaterials * seizureRate);
  const seizedGearCount = Math.floor(safeGear * seizureRate);

  return {
    seizedChroma,
    seizedVaultChroma,
    seizedMaterialsCount,
    seizedGearCount,
    landSeized: 0, // Land is NEVER seized by Edict law
    fineToLeave: fine,
    remainingChroma: safeChroma - seizedChroma,
    remainingVaultChroma: safeVault - seizedVaultChroma,
    remainingMaterialsCount: safeMaterials - seizedMaterialsCount,
    remainingGearCount: safeGear - seizedGearCount,
  };
}

export function processRobberyWitness(params: {
  robberId: string;
  victimId: string;
  isWitnessedBySentry: boolean;
  stolenAmount: number;
  now?: number;
}): {
  flag: RedFlag;
  bounty?: Bounty;
} {
  const timestamp = params.now ?? Date.now();
  const flag: RedFlag = {
    id: `flag_robbery_${params.robberId}_${timestamp}`,
    accountId: params.robberId,
    reason: `Robbery of player ${params.victimId}`,
    issuedAt: timestamp,
    expiresAt: timestamp + CRIME_CONFIG.redFlagDurationMs,
    active: true,
  };

  let bounty: Bounty | undefined;
  if (params.isWitnessedBySentry) {
    bounty = {
      id: `bounty_sentry_witness_${params.robberId}_${timestamp}`,
      targetAccountId: params.robberId,
      rewardChroma: Math.max(CRIME_CONFIG.bountyStartingReward, Math.round(params.stolenAmount * 1.5)),
      reason: `Robbery witnessed in daylight by the Lord Sentries`,
      issuerId: 'sentry_patrol',
      issuedAt: timestamp,
      status: 'open',
    };
  }

  if (bounty) {
    return { flag, bounty };
  }
  return { flag };
}
