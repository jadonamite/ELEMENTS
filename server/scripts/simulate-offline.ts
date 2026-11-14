import { DatabaseSync } from 'node:sqlite';
import { GAME_HOUR_MS } from '@elements/shared';
import { migrateDatabase, setDatabase } from '../src/db.js';
import { ensureSindrMerchants } from '../src/economy/agents/agentLoop.js';
import { startEconomyLoop } from '../src/economy/worldLoop.js';
import { verifyWorldSupply } from '../src/economy/ledgerService.js';

// Unset every NEAR_* and *_CONTRACT_ID env var to guarantee offline safety,
// as well as any remote AI provider keys so fast-forward offline simulation runs instantly.
for (const key of Object.keys(process.env)) {
  if (
    key.startsWith('NEAR_') ||
    key.endsWith('_CONTRACT_ID') ||
    key.endsWith('_API_KEY') ||
    key.endsWith('_API_TOKEN') ||
    key.includes('CLOUDFLARE')
  ) {
    delete process.env[key];
  }
}

async function main() {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);

  console.log('--- Fast-Clock Offline Agent Simulation (Zero Players) ---');
  console.log('Starting world supply valid:', verifyWorldSupply(db));

  let currentTime = 0;
  const loop = startEconomyLoop({
    db,
    now: () => currentTime,
    checkEveryMs: 1_000_000,
    log: () => {},
  });

  // Temporarily mute console.log during ticks for clean output
  const originalLog = console.log;
  console.log = () => {};

  // Advance clock over 48 game hours (2 game days) in 30-minute intervals
  for (let step = 0; step <= 96; step++) {
    currentTime = step * 30 * (GAME_HOUR_MS / 60);
    await loop.step();
  }
  loop.stop();

  console.log = originalLog;

  console.log('Ending world supply valid:', verifyWorldSupply(db));

  const countRows = db
    .prepare("SELECT count(*) as count FROM ledger_entries WHERE reason != 'genesis'")
    .get() as { count: number };
  console.log(`Total agent-made ledger rows produced: ${countRows.count}`);

  const tributeRows = db
    .prepare("SELECT count(*) as count FROM ledger_entries WHERE reason = 'merchant_tribute'")
    .get() as { count: number };
  console.log(`- Scheduled tribute rows: ${tributeRows.count}`);

  const caravanRows = db
    .prepare("SELECT count(*) as count FROM ledger_entries WHERE reason = 'trade_payment' AND ref_id LIKE 'caravan:%'")
    .get() as { count: number };
  console.log(`- Caravan trade rows: ${caravanRows.count}`);

  const rivalRows = db
    .prepare("SELECT count(*) as count FROM ledger_entries WHERE sender = 'rival_guild' AND reason = 'merchant_buy'")
    .get() as { count: number };
  console.log(`- Rival clan purchase rows: ${rivalRows.count}`);

  const sampleRows = db
    .prepare(
      `SELECT id, sender, receiver, amount, reason, ref_id, timestamp
       FROM ledger_entries
       WHERE reason != 'genesis'
       ORDER BY timestamp ASC
       LIMIT 25`,
    )
    .all();

  console.log('\n--- Sample Agent-Made Ledger Rows ---');
  console.log(JSON.stringify(sampleRows, null, 2));

  const sampleTributeRows = db
    .prepare(
      `SELECT id, sender, receiver, amount, reason, ref_id, timestamp
       FROM ledger_entries
       WHERE reason = 'merchant_tribute'
       ORDER BY timestamp ASC
       LIMIT 10`,
    )
    .all();

  console.log('\n--- Sample Scheduled Tribute Rows (Treasury Payout to Keepers) ---');
  console.log(JSON.stringify(sampleTributeRows, null, 2));
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
