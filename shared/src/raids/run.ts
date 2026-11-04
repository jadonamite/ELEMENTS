import { fail, ok, type DungeonDef, type Result } from './config.js';
import { rollLoot, type LootItem } from './loot.js';
import type { FighterOutcome } from './fighters.js';
import { hashSeed, seededRng } from './rng.js';

export type RunState = 'active' | 'won' | 'lost' | 'abandoned';

export interface RunEvent { at: number; text: string; kind: 'room' | 'loot' | 'death' | 'flee' | 'down' | 'end' | 'carving' }

export interface RaidRun {
  id: string;
  dungeonId: string;
  partyId: string;
  members: string[];
  fighters: Array<{ id: string; wage: number; employer: string }>;
  seed: number;
  order: string[];
  roomIndex: number;
  roomEnteredAt: number;
  state: RunState;
  fighterStatus: Record<string, FighterOutcome>;
  down: string[];
  loot: LootItem[];
  kills: Record<string, number>;
  bossKilledBy: string | null;
  events: RunEvent[];
  startedAt: number;
  endedAt: number | null;
}

export function startRun(p: { id: string; dungeonId: string; partyId: string; members: string[]; fighters: RaidRun['fighters']; seed: number; order: string[]; now: number }): RaidRun {
  return {
    id: p.id, dungeonId: p.dungeonId, partyId: p.partyId, members: [...p.members], fighters: [...p.fighters],
    seed: p.seed, order: [...p.order], roomIndex: 0, roomEnteredAt: p.now, state: 'active',
    fighterStatus: Object.fromEntries(p.fighters.map((f) => [f.id, 'stayed'])), down: [], loot: [], kills: {},
    bossKilledBy: null, events: [{ at: p.now, kind: 'room', text: 'The key turns. The party goes down.' }], startedAt: p.now, endedAt: null,
  };
}

export const currentRoom = (r: RaidRun): string => r.order[r.roomIndex]!;

const active = (r: RaidRun): Result<RaidRun> | null => (r.state === 'active' ? null : fail('The run is over'));

/**
 * The client reports a room cleared. The server accepts it only for the room the party is in, and
 * not sooner than the dungeon's minimum, then rolls that room's loot from the run's own seed.
 */
export function clearRoom(r: RaidRun, roomId: string, dungeon: DungeonDef, now: number, killers: Record<string, number> = {}): Result<RaidRun> {
  const done = active(r); if (done) return done;
  if (roomId !== currentRoom(r)) return fail('That is not the room the party is in');
  const room = dungeon.rooms[roomId];
  if (!room) return fail('Unknown room');
  const elapsed = (now - r.roomEnteredAt) / 1000;
  if (room.kind !== 'entry' && elapsed < dungeon.minClearSeconds) return fail('Cleared too fast to be believed');
  const rng = seededRng(hashSeed(`${r.seed}:${roomId}`));
  const found = room.kind === 'entry' ? [] : rollLoot(room.kind === 'boss' ? dungeon.loot.boss : dungeon.loot.fight, rng);
  const kills = { ...r.kills };
  for (const [id, n] of Object.entries(killers)) kills[id] = (kills[id] ?? 0) + Math.max(0, Math.floor(n));
  const events = [...r.events];
  if (found.length) events.push({ at: now, kind: 'loot', text: `${room.name}: ${found.map((f) => `${f.qty} ${f.kind}`).join(', ')}` });
  const last = r.roomIndex >= r.order.length - 1;
  if (last) {
    events.push({ at: now, kind: 'end', text: `${dungeon.boss.name} falls. The party climbs out.` });
    return ok({ ...r, loot: [...r.loot, ...found], kills, events, state: 'won', endedAt: now });
  }
  const next = dungeon.rooms[r.order[r.roomIndex + 1]!];
  events.push({ at: now, kind: 'room', text: `On into ${next?.name ?? 'the dark'}.` });
  return ok({ ...r, loot: [...r.loot, ...found], kills, events, roomIndex: r.roomIndex + 1, roomEnteredAt: now, down: [] });
}

export function fighterDied(r: RaidRun, fighterId: string, name: string, now: number): Result<RaidRun> {
  const done = active(r); if (done) return done;
  if (r.fighterStatus[fighterId] !== 'stayed') return fail('That fighter is not in the fight');
  return ok({ ...r, fighterStatus: { ...r.fighterStatus, [fighterId]: 'died' }, events: [...r.events, { at: now, kind: 'death', text: `${name} is dead.` }] });
}

export function fighterFled(r: RaidRun, fighterId: string, name: string, now: number): Result<RaidRun> {
  const done = active(r); if (done) return done;
  if (r.fighterStatus[fighterId] !== 'stayed') return fail('That fighter is not in the fight');
  return ok({ ...r, fighterStatus: { ...r.fighterStatus, [fighterId]: 'fled' }, events: [...r.events, { at: now, kind: 'flee', text: `${name} breaks and runs for the stairs.` }] });
}

/** A player goes down. When every player is down, the run is lost. */
export function memberDown(r: RaidRun, accountId: string, now: number): Result<RaidRun> {
  const done = active(r); if (done) return done;
  if (!r.members.includes(accountId)) return fail('Not on this run');
  const down = r.down.includes(accountId) ? r.down : [...r.down, accountId];
  const events = [...r.events, { at: now, kind: 'down' as const, text: `${accountId} goes down.` }];
  if (down.length >= r.members.length) {
    return ok({ ...r, down, state: 'lost', endedAt: now, events: [...events, { at: now, kind: 'end', text: 'The party is beaten. The ruin keeps what it takes.' }] });
  }
  return ok({ ...r, down, events });
}

export function memberUp(r: RaidRun, accountId: string): RaidRun {
  return { ...r, down: r.down.filter((d) => d !== accountId) };
}

/** Walking out before the boss: no haul, no quarter lost, but any fighter still standing was left behind. */
export function abandonRun(r: RaidRun, now: number): Result<RaidRun> {
  const done = active(r); if (done) return done;
  return ok({ ...r, state: 'abandoned', endedAt: now, events: [...r.events, { at: now, kind: 'end', text: 'The party turns back.' }] });
}

/** Fighters still standing when the party walked out. A party that is beaten did not leave anyone; it fell. */
export function abandonedFighters(r: RaidRun): string[] {
  if (r.state !== 'abandoned') return [];
  return Object.entries(r.fighterStatus).filter(([, s]) => s === 'stayed').map(([id]) => id);
}
