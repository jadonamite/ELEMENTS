import type {
  GangMember,
  OutlawLimits,
  PlayerEncounterMemory,
  RobberGangState,
} from './types.js';

export const GANG_DEFAULTS: OutlawLimits = {
  gangSizeMin: 2,
  gangSizeMax: 4,
  maxLitFraction: 0.20,
  sentrySafeDistance: 25,
  minCarryThreshold: 50,
  highCarryThreshold: 300,
  dayAmbushOdds: 0.15,
  nightAmbushOdds: 0.85,
  fleeHealthFraction: 0.30,
  reachDistance: 20,
  ambushCooldownSeconds: 45,
};

export function createRobberGang(
  id: string,
  name: string,
  hideout = { x: 120, z: -15, name: "Sindr Alley Cache" },
  limits = GANG_DEFAULTS,
  memberCount?: number
): RobberGangState {
  const count = memberCount ?? limits.gangSizeMin + Math.floor(Math.random() * (limits.gangSizeMax - limits.gangSizeMin + 1));
  const maxLit = Math.floor(count * limits.maxLitFraction);
  let litAssigned = 0;

  const members: GangMember[] = [];
  for (let i = 0; i < count; i++) {
    const isLit = litAssigned < maxLit && Math.random() < limits.maxLitFraction;
    if (isLit) litAssigned++;

    const isSword = Math.random() < 0.4;
    members.push({
      id: `${id}_m${i + 1}`,
      name: `${name} ${isLit ? 'Flame' : 'Thug'} ${i + 1}`,
      isLit,
      element: isLit ? 'IGNIS' : undefined,
      weapon: isSword ? 'sword' : 'club',
      health: 100,
      maxHealth: 100,
      state: 'idle',
    });
  }

  return {
    id,
    name,
    purse: { balance: 150, transactions: [] },
    hideout,
    members,
    memories: {},
    state: 'idle',
    currentTargetId: null,
    ambushSpot: null,
  };
}

export function recordPlayerDefeat(
  gang: RobberGangState,
  playerId: string,
  now = Date.now()
): PlayerEncounterMemory {
  const existing = gang.memories[playerId] ?? {
    playerId,
    timesBeaten: 0,
    timesPlayerFled: 0,
    timesRobbed: 0,
    fearScore: 0,
    lastEncounter: now,
  };

  existing.timesBeaten += 1;
  // Beating the gang raises their fear of this player
  existing.fearScore = Math.min(100, existing.fearScore + 50);
  existing.lastEncounter = now;
  gang.memories[playerId] = existing;
  return existing;
}

export function recordPlayerFled(
  gang: RobberGangState,
  playerId: string,
  now = Date.now()
): PlayerEncounterMemory {
  const existing = gang.memories[playerId] ?? {
    playerId,
    timesBeaten: 0,
    timesPlayerFled: 0,
    timesRobbed: 0,
    fearScore: 0,
    lastEncounter: now,
  };

  existing.timesPlayerFled += 1;
  // A fleeing player emboldens the gang (fear decreases)
  existing.fearScore = Math.max(-50, existing.fearScore - 20);
  existing.lastEncounter = now;
  gang.memories[playerId] = existing;
  return existing;
}

export interface FenceLoot {
  chroma: number;
  items: Array<{ id: string; name: string; count: number; estimatedValue?: number }>;
}

export type FenceSaleResult = {
  chromaEarned: number;
  payoutToPurse: number;
  fenceCut: number;
};

/**
 * Stub hook to sell stolen player goods to a fence (AGENTS.md 4).
 * Fences pay far under market value (e.g. 50% discount) when outlaws cannot use bank.
 */
export function sellToFence(
  gang: RobberGangState,
  loot: FenceLoot,
  fenceDiscount = 0.50,
  now = Date.now()
): FenceSaleResult {
  let itemsValue = 0;
  for (const item of loot.items) {
    const val = item.estimatedValue ?? 10;
    itemsValue += val * item.count;
  }

  const grossChroma = loot.chroma + Math.round(itemsValue * fenceDiscount);
  const fenceCut = Math.round(grossChroma * 0.15); // Fence broker fee
  const payoutToPurse = grossChroma - fenceCut;

  gang.purse.balance += payoutToPurse;
  gang.purse.transactions.push({
    amount: payoutToPurse,
    reason: `fence_sale:${loot.items.length}_items`,
    timestamp: now,
  });

  return {
    chromaEarned: grossChroma,
    payoutToPurse,
    fenceCut,
  };
}
