import express, { type Application, type Request, type Response } from 'express';
import { verifyToken } from './auth.js';
import { createOrGetAccount, createOrGetRising, getRising } from './db.js';
import { isAccountAllowed, isIpAllowed } from './rate-limit.js';
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
  claimBounty,
  pardonBounty,
  getActiveRedFlags,
  addRedFlag,
  processJailSentence,
  executePlayerTrade,
  listLootPiles,
  claimLootPile,
  getMerchantMind,
  getShopsForSale,
  buyShop,
  setShopPrices,
  stockShop,
  withdrawShopProfit,
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

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }

    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    if (!isAccountAllowed(verified.userId)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    createOrGetAccount(verified.userId);
    const stored = getRising(verified.userId);

    res.json({
      accountId: verified.userId,
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

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }

    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    if (!isAccountAllowed(verified.userId)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const rising = createOrGetRising(verified.userId);

    res.json({
      accountId: verified.userId,
      role: rising.role,
      element: rising.element ?? null,
      rising: {
        role: rising.role,
        element: rising.element ?? null,
      },
    });
  });

  // --- Economy endpoints (M5) ---

  app.get('/api/economy/balance/:accountId', (req: Request, res: Response) => {
    const accountId = String(req.params.accountId ?? '');
    if (!accountId) {
      res.status(400).json({ error: 'Missing accountId' });
      return;
    }
    const balance = getAccountBalance(accountId);
    res.json({ accountId, balance });
  });

  app.post('/api/economy/grant-starting-purse', async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const grant = grantPlayerStartingPurse(verified.userId);
    const balance = getAccountBalance(verified.userId);
    res.json({ accountId: verified.userId, granted: !!grant, balance, grant });
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

  app.get('/api/economy/merchants/:merchantId/quote', (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    const itemType = String(req.query.itemType || '');
    const action = req.query.action === 'sell' ? 'sell' : 'buy';
    const quantity = Math.max(1, parseInt(String(req.query.quantity || '1'), 10) || 1);
    const isOutsider = req.query.isOutsider === 'true';
    const buyerAccountId = req.query.accountId ? String(req.query.accountId) : undefined;

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
    if (isOutsider) quoteParams.isOutsider = true;
    if (buyerAccountId) quoteParams.buyerAccountId = buyerAccountId;

    const quote = quoteMerchantTrade(quoteParams);
    res.json({ quote });
  });

  app.post('/api/economy/merchants/buy', async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const { merchantId, itemType, quantity, isOutsider } = req.body || {};
    try {
      const buyParams: {
        merchantId: string;
        buyerAccountId: string;
        itemType: string;
        quantity: number;
        isOutsider?: boolean;
      } = {
        merchantId,
        buyerAccountId: verified.userId,
        itemType,
        quantity: quantity ?? 1,
      };
      if (isOutsider) buyParams.isOutsider = true;

      const result = buyFromMerchant(buyParams);
      res.json({ success: true, result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Buy failed' });
    }
  });

  app.post('/api/economy/merchants/sell', async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const { merchantId, itemType, quantity, isOutsider } = req.body || {};
    try {
      const sellParams: {
        merchantId: string;
        sellerAccountId: string;
        itemType: string;
        quantity: number;
        isOutsider?: boolean;
      } = {
        merchantId,
        sellerAccountId: verified.userId,
        itemType,
        quantity: quantity ?? 1,
      };
      if (isOutsider) sellParams.isOutsider = true;

      const result = sellToMerchant(sellParams);
      res.json({ success: true, result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Sell failed' });
    }
  });

  app.post('/api/economy/counting-house/deposit', async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const { amount, countingHouseId } = req.body || {};
    try {
      const note = depositToCountingHouse({
        accountId: verified.userId,
        amount,
        countingHouseId,
      });
      res.json({ success: true, note });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Deposit failed' });
    }
  });

  app.post('/api/economy/counting-house/withdraw', async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const { noteId, countingHouseId } = req.body || {};
    try {
      const result = withdrawFromCountingHouse({
        accountId: verified.userId,
        noteId,
        countingHouseId,
      });
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Withdrawal failed' });
    }
  });

  app.get('/api/economy/counting-house/notes/:accountId', (req: Request, res: Response) => {
    const accountId = String(req.params.accountId ?? '');
    const notes = getAccountNotes(accountId);
    res.json({ notes });
  });

  app.get('/api/economy/bounties', (_req: Request, res: Response) => {
    const bounties = getOpenBounties();
    res.json({ bounties });
  });

  app.post('/api/economy/bounties/claim', async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const { bountyId } = req.body || {};
    try {
      const bounty = claimBounty({ bountyId, claimantId: verified.userId });
      res.json({ success: true, bounty });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Bounty claim failed' });
    }
  });

  app.post('/api/economy/bounties/pardon', async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const { bountyId } = req.body || {};
    try {
      const bounty = pardonBounty({ bountyId, payerId: verified.userId });
      res.json({ success: true, bounty });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Bounty pardon failed' });
    }
  });

  app.get('/api/economy/crime/flags/:accountId', (req: Request, res: Response) => {
    const accountId = String(req.params.accountId ?? '');
    const flags = getActiveRedFlags(accountId);
    res.json({ flags });
  });

  app.post('/api/economy/crime/flag', (req: Request, res: Response) => {
    const { accountId, reason } = req.body || {};
    if (!accountId || !reason) {
      res.status(400).json({ error: 'Missing accountId or reason' });
      return;
    }
    const result = addRedFlag(accountId, reason);
    res.json({ success: true, ...result });
  });

  app.post('/api/economy/crime/jail', (req: Request, res: Response) => {
    const { accountId, vaultChroma, materialsCount, gearCount, hasLand } = req.body || {};
    if (!accountId) {
      res.status(400).json({ error: 'Missing accountId' });
      return;
    }
    const result = processJailSentence({
      accountId,
      vaultChroma: vaultChroma ?? 0,
      materialsCount: materialsCount ?? 0,
      gearCount: gearCount ?? 0,
      hasLand: !!hasLand,
    });
    res.json({ success: true, seizure: result });
  });

  app.post('/api/economy/trade', async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const { sellerId, amount, refId } = req.body || {};
    try {
      const trade = executePlayerTrade({
        buyerId: verified.userId,
        sellerId,
        amount,
        refId,
      });
      res.json({ success: true, ...trade });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Trade failed' });
    }
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

  app.post('/api/economy/loot/:pileId/claim', async (req: Request, res: Response) => {
    const pileId = String(req.params.pileId ?? '');
    if (!pileId) {
      res.status(400).json({ error: 'Missing pileId' });
      return;
    }

    // The claimer is always the signed-in player, never a name sent in the body.
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let accountId: string;
    try {
      accountId = (await verifyToken(token)).userId;
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

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
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    try {
      const result = buyShop({
        merchantId,
        buyerAccountId: verified.userId,
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
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const multipliers = req.body?.multipliers ?? req.body?.prices;
    if (!multipliers || typeof multipliers !== 'object') {
      res.status(400).json({ error: 'Missing multipliers dictionary' });
      return;
    }

    try {
      const result = setShopPrices({
        merchantId,
        ownerAccountId: verified.userId,
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
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    // Refused until the server records what each player carries: without that record,
    // stocking would create goods from nothing.
    void merchantId;
    void verified;
    res.status(501).json({ error: 'Shop stocking is not open yet' });
  });

  app.post('/api/economy/shops/:merchantId/withdraw', async (req: Request, res: Response) => {
    const merchantId = String(req.params.merchantId ?? '');
    if (!merchantId) {
      res.status(400).json({ error: 'Missing merchantId' });
      return;
    }
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }
    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const amount =
      req.body?.amount !== undefined ? Number(req.body.amount) : undefined;

    try {
      const result = withdrawShopProfit({
        merchantId,
        ownerAccountId: verified.userId,
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
