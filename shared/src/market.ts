import { sessionGrantBytes } from './sessionGrant.js';

import { calculateTradeTax } from './economy/trade.js';

/** The verifier takes no fee of its own; the game's trade tax is a signed payment to the treasury. */
export const MARKET_RULES = { feePips: 0, offerLifetimeMs: 300_000 } as const;
export interface MarketIntent { intent: string; [key: string]: unknown }
export interface SignedMarketIntent {
  standard: 'nep413';
  payload: { message: string; nonce: string; recipient: string };
  public_key: string;
  signature: string;
}
export interface MarketTerms { signer_id: string; deadline: string; intents: MarketIntent[] }

function wholeAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a positive whole amount');
}

/** The buyer's tax on a board trade: the Dim rate, or the Lit-to-Lit rate when both sides are Lit. */
export function marketTax(price: number, litPair: boolean): number {
  wholeAmount(price);
  return calculateTradeTax(price, 'Shaper', litPair ? 'Shaper' : 'Hush').taxAmount;
}

/** What a trade moves: the items whole, the price to the seller, the tax from the buyer to the treasury. */
export function marketQuote(item: string, quantity: number, price: number, litPair = false) {
  wholeAmount(quantity);
  const tax = marketTax(price, litPair);
  return { item, quantity, price, tax, buyerPays: price + tax };
}

export function offerIntents(side: 'sell' | 'buy', itemToken: string, coinToken: string, quantity: number, price: number, treasury: string, litPair: boolean): MarketIntent[] {
  const quote = marketQuote(itemToken, quantity, price, litPair);
  if (side === 'sell') return [{ intent: 'token_diff', diff: { [itemToken]: String(-quantity), [coinToken]: String(price) } }];
  return [
    { intent: 'token_diff', diff: { [itemToken]: String(quantity), [coinToken]: String(-price) } },
    { intent: 'transfer', receiver_id: treasury, tokens: { [coinToken]: String(quote.tax) } },
  ];
}
export function marketSigningBytes(payload: SignedMarketIntent['payload']): Uint8Array {
  const nonce = Uint8Array.from(atob(payload.nonce), c => c.charCodeAt(0));
  return sessionGrantBytes({ ...payload, nonce: [...nonce], callback_url: null });
}
export function marketPayload(signer: string, contract: string, salt: string, intents: MarketIntent[], now = Date.now()): SignedMarketIntent['payload'] {
  if (!/^[a-f0-9]{8}$/i.test(salt)) throw new Error('Invalid verifier salt');
  const deadline = now + MARKET_RULES.offerLifetimeMs;
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  nonce.set([0x56, 0x28, 0xf6, 0xc6, 0]);
  nonce.set(Uint8Array.from(salt.match(/../g)!, byte => parseInt(byte, 16)), 5);
  new DataView(nonce.buffer).setBigUint64(9, BigInt(deadline) * 1_000_000n, true);
  return { message: JSON.stringify({ signer_id: signer, deadline: new Date(deadline).toISOString(), intents }), recipient: contract, nonce: btoa(String.fromCharCode(...nonce)) };
}
