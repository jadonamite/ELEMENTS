import type { ClimbRefusal } from '../../../shared/src/growth/climb.js';
import { getServerUrl, getStoredAuthToken, isOfflineMode, hasGameServer } from '../auth/server-api.js';

// Calls to the economy server. Every call that moves coin or items is signed with the player's token;
// the server decides who is asking, never the request body.

export interface LootContents {
  chroma: number;
  shards: Record<string, number>;
  materials: Record<string, number>;
  gear?: Record<string, number>;
}

export interface LootPile {
  id: string;
  x: number;
  z: number;
  zone: string;
  contents: LootContents;
  ownerId: string | null;
  ownerUntil: number;
  expiresAt: number;
  claimed: boolean;
  nation?: string | null;
  source?: string | null;
}

export interface QuoteStep {
  rule: string;
  effect: number;
  words: string;
}

export interface Quote {
  unitPrice: number;
  totalPrice: number;
  canExecute: boolean;
  reason?: string;
  steps?: QuoteStep[];
  summary?: string;
}

export interface MerchantShelf {
  stock: number;
  maxStock: number;
  basePrice: number;
}

export interface Merchant {
  id: string;
  nation: string;
  balance: number;
  status: string;
  inventory: Record<string, MerchantShelf>;
}

export class EconomyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Economy is on when a game server exists and the player is not in explicit offline mode.
export function economyAvailable(): boolean {
  return hasGameServer() && !isOfflineMode();
}

export function isGuestSession(): boolean {
  return getStoredAuthToken() === null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!hasGameServer()) throw new EconomyError('Unavailable', 503);
  const token = getStoredAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${getServerUrl()}${path}`, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new EconomyError(body.error ?? `Request failed (${response.status})`, response.status);
  return body;
}

export async function fetchSatchel(): Promise<{ accountId: string; items: Record<string, number> }> {
  return call('/api/economy/satchel');
}

export async function fetchWornArmour(): Promise<{ item: string | null; outfit: string; armour: number }> {
  return call('/api/economy/armour');
}

export async function setWornArmour(item: string | null): Promise<{ item: string | null; outfit: string; armour: number }> {
  return call('/api/economy/armour', {
    method: 'POST',
    body: JSON.stringify({ item }),
  });
}

export async function fetchBalance(accountId: string): Promise<number> {
  const data = await call<{ balance: number }>(`/api/economy/balance/${encodeURIComponent(accountId)}`);
  return data.balance;
}

export async function listLoot(zone: string, x: number, z: number, r: number): Promise<LootPile[]> {
  const q = new URLSearchParams({ zone, x: x.toFixed(2), z: z.toFixed(2), r: String(r) });
  const data = await call<{ piles: LootPile[] }>(`/api/economy/loot?${q}`);
  return data.piles;
}

export async function claimLoot(pileId: string, x: number, z: number): Promise<{ contents: LootContents }> {
  return call(`/api/economy/loot/${encodeURIComponent(pileId)}/claim`, {
    method: 'POST',
    body: JSON.stringify({ x, z }),
  });
}

export async function reportKill(
  kind: string,
  x: number,
  z: number,
  zone: string,
  nation: string,
  enemyId?: string,
): Promise<{ pile: LootPile | null; releasedPiles?: LootPile[] }> {
  const data = await call<{ pile: LootPile | null; releasedPiles?: LootPile[] }>('/api/economy/loot/fight', {
    method: 'POST',
    body: JSON.stringify({ kind, x, z, zone, nation, enemyId }),
  });
  return data;
}

/** Where the player stands with the town watch, as the server holds it. */
export interface Standing {
  accountId?: string;
  redFlags: number;
  hasBounty: boolean;
}

/** A price the watch has put on a player's head, as the notice board reads it. */
export interface Bounty {
  id: string;
  targetAccountId: string;
  rewardChroma: number;
  reason: string;
  issuerId: string;
  issuedAt: number;
  status: 'open' | 'claimed' | 'pardoned';
}

export async function fetchOpenBounties(): Promise<Bounty[]> {
  const data = await call<{ bounties: Bounty[] }>('/api/economy/bounties');
  return data.bounties;
}

export async function fetchStanding(): Promise<Standing> {
  return call<Standing>('/api/economy/crime/standing');
}

/** The town watch saw the player brawling in the street: one red flag on the server. */
export async function reportBrawlSeen(): Promise<Standing & { convertedToBounty: boolean }> {
  return call('/api/economy/crime/brawl-seen', { method: 'POST', body: '{}' });
}

/** Where the player stands on the climb to their next tier, and their master's terms. */
export interface ClimbTerms {
  tier: number;
  next: number | null;
  wins: number;
  winsNeeded: number;
  qualified: boolean;
  master: string | null;
  fee: number;
  paid: boolean;
  feeRose: boolean;
  purse: number;
}

export type EnrolOutcome =
  | { outcome: 'accepted'; fee: number; next: number }
  | { outcome: 'refused'; reason: ClimbRefusal; fee: number };

export async function fetchClimb(): Promise<ClimbTerms> {
  return call('/api/climb');
}

/** Asks the master to take the player on for the next tier; the fee is paid if they do. */
export async function enrolClimb(): Promise<EnrolOutcome> {
  return call('/api/climb/enrol', { method: 'POST', body: '{}' });
}

/** The player won the trial they paid for; the server raises their tier. */
export async function reportTrialWon(): Promise<{ tier: number }> {
  return call('/api/climb/trial-won', { method: 'POST', body: '{}' });
}

/** What a Sentry did on seeing the player: fined each unfined red flag once, or nothing. */
export interface SentryFine {
  action: 'ignore' | 'fine' | 'arrest';
  amount: number;
  flags: number;
}

/** A Sentry at a post sees the player at (x, z); the server fines what is due. */
export async function reportSentrySaw(zone: string, x: number, z: number): Promise<SentryFine & Standing> {
  return call('/api/economy/crime/sentry-fine', { method: 'POST', body: JSON.stringify({ zone, x, z }) });
}

export async function reportDeath(
  x: number,
  z: number,
  zone: string,
  killer?: { id?: string; kind: string },
): Promise<LootPile | null> {
  const data = await call<{ pile: LootPile | null }>('/api/economy/death', {
    method: 'POST',
    body: JSON.stringify({ x, z, zone, killer }),
  });
  return data.pile;
}

export interface ShopOwnership {
  merchantId: string;
  mine: boolean;
  ownerHandle: string | null;
  purse: number;
  priceMultipliers: Record<string, number>;
  unpaidUpkeepDays: number;
}

export async function fetchShopOwnership(merchantId: string): Promise<ShopOwnership> {
  return call<ShopOwnership>(`/api/economy/shops/${encodeURIComponent(merchantId)}/ownership`);
}

export interface ShopForSale {
  merchantId: string;
  salePrice: number;
  daysOnSale: number;
  remainingDays: number;
}

export async function fetchShopsForSale(): Promise<ShopForSale[]> {
  const data = await call<{ shops: ShopForSale[] }>('/api/economy/shops/for-sale');
  return data.shops;
}

export async function buyShop(merchantId: string): Promise<{ success: boolean }> {
  return call(`/api/economy/shops/${encodeURIComponent(merchantId)}/buy`, { method: 'POST', body: '{}' });
}

export async function withdrawShopProfit(merchantId: string, amount?: number): Promise<{ amount: number }> {
  return call(`/api/economy/shops/${encodeURIComponent(merchantId)}/withdraw`, {
    method: 'POST',
    body: JSON.stringify(amount === undefined ? {} : { amount }),
  });
}

export async function setShopPrices(merchantId: string, multipliers: Record<string, number>): Promise<{ multipliers: Record<string, number> }> {
  return call(`/api/economy/shops/${encodeURIComponent(merchantId)}/prices`, {
    method: 'POST',
    body: JSON.stringify({ multipliers }),
  });
}

export async function fetchMerchant(merchantId: string): Promise<Merchant> {
  const data = await call<{ merchant: Merchant }>(`/api/economy/merchants/${encodeURIComponent(merchantId)}`);
  return data.merchant;
}

export interface MerchantMind {
  merchantId: string;
  latestThought: string;
  lastDecision: string;
  actions: Array<{ action: unknown; reasoning?: string; timestamp: number }>;
  purse: number;
  open: boolean;
  status: string;
}

export async function fetchMerchantMind(merchantId: string): Promise<MerchantMind> {
  return call<MerchantMind>(`/api/economy/merchants/${encodeURIComponent(merchantId)}/mind`);
}

export async function fetchQuote(
  merchantId: string,
  itemType: string,
  action: 'buy' | 'sell',
  quantity: number,
): Promise<Quote> {
  const q = new URLSearchParams({ itemType, action, quantity: String(quantity) });
  const data = await call<{ quote: Quote }>(`/api/economy/merchants/${encodeURIComponent(merchantId)}/quote?${q}`);
  return data.quote;
}

export async function buy(merchantId: string, itemType: string, quantity: number): Promise<{ totalPrice: number; itemId: string }> {
  const data = await call<{ result: { totalPrice: number; itemId: string } }>('/api/economy/merchants/buy', {
    method: 'POST',
    body: JSON.stringify({ merchantId, itemType, quantity }),
  });
  return data.result;
}

export async function sell(merchantId: string, itemType: string, quantity: number): Promise<{ totalPrice: number }> {
  const data = await call<{ result: { totalPrice: number } }>('/api/economy/merchants/sell', {
    method: 'POST',
    body: JSON.stringify({ merchantId, itemType, quantity }),
  });
  return data.result;
}

// Gives a new player their starting purse; does nothing after the first time.
export async function claimStartingPurse(): Promise<void> {
  await call('/api/economy/grant-starting-purse', { method: 'POST', body: '{}' });
}

export interface CountingHouseNote {
  noteId: string;
  accountId: string;
  amount: number;
  issuedAt: number;
  issuedBy: string;
  status: 'active' | 'redeemed' | 'cancelled';
}

export async function depositCountingHouse(countingHouseId: string, amount: number): Promise<{ note: CountingHouseNote }> {
  return call('/api/economy/counting-house/deposit', {
    method: 'POST',
    body: JSON.stringify({ countingHouseId, amount }),
  });
}

export async function withdrawCountingHouse(countingHouseId: string, noteId: string): Promise<{ withdrawnAmount: number; note: CountingHouseNote }> {
  return call('/api/economy/counting-house/withdraw', {
    method: 'POST',
    body: JSON.stringify({ countingHouseId, noteId }),
  });
}

export async function fetchAccountNotes(accountId: string): Promise<CountingHouseNote[]> {
  const data = await call<{ notes: CountingHouseNote[] }>(`/api/economy/counting-house/notes/${encodeURIComponent(accountId)}`);
  return data.notes;
}

export interface DailyChronicle {
  dayNumber: number;
  title: string;
  headline: string;
  paragraphs: string[];
  shortNotices: string[];
  writtenAt: number;
}

export async function fetchDailyChronicle(): Promise<DailyChronicle | null> {
  try {
    const report = await call<{ chronicle?: DailyChronicle }>('/api/economy/director/today');
    return report.chronicle ?? null;
  } catch {
    return null;
  }
}

export interface ConversationOutcome {
  agentId: string;
  agentName: string;
  reply: string;
  thinkingBeat: string;
  memoryScore: number;
  /** Which provider wrote the reply, or 'written'. */
  source: string;
  haggleOutcome?: {
    success: boolean;
    agreedPrice?: number;
    reason: string;
  };
}

export async function talkToAgent(
  agentId: string,
  message: string,
  options: {
    intent?: 'ask' | 'haggle' | 'gossip';
    itemType?: string;
    offeredPrice?: number;
    /** Someone from the crowd, who exists only in the browser: their trade, name and zone. */
    crowd?: { role: string; name: string; place: string };
  } = {},
): Promise<ConversationOutcome> {
  return call(`/api/economy/agents/${encodeURIComponent(agentId)}/talk`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      intent: options.intent ?? 'ask',
      itemType: options.itemType,
      offeredPrice: options.offeredPrice,
      crowd: options.crowd,
    }),
  });
}
