import express, { type Application, type Request, type Response } from 'express';
import { verifyToken } from './auth.js';
import { createOrGetAccount, createOrGetRising, getRising } from './db.js';
import { isAccountAllowed, isIpAllowed } from './rate-limit.js';
import { isOutsider } from './net/money.js';
import { isInRoom, isZoneOnline } from './net/presence.js';
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
  getStanding,
  listLootPiles,
  claimLootPile,
  getMerchantMind,
  getShopsForSale,
  buyShop,
  setShopPrices,
  stockShop,
  withdrawShopProfit,
  getSatchel,
  clientKillsAllowed,
  dropFromClientKill,
  createLootPileFromFight,
} from './economy/index.js';

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

function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
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
      rising: stored
        ? {
            role: stored.role,
            element: stored.element ?? null,
          }
        : null,
    });
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

    const rising = createOrGetRising(accountId);

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
    if (accountId) res.json(getStanding(accountId));
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
    res.json({ convertedToBounty: result.convertedToBounty, ...getStanding(accountId) });
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
    const { kind, x, z, zone, nation } = req.body || {};
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
      const pile = dropFromClientKill({
        accountId,
        kind,
        x: numX,
        z: numZ,
        zone,
        nation: typeof nation === 'string' ? nation : undefined,
      });
      res.json({ pile });
    } catch (err: unknown) {
      res.status(429).json({ error: err instanceof Error ? err.message : 'Drop failed' });
    }
  });

  // The signed-in player died: what they carried (per the server) falls where they fell.
  app.post('/api/economy/death', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (!accountId) return;
    if (heldByRoom(accountId, res)) return;
    const { x, z, zone } = req.body || {};
    const numX = Number(x);
    const numZ = Number(z);
    if (typeof zone !== 'string' || !Number.isFinite(numX) || !Number.isFinite(numZ)) {
      res.status(400).json({ error: 'Missing zone, x or z' });
      return;
    }
    try {
      const pile = createLootPileFromFight({
        x: numX,
        z: numZ,
        zone,
        source: 'player_death',
        sourceAccountId: accountId,
      });
      res.json({ pile });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Death drop failed' });
    }
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

  app.get('/api/economy/satchel', async (req: Request, res: Response) => {
    const accountId = await requireAccount(req, res);
    if (accountId) res.json({ accountId, items: getSatchel(accountId) });
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
