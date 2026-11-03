import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateShopPurchase,
  validatePriceMultiplier,
  validatePriceMultipliers,
  applyOwnerPriceMultiplier,
  checkShopSaleExpiry,
  checkUpkeepStatus,
  validateStockDeposit,
  validateWithdrawal,
  SHOPS_CONFIG,
} from '../src/economy/index.js';

test('Shop purchase validation: accepts valid buyer and enforces price, flags, bounties and limits', () => {
  const baseParams = {
    buyerAccountId: 'player_alice',
    shopId: 'sindr_shards',
    isClosedOrForSale: true,
    buyerBalance: 2500,
    hasRedFlag: false,
    hasBounty: false,
    currentlyOwnedCount: 0,
    salePrice: SHOPS_CONFIG.salePrice,
    maxPerPlayer: SHOPS_CONFIG.maxPerPlayer,
  };

  // Valid purchase
  const validRes = validateShopPurchase(baseParams);
  assert.equal(validRes.valid, true);

  // Shop is not closed / on sale
  const notForSale = validateShopPurchase({ ...baseParams, isClosedOrForSale: false });
  assert.equal(notForSale.valid, false);
  assert.match(notForSale.reason ?? '', /not currently closed/i);

  // Buyer has red flag
  const flagged = validateShopPurchase({ ...baseParams, hasRedFlag: true });
  assert.equal(flagged.valid, false);
  assert.match(flagged.reason ?? '', /red flag/i);

  // Buyer has active bounty
  const hunted = validateShopPurchase({ ...baseParams, hasBounty: true });
  assert.equal(hunted.valid, false);
  assert.match(hunted.reason ?? '', /bounty/i);

  // Buyer already owns a shop (maxPerPlayer = 1)
  const alreadyOwns = validateShopPurchase({ ...baseParams, currentlyOwnedCount: 1 });
  assert.equal(alreadyOwns.valid, false);
  assert.match(alreadyOwns.reason ?? '', /at most 1 shop/i);

  // Buyer has insufficient CHROMA
  const poor = validateShopPurchase({ ...baseParams, buyerBalance: 1999 });
  assert.equal(poor.valid, false);
  assert.match(poor.reason ?? '', /insufficient chroma/i);
});

test('Price multiplier validation: strictly enforces [0.6, 2.5] bounds', () => {
  // Boundary tests
  assert.equal(validatePriceMultiplier(0.6).valid, true);
  assert.equal(validatePriceMultiplier(1.0).valid, true);
  assert.equal(validatePriceMultiplier(1.5).valid, true);
  assert.equal(validatePriceMultiplier(2.5).valid, true);

  // Below min
  const tooLow = validatePriceMultiplier(0.59);
  assert.equal(tooLow.valid, false);
  assert.match(tooLow.reason ?? '', /outside allowed range/i);

  // Above max
  const tooHigh = validatePriceMultiplier(2.51);
  assert.equal(tooHigh.valid, false);
  assert.match(tooHigh.reason ?? '', /outside allowed range/i);

  // Non-finite
  assert.equal(validatePriceMultiplier(NaN).valid, false);
  assert.equal(validatePriceMultiplier(Infinity).valid, false);

  // Multiplier record validation
  const validBatch = validatePriceMultipliers({
    shard: 1.25,
    potion: 0.8,
    item: 2.0,
  });
  assert.equal(validBatch.valid, true);
  assert.deepEqual(validBatch.sanitized, {
    shard: 1.25,
    potion: 0.8,
    item: 2.0,
  });

  const invalidBatch = validatePriceMultipliers({
    shard: 1.2,
    potion: 3.5,
  });
  assert.equal(invalidBatch.valid, false);
  assert.match(invalidBatch.reason ?? '', /potion/i);
});

test('Owner price multiplier application: applies multiplier and generates quote step', () => {
  const baseQuote = 20;

  // Multiplier 1.5
  const result1 = applyOwnerPriceMultiplier(baseQuote, 1.5);
  assert.equal(result1.price, 30);
  assert.ok(result1.step);
  assert.equal(result1.step?.rule, 'owner_multiplier');
  assert.equal(result1.step?.effect, 0.5);
  assert.equal(result1.step?.words, 'The owner sets this price.');

  // Multiplier 0.7
  const result2 = applyOwnerPriceMultiplier(baseQuote, 0.7);
  assert.equal(result2.price, 14);
  assert.ok(result2.step);
  assert.equal(result2.step?.words, 'The owner sets this price.');

  // Undefined multiplier leaves base quote untouched
  const untouched = applyOwnerPriceMultiplier(baseQuote, undefined);
  assert.equal(untouched.price, 20);
  assert.equal(untouched.step, undefined);
});

test('Shop sale expiry: unsold shop expires after 3 game days', () => {
  assert.deepEqual(checkShopSaleExpiry({ daysOnSale: 0 }), { expired: false, remainingDays: 3 });
  assert.deepEqual(checkShopSaleExpiry({ daysOnSale: 1 }), { expired: false, remainingDays: 2 });
  assert.deepEqual(checkShopSaleExpiry({ daysOnSale: 2 }), { expired: false, remainingDays: 1 });
  assert.deepEqual(checkShopSaleExpiry({ daysOnSale: 3 }), { expired: true, remainingDays: 0 });
  assert.deepEqual(checkShopSaleExpiry({ daysOnSale: 5 }), { expired: true, remainingDays: 0 });
});

test('Upkeep status: forfeits shop ownership after 7 unpaid game days', () => {
  assert.deepEqual(checkUpkeepStatus({ unpaidDays: 0 }), { forfeited: false, remainingDays: 7 });
  assert.deepEqual(checkUpkeepStatus({ unpaidDays: 4 }), { forfeited: false, remainingDays: 3 });
  assert.deepEqual(checkUpkeepStatus({ unpaidDays: 6 }), { forfeited: false, remainingDays: 1 });
  assert.deepEqual(checkUpkeepStatus({ unpaidDays: 7 }), { forfeited: true, remainingDays: 0 });
  assert.deepEqual(checkUpkeepStatus({ unpaidDays: 10 }), { forfeited: true, remainingDays: 0 });
});

test('Stock deposit and profit withdrawal validation', () => {
  // Stock deposit
  assert.equal(validateStockDeposit({ itemType: 'shard', quantity: 25 }).valid, true);
  assert.equal(validateStockDeposit({ itemType: '', quantity: 25 }).valid, false);
  assert.equal(validateStockDeposit({ itemType: 'shard', quantity: 0 }).valid, false);
  assert.equal(validateStockDeposit({ itemType: 'shard', quantity: -5 }).valid, false);
  assert.equal(validateStockDeposit({ itemType: 'shard', quantity: 1.5 }).valid, false);

  // Profit withdrawal
  assert.equal(validateWithdrawal({ merchantBalance: 500, requestedAmount: 200 }).valid, true);
  assert.equal(validateWithdrawal({ merchantBalance: 500 }).valid, true);
  assert.equal(validateWithdrawal({ merchantBalance: 500 }).amount, 500);

  const overdraw = validateWithdrawal({ merchantBalance: 500, requestedAmount: 501 });
  assert.equal(overdraw.valid, false);
  assert.match(overdraw.reason ?? '', /only holds 500/i);

  const nonPositive = validateWithdrawal({ merchantBalance: 500, requestedAmount: 0 });
  assert.equal(nonPositive.valid, false);
});
