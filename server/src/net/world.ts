import type { ActionState, Element, Weapon } from '@elements/shared';
import { balance, rules } from './balance.js';
import { ServerEnemy, type Strike } from './enemies.js';
import { PoseHistory } from './history.js';
import { judgeHit, parseHit, type Attacker } from './hit-check.js';
import { reportKill, type KillReport } from './kill-hook.js';
import { layoutFor } from './zones.js';

/** Fastest a player can honestly cover ground, metres per second: a Lit sprint plus dash lunges. */
export const MAX_PLAYER_SPEED = 14;
/** Extra distance allowed per report for jitter and lunges, metres. */
const MOVE_SLACK = 1.5;

/** Who a connection is, settled at join by the login check. Never taken from a message. */
export interface Identity {
  accountId: string;
  role: 'Shaper' | 'Hush';
  element: Element;
  /** Fighting tier from the stored rising; it decides which moves land. */
  tier?: number;
}

/** The tier every rising holds until trials raise or set it: every move but the strongest open. */
export const OPEN_TIER = 5;

export class ServerPlayer implements Attacker {
  readonly id: string;
  readonly accountId: string;
  readonly role: 'Shaper' | 'Hush';
  readonly element: Element;
  readonly weapon: Weapon;
  readonly hush: boolean;
  readonly tier: number;
  x: number;
  y = 0;
  z: number;
  vx = 0;
  vz = 0;
  facing = 0;
  clip = 'idle';
  rate = 1;
  guard = false;
  sampledAt: number;
  hp: number;
  readonly maxHp: number = balance.hero.maxHealth;
  /** Seconds until a fallen player stands again. */
  downFor = 0;
  /** Seconds left in which a move to the respawn point is accepted. */
  private warpWindow = 0;
  /** Server time of the last accepted move report. */
  private movedAt: number;
  readonly history = new PoseHistory(1.5);
  action: ActionState = rules.createActionState();
  swings = new Map<number, { at: number; move: string; struck: Set<string> }>();
  lastSwing = -1;
  /** Move reports refused for covering too much ground. */
  refusedMoves = 0;

  constructor(id: string, who: Identity, spawn: { x: number; z: number }, now: number) {
    this.id = id;
    this.accountId = who.accountId;
    this.role = who.role;
    this.element = who.element;
    this.hush = who.role === 'Hush';
    this.tier = who.tier ?? OPEN_TIER;
    this.weapon = !this.hush && who.element === 'AURA' ? 'staff' : 'sword';
    this.x = spawn.x;
    this.z = spawn.z;
    this.sampledAt = now;
    this.movedAt = now;
    this.hp = this.maxHp;
    this.history.push(now, this.x, this.z, this.facing);
    // The first report puts the player wherever the client loaded them.
    this.warpWindow = Infinity;
  }

  get alive(): boolean { return this.hp > 0; }

  /** Opens a short window in which the next report may land anywhere (spawn, respawn). */
  allowWarp(seconds = 3): void { this.warpWindow = seconds; }

  tick(dt: number): boolean {
    if (this.warpWindow !== Infinity) this.warpWindow = Math.max(0, this.warpWindow - dt);
    if (this.downFor > 0 && (this.downFor -= dt) <= 0) {
      this.downFor = 0;
      this.hp = this.maxHp;
      this.allowWarp();
      return true;
    }
    return false;
  }

  /** Applies a movement report if it is possible; false when refused. */
  move(raw: unknown, now: number): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const m = raw as Record<string, unknown>;
    const nums = [m.x, m.y, m.z, m.vx, m.vz, m.f, m.t, m.r];
    if (!nums.every(n => typeof n === 'number' && Number.isFinite(n))) return false;
    const [x, y, z, vx, vz, f, t, r] = nums as number[];
    if (Math.abs(x!) > 5000 || Math.abs(z!) > 5000 || Math.abs(y!) > 500) return false;
    const elapsed = Math.max(0, now - this.movedAt);
    const moved = Math.hypot(x! - this.x, z! - this.z);
    const warping = this.warpWindow > 0;
    if (!warping && moved > MAX_PLAYER_SPEED * elapsed + MOVE_SLACK) {
      this.refusedMoves++;
      return false;
    }
    if (warping && this.warpWindow === Infinity) this.warpWindow = 0;
    const speed = Math.hypot(vx!, vz!);
    const cap = speed > MAX_PLAYER_SPEED ? MAX_PLAYER_SPEED / speed : 1;
    this.x = x!;
    this.y = y!;
    this.z = z!;
    this.vx = vx! * cap;
    this.vz = vz! * cap;
    this.facing = f!;
    this.clip = typeof m.a === 'string' ? m.a.slice(0, 32) : 'idle';
    this.rate = Math.min(4, Math.max(0, r!));
    this.guard = m.g === true;
    // The sample time is the client's; it may not run ahead of the server or behind the last one.
    this.sampledAt = Math.min(now, Math.max(this.sampledAt, t!));
    this.movedAt = now;
    this.history.push(this.sampledAt, this.x, this.z, this.facing);
    return true;
  }

  /** A blow from an enemy. A raised guard facing the blow takes the guard's share. */
  takeStrike(s: Strike): number {
    if (!this.alive) return 0;
    const toward = Math.atan2(s.fromX - this.x, s.fromZ - this.z);
    const facing = Math.abs(Math.atan2(Math.sin(toward - this.facing), Math.cos(toward - this.facing))) <= balance.hero.blockAngle;
    const damage = this.guard && facing ? s.damage * balance.hero.blockDamageScale : s.damage;
    this.hp = Math.max(0, this.hp - damage);
    if (this.hp === 0) this.downFor = balance.hero.respawnSeconds;
    return damage;
  }
}

export type WorldEvent =
  | { type: 'hit_result'; to: string; e: string; sw: number; ok: boolean; reason?: string; damage?: number }
  | { type: 'enemy_hit'; e: string; d: number; hp: number; by: string }
  | { type: 'enemy_died'; e: string; by: string; x: number; z: number }
  | { type: 'hurt'; to: string; by: string; d: number; hp: number; max: number }
  | { type: 'fell'; to: string; x: number; z: number }
  | { type: 'revived'; to: string; x: number; z: number };

/**
 * One zone's truth: who is where, every enemy's body and health, and every hit.
 * The room feeds it messages and ticks and sends out what it returns.
 */
let worldCount = 0;

export class ZoneWorld {
  /** Tells this world apart from another room running the same zone. */
  readonly id = `world-${++worldCount}`;
  readonly players = new Map<string, ServerPlayer>();
  readonly enemies = new Map<string, ServerEnemy>();
  readonly layout;
  /** Damage each player dealt to each enemy since it last stood up, for shared kills. */
  private readonly damageBy = new Map<string, Map<string, number>>();

  constructor(readonly zone: string, rand: () => number = Math.random) {
    this.layout = layoutFor(zone);
    for (const spawn of this.layout.enemies) this.enemies.set(spawn.id, new ServerEnemy(spawn, rand));
  }

  join(id: string, who: Identity, now: number): ServerPlayer {
    const p = new ServerPlayer(id, who, this.layout.respawn, now);
    this.players.set(id, p);
    return p;
  }

  leave(id: string): void {
    this.players.delete(id);
    for (const e of this.enemies.values()) if (e.target === id) e.target = null;
  }

  move(id: string, raw: unknown, now: number): boolean {
    return this.players.get(id)?.move(raw, now) ?? false;
  }

  hit(id: string, raw: unknown, now: number): WorldEvent[] {
    const p = this.players.get(id);
    const claim = parseHit(raw);
    if (!p || !claim) return [{ type: 'hit_result', to: id, e: '', sw: -1, ok: false, reason: 'invalid_input' }];
    const enemy = this.enemies.get(claim.e);
    const verdict = judgeHit(p, enemy, claim, now);
    if (!verdict.ok || !enemy) {
      return [{ type: 'hit_result', to: id, e: claim.e, sw: claim.sw, ok: false, reason: verdict.ok ? 'target_missing' : verdict.reason }];
    }
    p.action = verdict.action;
    const killed = enemy.wound(verdict.damage, id);
    const tally = this.damageBy.get(enemy.id) ?? new Map<string, number>();
    tally.set(p.accountId, (tally.get(p.accountId) ?? 0) + verdict.damage);
    this.damageBy.set(enemy.id, tally);
    const events: WorldEvent[] = [
      { type: 'hit_result', to: id, e: enemy.id, sw: claim.sw, ok: true, damage: verdict.damage },
      { type: 'enemy_hit', e: enemy.id, d: verdict.damage, hp: enemy.hp, by: id },
    ];
    if (killed) {
      events.push({ type: 'enemy_died', e: enemy.id, by: id, x: enemy.x, z: enemy.z });
      const report: KillReport = {
        zone: this.zone,
        worldId: this.id,
        enemyId: enemy.id,
        kind: enemy.kind,
        x: enemy.x,
        z: enemy.z,
        killerAccountId: p.accountId,
        damageBy: Object.fromEntries(tally),
        at: now,
      };
      this.damageBy.delete(enemy.id);
      reportKill(report);
    }
    return events;
  }

  step(dt: number, now: number): WorldEvent[] {
    const events: WorldEvent[] = [];
    for (const p of this.players.values()) {
      if (p.tick(dt)) events.push({ type: 'revived', to: p.id, x: this.layout.respawn.x, z: this.layout.respawn.z });
    }
    const quarry = [...this.players.values()].map(p => ({ id: p.id, x: p.x, z: p.z, alive: p.alive }));
    for (const e of this.enemies.values()) {
      const wasAlive = e.alive;
      for (const s of e.step(dt, now, quarry)) {
        const p = this.players.get(s.target);
        if (!p) continue;
        const wasUp = p.alive;
        const d = p.takeStrike(s);
        events.push({ type: 'hurt', to: p.id, by: e.id, d, hp: p.hp, max: p.maxHp });
        if (wasUp && !p.alive) events.push({ type: 'fell', to: p.id, x: p.x, z: p.z });
      }
      if (!wasAlive && e.alive) this.damageBy.delete(e.id);
    }
    return events;
  }

  snapshot(now: number): { t: number; p: unknown[]; e: unknown[] } {
    const r = (n: number): number => Math.round(n * 100) / 100;
    const p = [...this.players.values()].map(pl => [
      pl.id, r(pl.x), r(pl.y), r(pl.z), r(pl.vx), r(pl.vz), r(pl.facing), pl.clip, r(pl.rate), r(pl.sampledAt), Math.ceil(pl.hp), pl.maxHp,
    ]);
    const e = [...this.enemies.values()].map(en => [
      en.id, en.kind, r(en.x), r(en.z), r(en.vx), r(en.vz), r(en.facing), en.shownState, Math.ceil(en.hp), en.tune.maxHealth,
    ]);
    return { t: r(now * 10) / 10, p, e };
  }
}
