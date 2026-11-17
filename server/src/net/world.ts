import { withinLocalBounds } from '@elements/shared';
import type { ActionState, Element, Weapon } from '@elements/shared';
import { armourOf, outfitOf, standClear, Stamina, actStaminaCost, moveStaminaCost, MOVE_IDS, type MoveId, type StaminaTuning } from '@elements/shared';
import { armour, balance, rules } from './balance.js';
import { ServerEnemy, type Strike } from './enemies.js';
import { PoseHistory } from './history.js';
import { judgeHit, parseHit, REWIND_LIMIT, type Attacker } from './hit-check.js';
import { reportKill, type KillReport } from './kill-hook.js';
import { layoutFor } from './zones.js';
import { nationalRegion, regionContains, networkPosition, NATIONAL_SPAWN, SPAWN_REGION, type NationalRegion } from './coordinates.js';

/** Fastest a player can honestly cover ground, metres per second: a Lit sprint plus dash lunges. */
export const MAX_PLAYER_SPEED = 14;
/** Extra distance allowed per report for jitter and lunges, metres. */
const MOVE_SLACK = 1.5;

const staminaTune = balance.combat.stamina as StaminaTuning;
/** A move report older than this no longer counts as running, seconds. */
const RUN_REPORT_SECONDS = 0.5;
/** How often a player hears their own stamina when it changes, and at most how long between reports, seconds. */
const STAMINA_REPORT_SECONDS = 0.25;
const STAMINA_QUIET_SECONDS = 2;

/** Who a connection is, settled at join by the login check. Never taken from a message. */
export interface Identity {
  accountId: string;
  role: 'Shaper' | 'Hush';
  element: Element;
  /** Fighting tier from the stored rising; it decides which moves land. */
  tier?: number | undefined;
  /** Optional forced carry amount for testing. */
  forcedCarry?: number | undefined;
  /** The armour piece the account wears, from its stored character; null in rags. */
  worn?: string | null | undefined;
}

/** The tier every rising holds until trials raise or set it: every move but the strongest open. */
export const OPEN_TIER = 5;

export class ServerPlayer implements Attacker {
  id: string;
  readonly accountId: string;
  readonly role: 'Shaper' | 'Hush';
  readonly element: Element;
  readonly weapon: Weapon;
  readonly hush: boolean;
  readonly tier: number;
  readonly forcedCarry?: number | undefined;
  /** The armour piece worn; the outfit others draw and the armour blows must beat. */
  worn: string | null;
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
  transferUntil = 0;
  region: NationalRegion | null = null;
  readonly history = new PoseHistory(1.5);
  action: ActionState = rules.createActionState();
  swings = new Map<number, { at: number; move: string; struck: Set<string> }>();
  lastSwing = -1;
  /** Move reports refused for covering too much ground. */
  refusedMoves = 0;
  /** The server's own count of this player's stamina, from the actions it sees. */
  readonly stamina = new Stamina(staminaTune);
  /** Server time a paid dodge began; blows inside its window pass through. */
  dodgeAt = -Infinity;
  /** Server time the guard went up, for parries. */
  guardSince = -Infinity;
  /** A broken guard counts for nothing until this server time. */
  guardBrokenUntil = -Infinity;
  /** Whether the last move reports showed a run, and when that report came. */
  running = false;
  private ranAt = -Infinity;
  /** Any enemy has this player as its target: running costs full price. */
  inFight = false;
  /** Swing numbers already charged, and whether they were paid. */
  private readonly paid = new Map<number, boolean>();
  /** Last stamina sent to the player, and seconds since. */
  private staminaSent = { v: -1, w: false, quiet: Infinity, wait: 0 };

  constructor(id: string, who: Identity, spawn: { x: number; z: number }, now: number) {
    this.id = id;
    this.accountId = who.accountId;
    this.role = who.role;
    this.element = who.element;
    this.hush = who.role === 'Hush';
    this.tier = who.tier ?? OPEN_TIER;
    this.forcedCarry = who.forcedCarry;
    this.worn = who.worn ?? null;
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

  /** Change the frame without granting movement or resetting combat state. */
  enterRegion(region: NationalRegion, position: { x: number; y: number; z: number }, now: number): void {
    this.region = region;
    this.x = position.x;
    this.y = position.y;
    this.z = position.z;
    this.movedAt = now;
    this.sampledAt = now;
    this.warpWindow = 0;
    this.transferUntil = 0;
    this.history.clear();
    this.history.push(now, this.x, this.z, this.facing);
  }

  get alive(): boolean { return this.hp > 0; }

  /** The outfit this fighter draws in, from the armour worn. */
  get outfit(): string { return outfitOf(armour, this.worn); }

  /** What the worn armour adds when a blow lands, in the combat rules' scale. */
  get armour(): number { return armourOf(armour, this.worn); }

  setWorn(itemId: string | null): void { this.worn = itemId; }

  /** Opens a short window in which the next report may land anywhere (spawn, respawn). */
  allowWarp(seconds = 3): void { if (!this.region) this.warpWindow = seconds; }

  tick(dt: number, now = Infinity): boolean {
    if (this.warpWindow !== Infinity) this.warpWindow = Math.max(0, this.warpWindow - dt);
    if (this.downFor > 0 && (this.downFor -= dt) <= 0) {
      this.downFor = 0;
      this.hp = this.maxHp;
      this.stamina.fill();
      this.allowWarp();
      return true;
    }
    if (this.alive) {
      const running = this.running && now - this.ranAt <= RUN_REPORT_SECONDS;
      this.stamina.tick(dt, { running, inFight: this.inFight, guarding: this.guard });
    }
    return false;
  }

  /**
   * Charges a move's stamina once per swing. Free moves always pass; a costly one the player cannot
   * afford is recorded unpaid, so it neither protects (a dodge) nor lands (a heavy).
   */
  payFor(swing: number, move: string): boolean {
    const cost = moveStaminaCost(move, staminaTune);
    if (cost <= 0) return true;
    const known = this.paid.get(swing);
    if (known !== undefined) return known;
    const ok = this.stamina.spend(cost);
    this.paid.set(swing, ok);
    for (const key of this.paid.keys()) if (key < swing - 16) this.paid.delete(key);
    return ok;
  }

  /** An action that costs stamina started on the player's side. Returns false when it was not paid. */
  act(raw: unknown, now: number): boolean {
    if (!this.alive || !raw || typeof raw !== 'object') return false;
    const m = raw as Record<string, unknown>;
    if (typeof m.t !== 'number' || !Number.isFinite(m.t)) return false;
    const at = Math.min(now, Math.max(now - REWIND_LIMIT, m.t));
    if (m.k === 'jump' || m.k === 'super_jump') return this.stamina.spend(actStaminaCost(m.k, staminaTune));
    if (m.k !== 'move' || typeof m.m !== 'string' || !(MOVE_IDS as readonly string[]).includes(m.m)) return false;
    if (typeof m.sw !== 'number' || !Number.isInteger(m.sw) || m.sw < 0) return false;
    if (m.m === 'dodge') {
      if (this.paid.has(m.sw)) return this.paid.get(m.sw)!;
      // The dodge's own cooldown, then its stamina; only a paid dodge protects.
      const started = rules.startMove(this.action, 'dodge' as MoveId, at, false, { element: this.element, weapon: this.weapon, hush: this.hush });
      if (!started.accepted) { this.paid.set(m.sw, false); return false; }
      this.action = started.state;
      if (!this.payFor(m.sw, 'dodge')) return false;
      this.dodgeAt = at;
      return true;
    }
    return this.payFor(m.sw, m.m);
  }

  /** The player's stamina, when it is worth telling them: on a change, or now and then. */
  staminaReport(dt: number): { v: number; cap: number; w: number } | null {
    const sent = this.staminaSent;
    sent.quiet += dt;
    if ((sent.wait -= dt) > 0) return null;
    const v = Math.round(this.stamina.current * 10) / 10;
    const w = this.stamina.winded;
    if (Math.abs(v - sent.v) < 0.5 && w === sent.w && sent.quiet < STAMINA_QUIET_SECONDS) return null;
    sent.v = v; sent.w = w; sent.quiet = 0; sent.wait = STAMINA_REPORT_SECONDS;
    return { v, cap: this.stamina.cap, w: Math.round(this.stamina.windedFor * 100) / 100 };
  }

  /** Applies a movement report if it is possible; false when refused. */
  move(raw: unknown, now: number): boolean {
    if (this.transferUntil > now) return false;
    if (!raw || typeof raw !== 'object') return false;
    const m = raw as Record<string, unknown>;
    const nums = [m.x, m.y, m.z, m.vx, m.vz, m.f, m.t, m.r];
    if (!nums.every(n => typeof n === 'number' && Number.isFinite(n))) return false;
    const [x, y, z, vx, vz, f, t, r] = nums as number[];
    const position = { x: x!, y: y!, z: z! };
    if (this.region ? !regionContains(this.region, position) : !withinLocalBounds(position)) return false;
    const elapsed = Math.max(0, now - this.movedAt);
    const moved = Math.hypot(x! - this.x, z! - this.z, this.region ? y! - this.y : 0);
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
    const guard = m.g === true;
    if (guard && !this.guard) this.guardSince = now;
    this.guard = guard;
    this.running = Math.hypot(this.vx, this.vz) > balance.controller.runSpeedThreshold;
    if (this.running) this.ranAt = now;
    // The sample time is the client's; it may not run ahead of the server or behind the last one.
    this.sampledAt = Math.min(now, Math.max(this.sampledAt, t!));
    this.movedAt = now;
    this.history.push(this.sampledAt, this.x, this.z, this.facing);
    return true;
  }

  /**
   * A blow from an enemy; null when a paid dodge let it pass. A raised guard facing the blow takes the guard's
   * share and costs stamina; raised just in time it parries and gives stamina back; a winded guard breaks.
   */
  takeStrike(s: Strike, now: number): number | null {
    if (!this.alive) return 0;
    if (now - this.dodgeAt <= staminaTune.dodgeProtectSeconds) return null;
    const toward = Math.atan2(s.fromX - this.x, s.fromZ - this.z);
    const facing = Math.abs(Math.atan2(Math.sin(toward - this.facing), Math.cos(toward - this.facing))) <= balance.hero.blockAngle;
    let guarded = this.guard && facing && now >= this.guardBrokenUntil;
    if (guarded) {
      if (now - this.guardSince <= rules.parryWindow(this.hush)) this.stamina.refund();
      else if (this.stamina.soak(rules.calculateDamage(s.damage, this.armour)) === 'broken') {
        guarded = false;
        this.guardBrokenUntil = now + staminaTune.guardBreakSeconds;
      }
    }
    // Worn armour takes its share of every blow that gets through the guard.
    const raw = guarded ? s.damage * balance.hero.blockDamageScale : s.damage;
    const damage = rules.calculateDamage(raw, this.armour);
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
  | { type: 'fell'; to: string; x: number; z: number; by: { id: string; kind: string } }
  | { type: 'revived'; to: string; x: number; z: number }
  | { type: 'stamina'; to: string; v: number; cap: number; w: number };

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
    for (const spawn of this.layout.enemies) {
      const pos = zone === 'sindr' ? standClear(spawn.x, spawn.z) : { x: spawn.x, z: spawn.z };
      this.enemies.set(spawn.id, new ServerEnemy({ ...spawn, x: pos.x, z: pos.z }, rand));
    }
  }

  join(id: string, who: Identity, now: number): ServerPlayer {
    const region = nationalRegion(this.zone);
    if (region && this.zone !== SPAWN_REGION) throw new Error('A crossing token is required');
    const p = new ServerPlayer(id, who, this.layout.respawn, now);
    if (region) p.enterRegion(region, networkPosition(this.zone, NATIONAL_SPAWN), now);
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

  /** A stamina action from the player's side; see ServerPlayer.act. */
  act(id: string, raw: unknown, now: number): boolean {
    const p = this.players.get(id);
    return !!p && p.transferUntil <= now && p.act(raw, now);
  }

  hit(id: string, raw: unknown, now: number): WorldEvent[] {
    const p = this.players.get(id);
    const claim = parseHit(raw);
    if (!p || p.transferUntil > now || !claim) return [{ type: 'hit_result', to: id, e: '', sw: -1, ok: false, reason: 'invalid_input' }];
    const enemy = this.enemies.get(claim.e);
    // A heavy the player had no stamina for never lands.
    if ((MOVE_IDS as readonly string[]).includes(claim.m) && !p.payFor(claim.sw, claim.m)) {
      return [{ type: 'hit_result', to: id, e: claim.e, sw: claim.sw, ok: false, reason: 'winded' }];
    }
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
      p.inFight = false;
      for (const e of this.enemies.values()) if (e.alive && e.target === p.id) { p.inFight = true; break; }
      if (p.tick(dt, now)) events.push({ type: 'revived', to: p.id, x: p.region ? p.x : this.layout.respawn.x, z: p.region ? p.z : this.layout.respawn.z });
      const report = p.staminaReport(dt);
      if (report) events.push({ type: 'stamina', to: p.id, ...report });
    }
    const quarry = [...this.players.values()].map(p => ({ id: p.id, x: p.x, z: p.z, alive: p.alive }));
    for (const e of this.enemies.values()) {
      const wasAlive = e.alive;
      for (const s of e.step(dt, now, quarry)) {
        const p = this.players.get(s.target);
        if (!p) continue;
        const wasUp = p.alive;
        const d = p.takeStrike(s, now);
        if (d === null) continue;
        events.push({ type: 'hurt', to: p.id, by: e.id, d, hp: p.hp, max: p.maxHp });
        if (wasUp && !p.alive) events.push({ type: 'fell', to: p.id, x: p.x, z: p.z, by: { id: e.id, kind: e.kind } });
      }
      if (!wasAlive && e.alive) this.damageBy.delete(e.id);
    }
    return events;
  }

  snapshot(now: number): { t: number; p: unknown[]; e: unknown[] } {
    const r = (n: number): number => Math.round(n * 100) / 100;
    const p = [...this.players.values()].map(pl => [
      pl.id, r(pl.x), r(pl.y), r(pl.z), r(pl.vx), r(pl.vz), r(pl.facing), pl.clip, r(pl.rate), r(pl.sampledAt), Math.ceil(pl.hp), pl.maxHp, pl.outfit,
    ]);
    const e = [...this.enemies.values()].map(en => [
      en.id, en.kind, r(en.x), r(en.z), r(en.vx), r(en.vz), r(en.facing), en.shownState, Math.ceil(en.hp), en.tune.maxHealth,
    ]);
    return { t: r(now * 10) / 10, p, e };
  }
}
