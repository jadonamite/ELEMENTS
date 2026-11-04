import type RAPIER from '@dimforge/rapier3d-compat';
import { type Camera, type Scene, Vector3 } from 'three';
import balance from '../../../shared/balance.json';
import { createCombatRules, type CombatBalance, type Kit, type MoveId } from '../../../shared/src/index.js';
import {
  enemyFromTuple, MOVE_HZ, playerFromTuple, ServerClock,
  type EnemyDiedMsg, type EnemyHitMsg, type HitResultMsg, type HurtMsg, type MoveMsg, type PongMsg, type SnapMsg, type TrackDelay, type WelcomeMsg,
} from '../../../shared/src/net/index.js';
import type { Combat } from '../combat.js';
import type { EnemyTemplate } from '../enemy.js';
import type { HeroInstance } from '../hero.js';
import type { HoundTemplate } from '../monsters/hound.js';
import { NetEnemy, RemotePlayer, type PuppetTemplate } from './puppets.js';
import { RoomLink } from './wire.js';

const rules = createCombatRules(balance.combat as unknown as CombatBalance);
/** Moves that land all round the fighter rather than in front. */
const ALL_ROUND = new Set(['ground_pound', 'ultimate']);
/** Half-angle in front that a blow reaches, radians; the server allows a little more. */
const ARC = 1.4;

/** What the game hands the online session. All of it is read, never replaced. */
export interface OnlineGame {
  scene: Scene;
  camera: Camera;
  world: RAPIER.World;
  controller: { position: Vector3; facing: number; body: RAPIER.RigidBody };
  hero: HeroInstance;
  combat: Combat;
  kit: () => Kit;
  alive: () => boolean;
  isLit: () => boolean;
  loadAvatar: () => Promise<HeroInstance>;
  loadHound: () => Promise<HoundTemplate>;
  villains: Promise<EnemyTemplate>;
  /** One of our hits the server accepted. */
  onMyHit?: (at: Vector3, damage: number, killed: boolean) => void;
  /** An enemy the server moves struck us; hp is the server's figure. */
  onHurt?: (hp: number, max: number, damage: number) => void;
  onStatus?: (text: string) => void;
  /** The server's fighting tier for this player, sent on joining. */
  onTier?: (tier: number) => void;
}

export interface OnlineOptions {
  server: string;
  zone: string;
  token: string | null;
  element: string;
  role: 'Shaper' | 'Hush';
  /** Test-only added delay each way, seconds. */
  lag?: number;
  trackDelay?: TrackDelay;
}

/** Live link between this browser and its zone on the game server. */
export class OnlineSession {
  readonly clock = new ServerClock();
  readonly players = new Map<string, RemotePlayer>();
  readonly enemies = new Map<string, NetEnemy>();
  you = '';
  /** How far in the past other players are drawn; see RemoteTrack. */
  trackDelay: TrackDelay = 'auto';
  /** Hit verdicts from the server, newest last, for tests and the debug view. */
  readonly verdicts: HitResultMsg[] = [];
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

  private constructor(private readonly link: RoomLink, private readonly game: OnlineGame) {
    this.hudRoot = document.getElementById('fight-hud') ?? document.body;
    link.on('welcome', (m) => {
      const w = m as WelcomeMsg;
      this.you = w.you;
      if (typeof w.tier === 'number') game.onTier?.(w.tier);
    });
    link.on('pong', (m) => {
      const p = m as PongMsg;
      this.clock.sample(p.c, performance.now() / 1000, p.t);
    });
    link.on('snap', (m) => this.applySnapshot(m as SnapMsg));
    link.on('left', (m) => this.dropPlayer((m as { id: string }).id));
    link.on('hit_result', (m) => {
      const r = m as HitResultMsg;
      this.verdicts.push(r);
      if (this.verdicts.length > 50) this.verdicts.shift();
    });
    link.on('enemy_hit', (m) => {
      const h = m as EnemyHitMsg;
      const e = this.enemies.get(h.e);
      if (!e) return;
      e.view = { ...e.view, hp: h.hp };
      e.struck();
      if (h.by === this.you) game.onMyHit?.(e.model.position.clone().setY(e.model.position.y + 1), h.d, h.hp <= 0);
    });
    link.on('enemy_died', (m) => {
      const d = m as EnemyDiedMsg;
      const e = this.enemies.get(d.e);
      if (e) e.view = { ...e.view, hp: 0, state: 'dead' };
    });
    link.on('hurt', (m) => {
      const h = m as HurtMsg;
      game.onHurt?.(h.hp, h.max, h.d);
    });
    link.onClose = () => game.onStatus?.('Disconnected from the world server');
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
    const link = await RoomLink.join(opts.server, 'zone', { zone: opts.zone, element: opts.element, role: opts.role }, opts.token, { delay: opts.lag ?? 0 });
    const session = new OnlineSession(link, game);
    if (opts.trackDelay !== undefined) session.trackDelay = opts.trackDelay;
    for (let i = 0; i < 5; i++) setTimeout(() => session.ping(), i * 120);
    return session;
  }

  /** The room connection, for the money messages. */
  get channel(): { on(type: string, h: (m: unknown) => void): void; send(type: string, m: unknown): void } {
    return { on: (type, h) => this.link.on(type, h), send: (type, m) => this.link.send(type, m) };
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
    const arrived = this.serverNow();
    const seen = new Set<string>();
    for (const tuple of s.p) {
      const v = playerFromTuple(tuple);
      if (v.id === this.you) continue;
      seen.add(v.id);
      let rp = this.players.get(v.id);
      if (!rp) {
        rp = new RemotePlayer(v.id, this.game.scene, this.game.loadAvatar, this.trackDelay);
        this.players.set(v.id, rp);
      }
      rp.push(v, arrived);
    }
    for (const id of this.players.keys()) if (!seen.has(id)) this.dropPlayer(id);
    for (const tuple of s.e) {
      const v = enemyFromTuple(tuple);
      let e = this.enemies.get(v.id);
      if (!e) {
        const template = v.kind === 'hound' ? this.houndTemplate : this.villainTemplate;
        if (!template) continue;
        e = new NetEnemy(v, template, this.game.scene, this.hudRoot, this.game.controller.position.y);
        this.enemies.set(v.id, e);
      }
      e.push(v, s.t, arrived);
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
    const c = this.game.controller;
    const p = c.position;
    const fresh = Number.isNaN(this.lastSent.x);
    const vx = fresh ? 0 : (p.x - this.lastSent.x) / elapsed;
    const vz = fresh ? 0 : (p.z - this.lastSent.z) / elapsed;
    this.lastSent.copy(p);
    const msg: MoveMsg & { g: boolean } = {
      t: this.serverNow(),
      x: p.x, y: p.y, z: p.z,
      vx, vz,
      f: c.facing,
      a: this.game.hero.anim.getCurrentClip() ?? 'idle',
      r: 1,
      g: this.game.combat.blocking,
    };
    this.link.send('move', msg);
  }

  /** While our swing is live, report each server enemy it reaches, once per swing. */
  private strike(now: number): void {
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
    this.game.scene.onBeforeRender = this.restoreRender;
    for (const id of [...this.players.keys()]) this.dropPlayer(id);
    for (const e of this.enemies.values()) e.dispose();
    this.enemies.clear();
    this.link.close();
  }
}
