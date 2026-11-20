import type RAPIER from '@dimforge/rapier3d-compat';
import { type Camera, type Scene, Vector3 } from 'three';
import balance from '../../../shared/balance.json';
import { createCombatRules, LEGACY_SINDR_ORIGIN, regionFor, toGlobal, toLocal, type Point3, type Region, type CombatBalance, type Kit, type MoveId } from '../../../shared/src/index.js';
import {
  enemyFromTuple, MOVE_HZ, playerFromTuple, ServerClock,
  type ClockMsg, type EnemyDiedMsg, type EnemyHitMsg, type HitResultMsg, type HurtMsg, type MoveMsg, type StaminaMsg, type ActMsg, type PongMsg, type SnapMsg, type TrackDelay, type WelcomeMsg,
} from '../../../shared/src/net/index.js';
import type { Combat } from '../combat.js';
import { parseOutfit, type OutfitId } from '../body.js';
import type { EnemyTemplate } from '../enemy.js';
import type { HeroInstance } from '../hero.js';
import type { HoundTemplate } from '../monsters/hound.js';
import { NetEnemy, RemotePlayer, type PuppetTemplate } from './puppets.js';
import { RoomLink } from './wire.js';
import { adjacentNetworkRegions, finitePoint, networkRegion } from './regions.js';

const rules = createCombatRules(balance.combat as unknown as CombatBalance);
/** Moves that land all round the fighter rather than in front. */
const ALL_ROUND = new Set(['ground_pound', 'ultimate']);
/** Half-angle in front that a blow reaches, radians; the server allows a little more. */
const ARC = 1.4;

/** What the game hands the online session. All of it is read, never replaced. */
export interface OnlineGame {
  /** National metres represented by scene coordinate zero. Fixed for this session. */
  networkOrigin?: Point3;
  /** Place the local controller, interpolation history, hero and camera after authority corrections. */
  onPosition?: (position: Point3) => void;
  /** Room ownership changed; this does not shift the scene origin. */
  onRegion?: (region: Region) => void;
  scene: Scene;
  camera: Camera;
  world: RAPIER.World;
  controller: { position: Vector3; facing: number; body: RAPIER.RigidBody };
  hero: HeroInstance;
  combat: Combat;
  kit: () => Kit;
  alive: () => boolean;
  isLit: () => boolean;
  loadAvatar: (outfit?: OutfitId) => Promise<HeroInstance>;
  loadHound: () => Promise<HoundTemplate>;
  villains: Promise<EnemyTemplate>;
  clock?: { setMinute?: (m: number, s?: number) => void } | undefined;
  /** One of our hits the server accepted. */
  onMyHit?: ((at: Vector3, damage: number, killed: boolean) => void) | undefined;
  /** An enemy the server moves struck us; hp is the server's figure. */
  onHurt?: ((hp: number, max: number, damage: number) => void) | undefined;
  /** The server's count of our stamina. */
  onStamina?: ((current: number, cap: number, windedFor: number) => void) | undefined;
  onStatus?: ((text: string) => void) | undefined;
  onNotice?: ((text: string) => void) | undefined;
  /** The server's fighting tier for this player, sent on joining. */
  onTier?: ((tier: number) => void) | undefined;
  /** The shrines this player has lit, as the server holds them. */
  onShrines?: ((lit: string[]) => void) | undefined;
  /** A shrine the player just reached was lit. */
  onShrineLit?: ((shrine: string) => void) | undefined;
  /** The server stood the player up (a revive or a shrine trip) at a spot in this scene. */
  onRevived?: ((position: Point3, facing: number | undefined, shrine: string | undefined) => void) | undefined;
  /** The outfit the server holds for this player, sent on joining. */
  onOutfit?: ((outfit: string) => void) | undefined;
}

export interface OnlineOptions {
  server: string;
  zone: string;
  token: string | null;
  element: string;
  role: 'Shaper' | 'Hush';
  /** Test-only added delay each way, seconds. */
  lag?: number | undefined;
  trackDelay?: TrackDelay | undefined;
  forcedCarry?: number | undefined;
  night?: number | undefined;
  clock?: number | undefined;
}

/** Live link between this browser and its zone on the game server. */
export class OnlineSession {
  readonly clock = new ServerClock();
  readonly players = new Map<string, RemotePlayer>();
  readonly enemies = new Map<string, NetEnemy>();
  you = '';
  /** How far in the past other players are drawn; see RemoteTrack. */
  trackDelay: TrackDelay = 'auto';
  /** Notices and alerts received from the server. */
  readonly notices: string[] = [];
  /** Hit verdicts from the server, newest last, for tests and the debug view. */
  readonly verdicts: HitResultMsg[] = [];
  private region: Region | null = null;
  private ready = false;
  private sourceAttached = true;
  private disposed = false;
  private pending: { zone: string; until: number; joining: boolean } | null = null;
  private readonly usedTokens = new Set<string>();
  private readonly handlers = new Map<string, Array<(message: unknown) => void>>();
  private readonly origin: Point3;
  private authoritative: Point3 | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private targetLink: RoomLink | null = null;
  /** Movement pauses while the server freezes the source player for transfer. */
  get crossing(): boolean { return this.pending !== null || (!!this.region && !this.ready); }
  get zone(): string { return this.region?.id ?? this.options.zone; }
  private sendIn = 0;
  private lastLocal = performance.now() / 1000;
  private lastFrame = -1;
  private seenSwing = -1;
  private swingStart = 0;
  private readonly point = new Vector3();
  private readonly lastSent = new Vector3();
  private houndTemplate: PuppetTemplate | null = null;
  private villainTemplate: PuppetTemplate | null = null;
  private pingTimer = 0;
  private readonly restoreRender: Scene['onBeforeRender'];
  private readonly hudRoot: HTMLElement;

  private constructor(private link: RoomLink, private readonly game: OnlineGame, private readonly options: OnlineOptions) {
    this.origin = { ...(game.networkOrigin ?? LEGACY_SINDR_ORIGIN) };
    this.bindClose(link);
    this.hudRoot = document.getElementById('fight-hud') ?? document.body;
    this.on('welcome', (m) => this.welcome(m));
    this.on('pong', (m) => {
      const p = m as PongMsg;
      this.clock.sample(p.c, performance.now() / 1000, p.t);
    });
    this.on('snap', (m) => this.applySnapshot(m as SnapMsg));
    this.on('shrines', (m) => {
      const lit = (m as { lit?: unknown }).lit;
      if (Array.isArray(lit)) game.onShrines?.(lit.filter((x): x is string => typeof x === 'string'));
    });
    this.on('shrine_lit', (m) => {
      const shrine = (m as { shrine?: unknown }).shrine;
      if (typeof shrine === 'string') game.onShrineLit?.(shrine);
    });
    this.on('shrine_refused', (m) => {
      const error = (m as { error?: unknown }).error;
      if (typeof error === 'string') this.game.onNotice?.(error) ?? this.game.onStatus?.(error);
    });
    this.on('revived', (m) => {
      const r = m as { x?: unknown; y?: unknown; z?: unknown; facing?: unknown; shrine?: unknown };
      if (typeof r.x !== 'number' || typeof r.z !== 'number') return;
      const position = this.fromNetwork({ x: r.x, y: typeof r.y === 'number' ? r.y : 0, z: r.z });
      this.place(position);
      game.onRevived?.(position, typeof r.facing === 'number' ? r.facing : undefined, typeof r.shrine === 'string' ? r.shrine : undefined);
    });
    this.on('shrine_jump', (m) => {
      const zone = (m as { zone?: unknown }).zone;
      if (typeof zone === 'string') void this.jump(zone);
    });
    this.on('left', (m) => this.dropPlayer((m as { id: string }).id));
    this.on('notice', (m) => {
      const text = (m as { text?: unknown }).text;
      if (typeof text === 'string') {
        this.notices.push(text);
        this.game.onNotice?.(text) ?? this.game.onStatus?.(text);
      }
    });
    this.on('clock', (m) => {
      const c = m as ClockMsg;
      if (typeof c.minute === 'number') {
        this.game.clock?.setMinute?.(c.minute, c.speed);
      }
    });
    this.on('hit_result', (m) => {
      const r = m as HitResultMsg;
      this.verdicts.push(r);
      if (this.verdicts.length > 50) this.verdicts.shift();
    });
    this.on('enemy_hit', (m) => {
      const h = m as EnemyHitMsg;
      const e = this.enemies.get(h.e);
      if (!e) return;
      e.view = { ...e.view, hp: h.hp };
      e.struck();
      if (h.by === this.you) game.onMyHit?.(e.model.position.clone().setY(e.model.position.y + 1), h.d, h.hp <= 0);
    });
    this.on('enemy_died', (m) => {
      const d = m as EnemyDiedMsg;
      const e = this.enemies.get(d.e);
      if (e) e.view = { ...e.view, hp: 0, state: 'dead' };
    });
    this.on('hurt', (m) => {
      const h = m as HurtMsg;
      game.onHurt?.(h.hp, h.max, h.d);
    });
    this.on('stamina', (m) => {
      const s = m as StaminaMsg;
      if ([s.v, s.cap, s.w].every(n => typeof n === 'number' && Number.isFinite(n))) game.onStamina?.(s.v, s.cap, s.w);
    });
    this.on('correct', (m) => {
      if (finitePoint(m)) this.place(this.fromNetwork(m));
    });
    this.on('region_handoff', (m) => { void this.handoff(m); });
    this.on('region_refused', () => {
      if (this.pending?.joining) return;
      this.pending = null;
      if (this.authoritative) this.place(this.authoritative);
      game.onStatus?.('Crossing refused. You remain in the source region.');
    });
    // Draw remote bodies just before each render, after the hero has moved this frame.
    this.restoreRender = game.scene.onBeforeRender;
    const previous = game.scene.onBeforeRender;
    game.scene.onBeforeRender = (...args) => {
      previous.apply(game.scene, args);
      this.frame();
    };
    void game.villains.then((t) => {
      const variant = t.variants[0];
      if (variant) this.villainTemplate = { model: variant.model, clips: variant.clips, scale: 1, barHeight: balance.enemy.healthBarHeight };
    });
    void game.loadHound().then((t) => { this.houndTemplate = { model: t.model, clips: t.clips, scale: 0.48, barHeight: 1.3 }; })
      .catch((error: unknown) => console.error('Hound model failed to load:', error));
  }

  /** Joins the zone's room. Throws when the server can't be reached or refuses. */
  static async connect(game: OnlineGame, opts: OnlineOptions): Promise<OnlineSession> {
    if (opts.zone.startsWith('ignis:') && (!networkRegion(opts.zone) || !opts.token || !game.onPosition)) {
      throw new Error('National travel requires sign-in, a valid region and controller placement');
    }
    const join = (zone: string): Promise<RoomLink> => RoomLink.join(
      opts.server,
      'zone',
      {
        zone,
        element: opts.element,
        role: opts.role,
        forcedCarry: opts.forcedCarry,
        night: opts.night,
        clock: opts.clock,
      },
      opts.token,
      { delay: opts.lag ?? 0 },
    );
    let link: RoomLink;
    try {
      link = await join(opts.zone);
    } catch (error: unknown) {
      const resume = error instanceof Error ? /^Resume in (ignis:region:[0-9]+:[0-9]+:-?[0-9]+)$/.exec(error.message)?.[1] : undefined;
      if (!opts.token || !networkRegion(opts.zone) || !resume || !networkRegion(resume) || resume === opts.zone) throw error;
      // The authenticated server selects the remembered room; its welcome owns the position.
      link = await join(resume);
    }
    const session = new OnlineSession(link, game, opts);
    if (opts.trackDelay !== undefined) session.trackDelay = opts.trackDelay;
    for (let i = 0; i < 5; i++) session.later(() => session.ping(), i * 120);
    return session;
  }

  private later(fn: () => void, milliseconds: number): void {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.disposed) fn(); }, milliseconds);
    this.timers.add(timer);
  }

  private bindClose(link: RoomLink): void {
    link.onClose = () => {
      if (!this.disposed && this.link === link) {
        this.ready = false;
        this.game.onStatus?.('Disconnected from the world server');
      }
    };
  }

  private on(type: string, handler: (message: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    this.listen(this.link, type, handler);
  }

  private listen(link: RoomLink, type: string, handler: (message: unknown) => void): void {
    link.on(type, (message) => {
      if (!this.disposed && this.link === link) handler(this.channelMessage(type, message));
    });
  }

  private channelMessage(type: string, raw: unknown): unknown {
    if (!this.region || !raw || typeof raw !== 'object') return raw;
    const body = raw as Record<string, unknown>;
    const pile = (value: unknown): unknown => {
      if (!value || typeof value !== 'object') return value;
      const p = value as Record<string, unknown>;
      if (typeof p.x !== 'number' || typeof p.z !== 'number') return value;
      const position = this.fromNetwork({ x: p.x, y: 0, z: p.z });
      return { ...p, x: position.x, z: position.z };
    };
    if (type === 'loot' && Array.isArray(body.piles)) return { ...body, piles: body.piles.map(pile) };
    if (type === 'loot_new') return { ...body, pile: pile(body.pile) };
    return raw;
  }

  private fromNetwork(position: Point3): Point3 {
    return this.region ? toLocal(toGlobal(position, this.region.origin), this.origin) : { x: position.x, y: position.y, z: position.z };
  }

  private toNetwork(position: Point3): Point3 {
    return this.region ? toLocal(toGlobal(position, this.origin), this.region.origin) : { x: position.x, y: position.y, z: position.z };
  }

  private place(position: Point3): void {
    this.authoritative = { ...position };
    this.game.onPosition?.(position);
    this.lastSent.copy(this.game.controller.position);
    this.sendIn = 0;
  }

  private welcome(raw: unknown): void {
    const w = raw as WelcomeMsg & { origin?: Point3; position?: Point3; overlap?: number };
    const region = networkRegion(w.zone);
    if (region) {
      if (!finitePoint(w.origin) || !finitePoint(w.position)
        || w.origin.x !== region.origin.x || w.origin.y !== region.origin.y || w.origin.z !== region.origin.z) {
        this.ready = false;
        this.link.close();
        this.game.onStatus?.('The server sent an invalid region frame');
        return;
      }
      this.region = region;
      this.place(this.fromNetwork(w.position));
      this.game.onRegion?.(region);
    }
    if (!region && finitePoint(w.position)) this.place(w.position);
    this.you = w.you;
    this.sourceAttached = true;
    this.ready = true;
    if (typeof w.tier === 'number') this.game.onTier?.(w.tier);
    if (typeof w.outfit === 'string') this.game.onOutfit?.(w.outfit);
  }

  /** Asks the room to carry the player from the lit shrine they stand at to another lit one. */
  travel(to: string): void {
    if (this.ready && !this.pending) this.link.send('shrine_travel', { to });
  }

  /**
   * The server moved the player to a shrine in another region: rejoin there as on a return visit. Its
   * welcome places the player; the old room has already let them go.
   */
  private async jump(zone: string): Promise<void> {
    const target = networkRegion(zone);
    if (!target || this.pending || this.disposed) return;
    const source = this.link;
    this.ready = false;
    this.game.onStatus?.('Travelling...');
    try {
      const link = await RoomLink.join(this.options.server, 'zone', {
        zone, element: this.options.element, role: this.options.role,
        forcedCarry: this.options.forcedCarry, night: this.options.night, clock: this.options.clock,
      }, this.options.token, { delay: this.options.lag ?? 0 });
      if (this.disposed || this.link !== source) { link.close(); return; }
      this.link = link;
      for (const [type, handlers] of this.handlers) for (const handler of handlers) this.listen(this.link, type, handler);
      this.bindClose(this.link);
      for (const id of [...this.players.keys()]) this.dropPlayer(id);
      for (const enemy of this.enemies.values()) enemy.dispose();
      this.enemies.clear();
      source.close();
      this.game.onStatus?.('');
      this.ping();
    } catch {
      this.game.onStatus?.('The shrine could not carry you. Reload to return to the world.');
    }
  }

  private async handoff(raw: unknown): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.joining || !this.region || !raw || typeof raw !== 'object') return;
    const m = raw as { zone?: unknown; token?: unknown; expiresAt?: unknown };
    const target = typeof m.zone === 'string' ? networkRegion(m.zone) : null;
    if (!target || target.id !== pending.zone || !adjacentNetworkRegions(this.region, target)
      || typeof m.token !== 'string' || !/^[a-f0-9]{64}$/.test(m.token) || this.usedTokens.has(m.token)
      || typeof m.expiresAt !== 'number' || !Number.isFinite(m.expiresAt)
      || m.expiresAt <= this.serverNow() || m.expiresAt > this.serverNow() + 6) return;
    pending.joining = true;
    pending.until = m.expiresAt;
    this.usedTokens.add(m.token);
    const source = this.link;
    let candidate = null as RoomLink | null;
    let finished = false;
    try {
      const welcome = await new Promise<{ link: RoomLink; message: unknown }>((resolve, reject) => {
        const refuse = (error: Error): void => {
          if (finished) return;
          finished = true;
          candidate?.close();
          reject(error);
        };
        // Allow an already committed response to arrive after the token admission deadline.
        this.later(() => refuse(new Error('Crossing timed out')),
          Math.max(1, (m.expiresAt as number - this.serverNow()) * 1000) + 1000 + (this.options.lag ?? 0) * 2000);
        void RoomLink.join(this.options.server, 'zone', { zone: target.id, handoff: m.token },
          this.options.token, { delay: this.options.lag ?? 0 }).then((link) => {
          candidate = link;
          if (finished || this.disposed) { link.close(); return; }
          this.targetLink = link;
          link.onClose = () => refuse(new Error('Target region closed the connection'));
          link.on('region_refused', () => refuse(new Error('Target region refused confirmation')));
          let validated: (WelcomeMsg & { origin: Point3; position: Point3 }) | null = null;
          link.on('welcome', (rawWelcome) => {
            if (finished || validated) return;
            if (!rawWelcome || typeof rawWelcome !== 'object') {
              refuse(new Error('Target region sent an invalid welcome'));
              return;
            }
            const message = rawWelcome as WelcomeMsg & { origin: Point3; position: Point3 };
            if (message.zone !== target.id || message.you !== link.sessionId
              || !finitePoint(message.origin) || !finitePoint(message.position)
              || message.origin.x !== target.origin.x || message.origin.y !== target.origin.y || message.origin.z !== target.origin.z
              || this.serverNow() >= (m.expiresAt as number)) {
              refuse(new Error('Target region sent an invalid or expired welcome'));
              return;
            }
            validated = message;
            link.send('region_ready', {});
          });
          link.on('region_committed', (rawCommit) => {
            if (finished || !validated) return;
            if (!rawCommit || typeof rawCommit !== 'object' || (rawCommit as { zone?: unknown }).zone !== target.id) {
              refuse(new Error('Target region sent an invalid confirmation'));
              return;
            }
            finished = true;
            resolve({ link, message: validated });
          });
        }, (error: unknown) => refuse(error instanceof Error ? error : new Error('Target region refused admission')));
      });
      if (this.disposed || this.link !== source || this.pending !== pending) { welcome.link.close(); return; }
      const message = welcome.message as WelcomeMsg & { origin: Point3; position: Point3 };
      this.link = welcome.link;
      this.targetLink = null;
      for (const [type, handlers] of this.handlers) for (const handler of handlers) this.listen(this.link, type, handler);
      this.bindClose(this.link);
      for (const id of [...this.players.keys()]) this.dropPlayer(id);
      for (const enemy of this.enemies.values()) enemy.dispose();
      this.enemies.clear();
      this.pending = null;
      this.welcome(message);
      source.close();
      this.link.send('econ_sync', {});
      this.ping();
    } catch {
      candidate?.close();
      this.targetLink = null;
      if (this.disposed || this.pending !== pending) return;
      // Refused provisional admission leaves authority with the source.
      pending.joining = false;
      pending.zone = '';
      pending.until = Math.max(pending.until, this.serverNow()) + 0.2;
      if (this.authoritative) this.place(this.authoritative);
      this.game.onStatus?.('Crossing failed. Waiting for the source region to resume.');
    }
  }

  /** The room connection, for the money messages. */
  get channel(): { on(type: string, h: (m: unknown) => void): void; send(type: string, m: unknown): void } {
    return { on: (type, h) => this.on(type, h), send: (type, m) => { if (!this.pending) this.link.send(type, m); } };
  }

  /** Tells the room a stamina action started: a costly move (with its swing number) or a jump. */
  act(k: ActMsg['k'], move?: string, swing?: number): void {
    if (!this.ready || this.pending) return;
    const msg: ActMsg = { k, t: this.serverNow() };
    if (move !== undefined) msg.m = move;
    if (swing !== undefined) msg.sw = swing;
    this.link.send('act', msg);
  }

  /** Server time now, as best this browser knows it. */
  serverNow(): number {
    return this.clock.now(performance.now() / 1000);
  }

  private ping(): void {
    this.link.send('ping', { c: performance.now() / 1000 });
  }

  /** Test-only: lets the next position report land anywhere (the server ignores it in production). */
  warp(): void {
    this.link.send('warp', {});
    this.lastSent.set(NaN, NaN, NaN);
  }

  private applySnapshot(s: SnapMsg): void {
    if (this.region) this.sourceAttached = s.p.some(tuple => tuple[0] === this.you);
    const arrived = this.serverNow();
    const seen = new Set<string>();
    for (const tuple of s.p) {
      const v = playerFromTuple(tuple);
      const position = this.fromNetwork(v);
      v.x = position.x; v.y = position.y; v.z = position.z;
      if (v.id === this.you) { this.authoritative = position; continue; }
      seen.add(v.id);
      let rp = this.players.get(v.id);
      if (!rp) {
        rp = new RemotePlayer(v.id, this.game.scene, this.game.loadAvatar, this.trackDelay, parseOutfit(v.outfit));
        this.players.set(v.id, rp);
      }
      rp.push(v, arrived);
    }
    for (const id of this.players.keys()) if (!seen.has(id)) this.dropPlayer(id);
    const seenEnemies = new Set<string>();
    for (const tuple of s.e) {
      const v = enemyFromTuple(tuple);
      const position = this.fromNetwork({ x: v.x, y: 0, z: v.z });
      v.x = position.x; v.z = position.z;
      seenEnemies.add(v.id);
      let e = this.enemies.get(v.id);
      if (!e) {
        const template = v.kind === 'hound' ? this.houndTemplate : this.villainTemplate;
        if (!template) continue;
        e = new NetEnemy(v, template, this.game.scene, this.hudRoot, this.game.controller.position.y);
        this.enemies.set(v.id, e);
      }
      e.push(v, s.t, arrived);
    }
    for (const [id, e] of this.enemies.entries()) {
      if (!seenEnemies.has(id)) {
        e.dispose();
        this.enemies.delete(id);
      }
    }
  }

  private dropPlayer(id: string): void {
    this.players.get(id)?.dispose();
    this.players.delete(id);
  }

  /** Per drawn frame: report our body, carry the others forward, and check our swing against server enemies. */
  private frame(): void {
    const local = performance.now() / 1000;
    if (local === this.lastFrame) return;
    const dt = Math.min(0.1, Math.max(0, local - this.lastLocal));
    this.lastLocal = local;
    this.lastFrame = local;
    const now = this.serverNow();
    this.pingTimer += dt;
    if (this.pingTimer > 2) { this.pingTimer = 0; this.ping(); }

    if (this.pending && !this.pending.joining && now >= this.pending.until) {
      this.pending = null;
      if (this.sourceAttached) {
        if (this.authoritative) this.place(this.authoritative);
      } else {
        this.ready = false;
        this.game.onStatus?.('Region transfer lost its connection. Reconnect to continue.');
      }
    }
    this.sendIn -= dt;
    if (this.sendIn <= 0) {
      const interval = 1 / MOVE_HZ;
      const elapsed = interval - this.sendIn;
      this.sendIn = interval;
      this.report(Math.max(elapsed, interval));
    }
    for (const p of this.players.values()) p.update(now, dt);
    for (const e of this.enemies.values()) {
      e.update(now, dt, this.game.world, this.game.controller.body);
      e.drawBar(this.game.camera, this.point);
    }
    this.strike(now);
  }

  private report(elapsed: number): void {
    if (!this.ready || this.pending || (this.region && !this.clock.synced)) return;
    const c = this.game.controller;
    const p = c.position;
    const fresh = Number.isNaN(this.lastSent.x);
    const vx = fresh ? 0 : (p.x - this.lastSent.x) / elapsed;
    const vz = fresh ? 0 : (p.z - this.lastSent.z) / elapsed;
    this.lastSent.copy(p);
    const wire = this.toNetwork(p);
    const msg: MoveMsg & { g: boolean } = {
      t: this.serverNow(),
      x: wire.x, y: wire.y, z: wire.z,
      vx, vz,
      f: c.facing,
      a: this.game.hero.anim.getCurrentClip() ?? 'idle',
      r: 1,
      g: this.game.combat.blocking,
    };
    this.link.send('move', msg);
    if (this.region && this.game.alive()) {
      const target = networkRegion(regionFor(toGlobal(p, this.origin)).id);
      if (target && adjacentNetworkRegions(this.region, target)) {
        this.pending = { zone: target.id, until: this.serverNow() + 6, joining: false };
        this.link.send('region_cross', { zone: target.id });
      }
    }
  }

  /** While our swing is live, report each server enemy it reaches, once per swing. */
  private strike(now: number): void {
    if (!this.ready || this.pending) return;
    const combat = this.game.combat;
    if (combat.swing !== this.seenSwing) {
      this.seenSwing = combat.swing;
      this.swingStart = now;
    }
    const move = combat.current;
    if (!move || !combat.striking || !this.game.alive()) return;
    const kit = this.game.kit();
    let reach = 2.2;
    try { reach = rules.moveFor(move as MoveId, kit).reach; } catch { return; }
    const limb = combat.strikingLimb;
    if (limb === 'blade') reach = Math.max(reach, combat.weaponReach);
    const c = this.game.controller;
    for (const e of this.enemies.values()) {
      if (!e.alive || e.lastSwing === combat.swing) continue;
      const dx = e.model.position.x - c.position.x;
      const dz = e.model.position.z - c.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + e.radius) continue;
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - c.facing), Math.cos(Math.atan2(dx, dz) - c.facing)));
      if (!ALL_ROUND.has(move) && dist > e.radius && off > ARC) continue;
      e.lastSwing = combat.swing;
      this.link.send('hit', { e: e.view.id, m: move, sw: combat.swing, t: this.swingStart, v: now, lit: this.game.isLit() });
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.targetLink?.close();
    this.game.scene.onBeforeRender = this.restoreRender;
    for (const id of [...this.players.keys()]) this.dropPlayer(id);
    for (const e of this.enemies.values()) e.dispose();
    this.enemies.clear();
    this.link.close();
  }
}
