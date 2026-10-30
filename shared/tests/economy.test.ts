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
