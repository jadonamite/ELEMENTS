import type RAPIER from '@dimforge/rapier3d-compat';
import { type Scene, Vector3 } from 'three';
import type { ContextOffer } from '../ui/context-action.js';
import {
  claimStartingPurse,
  economyAvailable,
  fetchBalance,
  fetchSatchel,
  fetchOpenBounties,
  fetchStanding,
  fetchWornArmour,
  isGuestSession,
  reportBrawlSeen,
  reportDeath,
  reportKill,
} from './api.js';
import type { LootPile, Standing } from './api.js';
import { CountingHouseWindow } from './counting-house-window.js';
import { httpDoor, RoomDoor, type MoneyDoor, type RoomChannel, type TradeState } from './door.js';
import { itemName } from './items.js';
import { NoticeBoardWindow } from './notice-board-window.js';
import { SatchelWindow } from './satchel-window.js';
import { ShopWindow } from './shop-window.js';
import { TradeWindow } from './trade-window.js';
import { placesFor, PLACE_REACH, TRADE_REACH } from '../../../shared/src/net/index.js';
import { stallsShut } from '../../../shared/src/net/clock.js';
import { WorldLoot } from './world-loot.js';

// The money loop in the town: loot that falls where enemies die, picked up by walking over it, sold at
// the market stalls, banked at counting houses, read on the notice board, and traded hand to hand with
// other players.

// What each kind of fighter in the town counts as for the loot rules.
const LOOT_KIND: Record<string, string> = {
  brawler: 'miscreant',
  armed: 'robber',
  bender: 'soldier',
  husk: 'monster',
};

export interface NearbyPlayerInfo {
  id: string;
  name: string;
  position: Vector3;
}

export interface TownEconomyEvents {
  notice(text: string): void;
  standingChanged(standing: Standing): void;
  wornChanged?(worn: { item: string | null; outfit: string; armour: number }): void;
  /** How dark the world is, 0 by day, 1 at night. The market closes at night. */
  nightness(): number;
}

export class TownEconomy {
  readonly enabled: boolean;
  private items: Record<string, number> = {};
  private coin = 0;
  private accountId: string | null = null;
  private worn: { item: string | null; outfit: string; armour: number } = { item: null, outfit: 'rags', armour: 0 };
  readonly loot: WorldLoot | null = null;
  private readonly shop: ShopWindow | null = null;
  private readonly countingHouse: CountingHouseWindow | null = null;
  private readonly noticeBoard: NoticeBoardWindow | null = null;
  private readonly tradeWindow: TradeWindow | null = null;
  private readonly satchelWindow: SatchelWindow | null = null;
  private nearStall: string | null = null;
  private stallAt: Vector3 | null = null;
  private nearHouse: string | null = null;
  private houseAt: Vector3 | null = null;
  private nearBoard = false;
  private boardAt: Vector3 | null = null;
  private nearPlayer: NearbyPlayerInfo | null = null;
  private playerAt: Vector3 | null = null;
  private incomingTrade: { id: string; name: string; at: Vector3 } | null = null;
  private getNearbyPlayers: (() => NearbyPlayerInfo[]) | null = null;
  private readonly offerAt = new Vector3();
  private readonly houseOfferAt = new Vector3();
  private readonly boardOfferAt = new Vector3();
  private readonly playerOfferAt = new Vector3();
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
      trade: (action, merchantId, item) => this.shuttered
        ? Promise.reject(new Error('The stalls are shuttered for the night'))
        : this.door.trade(action, merchantId, item, 1),
    });
    this.countingHouse = new CountingHouseWindow({
      coin: () => this.coin,
      accountId: () => this.accountId,
      changed: () => this.refresh(),
      deposit: (houseId, amount) => this.door.deposit(houseId, amount),
      withdraw: (houseId, noteId) => this.door.withdraw(houseId, noteId),
      notes: (houseId) => this.door.notes(houseId, this.accountId ?? undefined),
      isGuest: () => isGuestSession(),
    });
    this.noticeBoard = new NoticeBoardWindow({
      standing: () => this.standingNow,
      accountId: () => this.accountId,
      bounties: () => fetchOpenBounties(),
      isGuest: () => isGuestSession(),
    });
    this.tradeWindow = new TradeWindow({
      coin: () => this.coin,
      satchel: () => this.items,
      changed: () => this.refresh(),
      offer: (partnerId, chroma, items) => this.door.offerTrade(partnerId, chroma, items),
      accept: () => this.door.acceptTrade(),
      cancel: () => this.door.cancelTrade(),
      listen: (handler) => this.door.listenTrade(handler),
      isGuest: () => isGuestSession(),
    });
    this.satchelWindow = new SatchelWindow({
      satchel: () => this.items,
      coin: () => this.coin,
      worn: () => this.worn,
      wear: (item) => this.wear(item),
      changed: () => this.refresh(),
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

  get countingHouseOpen(): boolean {
    return this.countingHouse?.isOpen ?? false;
  }

  get tradeOpen(): boolean {
    return this.tradeWindow?.isOpen ?? false;
  }

  get noticeBoardOpen(): boolean {
    return this.noticeBoard?.isOpen ?? false;
  }

  get satchelOpen(): boolean {
    return this.satchelWindow?.isOpen ?? false;
  }

  get wornArmour(): { item: string | null; outfit: string; armour: number } {
    return this.worn;
  }

  openSatchel(): void {
    void this.satchelWindow?.open();
  }

  closeSatchel(): void {
    this.satchelWindow?.close();
  }

  toggleSatchel(): void {
    this.satchelWindow?.toggle();
  }

  async wear(itemId: string | null): Promise<{ item: string | null; outfit: string; armour: number }> {
    const result = await this.door.wear(itemId);
    this.worn = result;
    this.events.wornChanged?.(result);
    this.events.notice(result.item ? `Put on ${itemName(result.item)}` : 'Took off armour');
    await this.refresh();
    return result;
  }

  /** The market is shut once the world is dark enough; the stalls' shutters are already down. */
  private get shuttered(): boolean {
    return stallsShut(this.events.nightness());
  }

  openShop(merchantId?: string): void {
    const id = merchantId ?? this.nearStall ?? placesFor(this.zone).stalls[0]?.id;
    if (id) void this.shop?.open(id);
  }

  closeShop(): void {
    this.shop?.close();
  }

  openCountingHouse(houseId?: string): void {
    const id = houseId ?? this.nearHouse ?? placesFor(this.zone).countingHouses[0]?.id;
    if (id) void this.countingHouse?.open(id);
  }

  openNoticeBoard(): void {
    void this.noticeBoard?.open();
  }

  openTrade(partnerId: string, partnerName?: string): void {
    if (this.incomingTrade?.id === partnerId) this.incomingTrade = null;
    this.tradeWindow?.open(partnerId, partnerName);
  }

  update(dt: number, hero: Vector3): void {
    if (!this.enabled) return;
    this.loot?.update(dt, hero);

    const places = placesFor(this.zone);
    const stall = places.stalls.find((s) => Math.hypot(hero.x - s.x, hero.z - s.z) < PLACE_REACH);
    this.nearStall = stall?.id ?? null;
    this.stallAt = stall ? this.offerAt.set(stall.x, hero.y + 1.6, stall.z) : null;

    const house = places.countingHouses.find((h) => Math.hypot(hero.x - h.x, hero.z - h.z) < PLACE_REACH);
    this.nearHouse = house?.id ?? null;
    this.houseAt = house ? this.houseOfferAt.set(house.x, hero.y + 1.6, house.z) : null;

    const board = places.noticeBoard;
    this.nearBoard = board ? Math.hypot(hero.x - board.x, hero.z - board.z) < PLACE_REACH : false;
    this.boardAt = board && this.nearBoard ? this.boardOfferAt.set(board.x, hero.y + 2.2, board.z) : null;

    if (this.getNearbyPlayers) {
      const players = this.getNearbyPlayers();
      const p = players.find((other) => Math.hypot(hero.x - other.position.x, hero.z - other.position.z) <= TRADE_REACH);
      this.nearPlayer = p ?? null;
      this.playerAt = p ? this.playerOfferAt.set(p.position.x, p.position.y + 2.1, p.position.z) : null;
    } else {
      this.nearPlayer = null;
      this.playerAt = null;
    }
  }

  /** Trading, banking, reading the board or a player trade is what the context key does. */
  contextOffer(): ContextOffer | null {
    if (!this.enabled || this.shopOpen || this.countingHouseOpen || this.tradeOpen || this.noticeBoardOpen || this.satchelOpen) return null;

    if (this.incomingTrade) {
      return {
        verb: `Trade with ${this.incomingTrade.name}`,
        at: this.incomingTrade.at,
        act: () => {
          const inc = this.incomingTrade;
          if (inc) this.openTrade(inc.id, inc.name);
        },
      };
    }

    if (this.nearStall && this.stallAt) {
      return this.shuttered
        ? { verb: 'Shuttered for the night', at: this.stallAt, act: () => { this.events.notice('The stalls are shuttered until dawn.'); } }
        : { verb: 'Trade', at: this.stallAt, act: () => { this.interact(); } };
    }

    if (this.nearHouse && this.houseAt) {
      return { verb: 'Counting house', at: this.houseAt, act: () => { this.openCountingHouse(this.nearHouse!); } };
    }

    if (this.nearBoard && this.boardAt) {
      return { verb: 'Read the notice board', at: this.boardAt, act: () => { this.openNoticeBoard(); } };
    }

    if (this.nearPlayer && this.playerAt) {
      return { verb: `Trade with ${this.nearPlayer.name}`, at: this.playerAt, act: () => { this.openTrade(this.nearPlayer!.id, this.nearPlayer!.name); } };
    }

    return null;
  }

  // The interact key. Returns true when it opened a shop.
  interact(): boolean {
    if (!this.enabled || !this.shop || !this.nearStall || this.shop.isOpen) return false;
    if (this.shuttered) {
      this.events.notice('The stalls are shuttered until dawn.');
      return true;
    }
    void this.shop.open(this.nearStall);
    return true;
  }

  /**
   * The zone room is joined: from now on it holds this player's money. It pushes the purse and
   * the zone's piles; kills and falls drop on the server without a word from us.
   */
  goOnline(room: RoomChannel, getNearbyPlayers?: () => NearbyPlayerInfo[]): void {
    if (!this.enabled) return;
    this.getNearbyPlayers = getNearbyPlayers ?? null;
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
    room.on('outfit', (m) => {
      const body = m as { item?: string | null; outfit?: string; armour?: number; error?: string };
      if (!body.error) {
        this.worn = {
          item: body.item ?? null,
          outfit: body.outfit ?? 'rags',
          armour: body.armour ?? 0,
        };
        this.events.wornChanged?.(this.worn);
        void this.refresh();
      }
    });
    room.on('trade', (m) => {
      const s = m as TradeState;
      if (s.incoming && !this.tradeOpen) {
        const partnerName = s.incoming.slice(0, 8);
        const player = this.getNearbyPlayers?.().find((p) => p.id === s.incoming);
        const at = player ? player.position.clone().setY(player.position.y + 2.1) : this.offerAt.clone();
        this.incomingTrade = { id: s.incoming, name: partnerName, at };
        this.events.notice(`Trade offer from ${partnerName}. Press E to trade.`);
      }
    });
    room.send('econ_sync', {});
  }

  enemyKilled(kind: string, at: Vector3, nation?: string): void {
    if (!this.enabled || this.door.online) return;
    reportKill(LOOT_KIND[kind] ?? kind, at.x, at.z, this.zone, nation ?? this.nation)
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
    this.countingHouse?.dispose();
    this.noticeBoard?.dispose();
    this.tradeWindow?.dispose();
    this.satchelWindow?.dispose();
  }

  private async start(): Promise<void> {
    if (isGuestSession()) {
      this.coin = 0;
      this.items = {};
      this.known = true;
      return;
    }
    try {
      await claimStartingPurse();
    } catch {
      // Already granted, or the server is down; refresh shows what we have.
    }
    try {
      const initialWorn = await fetchWornArmour();
      this.worn = initialWorn;
      if (this.worn.outfit !== 'rags') this.events.wornChanged?.(this.worn);
    } catch {
      // Default is rags
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (isGuestSession()) return;
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
      const worn = await fetchWornArmour().catch(() => null);
      if (worn && (worn.item !== this.worn.item || worn.outfit !== this.worn.outfit)) {
        this.worn = worn;
        this.events.wornChanged?.(worn);
      }
    } catch {
      // Keep the last known view.
    }
  }

  private setStanding(next: Standing): void {
    if (next.accountId) this.accountId = next.accountId;
    this.standingNow = { redFlags: next.redFlags, hasBounty: next.hasBounty };
    this.events.standingChanged(this.standingNow);
  }
}

