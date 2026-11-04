import type RAPIER from '@dimforge/rapier3d-compat';
import type { Scene, Vector3 } from 'three';
import {
  claimStartingPurse,
  economyAvailable,
  fetchBalance,
  fetchSatchel,
  fetchStanding,
  reportBrawlSeen,
  reportDeath,
  reportKill,
} from './api.js';
import type { LootPile, Standing } from './api.js';
import { httpDoor, RoomDoor, type MoneyDoor, type RoomChannel } from './door.js';
import { ShopWindow } from './shop-window.js';
import { placesFor, PLACE_REACH } from '../../../shared/src/net/index.js';
import { WorldLoot } from './world-loot.js';

// The money loop in the town: loot that falls where enemies die, picked up by walking over it, sold at
// the market stalls, and dropped where you fall. All of it is held by the server; this keeps the
// player's view of their satchel and coin and draws the world side. Offline it talks to the HTTP
// routes; once the zone room is joined, every move of money goes through the room instead.


// What each kind of fighter in the town counts as for the loot rules.
const LOOT_KIND: Record<string, string> = {
  brawler: 'miscreant',
  armed: 'robber',
  bender: 'soldier',
  husk: 'monster',
};

export interface TownEconomyEvents {
  notice(text: string): void;
  standingChanged(standing: Standing): void;
}

export class TownEconomy {
  readonly enabled: boolean;
  private items: Record<string, number> = {};
  private coin = 0;
  private accountId: string | null = null;
  private readonly loot: WorldLoot | null = null;
  private readonly shop: ShopWindow | null = null;
  private readonly hint: HTMLDivElement;
  private nearStall: string | null = null;
  private standingNow: Standing = { redFlags: 0, hasBounty: false };
  private door: MoneyDoor = httpDoor;
  /** True once the server has told us the purse at least once. */
  private known = false;

  constructor(
    scene: Scene,
    world: RAPIER.World,
    private readonly zone: string,
    private readonly nation: string,
    private readonly events: TownEconomyEvents,
  ) {
    this.enabled = economyAvailable();
    this.hint = document.createElement('div');
    this.hint.className = 'shop-hint';
    this.hint.hidden = true;
    document.body.appendChild(this.hint);
    if (!this.enabled) return;

    this.loot = new WorldLoot(scene, world, zone, {
      picked: (text) => events.notice(text),
      satchelChanged: () => void this.refresh(),
      claim: (pileId, x, z) => this.door.claim(pileId, x, z),
    });
    this.shop = new ShopWindow({
      satchel: () => this.items,
      coin: () => this.coin,
      changed: () => this.refresh(),
      trade: (action, merchantId, item) => this.door.trade(action, merchantId, item, 1),
    });
    void this.start();
  }

  /** What the player carries, as robbers judge it: coin, plus the number of items as weight. */
  get carried(): { chroma: number; weight: number } | null {
    if (!this.enabled || !this.known) return null;
    const weight = Object.values(this.items).reduce((sum, n) => sum + n, 0);
    return { chroma: this.coin, weight };
  }

  /** Red flags and bounty as the server last told us. */
  get standing(): Standing {
    return this.standingNow;
  }

  get shopOpen(): boolean {
    return this.shop?.isOpen ?? false;
  }

  update(dt: number, hero: Vector3): void {
    if (!this.enabled) return;
    this.loot?.update(dt, hero);
    const stall = placesFor(this.zone).stalls.find((s) => Math.hypot(hero.x - s.x, hero.z - s.z) < PLACE_REACH);
    this.nearStall = stall?.id ?? null;
    const show = this.nearStall !== null && !this.shopOpen;
    if (this.hint.hidden === show) {
      this.hint.hidden = !show;
      if (show) this.hint.innerHTML = '<kbd>C</kbd> Trade at this stall';
    }
  }

  // The interact key. Returns true when it opened a shop.
  interact(): boolean {
    if (!this.enabled || !this.shop || !this.nearStall || this.shop.isOpen) return false;
    void this.shop.open(this.nearStall);
    return true;
  }

  /**
   * The zone room is joined: from now on it holds this player's money. It pushes the purse and
   * the zone's piles; kills and falls drop on the server without a word from us.
   */
  goOnline(room: RoomChannel): void {
    if (!this.enabled) return;
    this.door = new RoomDoor(room);
    if (this.loot) this.loot.pollServer = false;
    room.on('purse', (m) => {
      const p = m as { chroma: number; items: Record<string, number> };
      this.coin = p.chroma;
      this.items = p.items;
      this.known = true;
    });
    room.on('loot', (m) => this.loot?.replace((m as { piles: LootPile[] }).piles));
    room.on('loot_new', (m) => this.loot?.add((m as { pile: LootPile }).pile));
    room.on('loot_gone', (m) => this.loot?.remove((m as { id: string }).id));
    room.send('econ_sync', {});
  }

  enemyKilled(kind: string, at: Vector3): void {
    if (!this.enabled || this.door.online) return;
    reportKill(LOOT_KIND[kind] ?? kind, at.x, at.z, this.zone, this.nation)
      .then((pile) => { if (pile) this.loot?.add(pile); })
      .catch(() => {
        // No drop: the server refused (production, or too many kills too fast).
      });
  }

  heroDied(at: Vector3): void {
    if (!this.enabled || this.door.online) return;
    reportDeath(at.x, at.z, this.zone)
      .then((pile) => {
        if (!pile) return this.refresh();
        this.loot?.add(pile);
        const lost = Object.values(pile.contents.shards).reduce((a, b) => a + b, 0) + Object.values(pile.contents.materials).reduce((a, b) => a + b, 0);
        if (lost > 0) this.events.notice('What you carried lies where you fell');
        return this.refresh();
      })
      .catch(() => undefined);
  }

  /** A guard saw the player brawl. The server records the flag; we show what it says. */
  brawlSeen(): void {
    if (!this.enabled) return;
    reportBrawlSeen()
      .then((result) => {
        if (result.convertedToBounty) this.events.notice('Three red flags: the watch has put a bounty on you.');
        this.setStanding(result);
      })
      .catch(() => undefined);
  }

  dispose(): void {
    this.loot?.dispose();
    this.shop?.dispose();
    this.hint.remove();
  }

  private async start(): Promise<void> {
    try {
      await claimStartingPurse();
    } catch {
      // Already granted, or the server is down; refresh shows what we have.
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.door instanceof RoomDoor) {
      // The room pushes the purse after every change; standing still comes from HTTP.
      fetchStanding().then((s) => this.setStanding(s)).catch(() => undefined);
      return;
    }
    try {
      const satchel = await fetchSatchel();
      this.accountId = satchel.accountId;
      this.items = satchel.items;
      this.coin = await fetchBalance(this.accountId);
      this.known = true;
      this.setStanding(await fetchStanding());
    } catch {
      // Keep the last known view.
    }
  }

  private setStanding(next: Standing): void {
    this.standingNow = { redFlags: next.redFlags, hasBounty: next.hasBounty };
    this.events.standingChanged(this.standingNow);
  }
}
