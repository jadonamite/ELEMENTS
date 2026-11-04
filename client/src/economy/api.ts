import { getServerUrl, getStoredAuthToken, isOfflineMode } from '../auth/server-api.js';

// Calls to the economy server. Every call that moves coin or items is signed with the player's token;
// the server decides who is asking, never the request body.

export interface LootContents {
  chroma: number;
  shards: Record<string, number>;
  materials: Record<string, number>;
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

// Economy is on when the player is signed in and not playing offline.
export function economyAvailable(): boolean {
  return !isOfflineMode() && getStoredAuthToken() !== null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export async function reportKill(kind: string, x: number, z: number, zone: string, nation: string): Promise<LootPile | null> {
  const data = await call<{ pile: LootPile | null }>('/api/economy/loot/fight', {
    method: 'POST',
    body: JSON.stringify({ kind, x, z, zone, nation }),
  });
  return data.pile;
}

/** Where the player stands with the town watch, as the server holds it. */
export interface Standing {
  redFlags: number;
  hasBounty: boolean;
}

export async function fetchStanding(): Promise<Standing> {
  return call<Standing>('/api/economy/crime/standing');
}

/** The town watch saw the player brawling in the street: one red flag on the server. */
export async function reportBrawlSeen(): Promise<Standing & { convertedToBounty: boolean }> {
  return call('/api/economy/crime/brawl-seen', { method: 'POST', body: '{}' });
}

export async function reportDeath(x: number, z: number, zone: string): Promise<LootPile | null> {
  const data = await call<{ pile: LootPile | null }>('/api/economy/death', {
    method: 'POST',
    body: JSON.stringify({ x, z, zone }),
  });
  return data.pile;
}

export async function fetchMerchant(merchantId: string): Promise<Merchant> {
  const data = await call<{ merchant: Merchant }>(`/api/economy/merchants/${encodeURIComponent(merchantId)}`);
  return data.merchant;
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
