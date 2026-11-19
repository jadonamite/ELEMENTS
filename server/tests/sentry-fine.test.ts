import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CRIME_CONFIG, SINDR_SENTRY_POSTS, TREASURY_ACCOUNT_ID } from '@elements/shared';
import { migrateDatabase, setDatabase } from '../src/db.js';
import { getAccountBalance, grantPlayerStartingPurse } from '../src/economy/ledgerService.js';
import { addRedFlag, fineOnSight, getStanding } from '../src/economy/crimeService.js';

test('A Sentry fines each red flag once, only at a post in Sindr, and the flag stays until it fades', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  const player = 'brawler_1';
  grantPlayerStartingPurse(player, db);
  const post = SINDR_SENTRY_POSTS[0]!;
  const purse = getAccountBalance(player, db);
  const treasury = getAccountBalance(TREASURY_ACCOUNT_ID, db);

  // No flag, nothing to fine.
  assert.deepEqual(fineOnSight(player, 'sindr', post.x, post.z, db), { action: 'ignore', amount: 0, flags: 0 });

  addRedFlag(player, 'Brawling in the street', db);
  // Out of a Sentry's sight, or in another zone, nobody fines.
  assert.equal(fineOnSight(player, 'sindr', post.x + CRIME_CONFIG.sentrySightMetres + 5, post.z, db).action, 'ignore');
  assert.equal(fineOnSight(player, 'varda', post.x, post.z, db).action, 'ignore');

  const fine = fineOnSight(player, 'sindr', post.x + 2, post.z, db);
  assert.deepEqual(fine, { action: 'fine', amount: CRIME_CONFIG.sentryFinePerFlag, flags: 1 });
  assert.equal(getAccountBalance(player, db), purse - fine.amount);
  assert.equal(getAccountBalance(TREASURY_ACCOUNT_ID, db), treasury + fine.amount);
  assert.equal(getStanding(player, db).redFlags, 1, 'the flag is still shown until it fades');

  // The same flag is never fined twice; a new one is.
  assert.equal(fineOnSight(player, 'sindr', post.x, post.z, db).action, 'ignore');
  addRedFlag(player, 'Brawling again', db);
  assert.equal(fineOnSight(player, 'sindr', post.x, post.z, db).flags, 1);
});

test('A Sentry takes what the player holds when it is less than the fine', () => {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  const post = SINDR_SENTRY_POSTS[0]!;
  addRedFlag('penniless', 'Brawling', db);
  const fine = fineOnSight('penniless', 'sindr', post.x, post.z, db);
  assert.deepEqual(fine, { action: 'fine', amount: 0, flags: 1 });
});
