export interface CarriedLoot {
  chroma: number;
  shards: number;
  materials: number;
}

export interface FightLootResolution {
  transferredChroma: number;
  transferredShards: number;
  transferredMaterials: number;
  retainedChroma: number;
  retainedShards: number;
  retainedMaterials: number;
}

export function calculateWorldDeathDrop(carried: CarriedLoot): FightLootResolution {
  // Dying out in the world: drop materials carried, keep coin and shards, wake at shrine
  return {
    transferredChroma: 0,
    transferredShards: 0,
    transferredMaterials: carried.materials,
    retainedChroma: carried.chroma,
    retainedShards: carried.shards,
    retainedMaterials: 0,
  };
}

export function calculateDuelOrStoryLoss(
  carried: CarriedLoot,
  isFullLoot = false,
): FightLootResolution {
  if (isFullLoot) {
    return {
      transferredChroma: carried.chroma,
      transferredShards: carried.shards,
      transferredMaterials: carried.materials,
      retainedChroma: 0,
      retainedShards: 0,
      retainedMaterials: 0,
    };
  }

  // Story / private duel: 25% (one quarter) loss of carried CHROMA, shards, and materials
  const lostChroma = Math.floor(carried.chroma * 0.25);
  const lostShards = Math.floor(carried.shards * 0.25);
  const lostMaterials = Math.floor(carried.materials * 0.25);

  return {
    transferredChroma: lostChroma,
    transferredShards: lostShards,
    transferredMaterials: lostMaterials,
    retainedChroma: carried.chroma - lostChroma,
    retainedShards: carried.shards - lostShards,
    retainedMaterials: carried.materials - lostMaterials,
  };
}

export function calculateVillainDrop(villainKind: string): { chroma: number; shardChance: number } {
  switch (villainKind) {
    case 'boss':
      return { chroma: 250, shardChance: 1.0 };
    case 'soldier':
      return { chroma: 35, shardChance: 0.4 };
    case 'robber':
    case 'miscreant':
      return { chroma: 20, shardChance: 0.3 };
    case 'monster':
      return { chroma: 10, shardChance: 0.4 };
    default:
      return { chroma: 15, shardChance: 0.35 };
  }
}

export function calculateRobberTargetWeight(playerCarriedChroma: number): number {
  // Robbers target players carrying more coin
  // Base threat 1.0, increases linearly with coin carried
  return Math.max(1.0, 1.0 + playerCarriedChroma / 200);
}
