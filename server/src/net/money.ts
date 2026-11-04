import type { DatabaseSync } from 'node:sqlite';
import {
  calculateVillainDrop,
  type LootPile,
  TREASURY_ACCOUNT_ID,
} from '@elements/shared';
import { getDatabase, getRising } from '../db.js';
import {
  addRedFlag,
  claimBounty,
  createLootPileFromFight,
  getAccountBalance,
  getAccountNotes,
  getOpenBounties,
  getSatchel,
  processJailSentence,
} from '../economy/index.js';
import type { KillReport } from './kill-hook.js';

/**
 * The money rules only the server may set off. Nothing here has a public address: the zone
 * room calls them with what it knows itself (who, where, who won), never what a message says.
 */

/** Seconds after the starting purse is granted during which it can't be traded or given away. */
export const PURSE_LOCK_SECONDS = 3600;

/** A player who joined without a login. Guests earn nothing that lasts. */
export const isGuest = (accountId: string): boolean => accountId.startsWith('guest:');

/** The nation each zone belongs to, for its monsters' drops. */
const ZONE_NATION: Record<string, string> = { sindr: 'IGNIS', arena: 'IGNIS' };

/** What each server enemy counts as for the loot rules. */
const LOOT_KIND: Record<string, string> = { brawler: 'miscreant', armed: 'robber' };

/** Coin of the starting purse still held back from trades, by the ledger's own grant record. */
export function lockedPurse(accountId: string, now = Date.now(), db: DatabaseSync = getDatabase()): number {
  const grant = db
    .prepare("SELECT amount, timestamp FROM ledger_entries WHERE receiver = ? AND reason = 'player_starting_grant' ORDER BY timestamp ASC LIMIT 1")
    .get(accountId) as { amount: number; timestamp: number } | undefined;
  if (!grant || now - grant.timestamp >= PURSE_LOCK_SECONDS * 1000) return 0;
  return Math.min(grant.amount, getAccountBalance(accountId, db));
}

/** Coin the account may hand to another player right now. */
export const tradeableChroma = (accountId: string, now = Date.now(), db: DatabaseSync = getDatabase()): number =>
  Math.max(0, getAccountBalance(accountId, db) - lockedPurse(accountId, now, db));

/**
 * Whether a merchant treats the player as from a rival land: their nation (the element of
 * their stored rising) against the merchant's. A Hush has no nation from the rising, so none.
 */
export function isOutsider(accountId: string, merchantNation: string, db: DatabaseSync = getDatabase()): boolean {
  const rising = getRising(accountId, db);
  if (!rising || rising.role !== 'Shaper' || !rising.element) return false;
  return rising.element.toUpperCase() !== merchantNation.toUpperCase();
}

/** The drop for a kill the room judged. Guests' kills drop nothing. */
export function dropForKill(kill: KillReport, rng: () => number = Math.random, db: DatabaseSync = getDatabase()): LootPile | null {
  if (isGuest(kill.killerAccountId)) return null;
  const nation = ZONE_NATION[kill.zone] ?? 'IGNIS';
  if (kill.kind === 'hound') {
    return createLootPileFromFight(
      { x: kill.x, z: kill.z, zone: kill.zone, source: 'monster', nation, zoneKind: 'nation', winnerId: kill.killerAccountId, rng },
      db,
    );
  }
  const odds = calculateVillainDrop(LOOT_KIND[kill.kind] ?? kill.kind);
  const shards: Record<string, number> = rng() < odds.shardChance ? { [nation]: 1 } : {};
  return createLootPileFromFight(
    { x: kill.x, z: kill.z, zone: kill.zone, source: 'villain', carried: { chroma: odds.chroma, shards }, winnerId: kill.killerAccountId, rng },
    db,
  );
}

/** A player fell in the room's own fight: what the server holds for them drops where the room has them. */
export function dropForDeath(accountId: string, zone: string, x: number, z: number, db: DatabaseSync = getDatabase()): LootPile | null {
  if (isGuest(accountId)) return null;
  return createLootPileFromFight({ x, z, zone, source: 'player_death', sourceAccountId: accountId }, db);
}

/** A red flag the room's own rules saw earned (a banished name in chat, a robbery). */
export function flagFromRoom(accountId: string, reason: string, db: DatabaseSync = getDatabase()): ReturnType<typeof addRedFlag> | null {
  if (isGuest(accountId)) return null;
  return addRedFlag(accountId, reason, db);
}

/**
 * Jail for an arrested player, with the vault, materials and gear read from the server's
 * own books. Called by the Sentry rule that makes the arrest.
 */
export function jailFromServerState(accountId: string, db: DatabaseSync = getDatabase()): ReturnType<typeof processJailSentence> {
  const vaultChroma = getAccountNotes(accountId, db)
    .filter((n) => n.status === 'active')
    .reduce((sum, n) => sum + n.amount, 0);
  const materialsCount = Object.values(getSatchel(accountId, db)).reduce((sum, n) => sum + n, 0);
  return processJailSentence({ accountId, vaultChroma, materialsCount, gearCount: 0, hasLand: false }, db);
}

/**
 * The room saw `winnerId` beat `targetId` in a fight it judged: every open bounty on the
 * target is paid to the winner. Returns the bounties paid.
 */
export function payBountiesForDefeat(winnerId: string, targetId: string, db: DatabaseSync = getDatabase()): string[] {
  if (isGuest(winnerId) || winnerId === targetId) return [];
  const paid: string[] = [];
  for (const bounty of getOpenBounties(db)) {
    if (bounty.targetAccountId !== targetId) continue;
    claimBounty({ bountyId: bounty.id, claimantId: winnerId }, db);
    paid.push(bounty.id);
  }
  return paid;
}

export { TREASURY_ACCOUNT_ID };
