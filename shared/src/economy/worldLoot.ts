import { DEATH_CONFIG, DROPS_CONFIG } from './constants.js';
import type { Colour, LootContents, LootPile, LootSource } from './types.js';

export const COLOURS: readonly Colour[] = ['IGNIS', 'AQUES', 'TERRA', 'AURA'] as const;

export function createEmptyShards(): Record<Colour, number> {
  return {
    IGNIS: 0,
    AQUES: 0,
    TERRA: 0,
    AURA: 0,
  };
}

export function normalizeColour(nationOrColour: string): Colour {
  const upper = nationOrColour.trim().toUpperCase();
  if (upper === 'IGNIS' || upper === 'SINDR') return 'IGNIS';
  if (upper === 'AQUES') return 'AQUES';
  if (upper === 'TERRA') return 'TERRA';
  if (upper === 'AURA') return 'AURA';
  return 'IGNIS';
}

export interface CarriedLootInput {
  chroma?: number | undefined;
  shards?: Record<Colour, number> | Partial<Record<Colour, number>> | number | undefined;
  materials?: Record<string, number> | number | undefined;
}

/**
 * Villains drop all the CHROMA they carried plus whatever items/shards they held.
 */
export function villainDrop(
  carried?: CarriedLootInput,
  rng: () => number = Math.random,
): LootContents {
  const chroma = Math.max(0, carried?.chroma ?? 0);
  const shards = createEmptyShards();

  if (typeof carried?.shards === 'number') {
    const total = Math.max(0, carried.shards);
    for (let i = 0; i < total; i++) {
      const colIdx = Math.floor(rng() * COLOURS.length);
      const chosen = COLOURS[colIdx] ?? 'IGNIS';
      shards[chosen] = (shards[chosen] ?? 0) + 1;
    }
  } else if (carried?.shards && typeof carried.shards === 'object') {
    for (const col of COLOURS) {
      shards[col] = Math.max(0, carried.shards[col] ?? 0);
    }
  }

  let materials: Record<string, number> = {};
  if (typeof carried?.materials === 'number') {
    materials = { material: Math.max(0, carried.materials) };
  } else if (carried?.materials && typeof carried.materials === 'object') {
    materials = { ...carried.materials };
  }

  return {
    chroma,
    shards,
    materials,
  };
}

/**
 * Monsters drop shards: 40% chance of 1 shard of the nation's colour in a nation zone,
 * or 30% chance of 1 shard of a random colour in Chromara.
 */
export function monsterDrop(
  nation: string,
  zoneKind: string,
  rng: () => number = Math.random,
): LootContents {
  const shards = createEmptyShards();
  const isChromara = zoneKind.toLowerCase() === 'chromara' || nation.toLowerCase() === 'chromara';

  if (isChromara) {
    const roll = rng();
    if (roll < DROPS_CONFIG.monsterChromaraDropChance) {
      const colourIdx = Math.floor(rng() * COLOURS.length);
      const chosen = COLOURS[colourIdx] ?? 'IGNIS';
      shards[chosen] = 1;
    }
  } else {
    const roll = rng();
    if (roll < DROPS_CONFIG.monsterNationDropChance) {
      const nationColour = normalizeColour(nation);
      shards[nationColour] = 1;
    }
  }

  return {
    chroma: 0,
    shards,
    materials: {},
  };
}

/**
 * Dying out in the world drops all carried materials and 25% of carried shards.
 * Coin stays with the player.
 */
export function deathDrop(carried: CarriedLootInput): LootContents {
  const droppedShards = createEmptyShards();
  const lossRate = DEATH_CONFIG.carriedShardLossRate;

  if (typeof carried.shards === 'number') {
    const count = Math.floor(Math.max(0, carried.shards) * lossRate);
    droppedShards.IGNIS = count;
  } else if (carried.shards && typeof carried.shards === 'object') {
    for (const col of COLOURS) {
      const count = Math.max(0, carried.shards[col] ?? 0);
      droppedShards[col] = Math.floor(count * lossRate);
    }
  }

  let droppedMaterials: Record<string, number> = {};
  if (typeof carried.materials === 'number') {
    droppedMaterials = { material: Math.max(0, carried.materials) };
  } else if (carried.materials && typeof carried.materials === 'object') {
    droppedMaterials = { ...carried.materials };
  }

  return {
    chroma: 0,
    shards: droppedShards,
    materials: droppedMaterials,
  };
}

/**
 * Calculates both dropped loot and retained loot upon player death.
 */
export function calculateDeathDropResolution(carried: CarriedLootInput): {
  dropped: LootContents;
  retained: {
    chroma: number;
    shards: Record<Colour, number>;
    materials: Record<string, number>;
  };
} {
  const dropped = deathDrop(carried);
  const retainedShards = createEmptyShards();

  if (typeof carried.shards === 'number') {
    retainedShards.IGNIS = Math.max(0, carried.shards - dropped.shards.IGNIS);
  } else if (carried.shards && typeof carried.shards === 'object') {
    for (const col of COLOURS) {
      const initial = Math.max(0, carried.shards[col] ?? 0);
      retainedShards[col] = initial - dropped.shards[col];
    }
  }

  return {
    dropped,
    retained: {
      chroma: Math.max(0, carried.chroma ?? 0),
      shards: retainedShards,
      materials: {},
    },
  };
}

/**
 * Creates a LootPile instance with calculated ownership and expiry windows.
 */
export function createLootPile(params: {
  id?: string | undefined;
  x: number;
  z: number;
  zone: string;
  contents: LootContents;
  source: LootSource;
  droppedAt: number;
  ownerId?: string | null | undefined;
  ownerSeconds?: number | undefined;
  expireMinutes?: number | undefined;
}): LootPile {
  const ownerSeconds = params.ownerSeconds ?? DROPS_CONFIG.ownerSeconds;
  const expireMinutes = params.expireMinutes ?? DROPS_CONFIG.expireMinutes;
  const ownerId = params.ownerId ?? null;
  const ownerUntil = ownerId !== null ? params.droppedAt + ownerSeconds * 1000 : params.droppedAt;
  const expiresAt = params.droppedAt + expireMinutes * 60 * 1000;

  return {
    id: params.id ?? `pile_${Math.random().toString(36).slice(2, 10)}`,
    x: params.x,
    z: params.z,
    zone: params.zone,
    contents: params.contents,
    droppedAt: params.droppedAt,
    ownerId,
    ownerUntil,
    expiresAt,
    source: params.source,
    claimed: false,
    expired: false,
  };
}

/**
 * Evaluates whether an account can claim a loot pile at the given position and time.
 * True only within claimRadius of the pile, respecting ownership lock, and before expiry.
 */
export function canClaim(
  pile: LootPile,
  accountId: string,
  x: number,
  z: number,
  now: number,
  claimRadius = DROPS_CONFIG.claimRadius,
): boolean {
  if (pile.claimed) {
    return false;
  }
  if (pile.expired || now >= pile.expiresAt) {
    return false;
  }
  if (pile.ownerId !== null && now < pile.ownerUntil && accountId !== pile.ownerId) {
    return false;
  }
  const dist = Math.hypot(x - pile.x, z - pile.z);
  if (dist > claimRadius) {
    return false;
  }
  return true;
}
