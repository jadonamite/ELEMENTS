import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTAL_CHROMA_SUPPLY,
  TREASURY_ACCOUNT_ID,
  INITIAL_BALANCES,
  MERCHANT_ACCOUNT_IDS,
  MASTER_ACCOUNT_IDS,
  RIVAL_GUILD_ACCOUNT_ID,
  COUNTING_HOUSES,
  createGenesisEntries,
  deriveBalances,
  computeTotalSupply,
  validateLedgerEntry,
  applyLedgerEntry,
  calculateTreasuryPayout,
  calculateMerchantPrice,
  calculateQuote,
  updateMerchantSolvency,
  applyMerchantBailout,
  canAccessCountingHouse,
  createDepositNote,
  validateNoteRedemption,
  evaluateRedFlagThreshold,
  calculateJailSeizure,
  processRobberyWitness,
  calculateTradeTax,
  adjustNpcMemory,
  getNpcDisposition,
  getNpcPriceMultiplier,
  calculateWorldDeathDrop,
  calculateDuelOrStoryLoss,
  calculateVillainDrop,
  evaluateSentryAction,
  recordDemand,
  demandFactor,
  calculateDemandFactor,
  calculateColorBalanceFactor,
  GAME_HOUR_MS,
  canClaim,
  createLootPile,
  monsterDrop,
  villainDrop,
  deathDrop,
  calculateDeathDropResolution,
  createEmptyShards,
  DROPS_CONFIG,
  DEATH_CONFIG,
  type LedgerEntry,
  type MerchantState,
  type RedFlag,
} from '../src/economy/index.js';

test('Genesis supply invariant: 10,000,000 CHROMA created once across treasury, merchants, masters and guild', () => {
  const genesisEntries = createGenesisEntries();
  const balances = deriveBalances(genesisEntries);

  assert.equal(computeTotalSupply(balances), TOTAL_CHROMA_SUPPLY);
  assert.equal(balances.get(TREASURY_ACCOUNT_ID), INITIAL_BALANCES.treasury);

  for (const merchantId of MERCHANT_ACCOUNT_IDS) {
    assert.equal(balances.get(merchantId), INITIAL_BALANCES.merchantPerStore);
  }
  for (const masterId of MASTER_ACCOUNT_IDS) {
    assert.equal(balances.get(masterId), INITIAL_BALANCES.masterPerNation);
  }
  assert.equal(balances.get(RIVAL_GUILD_ACCOUNT_ID), INITIAL_BALANCES.rivalGuild);
});

test('Ledger validation: rejects invalid amounts, self transfers, and overspending while preserving total supply', () => {
  const genesis = createGenesisEntries();
  const balances = deriveBalances(genesis);

  // Negative amount
  const invalidNegative: LedgerEntry = {
    id: 'e1',
    from: TREASURY_ACCOUNT_ID,
    to: 'player1',
    amount: -10,
    reason: 'player_starting_grant',
    timestamp: Date.now(),
  };
  const negCheck = validateLedgerEntry(balances, invalidNegative);
  assert.equal(negCheck.valid, false);

  // Self transfer
  const selfTransfer: LedgerEntry = {
    id: 'e2',
    from: TREASURY_ACCOUNT_ID,
    to: TREASURY_ACCOUNT_ID,
    amount: 100,
    reason: 'player_starting_grant',
    timestamp: Date.now(),
  };
  const selfCheck = validateLedgerEntry(balances, selfTransfer);
  assert.equal(selfCheck.valid, false);

  // Overspend
  const overspend: LedgerEntry = {
    id: 'e3',
    from: RIVAL_GUILD_ACCOUNT_ID,
    to: 'player1',
    amount: 999_999_999,
    reason: 'trade_payment',
    timestamp: Date.now(),
  };
  const overCheck = validateLedgerEntry(balances, overspend);
  assert.equal(overCheck.valid, false);

  // Valid player grant from treasury
  const validGrant: LedgerEntry = {
    id: 'e4',
    from: TREASURY_ACCOUNT_ID,
    to: 'player1',
    amount: 100,
    reason: 'player_starting_grant',
    timestamp: Date.now(),
  };
  const validCheck = validateLedgerEntry(balances, validGrant);
  assert.equal(validCheck.valid, true);

  applyLedgerEntry(balances, validGrant);
  assert.equal(balances.get('player1'), 100);
  assert.equal(balances.get(TREASURY_ACCOUNT_ID), INITIAL_BALANCES.treasury - 100);
  assert.equal(computeTotalSupply(balances), TOTAL_CHROMA_SUPPLY);
});

test('Treasury payout: scales dynamically with treasury balance', () => {
  const baseReward = 30;

  // At baseline 7M, payout equals base
  assert.equal(calculateTreasuryPayout(baseReward, 7_000_000), 30);

  // At halved balance 3.5M, payout is halved
  assert.equal(calculateTreasuryPayout(baseReward, 3_500_000), 15);

  // Settled around 3.9M
  const settledPayout = calculateTreasuryPayout(baseReward, 3_900_000);
  assert.equal(settledPayout, Math.round(30 * (3.9 / 7)));

  // If treasury reaches zero or negative, payout is zero
  assert.equal(calculateTreasuryPayout(baseReward, 0), 0);
  assert.equal(calculateTreasuryPayout(baseReward, -100), 0);
});

test('Merchant pricing: price formula runs from 1x base at max stock to 3x base at zero stock', () => {
  const basePrice = 10;
  const maxStock = 200;

  // Full stock: scarcity 0, factor 1.0 => basePrice
  assert.equal(calculateMerchantPrice(basePrice, 200, maxStock), 10);

  // Half stock: scarcity 0.5, factor 1 + 2(0.5) = 2.0 => 20
  assert.equal(calculateMerchantPrice(basePrice, 100, maxStock), 20);

  // Empty stock: scarcity 1.0, factor 1 + 2(1.0) = 3.0 => 30
  assert.equal(calculateMerchantPrice(basePrice, 0, maxStock), 30);
});

test('Merchant quotes: apply outsider surcharge and discount, plus NPC memory scores', () => {
  const quoteParams = {
    itemType: 'shard',
    action: 'buy' as const,
    stock: 200,
    maxStock: 200,
    basePrice: 10,
    isOutsider: false,
  };

  // Local citizen at full stock
  const citizenQuote = calculateQuote(quoteParams);
  assert.equal(citizenQuote.unitPrice, 10);

  // Outsider pays 20% more on buy
  const outsiderQuote = calculateQuote({ ...quoteParams, isOutsider: true });
  assert.equal(outsiderQuote.unitPrice, 12);

  // Friendly citizen (memory score +80) gets discount
  const friendlyQuote = calculateQuote({ ...quoteParams, npcMemoryScore: 80 });
  assert.ok(friendlyQuote.unitPrice <= 10);

  // Hostile citizen (memory score -80) pays penalty
  const hostileQuote = calculateQuote({ ...quoteParams, npcMemoryScore: -80 });
  assert.ok(hostileQuote.unitPrice > 10);
});

test('Merchant solvency: pauses buying under 1,000 CHROMA and closes after 3 days; bailout revives', () => {
  const initialMerchant: MerchantState = {
    id: 'merchant_ignis',
    nation: 'IGNIS',
    balance: 800,
    status: 'open',
    daysBroke: 0,
    inventory: {
      shard: { stock: 100, maxStock: 200, basePrice: 10 },
    },
  };

  // Balance under 1,000 immediately pauses buying
  const step1 = updateMerchantSolvency(initialMerchant, false);
  assert.equal(step1.state.status, 'broke_buying_paused');
  assert.equal(step1.state.daysBroke, 0);

  // Day 1
  const day1 = updateMerchantSolvency(step1.state, true);
  assert.equal(day1.state.daysBroke, 1);
  assert.equal(day1.state.status, 'broke_buying_paused');

  // Day 2
  const day2 = updateMerchantSolvency(day1.state, true);
  assert.equal(day2.state.daysBroke, 2);

  // Day 3 triggers complete closure
  const day3 = updateMerchantSolvency(day2.state, true);
  assert.equal(day3.state.daysBroke, 3);
  assert.equal(day3.state.status, 'closed');

  // Treasury bailout restores 100,000 CHROMA and reopens store
  const revived = applyMerchantBailout(day3.state);
  assert.equal(revived.status, 'open');
  assert.equal(revived.daysBroke, 0);
  assert.equal(revived.balance, 800 + 100_000);
});

test('Counting houses: sealed notes redeemable anywhere, refused for marked players or bounties', () => {
  const chA = COUNTING_HOUSES[0].id; // bank_chromara_main
  const chB = COUNTING_HOUSES[4].id; // ch_ignis_sindr_upper

  // Clean player can access
  const cleanAccess = canAccessCountingHouse({ hasActiveRedFlag: false, hasActiveBounty: false });
  assert.equal(cleanAccess.allowed, true);

  // Marked player with red flag is refused
  const flaggedAccess = canAccessCountingHouse({ hasActiveRedFlag: true, hasActiveBounty: false });
  assert.equal(flaggedAccess.allowed, false);
  assert.ok(flaggedAccess.reason?.includes('red flag'));

  // Player with bounty is refused
  const bountyAccess = canAccessCountingHouse({ hasActiveRedFlag: false, hasActiveBounty: true });
  assert.equal(bountyAccess.allowed, false);
  assert.ok(bountyAccess.reason?.includes('bounty'));

  // Deposit at Chromara Bank
  const note = createDepositNote({
    noteId: 'note_001',
    accountId: 'player_alice',
    amount: 500,
    countingHouseId: chA,
  });
  assert.equal(note.status, 'active');
  assert.equal(note.amount, 500);

  // Redeem at Sindr Upper Ledger
  const validRedeem = validateNoteRedemption({
    note,
    redeemingAccountId: 'player_alice',
    countingHouseId: chB,
    hasActiveRedFlag: false,
    hasActiveBounty: false,
  });
  assert.equal(validRedeem.valid, true);

  // Mismatched bearer fails
  const impostorRedeem = validateNoteRedemption({
    note,
    redeemingAccountId: 'player_bob',
    countingHouseId: chB,
    hasActiveRedFlag: false,
    hasActiveBounty: false,
  });
  assert.equal(impostorRedeem.valid, false);
});

test('Crime: 3 red flags convert to a bounty; robbery witnessing triggers bounty', () => {
  const now = Date.now();
  const f1: RedFlag = {
    id: 'f1',
    accountId: 'thief1',
    reason: 'Speaking unapproved name',
    issuedAt: now - 1000,
    expiresAt: now + 100000,
    active: true,
  };
  const f2: RedFlag = {
    id: 'f2',
    accountId: 'thief1',
    reason: 'Brawling in town',
    issuedAt: now - 500,
    expiresAt: now + 100000,
    active: true,
  };
  const f3: RedFlag = {
    id: 'f3',
    accountId: 'thief1',
    reason: 'Street disturbance',
    issuedAt: now,
    expiresAt: now + 100000,
    active: true,
  };

  const evalThreshold = evaluateRedFlagThreshold([f1, f2], f3, now);
  assert.equal(evalThreshold.convertedToBounty, true);
  assert.ok(evalThreshold.bounty);
  assert.equal(evalThreshold.bounty.targetAccountId, 'thief1');
  assert.equal(evalThreshold.flagsToRetain.every((f) => !f.active), true);

  // Unwitnessed robbery gives red flag only
  const unwitnessed = processRobberyWitness({
    robberId: 'thief1',
    victimId: 'merchant_ignis',
    isWitnessedBySentry: false,
    stolenAmount: 100,
    now,
  });
  assert.ok(unwitnessed.flag);
  assert.equal(unwitnessed.bounty, undefined);

  // Sentry witnessed robbery immediately places a bounty
  const witnessed = processRobberyWitness({
    robberId: 'thief1',
    victimId: 'merchant_ignis',
    isWitnessedBySentry: true,
    stolenAmount: 100,
    now,
  });
  assert.ok(witnessed.flag);
  assert.ok(witnessed.bounty);
  assert.equal(witnessed.bounty.targetAccountId, 'thief1');
});

test('Jail seizure: seizes 40% of CHROMA, vault, materials and gear; land is NEVER seized', () => {
  const assets = {
    chroma: 1000,
    vaultChroma: 2000,
    materialsCount: 50,
    gearCount: 10,
    hasLand: true,
  };

  const seizure = calculateJailSeizure(assets);

  assert.equal(seizure.seizedChroma, 400); // 40% of 1000
  assert.equal(seizure.remainingChroma, 600);

  assert.equal(seizure.seizedVaultChroma, 800); // 40% of 2000
  assert.equal(seizure.remainingVaultChroma, 1200);

  assert.equal(seizure.seizedMaterialsCount, 20); // 40% of 50
  assert.equal(seizure.remainingMaterialsCount, 30);

  assert.equal(seizure.seizedGearCount, 4); // 40% of 10
  assert.equal(seizure.remainingGearCount, 6);

  assert.equal(seizure.landSeized, 0); // Land is immune
  assert.equal(seizure.fineToLeave, 50);
});

test('Trade tax: Lit-to-Lit is taxed at 20%; trades with Dim taxed at 5%', () => {
  // Lit to Lit trade of 100 CHROMA
  const litTrade = calculateTradeTax(100, 'Shaper', 'Shaper');
  assert.equal(litTrade.taxRate, 0.2);
  assert.equal(litTrade.taxAmount, 20);
  assert.equal(litTrade.sellerReceives, 80);

  // Lit to Dim (Hush) trade of 100 CHROMA
  const dimTrade1 = calculateTradeTax(100, 'Shaper', 'Hush');
  assert.equal(dimTrade1.taxRate, 0.05);
  assert.equal(dimTrade1.taxAmount, 5);
  assert.equal(dimTrade1.sellerReceives, 95);

  // Dim (Vakna) to Lit trade of 100 CHROMA
  const dimTrade2 = calculateTradeTax(100, 'Vakna', 'Shaper');
  assert.equal(dimTrade2.taxRate, 0.05);
  assert.equal(dimTrade2.taxAmount, 5);
  assert.equal(dimTrade2.sellerReceives, 95);
});

test('NPC memory: scores adjust within [-100, 100] and govern disposition and pricing', () => {
  const npcId = 'master_ignis';
  const player = 'player_ignis_novice';

  // Starting neutral
  const m0 = adjustNpcMemory(null, 15, npcId, player);
  assert.equal(m0.score, 15);
  assert.equal(getNpcDisposition(m0.score), 'neutral');

  // Repeated favours push to friendly
  const m1 = adjustNpcMemory(m0, 25, npcId, player);
  assert.equal(m1.score, 40);
  assert.equal(getNpcDisposition(m1.score), 'friendly');

  // Cheating / theft severely damages score
  const m2 = adjustNpcMemory(m1, -80, npcId, player);
  assert.equal(m2.score, -40);
  assert.equal(getNpcDisposition(m2.score), 'hostile');

  // Clamping prevents out of bounds
  const mOver = adjustNpcMemory(m2, -100, npcId, player);
  assert.equal(mOver.score, -100);

  // Wartime foreigner markup applies
  const wartimeBuyMult = getNpcPriceMultiplier(0, 'buy', true);
  assert.ok(wartimeBuyMult > 1.0);
});

test('Loot drops and Sentry reactions', () => {
  // World death retains coin and shards, drops carried materials
  const worldDrop = calculateWorldDeathDrop({ chroma: 150, shards: 12, materials: 8 });
  assert.equal(worldDrop.transferredMaterials, 8);
  assert.equal(worldDrop.retainedChroma, 150);
  assert.equal(worldDrop.retainedShards, 12);

  // Story loss drops 25% across the board
  const storyLoss = calculateDuelOrStoryLoss({ chroma: 100, shards: 20, materials: 12 });
  assert.equal(storyLoss.transferredChroma, 25);
  assert.equal(storyLoss.transferredShards, 5);
  assert.equal(storyLoss.transferredMaterials, 3);

  // Boss villain drops high CHROMA and guaranteed shard
  const bossDrop = calculateVillainDrop('boss');
  assert.equal(bossDrop.chroma, 250);
  assert.equal(bossDrop.shardChance, 1.0);

  // Sentry checks: ignores outside gates
  const outside = evaluateSentryAction({
    hasActiveBounty: true,
    activeRedFlagsCount: 1,
    inProtectedZone: false,
  });
  assert.equal(outside.action, 'ignore');

  // Sentry arrests bounty holder in protected zone
  const insideBounty = evaluateSentryAction({
    hasActiveBounty: true,
    bountyReward: 200,
    activeRedFlagsCount: 0,
    inProtectedZone: true,
  });
  assert.equal(insideBounty.action, 'arrest');
  assert.equal(insideBounty.fineAmount, 200);

  // Sentry fines red flags in protected zone
  const insideFlag = evaluateSentryAction({
    hasActiveBounty: false,
    activeRedFlagsCount: 2,
    inProtectedZone: true,
  });
  assert.equal(insideFlag.action, 'fine');
  assert.equal(insideFlag.fineAmount, 50);
});

test('Merchant demand: flooding a merchant with 2 x maxStock shards drops buy price by >= 25% and decays back after 24 game hours', () => {
  const maxStock = 200;
  const basePrice = 10;
  const stock = 100;
  const t0 = 1000000;

  // 1. Fresh merchant quote for selling to merchant (merchant buy price)
  const freshQuote = calculateQuote({
    itemType: 'shard',
    action: 'sell',
    stock,
    maxStock,
    basePrice,
    now: t0,
  });

  // 2. Flood merchant with 2 x maxStock (400 units) sold by players
  let demandWindow = recordDemand(undefined, 'shard', 'sell', 2 * maxStock, t0);

  const floodedQuote = calculateQuote({
    itemType: 'shard',
    action: 'sell',
    stock,
    maxStock,
    basePrice,
    demandWindow,
    now: t0,
  });

  // Buy price drops by at least 25% versus a fresh merchant
  const dropRatio = (freshQuote.unitPrice - floodedQuote.unitPrice) / freshQuote.unitPrice;
  assert.ok(
    dropRatio >= 0.25,
    `Expected drop >= 25%, got ${dropRatio * 100}% (fresh: ${freshQuote.unitPrice}, flooded: ${floodedQuote.unitPrice})`,
  );

  // 3. Drop decays back after 24 game hours
  const tDecayed = t0 + 24 * GAME_HOUR_MS + 1000;
  const decayedQuote = calculateQuote({
    itemType: 'shard',
    action: 'sell',
    stock,
    maxStock,
    basePrice,
    demandWindow,
    now: tDecayed,
  });

  assert.equal(
    decayedQuote.unitPrice,
    freshQuote.unitPrice,
    `Expected price to decay back to ${freshQuote.unitPrice}, got ${decayedQuote.unitPrice}`,
  );
});

test('Colour balance: kicks in at 41% and not at 39%', () => {
  const t0 = 5000000;
  const basePrice = 10;
  const stock = 200;
  const maxStock = 200;

  // Baseline quote with balanced shard sales (25% each)
  const neutralSales = {
    IGNIS: 25,
    AQUES: 25,
    TERRA: 25,
    AURA: 25,
  };
  const neutralIgnisQuote = calculateQuote({
    itemType: 'shard_ignis',
    action: 'sell',
    stock,
    maxStock,
    basePrice,
    shardSales: neutralSales,
    now: t0,
  });
  const neutralAquesQuote = calculateQuote({
    itemType: 'shard_aques',
    action: 'sell',
    stock,
    maxStock,
    basePrice,
    shardSales: neutralSales,
    now: t0,
  });

  // Case 1: IGNIS is 41% of shard sales (over 40% threshold)
  const sales41 = {
    IGNIS: 41,
    AQUES: 20,
    TERRA: 20,
    AURA: 19,
  };
  const quoteIgnis41 = calculateQuote({
    itemType: 'shard_ignis',
    action: 'sell',
    stock,
    maxStock,
    basePrice,
    shardSales: sales41,
    now: t0,
  });
  const quoteAques41 = calculateQuote({
    itemType: 'shard_aques',
    action: 'sell',
    stock,
    maxStock,
    basePrice,
    shardSales: sales41,
    now: t0,
  });

  // Colour balance kicks in: merchants pay 20% less for IGNIS and 20% more for counter (AQUES)
  assert.ok(
    quoteIgnis41.unitPrice < neutralIgnisQuote.unitPrice,
    `Expected IGNIS price at 41% (${quoteIgnis41.unitPrice}) < neutral (${neutralIgnisQuote.unitPrice})`,
  );
  assert.equal(quoteIgnis41.unitPrice, Math.round(neutralIgnisQuote.unitPrice * 0.8));

  assert.ok(
    quoteAques41.unitPrice > neutralAquesQuote.unitPrice,
    `Expected AQUES price at 41% (${quoteAques41.unitPrice}) > neutral (${neutralAquesQuote.unitPrice})`,
  );
  assert.equal(quoteAques41.unitPrice, Math.round(neutralAquesQuote.unitPrice * 1.2));

  // Case 2: IGNIS is 39% of shard sales (under 40% threshold)
  const sales39 = {
    IGNIS: 39,
    AQUES: 21,
    TERRA: 20,
    AURA: 20,
  };
  const quoteIgnis39 = calculateQuote({
    itemType: 'shard_ignis',
    action: 'sell',
    stock,
    maxStock,
    basePrice,
    shardSales: sales39,
    now: t0,
  });
  const quoteAques39 = calculateQuote({
    itemType: 'shard_aques',
    action: 'sell',
    stock,
    maxStock,
    basePrice,
    shardSales: sales39,
    now: t0,
  });

  // Colour balance does NOT kick in: prices remain neutral
  assert.equal(quoteIgnis39.unitPrice, neutralIgnisQuote.unitPrice);
  assert.equal(quoteAques39.unitPrice, neutralAquesQuote.unitPrice);
});

test('Merchant reasoning: every quote has at least one step and a non-empty summary', () => {
  const variations = [
    { itemType: 'shard', action: 'buy' as const, stock: 200, maxStock: 200, basePrice: 10 },
    { itemType: 'shard', action: 'sell' as const, stock: 0, maxStock: 200, basePrice: 10 },
    { itemType: 'potion', action: 'buy' as const, stock: 50, maxStock: 100, basePrice: 20, isOutsider: true },
    { itemType: 'item', action: 'sell' as const, stock: 10, maxStock: 50, basePrice: 150, npcMemoryScore: -80 },
    { itemType: 'item', action: 'buy' as const, stock: 0, maxStock: 50, basePrice: 150 }, // out of stock
  ];

  for (const v of variations) {
    const q = calculateQuote(v);
    assert.ok(q.steps.length >= 1, `Expected at least one step for ${v.itemType} ${v.action}`);
    assert.ok(q.summary.length > 0, `Expected non-empty summary for ${v.itemType} ${v.action}`);
    for (const step of q.steps) {
      assert.ok(step.rule.length > 0, 'Step rule must be non-empty');
      assert.ok(typeof step.effect === 'number', 'Step effect must be a number');
      assert.ok(step.words.length > 0, 'Step words must be non-empty');
    }
  }
});

test('Price limits: prices never go below 1 or above 3.9 x base after all rules', () => {
  const basePrice = 10;
  const maxStock = 200;

  // Maximum price pressure: empty stock (3x), heavy buying demand (+30%), outsider (+20%), hostile (-80)
  const demandWindowBuy = recordDemand(undefined, 'shard', 'buy', 2 * maxStock, 1000);
  const maxPressureQuote = calculateQuote({
    itemType: 'shard',
    action: 'buy',
    stock: 1, // nearly empty
    maxStock,
    basePrice,
    isOutsider: true,
    npcMemoryScore: -100,
    demandWindow: demandWindowBuy,
    now: 1000,
  });

  const upperLimit = Math.round(3.9 * basePrice);
  assert.ok(
    maxPressureQuote.unitPrice <= upperLimit,
    `Price ${maxPressureQuote.unitPrice} exceeded 3.9 x base (${upperLimit})`,
  );
  assert.ok(maxPressureQuote.unitPrice >= 1, 'Price must be at least 1');

  // Minimum price pressure: full stock (1x), heavy selling demand (-30%), colour balance discount (-20%), outsider sell (-10%), hostile sell (-15%)
  const demandWindowSell = recordDemand(undefined, 'shard_ignis', 'sell', 2 * maxStock, 1000);
  const minPressureQuote = calculateQuote({
    itemType: 'shard_ignis',
    action: 'sell',
    stock: maxStock,
    maxStock,
    basePrice,
    isOutsider: true,
    npcMemoryScore: -100,
    demandWindow: demandWindowSell,
    shardSales: { IGNIS: 50, AQUES: 20, TERRA: 15, AURA: 15 },
    now: 1000,
  });

  assert.ok(
    minPressureQuote.unitPrice >= 1,
    `Price ${minPressureQuote.unitPrice} went below 1`,
  );
  assert.ok(
    minPressureQuote.unitPrice <= upperLimit,
    `Price ${minPressureQuote.unitPrice} exceeded upper limit`,
  );
});

test('World loot claiming distance: claiming from 1.6 m fails and from 1.4 m works', () => {
  const pile = createLootPile({
    x: 0,
    z: 0,
    zone: 'sindr',
    contents: { chroma: 50, shards: createEmptyShards(), materials: {} },
    source: 'villain',
    droppedAt: 1000,
    ownerId: null,
  });

  // At 1.4 m: inside claim radius (1.5 m) -> canClaim is true
  assert.equal(canClaim(pile, 'player_1', 1.4, 0, 1000), true);
  assert.equal(canClaim(pile, 'player_1', 0, 1.4, 1000), true);

  // At 1.6 m: outside claim radius (1.5 m) -> canClaim is false
  assert.equal(canClaim(pile, 'player_1', 1.6, 0, 1000), false);
  assert.equal(canClaim(pile, 'player_1', 0, 1.6, 1000), false);
});

test('World loot ownership: non-owner cannot claim in the first 60 s and can after', () => {
  const droppedAt = 10_000;
  const pile = createLootPile({
    x: 0,
    z: 0,
    zone: 'sindr',
    contents: { chroma: 50, shards: createEmptyShards(), materials: {} },
    source: 'villain',
    ownerId: 'victor_player',
    droppedAt,
  });

  // During first 60 seconds (at 30s): victor can claim, others cannot
  const withinOwnerWindow = droppedAt + 30_000;
  assert.equal(canClaim(pile, 'victor_player', 0, 0, withinOwnerWindow), true);
  assert.equal(canClaim(pile, 'scavenger_player', 0, 0, withinOwnerWindow), false);

  // After 60 seconds (at 61s): anyone can claim
  const afterOwnerWindow = droppedAt + 61_000;
  assert.equal(canClaim(pile, 'victor_player', 0, 0, afterOwnerWindow), true);
  assert.equal(canClaim(pile, 'scavenger_player', 0, 0, afterOwnerWindow), true);
});

test('World loot expiry: expired pile cannot be claimed', () => {
  const droppedAt = 10_000;
  const pile = createLootPile({
    x: 0,
    z: 0,
    zone: 'sindr',
    contents: { chroma: 50, shards: createEmptyShards(), materials: {} },
    source: 'villain',
    ownerId: null,
    droppedAt,
  });

  // 14 minutes in: still claimable
  const beforeExpiry = droppedAt + 14 * 60 * 1000;
  assert.equal(canClaim(pile, 'player_1', 0, 0, beforeExpiry), true);

  // At 15 minutes (expiry boundary): cannot be claimed
  const atExpiry = droppedAt + DROPS_CONFIG.expireMinutes * 60 * 1000;
  assert.equal(canClaim(pile, 'player_1', 0, 0, atExpiry), false);

  // After 15 minutes: cannot be claimed
  const afterExpiry = droppedAt + 16 * 60 * 1000;
  assert.equal(canClaim(pile, 'player_1', 0, 0, afterExpiry), false);
});

test('World loot monster drops: monster drop rate over 10,000 seeded rolls is 40% plus or minus 2%', () => {
  function makeSeededRng(seed: number) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  const rng = makeSeededRng(123456789);
  const totalRolls = 10_000;
  let nationDrops = 0;

  for (let i = 0; i < totalRolls; i++) {
    const loot = monsterDrop('IGNIS', 'nation', rng);
    if (loot.shards.IGNIS === 1) {
      nationDrops++;
    }
  }

  const dropRate = nationDrops / totalRolls;
  assert.ok(
    dropRate >= 0.38 && dropRate <= 0.42,
    `Monster nation drop rate was ${dropRate}, expected between 0.38 and 0.42`,
  );

  const chromaraRng = makeSeededRng(987654321);
  let chromaraDrops = 0;
  for (let i = 0; i < totalRolls; i++) {
    const loot = monsterDrop('CHROMARA', 'chromara', chromaraRng);
    const totalShards = loot.shards.IGNIS + loot.shards.AQUES + loot.shards.TERRA + loot.shards.AURA;
    if (totalShards === 1) {
      chromaraDrops++;
    }
  }

  const chromaraRate = chromaraDrops / totalRolls;
  assert.ok(
    chromaraRate >= 0.28 && chromaraRate <= 0.32,
    `Monster Chromara drop rate was ${chromaraRate}, expected between 0.28 and 0.32`,
  );
});

test('World loot villain drops: villains drop all carried CHROMA and held materials', () => {
  const carried = {
    chroma: 125,
    shards: { IGNIS: 2, AQUES: 0, TERRA: 1, AURA: 0 },
    materials: { copper_ingot: 3, linen_scrap: 5 },
  };

  const loot = villainDrop(carried);
  assert.equal(loot.chroma, 125);
  assert.equal(loot.shards.IGNIS, 2);
  assert.equal(loot.shards.TERRA, 1);
  assert.equal(loot.shards.AQUES, 0);
  assert.equal(loot.materials.copper_ingot, 3);
  assert.equal(loot.materials.linen_scrap, 5);
});

test('World loot death drop: dying drops materials and 25% of carried shards while coin stays with player', () => {
  const carried = {
    chroma: 200,
    shards: { IGNIS: 8, AQUES: 4, TERRA: 2, AURA: 0 },
    materials: { iron_ore: 10, beast_hide: 4 },
  };

  const res = calculateDeathDropResolution(carried);

  // Coin stays with player: pile gets 0 chroma, player retains 200
  assert.equal(res.dropped.chroma, 0);
  assert.equal(res.retained.chroma, 200);

  // All materials drop into pile, player retains none
  assert.equal(res.dropped.materials.iron_ore, 10);
  assert.equal(res.dropped.materials.beast_hide, 4);
  assert.deepEqual(res.retained.materials, {});

  // 25% of carried shards drop: 8 * 0.25 = 2, 4 * 0.25 = 1, floor(2 * 0.25) = 0
  assert.equal(res.dropped.shards.IGNIS, 2);
  assert.equal(res.dropped.shards.AQUES, 1);
  assert.equal(res.dropped.shards.TERRA, 0);
  assert.equal(res.dropped.shards.AURA, 0);

  // Player retains the remainder
  assert.equal(res.retained.shards.IGNIS, 6);
  assert.equal(res.retained.shards.AQUES, 3);
  assert.equal(res.retained.shards.TERRA, 2);
  assert.equal(res.retained.shards.AURA, 0);
});
