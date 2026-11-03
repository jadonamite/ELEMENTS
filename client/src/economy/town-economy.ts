import type RAPIER from '@dimforge/rapier3d-compat';
import type { Scene, Vector3 } from 'three';
import {
  claimStartingPurse,
  economyAvailable,
  fetchBalance,
  fetchSatchel,
  reportDeath,
  reportKill,
} from './api.js';
import { ShopWindow } from './shop-window.js';
import { WorldLoot } from './world-loot.js';

// The money loop in the town: loot that falls where enemies die, picked up by walking over it, sold at
// the market stalls, and dropped where you fall. All of it is held by the server; this keeps the
// player's view of their satchel and coin and draws the world side.

// Sindr's market square is centred at x 125; its stalls stand 12 m east and west, 8 m north and south.
const STALLS: Array<{ merchantId: string; x: number; z: number }> = [
  { merchantId: 'sindr_shards', x: 113, z: -8 },
  { merchantId: 'sindr_supplies', x: 137, z: -8 },
  { merchantId: 'sindr_arms', x: 113, z: 8 },
];
const STALL_REACH = 3.6;

// What each kind of fighter in the town counts as for the loot rules.
const LOOT_KIND: Record<string, string> = {
  brawler: 'miscreant',
  armed: 'robber',
  bender: 'soldier',
  husk: 'monster',
};

export interface TownEconomyEvents {
  notice(text: string): void;
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
    });
    this.shop = new ShopWindow({
      satchel: () => this.items,
      coin: () => this.coin,
      changed: () => this.refresh(),
    });
    void this.start();
  }

  get shopOpen(): boolean {
    return this.shop?.isOpen ?? false;
  }

  update(dt: number, hero: Vector3): void {
    if (!this.enabled) return;
    this.loot?.update(dt, hero);
    const stall = STALLS.find((s) => Math.hypot(hero.x - s.x, hero.z - s.z) < STALL_REACH);
    this.nearStall = stall?.merchantId ?? null;
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

  enemyKilled(kind: string, at: Vector3): void {
    if (!this.enabled) return;
    reportKill(LOOT_KIND[kind] ?? kind, at.x, at.z, this.zone, this.nation)
      .then((pile) => this.loot?.add(pile))
      .catch(() => {
        // No drop: the server refused (production, or too many kills too fast).
      });
  }

  heroDied(at: Vector3): void {
    if (!this.enabled) return;
    reportDeath(at.x, at.z, this.zone)
      .then((pile) => {
        this.loot?.add(pile);
        const lost = Object.values(pile.contents.shards).reduce((a, b) => a + b, 0) + Object.values(pile.contents.materials).reduce((a, b) => a + b, 0);
        if (lost > 0) this.events.notice('What you carried lies where you fell');
        return this.refresh();
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
    try {
      const satchel = await fetchSatchel();
      this.accountId = satchel.accountId;
      this.items = satchel.items;
      this.coin = await fetchBalance(this.accountId);
    } catch {
      // Keep the last known view.
    }
  }
}
