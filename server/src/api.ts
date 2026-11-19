import { marketBoard } from './chain/market.js';
import { prepareGuestClaim } from './chain/guest-claim.js';
import express, { type Application, type Request, type Response } from 'express';
import { bindPlayerGrant } from './chain/grants.js';
import { ARMOUR } from './economy/armourService.js';
import { getDatabase } from './db.js';
import { isOutlawKind, localOutlawKey, type Killer, type LootPile, type SignedSessionGrant } from '@elements/shared';
import { verifyToken } from './auth.js';
import { fastForwardWeek } from './economy/fastForwardRunner.js';
import { chainSettler, itemsChainSettler, readChainConfig, worldAccount, worldHolders } from './chain/index.js';
import { createGuestRising, createOrGetAccount, createOrGetRising, getRising, getControlProgress, saveControlProgress } from './db.js';
import { isAccountAllowed, isIpAllowed } from './rate-limit.js';
import { isOutsider } from './net/money.js';
import { isInRoom, isZoneOnline } from './net/presence.js';
import { litShrinesOf, reachShrine } from './net/shrines.js';
import {
  getAccountBalance,
  grantPlayerStartingPurse,
  getAllMerchants,
  getMerchant,
  quoteMerchantTrade,
  buyFromMerchant,
  sellToMerchant,
  depositToCountingHouse,
  withdrawFromCountingHouse,
  getAccountNotes,
  getOpenBounties,
  pardonBounty,
  addRedFlag,
  fineOnSight,
  getStanding,
  listLootPiles,
  claimLootPile,
  getMerchantMind,
  getShopsForSale,
  getShopOwnership,
  buyShop,
  setShopPrices,
  stockShop,
  withdrawShopProfit,
  getSatchel,
  removeItems,
  clientKillsAllowed,
  dropFromClientKill,
  releaseOutlawHold,
  createLootPileFromFight,
  takeOffArmour,
  wearArmour,
  wornLook,
  getLatestDailyJudgeReport,
  createDeterministicJudgeReport,
  getTownsfolkMindState,
  getAgentRuntime,
} from './economy/index.js';
import { climbTerms, enrol, recordWin, trialWon } from './economy/climbService.js';

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.slice(7).trim();
    if (candidate) return candidate;
  }
  const bodyToken = req.body?.token ?? req.body?.authToken;
  if (typeof bodyToken === 'string' && bodyToken.trim()) {
    return bodyToken.trim();
  }
  return null;
}

/** The signed-in account behind a request, or null after answering 401. */
async function requireAccount(req: Request, res: Response): Promise<string | null> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing auth token' });
    return null;
  }
  try {
    return (await verifyToken(token)).userId;
  } catch {
    res.status(401).json({ error: 'Invalid auth token' });
    return null;
  }
}

/**
 * While the account stands in a zone room, the room holds its money: anything that needs a
 * place or a fight goes through the room's messages. Answers 409 and returns true when refused.
 */
function heldByRoom(accountId: string, res: Response): boolean {
  if (!isInRoom(accountId)) return false;
  res.status(409).json({ error: 'You are in an online zone: do this in the world' });
  return true;
}

/** The caller's address as the one proxy in front of the server saw it (see `trust proxy` in setupApi). */
function extractIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// ALLOWED_ORIGINS is a comma-separated list; unset means local development only.
export function isOriginAllowed(origin: string, list = process.env.ALLOWED_ORIGINS): boolean {
  const allowed = (list ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (allowed.length === 0) return LOCAL_ORIGIN.test(origin);
  return allowed.includes(origin);
}

export function setupApi(app: Application): void {
  // One proxy (the host's edge) sits in front: req.ip is the address it saw, not one the browser wrote.
  app.set('trust proxy', 1);
  app.use(express.json());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (typeof origin === 'string' && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.post('/api/session', async (req: Request, res: Response) => {
    const ip = extractIp(req);
    if (!isIpAllowed(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    if (!isAccountAllowed(accountId)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    createOrGetAccount(accountId);
    const stored = getRising(accountId);

    res.json({
      accountId: accountId,
      grantCaps: { CHROMA: "100000", ...Object.fromEntries([...new Set([
        ...Object.keys(getSatchel(accountId)), ...Object.keys(ARMOUR.pieces),
        ...getAllMerchants().flatMap(m => Object.keys(m.inventory)),
        'shard_ignis', 'shard_aques', 'shard_terra', 'shard_aura', 'material', 'material_linen',
        ...(getDatabase().prepare('SELECT DISTINCT item_id FROM item_ledger').all() as Array<{item_id:string}>).map(row => row.item_id),
      ])].map(itemId => [itemId, "1000"])) },
      grantContracts: [chainSettler(), itemsChainSettler()].filter(s => s !== null).map(s => s.contractId),
      rising: stored
        ? {
            role: stored.role,
            element: stored.element ?? null,
          }
        : null,
    });
  });

  app.post('/api/market/:action', async (req: Request, res: Response) => {
    const board = marketBoard();
    if (!board) { res.status(503).json({ error: 'The Chromara board is not open yet' }); return; }
    const owner = await requireAccount(req,res);
    if (!owner) return;
    if (!isAccountAllowed(owner)) { res.status(429).json({error:'Too many requests'}); return; }
    try {
      const body = req.body;
      switch (req.params.action) {
        case 'view': res.json(await board.view(owner)); break;
        case 'deposit-quote': res.json(await board.depositQuote(owner,body.token,body.amount)); break;
        case 'deposit': res.json(await board.deposit(owner,body.id,body.signature)); break;
        case 'offer-quote': res.json(board.offerTerms(owner,body.offer)); break;
        case 'offer': res.json({id:board.postOffer(owner,body.offer,body.signed)}); break;
        case 'return': res.json(await board.returnGoods(owner,body.token,body.amount,body.signed)); break;
        default: res.status(404).json({error:'Unknown board action'});
      }
    } catch (error) { res.status(400).json({error:error instanceof Error ? error.message : 'The board could not complete that action'}); }
  });

  app.post('/api/chain/grant', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (!isAccountAllowed(accountId)) { res.status(429).json({ error: 'Too many requests' }); return; }
    const settlers = [chainSettler(), itemsChainSettler()].filter(s => s !== null);
    const signed = req.body as SignedSessionGrant;
    try {
      const settler = settlers.find(s => s.contractId === signed.payload?.recipient);
      if (!settler) { res.status(409).json({ error: 'Contract is not enabled' }); return; }
      bindPlayerGrant(getDatabase(), accountId, signed, settlers.map(s => s.contractId));
      await settler.submitGrant(signed);
      res.json({ accepted: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid session grant' });
    }
  });

  app.post('/api/chain/claim-guest', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (!isAccountAllowed(accountId)) { res.status(429).json({ error: 'Too many requests' }); return; }
    const grants = req.body?.grants as SignedSessionGrant[];
    const proof = req.body?.proof as SignedSessionGrant;
    if (!Array.isArray(grants) || grants.length > 2) { res.status(400).json({ error: 'Guest grants required' }); return; }
    try {
      const coin = chainSettler(); const items = itemsChainSettler();
      // Validate all proofs before forwarding them; ledger rows are written only after grants land.
      const db = getDatabase();
      db.exec('SAVEPOINT guest_proof');
      try {
        prepareGuestClaim(db, accountId, grants, { ...(coin ? { coin: coin.contractId } : {}), ...(items ? { items: items.contractId } : {}) }, proof);
      } finally { db.exec('ROLLBACK TO guest_proof'); db.exec('RELEASE guest_proof'); }
      for (const grant of grants) {
        const settler = [coin, items].find(s => s?.contractId === grant.payload.recipient);
        if (!settler) throw new Error('Contract is not enabled');
        await settler.submitGrant(grant);
      }
      const result = prepareGuestClaim(db, accountId, grants, { ...(coin ? { coin: coin.contractId } : {}), ...(items ? { items: items.contractId } : {}) }, proof);
      res.json(result);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Guest claim failed' }); }
  });

  // The Drawing for a player who has not signed in: the server keeps the result behind a ticket, and
  // signing in with that ticket makes it the account's. The browser never chooses its own result.
  app.post('/api/rising/guest', (req: Request, res: Response) => {
    const ip = extractIp(req);
    if (!isIpAllowed(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    const guest = createGuestRising(ip);
    if (!guest) {
      res.status(429).json({ error: 'Too many Drawings from this address today' });
      return;
    }
    res.json({ guestTicket: guest.ticket, rising: { role: guest.role, element: guest.element } });
  });

  app.post('/api/rising', async (req: Request, res: Response) => {
    const ip = extractIp(req);
    if (!isIpAllowed(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    if (!isAccountAllowed(accountId)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const ticket = typeof req.body?.guestTicket === 'string' ? req.body.guestTicket : undefined;
    const rising = createOrGetRising(accountId, undefined, undefined, ticket);

    res.json({
      accountId: accountId,
      role: rising.role,
      element: rising.element ?? null,
      rising: {
        role: rising.role,
        element: rising.element ?? null,
      },
    });
  });

  app.get('/api/character/controls', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (!isAccountAllowed(accountId)) { res.status(429).json({ error: 'Too many requests' }); return; }
    const rising = getRising(accountId);
    if (!rising) { res.status(409).json({ error: 'Create your character first' }); return; }
    res.json({ progress: getControlProgress(accountId), tier: rising.tier ?? 5 });
  });
  app.post('/api/character/controls', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (!isAccountAllowed(accountId)) { res.status(429).json({ error: 'Too many requests' }); return; }
    if (!getRising(accountId)) { res.status(409).json({ error: 'Create your character first' }); return; }
    if (!req.body?.progress || typeof req.body.progress !== 'object' || Array.isArray(req.body.progress)) {
      res.status(400).json({ error: 'A control learning record is required' }); return;
    }
    res.json({ progress: saveControlProgress(accountId, req.body.progress) });
  });

  // The treasury, keepers, masters and counting houses: each a NEAR account with its own key.
  function worldAccountList() {
    const config = readChainConfig();
    if (!config) return [];
    return worldHolders().map((ledgerId) => {
      const account = worldAccount(ledgerId, config.gameAccount);
      return { ledgerId, account, explorer: `${config.explorerUrl}/address/${account}` };
    });
  }

  // Where CHROMA lives on NEAR: the contract, the last settled batch and how much is waiting.
  app.get('/api/chain', (_req: Request, res: Response) => {
    const chroma = chainSettler();
    const items = itemsChainSettler();
    res.json({ onChain: Boolean(chroma || items), contracts: {
      chroma: chroma ? { onChain: true, ...chroma.status() } : { onChain: false },
      items: items ? { onChain: true, ...items.status() } : { onChain: false },
    }, worldAccounts: worldAccountList() });
  });
  app.get('/api/chain/me', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    const chroma = chainSettler();
    const items = itemsChainSettler();
    res.json({ onChain: Boolean(chroma || items), contracts: {
      chroma: chroma ? { onChain: true, ...chroma.status(accountId) } : { onChain: false },
      items: items ? { onChain: true, ...items.status(accountId) } : { onChain: false },
    } });
  });

  // --- Economy endpoints (M5) ---

  // Your own balance only. Robbers and Sentries read the ledger on the server, not through here.
  app.get('/api/economy/balance/:accountId', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (String(req.params.accountId ?? '') !== accountId) {
      res.status(403).json({ error: 'Only your own balance' });
      return;
    }
    res.json({ accountId, balance: getAccountBalance(accountId) });
  });

  app.post('/api/economy/grant-starting-purse', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    const grant = grantPlayerStartingPurse(accountId);
    const balance = getAccountBalance(accountId);
    res.json({ accountId: accountId, granted: !!grant, balance, grant });
  });

  // A week of Sindr trading on a throwaway copy of the economy, for watching prices move. Never touches the live ledger.
  app.get('/api/economy/fast-forward', async (req: Request, res: Response) => {
    if (!isIpAllowed(req.ip ?? 'unknown')) { res.status(429).json({ error: 'Too many requests' }); return; }
    const seed = Math.max(1, Math.min(9999, Math.floor(Number(req.query.seed) || 1)));
    try {
      res.json(await fastForwardWeek(seed));
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'Simulation failed' });
    }
  });

  app.get('/api/economy/merchants', (_req: Request, res: Response) => {
    const merchants = getAllMerchants();
    res.json({ merchants });
  });

  app.get('/api/economy/merchants/:merchantId', (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    const merchant = getMerchant(merchantId);
    if (!merchant) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }
    res.json({ merchant });
  });

  // A price for the signed-in player (outsider worked out here), or the plain price without a login.
  app.get('/api/economy/merchants/:merchantId/quote', async (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    const itemType = String(req.query.itemType || '');
    const action = req.query.action === 'sell' ? 'sell' : 'buy';
    const quantity = Math.max(1, parseInt(String(req.query.quantity || '1'), 10) || 1);
    const token = extractToken(req);
    const buyerAccountId = token ? await requireAccount(req, res) : undefined;
    if (buyerAccountId === null) return;
    const merchant = getMerchant(merchantId);
    const outsider = !!(buyerAccountId && merchant && isOutsider(buyerAccountId, merchant.nation));

    const quoteParams: {
      merchantId: string;
      itemType: string;
      action: 'buy' | 'sell';
      quantity: number;
      isOutsider?: boolean;
      buyerAccountId?: string;
    } = {
      merchantId,
      itemType,
      action,
      quantity,
    };
    if (outsider) quoteParams.isOutsider = true;
    if (buyerAccountId) quoteParams.buyerAccountId = buyerAccountId;

    const quote = quoteMerchantTrade(quoteParams);
    res.json({ quote });
  });

  app.post('/api/economy/merchants/buy', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    if (heldByRoom(accountId, res)) return;
    const { merchantId, itemType, quantity } = req.body || {};
    const merchant = getMerchant(String(merchantId ?? ''));
    try {
      const buyParams: {
        merchantId: string;
        buyerAccountId: string;
        itemType: string;
        quantity: number;
        isOutsider?: boolean;
      } = {
        merchantId,
        buyerAccountId: accountId,
        itemType,
        quantity: quantity ?? 1,
      };
      if (merchant && isOutsider(accountId, merchant.nation)) buyParams.isOutsider = true;

      const result = buyFromMerchant(buyParams);
      res.json({ success: true, result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Buy failed' });
    }
  });

  app.post('/api/economy/merchants/sell', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    if (heldByRoom(accountId, res)) return;
    const { merchantId, itemType, quantity } = req.body || {};
    const merchant = getMerchant(String(merchantId ?? ''));
    try {
      const sellParams: {
        merchantId: string;
        sellerAccountId: string;
        itemType: string;
        quantity: number;
        isOutsider?: boolean;
      } = {
        merchantId,
        sellerAccountId: accountId,
        itemType,
        quantity: quantity ?? 1,
      };
      if (merchant && isOutsider(accountId, merchant.nation)) sellParams.isOutsider = true;

      const result = sellToMerchant(sellParams);
      res.json({ success: true, result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Sell failed' });
    }
  });

  app.post('/api/economy/counting-house/deposit', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    if (heldByRoom(accountId, res)) return;
    const { amount, countingHouseId } = req.body || {};
    try {
      const note = depositToCountingHouse({
        accountId: accountId,
        amount,
        countingHouseId,
      });
      res.json({ success: true, note });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Deposit failed' });
    }
  });

  app.post('/api/economy/counting-house/withdraw', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    if (heldByRoom(accountId, res)) return;
    const { noteId, countingHouseId } = req.body || {};
    try {
      const result = withdrawFromCountingHouse({
        accountId: accountId,
        noteId,
        countingHouseId,
      });
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Withdrawal failed' });
    }
  });

  app.get('/api/economy/counting-house/notes/:accountId', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (String(req.params.accountId ?? '') !== accountId) {
      res.status(403).json({ error: 'Only your own notes' });
      return;
    }
    res.json({ notes: getAccountNotes(accountId) });
  });

  app.get('/api/economy/bounties', (_req: Request, res: Response) => {
    const bounties = getOpenBounties();
    res.json({ bounties });
  });

  app.post('/api/economy/bounties/pardon', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    const { bountyId } = req.body || {};
    try {
      const bounty = pardonBounty({ bountyId, payerId: accountId });
      res.json({ success: true, bounty });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Bounty pardon failed' });
    }
  });

  // The player's own standing with the town watch. The account comes from the token.
  app.get('/api/economy/crime/standing', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (accountId) res.json({ accountId, ...getStanding(accountId) });
  });

  // The town watch saw this player brawling in the street. The account comes from the token, never the body.
  app.post('/api/economy/crime/brawl-seen', async (req: Request, res: Response) => {
    if (!clientKillsAllowed()) {
      res.status(403).json({ error: 'Fights are judged by the game server here' });
      return;
    }
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    const result = addRedFlag(accountId, 'Brawling in the street, seen by the town watch');
    res.json({ accountId, convertedToBounty: result.convertedToBounty, ...getStanding(accountId) });
  });

  // The tier climb with the player's own master: where they stand, paying the fee, and the trial won.
  app.get('/api/climb', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (accountId) res.json(climbTerms(accountId));
  });
  app.post('/api/climb/enrol', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (accountId) res.json(enrol(accountId, clientKillsAllowed()));
  });
  app.post('/api/climb/trial-won', async (req: Request, res: Response) => {
    if (!clientKillsAllowed()) {
      res.status(403).json({ error: 'Trials are judged by the game server here' });
      return;
    }
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    try {
      res.json(trialWon(accountId));
    } catch (err: unknown) {
      res.status(409).json({ error: err instanceof Error ? err.message : 'No trial to win' });
    }
  });

  // A Sentry at a post saw this player: each red flag not yet fined is fined once. The account comes from the token.
  app.post('/api/economy/crime/sentry-fine', async (req: Request, res: Response) => {
    if (!clientKillsAllowed()) {
      res.status(403).json({ error: 'The game server judges what the Sentries see here' });
      return;
    }
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    const { zone, x, z } = req.body || {};
    if (typeof zone !== 'string' || !Number.isFinite(x) || !Number.isFinite(z)) {
      res.status(400).json({ error: 'Need zone, x and z' });
      return;
    }
    const fine = fineOnSight(accountId, zone, x, z);
    res.json({ accountId, ...fine, ...getStanding(accountId) });
  });

  app.get('/api/economy/loot', (req: Request, res: Response) => {
    const zone = typeof req.query.zone === 'string' ? req.query.zone : '';
    if (!zone) {
      res.status(400).json({ error: 'Missing zone parameter' });
      return;
    }

    const x = req.query.x !== undefined ? Number(req.query.x) : undefined;
    const z = req.query.z !== undefined ? Number(req.query.z) : undefined;
    const r = req.query.r !== undefined ? Number(req.query.r) : undefined;

    if (x !== undefined && Number.isNaN(x)) {
      res.status(400).json({ error: 'Invalid coordinate x' });
      return;
    }
    if (z !== undefined && Number.isNaN(z)) {
      res.status(400).json({ error: 'Invalid coordinate z' });
      return;
    }
    if (r !== undefined && Number.isNaN(r)) {
      res.status(400).json({ error: 'Invalid radius r' });
      return;
    }

    try {
      const piles = listLootPiles({ zone, x, z, radius: r });
      res.json({ piles });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to query loot piles' });
    }
  });

  // A browser-run enemy fell: drop its loot where it lay. Development builds only.
  app.post('/api/economy/loot/fight', async (req: Request, res: Response) => {
    if (!clientKillsAllowed()) {
      res.status(403).json({ error: 'Kills are reported by the game server here' });
      return;
    }
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (heldByRoom(accountId, res)) return;
    const { kind, x, z, zone, nation, enemyId } = req.body || {};
    if (typeof zone === 'string' && isZoneOnline(zone)) {
      res.status(409).json({ error: 'This zone is played online: its kills are judged by the game server' });
      return;
    }
    const numX = Number(x);
    const numZ = Number(z);
    if (typeof kind !== 'string' || typeof zone !== 'string' || !Number.isFinite(numX) || !Number.isFinite(numZ)) {
      res.status(400).json({ error: 'Missing kind, zone, x or z' });
      return;
    }
    try {
      recordWin(accountId);
      let releasedPiles: LootPile[] = [];
      if (typeof enemyId === 'string' && enemyId) {
        releasedPiles = releaseOutlawHold(localOutlawKey(accountId, enemyId), { x: numX, z: numZ }, accountId);
      }
      const pile = dropFromClientKill({
        accountId,
        kind,
        x: numX,
        z: numZ,
        zone,
        nation: typeof nation === 'string' ? nation : undefined,
      });
      res.json({ pile, releasedPiles });
    } catch (err: unknown) {
      res.status(429).json({ error: err instanceof Error ? err.message : 'Drop failed' });
    }
  });

  // The signed-in player died: what they carried (per the server) falls where they fell.
  app.post('/api/economy/death', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (heldByRoom(accountId, res)) return;
    const { x, z, zone, killer } = req.body || {};
    const numX = Number(x);
    const numZ = Number(z);
    if (typeof zone !== 'string' || !Number.isFinite(numX) || !Number.isFinite(numZ)) {
      res.status(400).json({ error: 'Missing zone, x or z' });
      return;
    }
    try {
      const rising = getRising(accountId);
      // An outlaw the browser names holds only this player's own drop, so a made-up killer gains nothing.
      const deathKiller: Killer = killer && typeof killer === 'object' && typeof killer.kind === 'string' && isOutlawKind(killer.kind)
        && typeof killer.id === 'string' && killer.id
        ? { kind: 'outlaw', id: localOutlawKey(accountId, killer.id) }
        : { kind: 'none' };
      const pile = createLootPileFromFight({
        x: numX,
        z: numZ,
        zone,
        source: 'player_death',
        sourceAccountId: accountId,
        nation: rising?.element ?? undefined,
        killer: deathKiller,
      });
      res.json({ pile });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Death drop failed' });
    }
  });

  // Shrines: which shrines an account has lit.
  app.get('/api/shrines', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    const lit = litShrinesOf(accountId);
    res.json({ lit: [...lit] });
  });

  // Reaching a shrine outside a fight lights it for good.
  app.post('/api/shrines/reach', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    const { x, z, inFight } = req.body || {};
    const numX = Number(x);
    const numZ = Number(z);
    if (!Number.isFinite(numX) || !Number.isFinite(numZ)) {
      res.status(400).json({ error: 'Missing x or z' });
      return;
    }
    const lit = litShrinesOf(accountId);
    const shrine = reachShrine(accountId, lit, numX, numZ, Boolean(inFight));
    res.json({ shrine: shrine ? shrine.id : null, lit: [...lit] });
  });

  app.post('/api/economy/loot/:pileId/claim', async (req: Request, res: Response) => {
    const pileId = String(req.params.pileId ?? '');
    if (!pileId) {
      res.status(400).json({ error: 'Missing pileId' });
      return;
    }

    // The claimer is always the signed-in player, never a name sent in the body.
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    if (heldByRoom(accountId, res)) return;
    const { x, z } = req.body || {};
    if (x === undefined || z === undefined) {
      res.status(400).json({ error: 'Missing x or z' });
      return;
    }

    const numX = Number(x);
    const numZ = Number(z);
    if (Number.isNaN(numX) || Number.isNaN(numZ)) {
      res.status(400).json({ error: 'Invalid coordinates x or z' });
      return;
    }

    try {
      const result = claimLootPile({
        pileId,
        accountId: String(accountId),
        x: numX,
        z: numZ,
      });
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Claim failed' });
    }
  });

  app.get('/api/economy/merchants/:merchantId/mind', (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    if (!merchantId) {
      res.status(400).json({ error: 'Missing merchantId' });
      return;
    }

    try {
      const mind = getMerchantMind(merchantId);
      if (!mind) {
        res.status(404).json({ error: 'Merchant not found' });
        return;
      }
      res.json(mind);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to query merchant mind' });
    }
  });

  app.get('/api/economy/director/today', (_req: Request, res: Response) => {
    try {
      res.json(getLatestDailyJudgeReport() ?? createDeterministicJudgeReport(1, Date.now(), 0, 0));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to query director report' });
    }
  });

  app.get('/api/economy/townsfolk/:npcId/mind', (req: Request, res: Response) => {
    const npcId = String(req.params.npcId ?? '');
    try {
      const state = getTownsfolkMindState(npcId);
      if (!state) {
        res.status(404).json({ error: 'Nobody by that name here' });
        return;
      }
      res.json(state);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to query townsfolk mind' });
    }
  });

  // The minds' working: which provider served each recent call and how fast, the budget pressure, the event queue.
  app.get('/api/economy/minds/telemetry', (_req: Request, res: Response) => {
    const { router, queue } = getAgentRuntime();
    res.json({
      calls: router.getRecentTelemetry().slice(-200),
      pressure: router.governor.getPressureLevel(),
      usage: router.governor.getUsageStats(),
      judge: router.nearAiAvailable() ? 'NEAR AI' : router.judgeAvailable() ? `free models (NEAR AI: ${router.offReason('nearai') ?? 'no key'})` : 'off',
      events: queue.stats,
    });
  });

  // Face to face: a player speaks to a keeper, a named townsperson or someone in the crowd.
  app.post('/api/economy/agents/:agentId/talk', async (req: Request, res: Response) => {
    const agentId = String(req.params.agentId ?? '').slice(0, 64);
    const token = extractToken(req);
    let accountId = `guest:${extractIp(req)}`;
    if (token) {
      const verified = await requireAccount(req, res);
      if (!verified) return;
      accountId = verified;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const crowd = body.crowd && typeof body.crowd === 'object' ? (body.crowd as Record<string, unknown>) : null;
    try {
      const result = await getAgentRuntime().conversations.talk({
        accountId,
        agentId,
        message: typeof body.message === 'string' ? body.message : '',
        intent: body.intent === 'haggle' ? 'haggle' : body.intent === 'gossip' ? 'gossip' : 'ask',
        itemType: typeof body.itemType === 'string' ? body.itemType.slice(0, 64) : undefined,
        offeredPrice: typeof body.offeredPrice === 'number' && Number.isFinite(body.offeredPrice) ? body.offeredPrice : undefined,
        crowd: crowd && typeof crowd.role === 'string' && typeof crowd.name === 'string' && typeof crowd.place === 'string'
          ? { role: crowd.role, name: crowd.name, place: crowd.place }
          : undefined,
      });
      if (!result) {
        res.status(404).json({ error: 'Nobody by that name here' });
        return;
      }
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Conversation failed' });
    }
  });

  // --- Shop Ownership endpoints (E4) ---

  app.get('/api/economy/shops/for-sale', (_req: Request, res: Response) => {
    try {
      const shops = getShopsForSale();
      res.json({ shops });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to query shops for sale',
      });
    }
  });

  // Who holds this shop, and what its purse holds. The account comes from the token.
  app.get('/api/economy/shops/:merchantId/ownership', async (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    const ownership = getShopOwnership(merchantId);
    const merchant = getMerchant(merchantId);
    res.json({
      merchantId,
      mine: ownership?.ownerId === accountId,
      ownerHandle: ownership ? ownership.ownerId.slice(0, 8) : null,
      purse: merchant?.balance ?? 0,
      priceMultipliers: ownership?.priceMultipliers ?? {},
      unpaidUpkeepDays: ownership?.unpaidUpkeepDays ?? 0,
    });
  });

  app.post('/api/economy/shops/:merchantId/buy', async (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    if (!merchantId) {
      res.status(400).json({ error: 'Missing merchantId' });
      return;
    }
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    try {
      const result = buyShop({
        merchantId,
        buyerAccountId: accountId,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to purchase shop',
      });
    }
  });

  app.post('/api/economy/shops/:merchantId/prices', async (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    if (!merchantId) {
      res.status(400).json({ error: 'Missing merchantId' });
      return;
    }
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    const multipliers = req.body?.multipliers ?? req.body?.prices;
    if (!multipliers || typeof multipliers !== 'object') {
      res.status(400).json({ error: 'Missing multipliers dictionary' });
      return;
    }

    try {
      const result = setShopPrices({
        merchantId,
        ownerAccountId: accountId,
        multipliers,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to set shop prices',
      });
    }
  });

  app.post('/api/economy/shops/:merchantId/stock', async (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    if (!merchantId) {
      res.status(400).json({ error: 'Missing merchantId' });
      return;
    }
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    const { itemType, quantity } = req.body || {};
    if (!itemType || typeof quantity !== 'number') {
      res.status(400).json({ error: 'Missing itemType or quantity' });
      return;
    }

    try {
      const result = stockShop({
        merchantId,
        ownerAccountId: accountId,
        itemType: String(itemType),
        quantity: Number(quantity),
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to stock shop',
      });
    }
  });

  // What the signed-in character wears. Read at boot, before the room holds the account, so the
  // hero is built in the right outfit; the room takes over once the player is in a zone.
  app.get('/api/economy/armour', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    res.json(wornLook(accountId));
  });

  app.post('/api/economy/armour', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (heldByRoom(accountId, res)) return;
    const raw = (req.body ?? {}) as { item?: unknown };
    const item = raw.item === null || raw.item === undefined ? null : typeof raw.item === 'string' ? raw.item : undefined;
    if (item === undefined) {
      res.status(400).json({ error: 'invalid_input' });
      return;
    }
    try {
      const worn = item === null
        ? takeOffArmour({ accountId })
        : wearArmour({ accountId, itemId: item });
      res.json(worn);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Refused' });
    }
  });

  app.get('/api/economy/satchel', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (accountId) res.json({ accountId, items: getSatchel(accountId) });
  });

  app.post('/api/economy/items/use', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : '';
    if (itemId !== 'potion') { res.status(400).json({ error: 'This item cannot be consumed' }); return; }
    try {
      removeItems({ accountId, to: 'world', stacks: [{ itemId, quantity: 1 }], reason: 'item_use' });
      res.json({ consumed: itemId, items: getSatchel(accountId) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Item could not be consumed' });
    }
  });

  app.post('/api/economy/shops/:merchantId/withdraw', async (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    if (!merchantId) {
      res.status(400).json({ error: 'Missing merchantId' });
      return;
    }
    const accountId = await requireAccount(req, res);
    if (!accountId) return;

    const amount =
      req.body?.amount !== undefined ? Number(req.body.amount) : undefined;

    try {
      const result = withdrawShopProfit({
        merchantId,
        ownerAccountId: accountId,
        amount,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to withdraw shop profit',
      });
    }
  });
}
