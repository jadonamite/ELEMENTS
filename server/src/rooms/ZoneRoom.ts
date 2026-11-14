import { Room, type Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { cycleMinutes, ELEMENTS, type Element } from '@elements/shared';
import { verifyToken } from '../auth.js';
import { getRising } from '../db.js';
import { takeOffArmour, wearArmour, wornLook } from '../economy/armourService.js';
import { balance } from '../net/balance.js';
import { SNAPSHOT_RATE } from '../net/constants.js';
import { isGuest } from '../net/money.js';
import { ServerRobberGang } from '../net/outlaws.js';
import { closeZone, enterRoom, leaveRoom, openZone } from '../net/presence.js';
import { OPEN_TIER, ServerPlayer, ZoneWorld, type Identity, type WorldEvent } from '../net/world.js';
import { ZoneEconomy, type EconEvent } from '../net/zone-economy.js';
import { adjacentRegions, HANDOFF_SECONDS, nationalRegion, networkPosition, persistentPosition, REGION_OVERLAP, regionContains, RegionHandoffs, SPAWN_REGION, lastNationalPosition, rememberNationalPosition } from '../net/coordinates.js';

interface RegionTransfer {
  player: ServerPlayer;
  expiresAt: number;
  state: 'pending' | 'committed' | 'finished';
  target?: ZoneRoom;
  targetClient?: Client;
  commit: () => boolean;
  rollback: () => void;
  finish: () => void;
}

const crossings = new RegionHandoffs<RegionTransfer>();
const nationalAccounts = new Map<string, ServerPlayer>();

/** How often the room re-reads its zone's piles, so expired ones vanish for everyone, seconds. */
const PILE_REFRESH_SECONDS = 5;

export function testBannedWords(text: string): boolean {
  return /\b(fire|water|earth|air|wind)\b/i.test(text);
}

export function redactBannedWords(text: string): string {
  return text.replace(/\b(fire|water|earth|air|wind)\b/gi, '[REDACTED BY EDICT]');
}

/** Guests (no login) may join only outside production, for local play and tests. */
export const guestsAllowed = (): boolean => process.env.NODE_ENV !== 'production';

/**
 * Settles who is joining. A login token is checked with the login service and the
 * player's role and element come from their stored rising; without a token, a guest
 * outside production picks a kit for testing.
 */
export async function identify(options: Record<string, unknown> | undefined, token: string | undefined | null): Promise<Identity> {
  const forcedCarry = typeof options?.forcedCarry === 'number'
    ? options.forcedCarry
    : typeof options?.chroma === 'number'
      ? options.chroma
      : undefined;
  if (token) {
    const { userId } = await verifyToken(token);
    const rising = getRising(userId);
    if (!rising) throw new Error('This account has not risen yet');
    // The character's armour comes from the account's stored look, not from a message.
    return {
      accountId: userId, role: rising.role, element: (rising.element ?? 'IGNIS') as Element, tier: rising.tier ?? OPEN_TIER, forcedCarry,
      worn: wornLook(userId).item,
    };
  }
  if (!guestsAllowed()) throw new Error('Login required');
  const asked = typeof options?.element === 'string' ? options.element.toUpperCase() : 'IGNIS';
  const element = (ELEMENTS as readonly string[]).includes(asked) ? asked as Element : 'IGNIS';
  return { accountId: `guest:${randomUUID()}`, role: options?.role === 'Hush' ? 'Hush' : 'Shaper', element, tier: OPEN_TIER, forcedCarry };
}

/**
 * One zone of the shared world. The room owns the zone's enemies and judges every hit;
 * players report their own movement, which is checked for what a body can do. While a
 * player is in the room, everything that moves their CHROMA or items goes through it.
 */
export class ZoneRoom extends Room {
  maxClients = 50;
  world!: ZoneWorld;
  economy!: ZoneEconomy;
  outlaws?: ServerRobberGang;
  clockMinute = 4;
  clockSpeed = 1;
  private started = 0;
  private disposed = false;
  private readonly outgoing = new Map<string, RegionTransfer>();
  private readonly incoming = new Map<string, RegionTransfer>();

  /** Seconds since the room opened: the clock every client syncs to. */
  now(): number {
    return this.world && nationalRegion(this.world.zone) ? performance.now() / 1000 : (performance.now() - this.started) / 1000;
  }

  override onCreate(options: { zone?: string; minute?: number; clock?: number; night?: number; speed?: number }): void {
    this.started = performance.now();
    const zone = typeof options?.zone === 'string' ? options.zone : 'arena';
    this.world = new ZoneWorld(zone);
    this.economy = new ZoneEconomy(this.world);
    if (zone === 'sindr') {
      this.outlaws = new ServerRobberGang();
    }
    const dayNight = balance.world.dayNight;
    this.clockSpeed = typeof options?.speed === 'number' ? options.speed : 1;
    if (typeof options?.minute === 'number') {
      this.clockMinute = options.minute;
    } else if (typeof options?.clock === 'number') {
      this.clockMinute = options.clock;
    } else if (typeof options?.night === 'number') {
      const x = Math.min(1, Math.max(0, options.night));
      this.clockMinute = x <= 0 ? dayNight.startMinute : x >= 1 ? 18 : dayNight.dayMinutes + dayNight.duskMinutes * x;
      if (options.night === 1) this.clockSpeed = 0;
    } else {
      this.clockMinute = dayNight.startMinute;
    }
    openZone(zone);
    void this.setMetadata({ zone });

    let sinceSnap = 0;
    let sincePiles = 0;
    this.setSimulationInterval((deltaMs) => {
      const dt = Math.min(deltaMs / 1000, 0.1);
      for (const transfer of this.outgoing.values()) {
        if (transfer.expiresAt <= this.now()) transfer.rollback();
      }
      this.clockMinute = (this.clockMinute + (dt / 60) * this.clockSpeed) % cycleMinutes(dayNight);
      this.deliver(this.world.step(dt, this.now()));
      this.pay(this.economy.drain());
      if (this.outlaws) {
        const notices = this.outlaws.update(dt, this.now(), this.world, this.economy, this.clockMinute);
        for (const text of notices) {
          this.broadcast('notice', { text });
        }
      }
      sincePiles += dt;
      if (sincePiles >= PILE_REFRESH_SECONDS) {
        sincePiles = 0;
        this.pay(this.economy.refresh());
      }
      sinceSnap += dt;
      if (sinceSnap >= 1 / SNAPSHOT_RATE - 1e-3) {
        sinceSnap = 0;
        this.broadcast('snap', this.world.snapshot(this.now()));
      }
    }, 1000 / SNAPSHOT_RATE);

    this.onMessage('move', (client: Client, message: unknown) => {
      if (!this.world.move(client.sessionId, message, this.now())) {
        const p = this.world.players.get(client.sessionId);
        if (p) client.send('correct', { x: p.x, y: p.y, z: p.z });
      } else {
        const p = this.world.players.get(client.sessionId);
        if (p?.region) rememberNationalPosition(p.accountId, p.region.id, p);
      }
    });

    this.onMessage('region_cross', (client: Client, message: unknown) => {
      const player = this.world.players.get(client.sessionId);
      const targetId = message && typeof message === 'object' ? (message as Record<string, unknown>).zone : undefined;
      const source = nationalRegion(this.world.zone);
      const target = typeof targetId === 'string' ? nationalRegion(targetId) : null;
      if (!player || !source || !target || isGuest(player.accountId) || !player.alive || !adjacentRegions(source, target)
        || !regionContains(target, networkPosition(target.id, persistentPosition(source.id, player)))) {
        client.send('region_refused', { error: 'Crossing refused' });
        return;
      }
      const now = this.now();
      const activeTransfer = this.outgoing.get(client.sessionId);
      if (activeTransfer && activeTransfer.expiresAt <= now) activeTransfer.rollback();
      if (this.incoming.has(client.sessionId) || this.outgoing.has(client.sessionId) || player.transferUntil > now) return;
      const expiresAt = now + HANDOFF_SECONDS;
      player.transferUntil = expiresAt;
      this.pay(this.economy.leave(client.sessionId));
      const sourceId = client.sessionId;
      const global = persistentPosition(source.id, player);
      const transfer: RegionTransfer = {
        player, expiresAt, state: 'pending',
        finish: () => {
          transfer.state = 'finished';
          this.outgoing.delete(sourceId);
          if (transfer.targetClient) transfer.target?.incoming.delete(transfer.targetClient.sessionId);
        },
        rollback: () => {
          if (transfer.state === 'finished') return;
          const committed = transfer.state === 'committed';
          const destination = transfer.target;
          const targetClient = transfer.targetClient;
          transfer.finish();
          if (committed && destination && targetClient) {
            destination.detach(targetClient.sessionId);
            player.id = sourceId;
            player.enterRegion(source, networkPosition(source.id, global), this.now());
            if (!this.disposed && this.clients.includes(client)) {
              this.world.players.set(sourceId, player);
              nationalAccounts.set(player.accountId, player);
              enterRoom(player.accountId);
            } else if (nationalAccounts.get(player.accountId) === player) {
              nationalAccounts.delete(player.accountId);
            }
          }
          player.transferUntil = 0;
          if (this.world.players.get(sourceId) === player) {
            rememberNationalPosition(player.accountId, source.id, player);
            client.send('correct', { x: player.x, y: player.y, z: player.z });
          }
          if (targetClient) {
            targetClient.send('region_refused', { error: 'Crossing expired or refused' });
            void targetClient.leave();
          }
        },
        commit: () => {
          const destination = transfer.target;
          const targetClient = transfer.targetClient;
          if (transfer.state !== 'pending' || transfer.expiresAt <= this.now() || this.disposed || destination?.disposed
            || !destination || !targetClient || this.world.players.get(sourceId) !== player || !player.alive) return false;
          this.detach(sourceId);
          player.id = targetClient.sessionId;
          player.enterRegion(target, networkPosition(target.id, global), destination.now());
          destination.world.players.set(targetClient.sessionId, player);
          enterRoom(player.accountId);
          rememberNationalPosition(player.accountId, target.id, player);
          transfer.state = 'committed';
          // Keep recovery available until the source receives the committed reply and leaves.
          transfer.expiresAt = this.now() + HANDOFF_SECONDS;
          return true;
        },
      };
      this.outgoing.set(sourceId, transfer);
      const token = crossings.issue({
        accountId: player.accountId, source: source.id, target: target.id, expiresAt,
        valid: () => transfer.state === 'pending' && !this.disposed
          && this.world.players.get(sourceId) === player && player.transferUntil === expiresAt && player.alive,
        take: () => transfer,
      }, now);
      client.send('region_handoff', { zone: target.id, token, expiresAt });
    });

    this.onMessage('region_ready', (client: Client) => {
      const transfer = this.incoming.get(client.sessionId);
      if (transfer?.state === 'committed') {
        client.send('region_committed', { zone: this.world.zone });
        return;
      }
      if (!transfer || !transfer.commit()) {
        transfer?.rollback();
        client.send('region_refused', { error: 'Crossing expired or refused' });
        return;
      }
      client.send('region_committed', { zone: this.world.zone });
      client.send('snap', this.world.snapshot(this.now()));
      this.pay(this.economy.join(client.sessionId));
    });

    // Stamina: dodges, heavies and jumps the player started. The room keeps its own count from these.
    this.onMessage('act', (client: Client, message: unknown) => { this.world.act(client.sessionId, message, this.now()); });

    this.onMessage('hit', (client: Client, message: unknown) => {
      this.deliver(this.world.hit(client.sessionId, message, this.now()));
    });

    // Money: the message names the player's choice; who and where come from the room.
    // Armour: the player names a piece they own (or null to take it off). The room holds the account's
    // satchel and the stored look, and judges whether it may be worn.
    this.onMessage('wear', (client: Client, message: unknown) => this.wear(client, message));

    this.onMessage('loot_claim', (client: Client, message: unknown) => this.pay(this.economy.claim(client.sessionId, message)));
    this.onMessage('shop', (client: Client, message: unknown) => this.pay(this.economy.shop(client.sessionId, message)));
    this.onMessage('bank', (client: Client, message: unknown) => this.pay(this.economy.bank(client.sessionId, message)));
    this.onMessage('trade_offer', (client: Client, message: unknown) => this.pay(this.economy.offer(client.sessionId, message)));
    this.onMessage('trade_accept', (client: Client) => this.pay(this.economy.accept(client.sessionId)));
    this.onMessage('trade_cancel', (client: Client) => this.pay(this.economy.cancelTrade(client.sessionId)));
    // The browser is listening: the zone's piles and its purse, as at join.
    this.onMessage('econ_sync', (client: Client) => this.pay(this.economy.join(client.sessionId)));

    this.onMessage('ping', (client: Client, message: unknown) => {
      const c = (message as { c?: unknown } | undefined)?.c;
      if (typeof c === 'number' && Number.isFinite(c)) client.send('pong', { c, t: this.now() });
    });

    // Outside production a test may place its player anywhere once.
    this.onMessage('warp', (client: Client) => {
      if (guestsAllowed()) this.world.players.get(client.sessionId)?.allowWarp(1);
    });

    this.onMessage('chat', (client: Client, message: { text?: unknown }) => {
      const text = typeof message?.text === 'string' ? message.text.trim().slice(0, 300) : '';
      if (!text) return;
      if (testBannedWords(text)) {
        this.broadcast('chat', { sender: client.sessionId, text: redactBannedWords(text), violation: true });
        this.broadcast('chat_announcement', {
          text: `A Sentry: ${client.sessionId} has violated the Edict of Unnaming. A fine of 10 CHROMA is levied to the Treasury.`,
        });
      } else {
        this.broadcast('chat', { sender: client.sessionId, text });
      }
    });
  }

  override async onAuth(_client: Client, options: Record<string, unknown>, context: { token?: string }): Promise<Identity> {
    // Until the room type is filtered by zone, refuse a player who landed in another zone's room.
    if (typeof options?.zone === 'string' && options.zone !== this.world.zone) throw new Error(`This room holds ${this.world.zone}`);
    const who = await identify(options, context?.token);
    if (nationalRegion(this.world.zone)) {
      if (isGuest(who.accountId)) throw new Error('Sign in to enter the nation');
      if (options?.handoff !== undefined) {
        if (!crossings.accepts(options.handoff, who.accountId, this.world.zone, this.now())) throw new Error('Crossing expired or refused');
      } else {
        if (nationalAccounts.has(who.accountId)) throw new Error('This account is already in the nation');
        const resume = lastNationalPosition(who.accountId)?.zone ?? SPAWN_REGION;
        if (this.world.zone !== resume) throw new Error(`Resume in ${resume}`);
      }
    }
    return who;
  }

  override onJoin(client: Client, options: unknown, who: Identity): void {
    const region = nationalRegion(this.world.zone);
    const token = options && typeof options === 'object' ? (options as Record<string, unknown>).handoff : undefined;
    let player: ServerPlayer;
    let position: { x: number; y: number; z: number };
    if (region && token !== undefined) {
      const transfer = crossings.consume(token, who.accountId, this.world.zone, this.now());
      player = transfer.player;
      transfer.target = this;
      transfer.targetClient = client;
      this.incoming.set(client.sessionId, transfer);
      position = networkPosition(region.id, persistentPosition(player.region!.id, player));
    } else {
      if (region && nationalAccounts.has(who.accountId)) throw new Error('This account is already in the nation');
      const saved = region ? lastNationalPosition(who.accountId) : undefined;
      if (region && this.world.zone !== (saved?.zone ?? SPAWN_REGION)) throw new Error(`Resume in ${saved?.zone ?? SPAWN_REGION}`);
      if (region && saved) {
        player = new ServerPlayer(client.sessionId, who, this.world.layout.respawn, this.now());
        player.enterRegion(region, networkPosition(region.id, saved.position), this.now());
        this.world.players.set(client.sessionId, player);
      } else {
        player = this.world.join(client.sessionId, who, this.now());
      }
      position = { x: player.x, y: player.y, z: player.z };
      if (region) {
        nationalAccounts.set(who.accountId, player);
        rememberNationalPosition(who.accountId, region.id, player);
      }
      if (!isGuest(who.accountId)) enterRoom(who.accountId);
    }
    client.send('welcome', { you: client.sessionId, t: this.now(), zone: this.world.zone, element: player.element, role: player.role, tier: player.tier, outfit: player.outfit, ...(region ? { origin: region.origin, overlap: REGION_OVERLAP, position } : {}) });
    client.send('clock', { minute: this.clockMinute, speed: this.clockSpeed });
    if (!this.incoming.has(client.sessionId)) {
      client.send('snap', this.world.snapshot(this.now()));
      this.pay(this.economy.join(client.sessionId));
    }
  }

  override onLeave(client: Client): void {
    const outgoing = this.outgoing.get(client.sessionId);
    if (outgoing?.state === 'committed') outgoing.finish();
    else outgoing?.rollback();
    const incoming = this.incoming.get(client.sessionId);
    incoming?.rollback();
    this.detach(client.sessionId);
  }

  private detach(id: string): void {
    const p = this.world.players.get(id);
    this.pay(this.economy.leave(id));
    if (p && !isGuest(p.accountId)) leaveRoom(p.accountId);
    if (p?.region) rememberNationalPosition(p.accountId, p.region.id, p);
    this.world.leave(id);
    this.broadcast('left', { id });
    // During transfer the account stays reserved even while neither room is mutating it.
    if (p && nationalAccounts.get(p.accountId) === p
      && ![...this.outgoing.values(), ...this.incoming.values()].some(t => t.player === p)) {
      nationalAccounts.delete(p.accountId);
    }
  }

  override onDispose(): void {
    this.disposed = true;
    for (const transfer of this.outgoing.values()) transfer.rollback();
    for (const transfer of this.incoming.values()) transfer.rollback();
    for (const p of this.world.players.values()) {
      if (p.region) rememberNationalPosition(p.accountId, p.region.id, p);
      if (nationalAccounts.get(p.accountId) === p) nationalAccounts.delete(p.accountId);
    }
    this.outlaws?.despawn(this.world);
    this.economy.dispose();
    closeZone(this.world.zone);
  }

  /**
   * Puts on or takes off armour. The piece must be the player's own, so the account is read from
   * the room, never from the message; everyone else sees the new outfit in the next snapshot.
   */
  private wear(client: Client, message: unknown): void {
    const p = this.world.players.get(client.sessionId);
    if (!p) return;
    const raw = (message as { item?: unknown } | null | undefined)?.item ?? null;
    const item = raw === null ? null : typeof raw === 'string' ? raw.slice(0, 64) : undefined;
    if (item === undefined) {
      client.send('outfit', { error: 'invalid_input' });
      return;
    }
    try {
      if (isGuest(p.accountId)) throw new Error('Sign in to wear armour');
      if (item === null) takeOffArmour({ accountId: p.accountId });
      else wearArmour({ accountId: p.accountId, itemId: item });
      p.setWorn(item);
    } catch (err) {
      client.send('outfit', { error: err instanceof Error ? err.message : 'Refused' });
      return;
    }
    client.send('outfit', { item: p.worn, outfit: p.outfit, armour: p.armour });
  }

  /** Sends money events to the one player they concern, or to everyone. */
  private pay(events: EconEvent[]): void {
    for (const ev of events) {
      if (ev.to !== undefined) this.clients.find(c => c.sessionId === ev.to)?.send(ev.type, ev.body);
      else this.broadcast(ev.type, ev.body);
    }
  }

  /** Sends world events to the one player they concern, or to everyone. */
  private deliver(events: WorldEvent[]): void {
    for (const ev of events) {
      // A fall the room saw drops what the player carries where the room has them.
      if (ev.type === 'fell') this.pay(this.economy.death(ev.to));
      const { type, ...body } = ev;
      if ('to' in ev) {
        const { to, ...rest } = body as typeof body & { to: string };
        this.clients.find(c => c.sessionId === ev.to)?.send(type, rest);
      } else {
        this.broadcast(type, body);
      }
    }
  }
}
