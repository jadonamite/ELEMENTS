import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  type CarriedLootInput,
  type LootContents,
  type LootPile,
  type LootSource,
  canClaim as pureCanClaim,
  createLootPile as pureCreateLootPile,
  deathDrop,
  monsterDrop,
  villainDrop,
  DROPS_CONFIG,
  TREASURY_ACCOUNT_ID,
} from '@elements/shared';
import { getDatabase } from '../db.js';
import { getAccountBalance, recordTransaction } from './ledgerService.js';

interface RawLootPileRow {
  id: string;
  x: number;
  z: number;
  zone: string;
  contents: string;
  dropped_at: number;
  owner_id: string | null;
  owner_until: number;
  expires_at: number;
  source: string;
  claimed: number;
  claimed_by: string | null;
  claimed_at: number | null;
  expired: number;
}

function mapRowToPile(row: RawLootPileRow): LootPile {
  let contents: LootContents;
  try {
    contents = JSON.parse(row.contents) as LootContents;
  } catch {
    contents = { chroma: 0, shards: { IGNIS: 0, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {} };
  }

  return {
    id: row.id,
    x: row.x,
    z: row.z,
    zone: row.zone,
    contents,
    droppedAt: row.dropped_at,
    ownerId: row.owner_id,
    ownerUntil: row.owner_until,
    expiresAt: row.expires_at,
    source: row.source as LootSource,
    claimed: row.claimed === 1,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    expired: row.expired === 1,
  };
}

export interface CreateLootPileParams {
  id?: string | undefined;
  x: number;
  z: number;
  zone: string;
  contents: LootContents;
  source: LootSource;
  ownerId?: string | null | undefined;
  sourceAccountId?: string | undefined;
  now?: number | undefined;
}

export function createLootPile(
  params: CreateLootPileParams,
  db: DatabaseSync = getDatabase(),
): LootPile {
  const now = params.now ?? Date.now();
  const id = params.id ?? `pile_${randomUUID()}`;

  const pile = pureCreateLootPile({
    id,
    x: params.x,
    z: params.z,
    zone: params.zone,
    contents: params.contents,
    source: params.source,
    droppedAt: now,
    ownerId: params.ownerId ?? null,
  });

  if (pile.contents.chroma > 0) {
    let fromAccount = TREASURY_ACCOUNT_ID;
    if (params.sourceAccountId) {
      const balance = getAccountBalance(params.sourceAccountId, db);
      if (balance >= pile.contents.chroma) {
        fromAccount = params.sourceAccountId;
      }
    }

    recordTransaction(
      {
        from: fromAccount,
        to: pile.id,
        amount: pile.contents.chroma,
        reason: 'loot_drop',
        refId: pile.id,
        metadata: { zone: pile.zone, source: pile.source },
      },
      db,
    );
  }

  db.prepare(
    `INSERT INTO loot_piles (
      id, x, z, zone, contents, dropped_at, owner_id, owner_until, expires_at, source, claimed, claimed_by, claimed_at, expired
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0)`,
  ).run(
    pile.id,
    pile.x,
    pile.z,
    pile.zone,
    JSON.stringify(pile.contents),
    pile.droppedAt,
    pile.ownerId,
    pile.ownerUntil,
    pile.expiresAt,
    pile.source,
  );

  return pile;
}

export interface CreateFightLootPileParams {
  x: number;
  z: number;
  zone: string;
  source: LootSource;
  carried?: CarriedLootInput | undefined;
  nation?: string | undefined;
  zoneKind?: string | undefined;
  winnerId?: string | null | undefined;
  sourceAccountId?: string | undefined;
  now?: number | undefined;
  rng?: (() => number) | undefined;
  id?: string | undefined;
}

export function createLootPileFromFight(
  params: CreateFightLootPileParams,
  db: DatabaseSync = getDatabase(),
): LootPile {
  let contents: LootContents;
  if (params.source === 'villain') {
    contents = villainDrop(params.carried, params.rng);
  } else if (params.source === 'monster') {
    contents = monsterDrop(params.nation ?? 'IGNIS', params.zoneKind ?? 'nation', params.rng);
  } else {
    contents = deathDrop(params.carried ?? { chroma: 0 });
  }

  return createLootPile(
    {
      id: params.id,
      x: params.x,
      z: params.z,
      zone: params.zone,
      contents,
      source: params.source,
      ownerId: params.winnerId ?? null,
      sourceAccountId: params.sourceAccountId,
      now: params.now,
    },
    db,
  );
}

export function getLootPileById(pileId: string, db: DatabaseSync = getDatabase()): LootPile | null {
  const row = db
    .prepare(
      `SELECT id, x, z, zone, contents, dropped_at, owner_id, owner_until, expires_at, source, claimed, claimed_by, claimed_at, expired
       FROM loot_piles WHERE id = ?`,
    )
    .get(pileId) as RawLootPileRow | undefined;

  if (!row) return null;
  return mapRowToPile(row);
}

export interface ListLootPilesParams {
  zone: string;
  x?: number | undefined;
  z?: number | undefined;
  radius?: number | undefined;
  now?: number | undefined;
  includeClaimed?: boolean | undefined;
  includeExpired?: boolean | undefined;
}

export function listLootPiles(
  params: ListLootPilesParams,
  db: DatabaseSync = getDatabase(),
): LootPile[] {
  const now = params.now ?? Date.now();
  const rows = db
    .prepare(
      `SELECT id, x, z, zone, contents, dropped_at, owner_id, owner_until, expires_at, source, claimed, claimed_by, claimed_at, expired
       FROM loot_piles WHERE zone = ?`,
    )
    .all(params.zone) as unknown as RawLootPileRow[];

  const piles: LootPile[] = [];
  for (const row of rows) {
    const pile = mapRowToPile(row);

    if (!params.includeClaimed && pile.claimed) {
      continue;
    }
    if (!params.includeExpired && (pile.expired || now >= pile.expiresAt)) {
      continue;
    }

    if (params.x !== undefined && params.z !== undefined && params.radius !== undefined) {
      const dist = Math.hypot(pile.x - params.x, pile.z - params.z);
      if (dist > params.radius) {
        continue;
      }
    }

    piles.push(pile);
  }

  return piles;
}

export interface ClaimLootPileParams {
  pileId: string;
  accountId: string;
  x: number;
  z: number;
  now?: number;
}

export function claimLootPile(
  params: ClaimLootPileParams,
  db: DatabaseSync = getDatabase(),
): { pile: LootPile; contents: LootContents } {
  const row = db
    .prepare(
      `SELECT id, x, z, zone, contents, dropped_at, owner_id, owner_until, expires_at, source, claimed, claimed_by, claimed_at, expired
       FROM loot_piles WHERE id = ?`,
    )
    .get(params.pileId) as RawLootPileRow | undefined;

  if (!row) {
    throw new Error('Loot pile not found');
  }

  const pile = mapRowToPile(row);
  if (pile.claimed) {
    throw new Error('Loot pile has already been claimed');
  }

  const now = params.now ?? Date.now();
  if (pile.expired || now >= pile.expiresAt) {
    throw new Error('Loot pile has expired');
  }

  // TODO: Position is currently provided by the caller; validate against authoritative game server player position when connected.
  const eligible = pureCanClaim(pile, params.accountId, params.x, params.z, now);
  if (!eligible) {
    const dist = Math.hypot(params.x - pile.x, params.z - pile.z);
    if (dist > DROPS_CONFIG.claimRadius) {
      throw new Error('Cannot claim loot pile: too far away');
    }
    if (pile.ownerId !== null && now < pile.ownerUntil && params.accountId !== pile.ownerId) {
      throw new Error('Cannot claim loot pile: reserved for fight victor');
    }
    throw new Error('Cannot claim loot pile');
  }

  db.prepare(
    `UPDATE loot_piles SET claimed = 1, claimed_by = ?, claimed_at = ? WHERE id = ?`,
  ).run(params.accountId, now, pile.id);

  if (pile.contents.chroma > 0) {
    recordTransaction(
      {
        from: pile.id,
        to: params.accountId,
        amount: pile.contents.chroma,
        reason: 'loot_claim',
        refId: pile.id,
        metadata: { zone: pile.zone, source: pile.source },
      },
      db,
    );
  }

  const updatedPile: LootPile = {
    ...pile,
    claimed: true,
    claimedBy: params.accountId,
    claimedAt: now,
  };

  return {
    pile: updatedPile,
    contents: pile.contents,
  };
}

export function sweepExpiredPiles(
  now: number = Date.now(),
  db: DatabaseSync = getDatabase(),
): { sweptPiles: LootPile[]; reclaimedChroma: number } {
  const rows = db
    .prepare(
      `SELECT id, x, z, zone, contents, dropped_at, owner_id, owner_until, expires_at, source, claimed, claimed_by, claimed_at, expired
       FROM loot_piles WHERE claimed = 0 AND expired = 0 AND expires_at <= ?`,
    )
    .all(now) as unknown as RawLootPileRow[];

  const sweptPiles: LootPile[] = [];
  let reclaimedChroma = 0;

  for (const row of rows) {
    const pile = mapRowToPile(row);
    db.prepare(`UPDATE loot_piles SET expired = 1 WHERE id = ?`).run(pile.id);

    if (pile.contents.chroma > 0) {
      recordTransaction(
        {
          from: pile.id,
          to: TREASURY_ACCOUNT_ID,
          amount: pile.contents.chroma,
          reason: 'loot_expired',
          refId: pile.id,
          metadata: { zone: pile.zone, source: pile.source },
        },
        db,
      );
      reclaimedChroma += pile.contents.chroma;
    }

    sweptPiles.push({
      ...pile,
      expired: true,
    });
  }

  return {
    sweptPiles,
    reclaimedChroma,
  };
}
