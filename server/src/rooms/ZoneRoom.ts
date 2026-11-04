import { Room, type Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { ELEMENTS, type Element } from '@elements/shared';
import { verifyToken } from '../auth.js';
import { getRising } from '../db.js';
import { SNAPSHOT_RATE } from '../net/constants.js';
import { isGuest } from '../net/money.js';
import { closeZone, enterRoom, leaveRoom, openZone } from '../net/presence.js';
import { ZoneWorld, type Identity, type WorldEvent } from '../net/world.js';
import { ZoneEconomy, type EconEvent } from '../net/zone-economy.js';

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
  if (token) {
    const { userId } = await verifyToken(token);
    const rising = getRising(userId);
    if (!rising) throw new Error('This account has not risen yet');
    return { accountId: userId, role: rising.role, element: (rising.element ?? 'IGNIS') as Element };
  }
  if (!guestsAllowed()) throw new Error('Login required');
  const asked = typeof options?.element === 'string' ? options.element.toUpperCase() : 'IGNIS';
  const element = (ELEMENTS as readonly string[]).includes(asked) ? asked as Element : 'IGNIS';
  return { accountId: `guest:${randomUUID()}`, role: options?.role === 'Hush' ? 'Hush' : 'Shaper', element };
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
  private started = 0;

  /** Seconds since the room opened: the clock every client syncs to. */
  now(): number {
    return (performance.now() - this.started) / 1000;
  }

  override onCreate(options: { zone?: string }): void {
    this.started = performance.now();
    const zone = typeof options?.zone === 'string' ? options.zone : 'arena';
    this.world = new ZoneWorld(zone);
    this.economy = new ZoneEconomy(this.world);
    openZone(zone);
    void this.setMetadata({ zone });

    let sinceSnap = 0;
    let sincePiles = 0;
    this.setSimulationInterval((deltaMs) => {
      const dt = Math.min(deltaMs / 1000, 0.1);
      this.deliver(this.world.step(dt, this.now()));
      this.pay(this.economy.drain());
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
      }
    });

    this.onMessage('hit', (client: Client, message: unknown) => {
      this.deliver(this.world.hit(client.sessionId, message, this.now()));
    });

    // Money: the message names the player's choice; who and where come from the room.
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
    return identify(options, context?.token);
  }

  override onJoin(client: Client, _options: unknown, who: Identity): void {
    const player = this.world.join(client.sessionId, who, this.now());
    if (!isGuest(who.accountId)) enterRoom(who.accountId);
    client.send('welcome', { you: client.sessionId, t: this.now(), zone: this.world.zone, element: player.element, role: player.role });
    client.send('snap', this.world.snapshot(this.now()));
    this.pay(this.economy.join(client.sessionId));
  }

  override onLeave(client: Client): void {
    const p = this.world.players.get(client.sessionId);
    this.pay(this.economy.leave(client.sessionId));
    if (p && !isGuest(p.accountId)) leaveRoom(p.accountId);
    this.world.leave(client.sessionId);
    this.broadcast('left', { id: client.sessionId });
  }

  override onDispose(): void {
    this.economy.dispose();
    closeZone(this.world.zone);
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
