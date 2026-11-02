import type { NpcMemory } from './types.js';

export const NPC_MEMORY_LIMITS = {
  minScore: -100,
  maxScore: 100,
  friendlyThreshold: 30,
  hostileThreshold: -30,
} as const;

export function clampNpcScore(score: number): number {
  return Math.max(NPC_MEMORY_LIMITS.minScore, Math.min(score, NPC_MEMORY_LIMITS.maxScore));
}

export function adjustNpcMemory(
  current: NpcMemory | null | undefined,
  delta: number,
  npcId: string,
  accountId: string,
  now = Date.now(),
): NpcMemory {
  const currentScore = current ? current.score : 0;
  const newScore = clampNpcScore(currentScore + delta);

  return {
    npcId,
    accountId,
    score: newScore,
    updatedAt: now,
  };
}

export type NpcDisposition = 'friendly' | 'neutral' | 'hostile';

export function getNpcDisposition(score: number): NpcDisposition {
  if (score >= NPC_MEMORY_LIMITS.friendlyThreshold) return 'friendly';
  if (score <= NPC_MEMORY_LIMITS.hostileThreshold) return 'hostile';
  return 'neutral';
}

export function getNpcPriceMultiplier(
  score: number,
  action: 'buy' | 'sell',
  isNationAtWar = false,
): number {
  let multiplier = 1.0;

  if (isNationAtWar) {
    if (action === 'buy') {
      multiplier += 0.15; // 15% wartime foreigner markup
    } else {
      multiplier -= 0.1; // 10% wartime discount on buying from outsider
    }
  }

  if (score > 30) {
    const factor = (score - 30) / 70;
    if (action === 'buy') {
      multiplier -= factor * 0.1; // up to 10% discount
    } else {
      multiplier += factor * 0.08; // up to 8% bonus
    }
  } else if (score < -30) {
    const factor = Math.abs(score + 30) / 70;
    if (action === 'buy') {
      multiplier += factor * 0.25; // up to 25% price hike
    } else {
      multiplier -= factor * 0.15; // up to 15% dock on player sales
    }
  }

  return Math.max(0.5, multiplier);
}
