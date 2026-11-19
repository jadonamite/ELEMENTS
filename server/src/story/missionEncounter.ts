import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { advanceMission, ARENA_TICKET, IGNIS_MISSION, LEGACY_SINDR_ORIGIN, toGlobal, toLocal, type LootPile } from '@elements/shared';
import { getMission, missionSnapshot, saveMission, type MissionContext } from './missionService.js';
import { createLootPile } from '../economy/lootService.js';
import { recordItemMove, withSavepoint } from '../economy/satchelService.js';
import { ServerEnemy } from '../net/enemies.js';
import type { KillReport } from '../net/kill-hook.js';
import type { ZoneWorld } from '../net/world.js';
import { nationalRegion, networkPosition, persistentPosition } from '../net/coordinates.js';

const owners = new WeakMap<DatabaseSync, Map<string, string>>();

interface Attempt { accountId: string; id: string; enemies: string[]; defeated: string[]; worldId: string; kind: 'ambush' | 'spar' }

export function migrateMissionEncounters(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS mission_encounters (
    account_id TEXT PRIMARY KEY, attempt TEXT NOT NULL, ticket_pile_id TEXT
  )`);
}

export function townPosition(zone: string, p: { x: number; y: number; z: number }): MissionContext {
  const region = nationalRegion(zone);
  const town = region ? toLocal(toGlobal(p, region.origin), LEGACY_SINDR_ORIGIN) : p;
  return { ...town, zone: zone === 'sindr' || region ? 'sindr' : zone };
}

export function roomPosition(zone: string, town: { x: number; y: number; z: number }) {
  return nationalRegion(zone) ? networkPosition(zone, toGlobal(town, LEGACY_SINDR_ORIGIN)) : town;
}

/** An ambush's roster is created here; only the room's judged kill hook can finish it. */
export class MissionEncounter {
  private readonly active = new Map<string, Attempt>();
  constructor(private readonly world: ZoneWorld, private readonly db: DatabaseSync) {}

  start(accountId: string, at: MissionContext, kind: 'ambush' | 'spar' = 'ambush') {
    const location = kind === 'spar' ? IGNIS_MISSION.yard : IGNIS_MISSION.ambush;
    if (at.zone !== 'sindr' || Math.hypot(at.x - location.x, at.z - location.z) > 7 || Math.abs(at.y - location.y) > 3) throw new Error('Stand at the encounter to begin');
    const registry = owners.get(this.db) ?? new Map<string, string>();
    owners.set(this.db, registry);
    if (registry.has(accountId) && registry.get(accountId) !== this.world.id) throw new Error('This search or spar is already active in another world');
    const known = this.active.get(accountId);
    if (known) {
      if (known.defeated.length === known.enemies.length) this.abandon(accountId);
      else if (known.kind === kind) return missionSnapshot(accountId, this.db);
      else throw new Error('Finish the current encounter first');
    }
    const state = getMission(accountId, this.db);
    if (state.zone !== 'sindr') throw new Error('This encounter is not available in Sindr');
    const next = advanceMission(state, kind === 'spar' ? 'start_spar' : 'start_ambush', false);
    const attempt: Attempt = { accountId, id: randomBytes(10).toString('hex'), enemies: [], defeated: [], worldId: this.world.id, kind };
    const spawns = [-1, 1].map((side, i) => {
      const id = `mission:${attempt.id}:${i}`;
      attempt.enemies.push(id);
      const p = roomPosition(this.world.zone, { x: location.x + side * 3, y: location.y, z: location.z });
      const enemy = new ServerEnemy({ id, kind: kind === 'spar' ? (i === 0 ? 'brawler' : 'armed') : 'robber', x: p.x, z: p.z });
      enemy.storyOwner = accountId; enemy.storyY = p.y;
      return enemy;
    });
    withSavepoint(this.db, () => {
      saveMission(accountId, next, this.db);
      this.db.prepare('INSERT INTO mission_encounters (account_id, attempt, ticket_pile_id) VALUES (?, ?, NULL) ON CONFLICT(account_id) DO UPDATE SET attempt = excluded.attempt').run(accountId, JSON.stringify(attempt));
    });
    for (const e of spawns) this.world.enemies.set(e.id, e);
    this.active.set(accountId, attempt);
    registry.set(accountId, this.world.id);
    return missionSnapshot(accountId, this.db);
  }

  isSparring(accountId: string): boolean { return this.active.get(accountId)?.kind === 'spar'; }

  isSpar(enemyId: string): boolean {
    return [...this.active.values()].some(a => a.kind === 'spar' && a.enemies.includes(enemyId));
  }

  /** Keeps ordinary drops; the last robber's pile also holds the unique clue. */
  killed(kill: KillReport, ordinary: LootPile | null): LootPile | null {
    const attempt = [...this.active.values()].find(a => a.enemies.includes(kill.enemyId));
    if (!attempt || attempt.worldId !== kill.worldId || attempt.accountId !== kill.killerAccountId || attempt.defeated.includes(kill.enemyId)) return ordinary;
    const defeated = [...attempt.defeated, kill.enemyId];
    let pile = ordinary;
    withSavepoint(this.db, () => {
      if (defeated.length === attempt.enemies.length) {
        const state = getMission(attempt.accountId, this.db);
        saveMission(attempt.accountId, advanceMission(state, attempt.kind === 'spar' ? 'survive_spar' : 'survive_ambush', false), this.db);
        if (attempt.kind === 'ambush') {
          const position = persistentPosition(kill.zone, { x: kill.x, y: 0, z: kill.z });
          if (!pile) pile = createLootPile({ x: position.x, z: position.z, zone: kill.zone, source: 'villain', ownerId: attempt.accountId,
            contents: { chroma: 0, shards: { IGNIS: 0, AQUES: 0, TERRA: 0, AURA: 0 }, materials: {} } }, this.db);
          const contents = { ...pile.contents, gear: { ...pile.contents.gear, [ARENA_TICKET]: 1 } };
          recordItemMove(this.db, 'world', pile.id, { itemId: ARENA_TICKET, quantity: 1 }, 'loot_drop', pile.id, Date.now());
          // A story clue remains recoverable after a disconnect and cannot be taken by another account.
          this.db.prepare('UPDATE loot_piles SET contents = ?, owner_id = ?, owner_until = ?, expires_at = ? WHERE id = ?').run(JSON.stringify(contents), attempt.accountId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, pile.id);
          pile = { ...pile, contents, ownerId: attempt.accountId, ownerUntil: Number.MAX_SAFE_INTEGER, expiresAt: Number.MAX_SAFE_INTEGER };
          this.db.prepare('UPDATE mission_encounters SET ticket_pile_id = ? WHERE account_id = ?').run(pile.id, attempt.accountId);
        }
      }
      this.db.prepare('UPDATE mission_encounters SET attempt = ? WHERE account_id = ?').run(JSON.stringify({ ...attempt, defeated }), attempt.accountId);
    });
    attempt.defeated = defeated;
    return pile;
  }

  abandon(accountId: string): void {
    const attempt = this.active.get(accountId);
    if (!attempt) return;
    for (const id of attempt.enemies) this.world.enemies.delete(id);
    this.active.delete(accountId);
    owners.get(this.db)?.delete(accountId);
  }

  dispose(): void { for (const accountId of this.active.keys()) this.abandon(accountId); }

  /** Dead mission enemies never respawn into a finished attempt. */
  reap(): void {
    for (const attempt of this.active.values()) {
      if (attempt.defeated.length === attempt.enemies.length) this.abandon(attempt.accountId);
      else for (const id of attempt.defeated) this.world.enemies.delete(id);
    }
  }
}

export function collectMissionTicket(accountId: string, pileId: string, db: DatabaseSync): void {
  const row = db.prepare('SELECT account_id FROM mission_encounters WHERE ticket_pile_id = ?').get(pileId) as { account_id: string } | undefined;
  if (!row) return;
  if (row.account_id !== accountId) throw new Error('This ticket belongs to another traveller');
  const state = getMission(accountId, db);
  saveMission(accountId, advanceMission(state, 'collect_ticket', false), db);
}
