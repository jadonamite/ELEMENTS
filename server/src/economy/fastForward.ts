import { DatabaseSync } from 'node:sqlite';
import { GAME_HOUR_MS, SINDR_MERCHANTS } from '@elements/shared';
import { migrateDatabase, setDatabase } from '../db.js';
import { ensureSindrMerchants, tickAllMerchantAgents, tickMerchantAgentsDay } from './agents/agentLoop.js';
import { RuleDecider } from './agents/ruleDecider.js';
import { getAccountBalance, grantPlayerStartingPurse, verifyWorldSupply } from './ledgerService.js';
import { buyFromMerchant, getMerchant, quoteMerchantTrade, sellToMerchant } from './merchantService.js';
import { addItems } from './satchelService.js';
import { buyShop, tickAllShopsDay } from './shopService.js';

// A week of Sindr trading in a throwaway database: the real merchant rules, the real keeper ticks and day
// ticks, and simulated players. It never touches the live ledger or the chain. Run it in a worker thread,
// because it points the economy's shared database handle at its own in-memory database.

export interface FastForwardGood {
  item: string;
  stock: number;
  maxStock: number;
  /** What a player pays for one. */
  buy: number;
  /** What the keeper pays a player for one; 0 when it is not buying. */
  sell: number;
  /** Index into FastForwardWeek.reasons. */
  reason: number;
}

export interface FastForwardKeeper {
  id: string;
  name: string;
  status: string;
  purse: number;
  owner: string | null;
  goods: FastForwardGood[];
}

export interface FastForwardFrame {
  hour: number;
  label: string;
  keepers: FastForwardKeeper[];
  events: string[];
}

export interface FastForwardWeek {
  seed: number;
  days: number;
  frames: FastForwardFrame[];
  /** Each keeper's reason sentence, stored once. */
  reasons: string[];
  supplyConserved: boolean;
  trades: number;
  refusals: number;
}

const DAY_HOURS = 24;
const DAYS = 7;
const FLOOD_COLOUR = 'shard_ignis';
const SHARD_KEEPERS = ['sindr_shards', 'sindr_crimson', 'sindr_scales', 'sindr_bright'];
const DRAINED = 'sindr_whetstone';
const POTIONS = 'sindr_potter';
const INVESTOR = 'sim_player_investor';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

function itemFor(key: string): string {
  return key === 'shard' ? FLOOD_COLOUR : key;
}

export async function simulateWeek(seed = 1): Promise<FastForwardWeek> {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  const random = rng(seed);
  const start = DAY_HOURS * GAME_HOUR_MS;
  const decider = new RuleDecider();
  ensureSindrMerchants(db, start);

  const players = Array.from({ length: 12 }, (_, i) => `sim_player_${i + 1}`);
  for (const p of [...players, INVESTOR]) grantPlayerStartingPurse(p, db);

  let trades = 0;
  let refusals = 0;
  const frames: FastForwardFrame[] = [];
  let events: string[] = [];
  const names = new Map(SINDR_MERCHANTS.map((m) => [m.id, m.name]));
  const owners = new Map<string, string>();
  const reasons: string[] = [];
  const reasonIndex = new Map<string, number>();
  const reasonOf = (text: string): number => {
    let i = reasonIndex.get(text);
    if (i === undefined) { i = reasons.length; reasons.push(text); reasonIndex.set(text, i); }
    return i;
  };
  let drainedBroke = false;

  const sell = (player: string, merchantId: string, itemType: string, quantity: number, now: number): number => {
    addItems({ accountId: player, from: 'world', stacks: [{ itemId: itemType, quantity }], reason: 'loot_claim', now }, db);
    try {
      const r = sellToMerchant({ merchantId, sellerAccountId: player, itemType, quantity, now }, db);
      trades++;
      return r.totalPrice;
    } catch {
      refusals++;
      return 0;
    }
  };
  const buy = (player: string, merchantId: string, itemType: string, quantity: number, now: number): boolean => {
    try {
      buyFromMerchant({ merchantId, buyerAccountId: player, itemType, quantity, now }, db);
      trades++;
      return true;
    } catch {
      refusals++;
      return false;
    }
  };

  const snapshot = (hour: number, now: number): void => {
    const keepers: FastForwardKeeper[] = SINDR_MERCHANTS.map((config) => {
      const m = getMerchant(config.id, db);
      const goods: FastForwardGood[] = Object.entries(m?.inventory ?? {}).map(([key, inv]) => {
        const item = itemFor(key);
        const buyQuote = quoteMerchantTrade({ merchantId: config.id, itemType: item, action: 'buy', quantity: 1, now }, db);
        const sellQuote = quoteMerchantTrade({ merchantId: config.id, itemType: item, action: 'sell', quantity: 1, now }, db);
        return {
          item,
          stock: inv.stock,
          maxStock: inv.maxStock,
          buy: buyQuote.unitPrice,
          sell: sellQuote.canExecute ? sellQuote.unitPrice : 0,
          reason: reasonOf(sellQuote.canExecute ? sellQuote.summary : buyQuote.summary),
        };
      });
      return {
        id: config.id,
        name: config.name,
        status: m?.status ?? 'open',
        purse: m?.balance ?? 0,
        owner: owners.get(config.id) ?? null,
        goods,
      };
    });
    const day = Math.floor(hour / DAY_HOURS) + 1;
    const clock = String(hour % DAY_HOURS).padStart(2, '0');
    frames.push({ hour, label: `Day ${day}, ${clock}:00`, keepers, events });
    events = [];
  };

  snapshot(0, start);
  for (let hour = 1; hour <= DAYS * DAY_HOURS; hour++) {
    const now = start + hour * GAME_HOUR_MS;
    const day = Math.floor((hour - 1) / DAY_HOURS) + 1;
    const clock = (hour - 1) % DAY_HOURS;
    const open = clock >= 8 && clock < 20;

    if (clock === 0 && hour > 1) {
      const { closed } = tickMerchantAgentsDay(now, db);
      tickAllShopsDay(now, db);
      for (const id of closed) events.push(`${names.get(id)} has been broke for three days and shuts.`);
    }

    if (open) {
      // Ordinary traffic: a few players sell loot or buy what they need.
      for (let i = 0; i < 4; i++) {
        const player = players[Math.floor(random() * players.length)]!;
        const others = SINDR_MERCHANTS.filter((m) => m.id !== DRAINED);
        const keeper = others[Math.floor(random() * others.length)]!;
        const keys = Object.keys(keeper.inventory);
        const key = keys[Math.floor(random() * keys.length)]!;
        const item = key === 'shard' ? ['shard_ignis', 'shard_aques', 'shard_terra', 'shard_aura'][Math.floor(random() * 4)]! : key;
        if (random() < 0.5) sell(player, keeper.id, item, 1 + Math.floor(random() * 3), now);
        else if (getAccountBalance(player, db) > 200) buy(player, keeper.id, item, 1, now);
      }

      // Days 2-3: players come back from the volcano road with sacks of one colour.
      if (day === 2 || day === 3) {
        const keeper = SHARD_KEEPERS[hour % SHARD_KEEPERS.length]!;
        sell(players[hour % players.length]!, keeper, FLOOD_COLOUR, 6, now);
        if (day === 2 && clock === 8) events.push('Players start selling sacks of crimson shards from the volcano road.');
      }

      // Day 4 morning: a fight is coming and everyone wants potions.
      if (day === 4 && clock >= 9 && clock < 14) {
        for (const p of players.slice(0, 4)) for (let n = 0; n < 4; n++) buy(p, POTIONS, 'potion', 1, now);
        if (clock === 9) events.push('A fight is coming: players crowd the potter for potions.');
      }

      // Days 2-3: one player keeps selling blades to the whetstone shop until its purse runs dry.
      if ((day === 2 || day === 3) && getMerchant(DRAINED, db)?.status === 'open') {
        const before = getMerchant(DRAINED, db)?.status;
        sell(INVESTOR, DRAINED, 'item', 6, now);
        const after = getMerchant(DRAINED, db)?.status;
        if (before === 'open' && after !== 'open' && !drainedBroke) {
          drainedBroke = true;
          events.push(`${names.get(DRAINED)} falls under 1,000 CHROMA and stops buying.`);
        }
      }

      // Once it has shut, that player buys the shop.
      if (getMerchant(DRAINED, db)?.status === 'closed' && !owners.has(DRAINED) && clock === 10) {
        try {
          buyShop({ merchantId: DRAINED, buyerAccountId: INVESTOR, now }, db);
          owners.set(DRAINED, INVESTOR);
          events.push(`A player buys the shuttered ${names.get(DRAINED)} for 2,000 CHROMA and now owns it.`);
        } catch (err) {
          events.push(`A player tries to buy ${names.get(DRAINED)}: ${err instanceof Error ? err.message : 'refused'}.`);
        }
      }
    }

    // Keepers act on their plans every half hour, as on the live server.
    await tickAllMerchantAgents({ now: now - GAME_HOUR_MS / 2, decider, db });
    await tickAllMerchantAgents({ now, decider, db });
    snapshot(hour, now);
  }

  return { seed, days: DAYS, frames, reasons, supplyConserved: verifyWorldSupply(db), trades, refusals };
}
