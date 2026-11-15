import { DatabaseSync } from 'node:sqlite';
import { CARAVANS_CONFIG, COUNTING_HOUSES, GAME_HOUR_MS, SINDR_MERCHANTS } from '@elements/shared';
import { createOrGetAccount, migrateDatabase, setDatabase } from '../db.js';
import { chainAccountFor } from '../chain/accounts.js';
import { worldKeyPair } from '../chain/keys.js';
import { dropForDeath, flagFromRoom, isOutsider, jailFromServerState, payBountiesForDefeat } from '../net/money.js';
import { RaidService } from '../raids/service.js';
import { ensureSindrMerchants, tickAllMerchantAgents, tickMerchantAgentsDay } from './agents/agentLoop.js';
import { RuleDecider } from './agents/ruleDecider.js';
import { tickCaravans } from './caravanService.js';
import { depositToCountingHouse } from './countingHouseService.js';
import { getAccountBalance, grantPlayerStartingPurse, verifyWorldSupply } from './ledgerService.js';
import { claimLootPile } from './lootService.js';
import { buyFromMerchant, getMerchant, quoteMerchantTrade, sellToMerchant } from './merchantService.js';
import { recordNpcInteraction } from './npcMemoryService.js';
import { tickRivalClanTrade } from './rivalClanService.js';
import { addItems } from './satchelService.js';
import { buyShop, tickAllShopsDay } from './shopService.js';
import { executePlayerTrade } from './tradeService.js';
import { tickWorldDirector } from './worldDirectorService.js';

// A week of the lore's economy in a throwaway database: the real services (merchants, counting houses, robbery,
// red flags, bounties, jail, player trade tax, caravans, the rival clan, the world director, shop bailouts, NPC
// memory, hired fighters) driven by simulated players. Every event lists the NEAR moves its ledger rows would
// settle. It never touches the live ledger or the chain. Run it in a worker thread, because it points the
// economy's shared database handle at its own in-memory database.

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

/** One move the event's ledger rows would settle on NEAR. */
export interface FastForwardMove {
  contract: 'coin' | 'items';
  /** Chain account names; null is the world (an item minted or burned). */
  from: string | null;
  to: string | null;
  amount: number;
  /** The item token id, for item moves. */
  token?: string;
  reason: string;
}

export type FastForwardKind =
  | 'bank' | 'robbery' | 'law' | 'bounty' | 'jail' | 'trade' | 'tribute' | 'caravan' | 'rival'
  | 'firestorm' | 'shop' | 'memory' | 'outsider' | 'hire' | 'market';

export interface FastForwardEvent {
  kind: FastForwardKind;
  text: string;
  moves: FastForwardMove[];
}

export interface FastForwardFrame {
  hour: number;
  label: string;
  keepers: FastForwardKeeper[];
  events: FastForwardEvent[];
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
  /** The contracts the moves name. */
  contracts: { coin: string; items: string };
  /** Lore pieces the week cannot show because the server has no service for them yet. */
  missing: string[];
}

const DAY_HOURS = 24;
const DAYS = 7;
const GAME_ACCOUNT = 'elements-dev.testnet';
const CONTRACTS = {
  coin: process.env.CHROMA_CONTRACT_ID || 'chroma-v2.elements-dev.testnet',
  items: process.env.ITEMS_CONTRACT_ID || 'items-v4.elements-dev.testnet',
};
const SIM_SECRET = 'elements-fast-forward';
const MISSING = [
  'Sentries fining a red-flagged player on sight: the server has jail and the pardon fine, but no on-sight fine yet.',
  'AQUES healers: no healer service exists in the server yet.',
  'Masters raising fees while students rise: the server has no training or student records yet.',
];
const FLOOD_COLOUR = 'shard_ignis';
const SHARD_KEEPERS = ['sindr_shards', 'sindr_crimson', 'sindr_scales', 'sindr_bright'];
const BOUGHT = 'sindr_whetstone';
const ABANDONED = 'sindr_wick';
const POTIONS = 'sindr_potter';
const INVESTOR = 'sim_investor';
const ROBBER = 'sim_robber';
const CARRIER = 'sim_carrier';
const BANKER = 'sim_banker';
const HUNTER = 'sim_hunter';
const CHEAT = 'sim_cheat';
const TRAVELLER = 'sim_traveller';
const NATIONS = ['IGNIS', 'AQUES', 'TERRA', 'AURA'] as const;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

const itemFor = (key: string): string => (key === 'shard' ? FLOOD_COLOUR : key);

/** A simulated player: an account, a rising (role and nation) and a holder key, as a signed-in player has. */
function addPlayer(db: DatabaseSync, id: string, role: 'Shaper' | 'Hush', element: string): void {
  createOrGetAccount(id, db);
  // The Dim (Hush) belong to no nation.
  const nation = role === 'Hush' ? null : element;
  db.prepare('UPDATE accounts SET role = ?, element = ?, chain_public_key = ? WHERE id = ?')
    .run(role, nation, worldKeyPair(SIM_SECRET, id).publicKey, id);
  db.prepare('INSERT OR REPLACE INTO risings (account_id, role, element, created_at) VALUES (?, ?, ?, 0)').run(id, role, nation);
  grantPlayerStartingPurse(id, db);
}

export async function simulateWeek(seed = 1): Promise<FastForwardWeek> {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  const random = rng(seed);
  const start = DAY_HOURS * GAME_HOUR_MS;
  let clockNow = start;
  const decider = new RuleDecider();
  ensureSindrMerchants(db, start);
  const raids = new RaidService(db, { now: () => clockNow, rand: random });

  const players = Array.from({ length: 12 }, (_, i) => `sim_player_${i + 1}`);
  players.forEach((p, i) => addPlayer(db, p, i % 3 === 0 ? 'Hush' : 'Shaper', NATIONS[i % NATIONS.length]!));
  addPlayer(db, INVESTOR, 'Hush', 'IGNIS');
  addPlayer(db, ROBBER, 'Shaper', 'IGNIS');
  addPlayer(db, CARRIER, 'Shaper', 'TERRA');
  addPlayer(db, BANKER, 'Shaper', 'TERRA');
  addPlayer(db, HUNTER, 'Shaper', 'AURA');
  addPlayer(db, CHEAT, 'Shaper', 'IGNIS');
  addPlayer(db, TRAVELLER, 'Shaper', 'AQUES');

  const names = new Map(SINDR_MERCHANTS.map((m) => [m.id, m.name]));
  const chainName = (ledgerId: string): string => chainAccountFor(ledgerId, { gameAccount: GAME_ACCOUNT, playerSecret: SIM_SECRET }, db);
  const lastRow = (table: string): number => (db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS r FROM ${table}`).get() as { r: number }).r;

  /** The NEAR moves the ledger rows written after `coinRow` / `itemRow` would settle. */
  const movesSince = (coinRow: number, itemRow: number): FastForwardMove[] => {
    const coin = db.prepare("SELECT sender, receiver, amount, reason FROM ledger_entries WHERE rowid > ? AND reason != 'genesis' ORDER BY rowid").all(coinRow) as Array<{ sender: string; receiver: string; amount: number; reason: string }>;
    const items = db.prepare('SELECT from_id, to_id, item_id, quantity, reason FROM item_ledger WHERE rowid > ? ORDER BY rowid').all(itemRow) as Array<{ from_id: string; to_id: string; item_id: string; quantity: number; reason: string }>;
    return [
      ...coin.map((r) => ({ contract: 'coin' as const, from: chainName(r.sender), to: chainName(r.receiver), amount: r.amount, reason: r.reason })),
      ...items.map((r) => ({
        contract: 'items' as const,
        from: r.from_id === 'world' ? null : chainName(r.from_id),
        to: r.to_id === 'world' ? null : chainName(r.to_id),
        amount: r.quantity, token: r.item_id, reason: r.reason,
      })),
    ];
  };

  let trades = 0;
  let refusals = 0;
  const frames: FastForwardFrame[] = [];
  let events: FastForwardEvent[] = [];
  const owners = new Map<string, string>();
  const reasons: string[] = [];
  const reasonIndex = new Map<string, number>();
  const reasonOf = (text: string): number => {
    let i = reasonIndex.get(text);
    if (i === undefined) { i = reasons.length; reasons.push(text); reasonIndex.set(text, i); }
    return i;
  };

  /** Runs one lore event through the real services; its text may depend on what happened. */
  const happen = async (kind: FastForwardKind, run: () => string | null | Promise<string | null>): Promise<void> => {
    const coinRow = lastRow('ledger_entries');
    const itemRow = lastRow('item_ledger');
    let text: string | null;
    try { text = await run(); } catch (err) { text = `${err instanceof Error ? err.message : String(err)}.`; }
    if (text) events.push({ kind, text, moves: movesSince(coinRow, itemRow) });
  };

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
      const merchant = getMerchant(merchantId, db);
      buyFromMerchant({ merchantId, buyerAccountId: player, itemType, quantity, now, isOutsider: merchant ? isOutsider(player, merchant.nation, db) : false }, db);
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
      return { id: config.id, name: config.name, status: m?.status ?? 'open', purse: m?.balance ?? 0, owner: owners.get(config.id) ?? null, goods };
    });
    const day = Math.floor(hour / DAY_HOURS) + 1;
    const clock = String(hour % DAY_HOURS).padStart(2, '0');
    frames.push({ hour, label: `Day ${day}, ${clock}:00`, keepers, events });
    events = [];
  };

  const name = (id: string): string => {
    const nation = /^merchant_(\w+)$/.exec(id)?.[1];
    return names.get(id) ?? (nation ? `the ${nation.toUpperCase()} merchant house` : id);
  };
  const goods = (type: string): string => ({ shard: 'shards', potion: 'potions', item: 'goods', material: 'materials' })[type] ?? type;

  const newDay = () => ({
    tribute: 0, caravans: 0, routes: new Set<string>(), rivalBuys: 0, rivalFrom: new Set<string>(), rivalGoods: new Set<string>(),
    moves: {} as Partial<Record<FastForwardKind, FastForwardMove[]>>,
  });
  let day_ = newDay();
  /** Runs routine work and keeps its NEAR moves for the day's one summary line. */
  const quiet = async (kind: FastForwardKind, run: () => void | Promise<void>): Promise<void> => {
    const coinRow = lastRow('ledger_entries');
    const itemRow = lastRow('item_ledger');
    await run();
    (day_.moves[kind] ??= []).push(...movesSince(coinRow, itemRow));
  };
  let boughtBroke = false;
  let abandonedBroke = false;
  let robberies = 0;

  snapshot(0, start);
  for (let hour = 1; hour <= DAYS * DAY_HOURS; hour++) {
    const now = start + hour * GAME_HOUR_MS;
    clockNow = now;
    const day = Math.floor((hour - 1) / DAY_HOURS) + 1;
    const clock = (hour - 1) % DAY_HOURS;
    const open = clock >= 8 && clock < 20;

    if (clock === 0 && hour > 1) {
      await happen('shop', () => {
        const { closed } = tickMerchantAgentsDay(now, db);
        const shops = tickAllShopsDay(now, db);
        const lines = closed.map((id) => `${name(id)} has been broke for three days and shuts${id === ABANDONED ? '. No player buys it.' : '.'}`);
        for (const id of shops.bailoutReopened) lines.push(`Nobody bought ${name(id)}. A new keeper arrives with a purse from the treasury and reopens it.`);
        return lines.length ? lines.join(' ') : null;
      });
    }

    if (open) {
      // Ordinary traffic: a few players sell loot or buy what they need.
      for (let i = 0; i < 4; i++) {
        const player = players[Math.floor(random() * players.length)]!;
        const others = SINDR_MERCHANTS.filter((m) => m.id !== BOUGHT && m.id !== ABANDONED);
        const keeper = others[Math.floor(random() * others.length)]!;
        const keys = Object.keys(keeper.inventory);
        const key = keys[Math.floor(random() * keys.length)]!;
        const item = key === 'shard' ? ['shard_ignis', 'shard_aques', 'shard_terra', 'shard_aura'][Math.floor(random() * 4)]! : key;
        if (random() < 0.5) sell(player, keeper.id, item, 1 + Math.floor(random() * 3), now);
        else if (getAccountBalance(player, db) > 200) buy(player, keeper.id, item, 1, now);
      }

      // Day 1: two players bank their coin in Chromara; a sealed note is safe from robbers.
      if (day === 1 && clock === 9) {
        await happen('bank', () => {
          const note = depositToCountingHouse({ accountId: BANKER, amount: 80, countingHouseId: COUNTING_HOUSES[0]!.id }, db);
          return `A TERRA player seals ${note.amount} CHROMA at ${COUNTING_HOUSES[0]!.name}. The note is safe from robbers; only its holder can draw on it.`;
        });
      }

      // Days 2-3: players come back from the volcano road with sacks of one colour; IGNIS players earn most.
      if (day === 2 || day === 3) {
        const keeper = SHARD_KEEPERS[hour % SHARD_KEEPERS.length]!;
        const ignis = players.filter((_, i) => NATIONS[i % NATIONS.length] === 'IGNIS');
        sell(ignis[hour % ignis.length]!, keeper, FLOOD_COLOUR, 6, now);
        if (day === 2 && clock === 8) events.push({ kind: 'trade', text: 'IGNIS players start selling sacks of crimson shards from the volcano road.', moves: [] });
      }

      // Days 2-4: one robber works the road. Each robbery is a red flag; the third becomes a bounty.
      if (day >= 2 && day <= 4 && clock === 15 && robberies < 3) {
        await happen(robberies === 2 ? 'bounty' : 'robbery', () => {
          addItems({ accountId: CARRIER, from: 'world', stacks: [{ itemId: 'shard_terra', quantity: 6 }], reason: 'loot_claim', now }, db);
          const pile = dropForDeath(CARRIER, 'sindr', 120 + robberies, 40, db);
          if (!pile) return null;
          claimLootPile({ pileId: pile.id, accountId: ROBBER, x: pile.x, z: pile.z, now }, db);
          const flagged = flagFromRoom(ROBBER, 'robbery on the volcano road', db);
          robberies++;
          const lead = 'A robber kills a TERRA player on the road and takes the shards in their satchel. Coin sealed at a counting house is never carried, so it cannot be robbed.';
          if (flagged?.convertedToBounty) return `${lead} Third red flag: the robber now has a bounty of ${flagged.bounty?.rewardChroma ?? 0} CHROMA on their head.`;
          return `${lead} The robber earns red flag ${robberies}.`;
        });
        // The robbed player earns coin again by selling what they find.
      }

      // Day 4: the marked robber tries to bank the loot.
      if (day === 4 && clock === 16) {
        await happen('law', () => {
          try { depositToCountingHouse({ accountId: ROBBER, amount: 20, countingHouseId: COUNTING_HOUSES[1]!.id }, db); }
          catch (err) { return `The marked robber tries to bank their coin. ${COUNTING_HOUSES[1]!.name} refuses: ${err instanceof Error ? err.message : String(err)}.`; }
          return 'The robber banks their coin: the counting house did not see the red flags.';
        });
      }

      // Day 5: a bounty hunter beats the robber and is paid the bounty by the treasury.
      if (day === 5 && clock === 10) {
        await happen('bounty', () => {
          const paid = payBountiesForDefeat(HUNTER, ROBBER, db);
          return paid.length ? 'An AURA bounty hunter beats the robber in a fight. The treasury pays the bounty.' : null;
        });
      }

      // Day 5: Sentries arrest the robber in Chromara. Jail takes 40 % of what they hold, then the fine to leave.
      if (day === 5 && clock === 14) {
        await happen('jail', () => {
          const before = getAccountBalance(ROBBER, db);
          const result = jailFromServerState(ROBBER, db);
          return `Sentries arrest the robber in Chromara. Jail seizes ${result.seizedChroma} of their ${before} CHROMA and takes the fine to leave.`;
        });
      }

      // Day 3: hand-to-hand trades. Two Lit pay the heavy Lit-to-Lit tax; a trade with the Dim pays the light one.
      if (day === 3 && clock === 11) {
        await happen('trade', () => {
          const r = executePlayerTrade({ buyerId: players[1]!, sellerId: players[2]!, amount: 60 }, db);
          return `Two Lit trade hand to hand for 60 CHROMA. The Lord's tax on Lit-to-Lit trade takes ${r.taxAmount}.`;
        });
        await happen('trade', () => {
          const r = executePlayerTrade({ buyerId: players[1]!, sellerId: players[0]!, amount: 60 }, db);
          return `A Lit buys from a Dim trader for 60 CHROMA. Trade through the Dim is taxed lightly: ${r.taxAmount}.`;
        });
      }

      // Day 3: an AQUES traveller buys in Sindr and pays the outsider price.
      if (day === 3 && clock === 13) {
        await happen('outsider', () => {
          const local = quoteMerchantTrade({ merchantId: POTIONS, itemType: 'potion', action: 'buy', quantity: 1, now, isOutsider: false }, db);
          const outsider = quoteMerchantTrade({ merchantId: POTIONS, itemType: 'potion', action: 'buy', quantity: 1, now, isOutsider: isOutsider(TRAVELLER, 'IGNIS', db) }, db);
          buy(TRAVELLER, POTIONS, 'potion', 1, now);
          return `An AQUES traveller buys a potion in Sindr for ${outsider.unitPrice} CHROMA. An IGNIS local pays ${local.unitPrice}.`;
        });
      }

      // Day 3: a player cheats a keeper; the keeper remembers and prices them higher.
      if (day === 3 && clock === 17) {
        await happen('memory', () => {
          const before = quoteMerchantTrade({ merchantId: POTIONS, itemType: 'potion', action: 'buy', quantity: 1, now, buyerAccountId: CHEAT }, db);
          for (let n = 0; n < 3; n++) recordNpcInteraction(POTIONS, CHEAT, -40, db);
          const after = quoteMerchantTrade({ merchantId: POTIONS, itemType: 'potion', action: 'buy', quantity: 1, now, buyerAccountId: CHEAT }, db);
          return `A player cheats ${name(POTIONS)}. The keeper remembers: their potion goes from ${before.unitPrice} to ${after.unitPrice} CHROMA, for them alone.`;
        });
      }

      // Day 4 morning: a raid is coming. Players crowd the potter, and a party leader hires a fighter at the Raid Hall.
      if (day === 4 && clock >= 9 && clock < 14) {
        for (const p of players.slice(0, 4)) for (let n = 0; n < 4; n++) buy(p, POTIONS, 'potion', 1, now);
        if (clock === 9) {
          events.push({ kind: 'trade', text: 'A raid is coming: players crowd the potter for potions.', moves: [] });
          await happen('hire', () => {
            const fighter = raids.fighters().find((f) => f.status !== 'hired');
            if (!fighter) return null;
            const leader = [...players].sort((a, b) => getAccountBalance(b, db) - getAccountBalance(a, db))[0]!;
            const { wage } = raids.hire(leader, fighter.id);
            return `A party leader hires ${fighter.name} at the Raid Hall. The wage, ${wage} CHROMA, is held by the Hall until the run ends.`;
          });
        }
      }

      // Day 1: one keeper is drained and nobody buys it; it will shut and a new keeper will come.
      if (day === 1 && getMerchant(ABANDONED, db)?.status === 'open') {
        const before = getMerchant(ABANDONED, db)?.status;
        sell(INVESTOR, ABANDONED, Object.keys(getMerchant(ABANDONED, db)?.inventory ?? {})[0] ?? 'item', 8, now);
        if (before === 'open' && getMerchant(ABANDONED, db)?.status !== 'open' && !abandonedBroke) {
          abandonedBroke = true;
          events.push({ kind: 'shop', text: `${name(ABANDONED)} falls under 1,000 CHROMA and stops buying.`, moves: [] });
        }
      }

      // Days 2-3: one player keeps selling blades to the whetstone shop until its purse runs dry.
      if ((day === 2 || day === 3) && getMerchant(BOUGHT, db)?.status === 'open') {
        const before = getMerchant(BOUGHT, db)?.status;
        sell(INVESTOR, BOUGHT, 'item', 6, now);
        if (before === 'open' && getMerchant(BOUGHT, db)?.status !== 'open' && !boughtBroke) {
          boughtBroke = true;
          events.push({ kind: 'shop', text: `${name(BOUGHT)} falls under 1,000 CHROMA and stops buying.`, moves: [] });
        }
      }

      // Once it has shut, that player buys the shop.
      if (getMerchant(BOUGHT, db)?.status === 'closed' && !owners.has(BOUGHT) && clock === 10) {
        await happen('shop', () => {
          buyShop({ merchantId: BOUGHT, buyerAccountId: INVESTOR, now }, db);
          owners.set(BOUGHT, INVESTOR);
          return `A player buys the shuttered ${name(BOUGHT)} and now owns it.`;
        });
      }
    }

    // Keepers act on their plans every half hour, as on the live server; tribute ships on its schedule.
    // Tribute, caravans and the rival clan run every hour; the log gets one line for each per day.
    await quiet('tribute', async () => {
      const before = (db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE reason = 'merchant_tribute'").get() as { n: number }).n;
      await tickAllMerchantAgents({ now: now - GAME_HOUR_MS / 2, decider, db });
      await tickAllMerchantAgents({ now, decider, db });
      const after = (db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE reason = 'merchant_tribute'").get() as { n: number }).n;
      if (after > before) day_.tribute += after - before;
    });
    await quiet('caravan', () => {
      for (const c of tickCaravans({ now }, db).filter((x) => x.dispatched)) {
        day_.caravans++;
        day_.routes.add(c.routeName);
      }
    });
    await quiet('rival', () => {
      const r = tickRivalClanTrade({ now }, db);
      if (r.executed) {
        day_.rivalBuys++;
        day_.rivalFrom.add(name(r.merchantId ?? ''));
        day_.rivalGoods.add(goods(r.itemType ?? ''));
      }
    });
    await happen('firestorm', () => {
      const { triggeredEvent: e } = tickWorldDirector({ now }, db);
      if (!e) return null;
      const route = CARAVANS_CONFIG.routes.find((r) => r.id === e.closedRoute)?.name ?? 'a trade road';
      return `${e.nation}'s players have grown too strong. The world pushes back: a firestorm closes the ${route} and ${e.nation} prices rise for a day.`;
    });

    if (clock === DAY_HOURS - 1) {
      const lines: Array<[FastForwardKind, string]> = [];
      if (day_.tribute) lines.push(['tribute', `Keepers ship ${day_.tribute} ${day_.tribute === 1 ? 'load' : 'loads'} of tribute to the Lord's treasury on day ${day}.`]);
      if (day_.caravans) lines.push(['caravan', `${day_.caravans} caravans leave on day ${day}, on the ${[...day_.routes].join(', the ')}.`]);
      if (day_.rivalBuys) lines.push(['rival', `The rival clan buys ${[...day_.rivalGoods].join(' and ')} ${day_.rivalBuys} times on day ${day} from ${[...day_.rivalFrom].join(' and ')}, with its own purse.`]);
      for (const [kind, text] of lines) events.push({ kind, text, moves: day_.moves[kind] ?? [] });
      day_ = newDay();
    }
    snapshot(hour, now);
  }

  return {
    seed, days: DAYS, frames, reasons, supplyConserved: verifyWorldSupply(db), trades, refusals,
    contracts: CONTRACTS, missing: MISSING,
  };
}

