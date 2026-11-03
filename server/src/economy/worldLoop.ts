import type { DatabaseSync } from 'node:sqlite';
import { AGENT_CONFIG, GAME_HOUR_MS } from '@elements/shared';
import { getDatabase } from '../db.js';
import { ensureSindrMerchants, tickAllMerchantAgents, tickMerchantAgentsDay } from './agents/agentLoop.js';
import { NearAiDecider } from './agents/nearAiDecider.js';
import type { AgentDecider } from './agents/types.js';
import { sweepExpiredPiles } from './lootService.js';
import { tickAllShopsDay } from './shopService.js';

// The economy running on its own while the server is up: merchants decide on their tick,
// unclaimed loot returns to the treasury when it expires, and each day broke shops close,
// owned shops pay upkeep and unsold shops get a new merchant.

const SWEEP_EVERY_MS = 30_000;

export interface EconomyLoop {
  stop(): void;
}

export function startEconomyLoop(
  options: { db?: DatabaseSync; decider?: AgentDecider; now?: () => number; log?: (line: string) => void } = {},
): EconomyLoop {
  const db = options.db ?? getDatabase();
  const now = options.now ?? Date.now;
  const decider = options.decider ?? new NearAiDecider();
  const log = options.log ?? ((line: string) => console.log(`[economy] ${line}`));

  ensureSindrMerchants(db, now());

  let ticking = false;
  const agentTick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      const results = await tickAllMerchantAgents({ now: now(), decider, db });
      log(`merchants ticked: ${results.length}`);
    } catch (err) {
      log(`merchant tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      ticking = false;
    }
  };

  const sweep = (): void => {
    try {
      const { sweptPiles, reclaimedChroma } = sweepExpiredPiles(now(), db);
      if (sweptPiles.length > 0) log(`expired piles: ${sweptPiles.length}, ${reclaimedChroma} CHROMA back to the treasury`);
    } catch (err) {
      log(`loot sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const day = (): void => {
    try {
      const t = now();
      const { closed } = tickMerchantAgentsDay(t, db);
      const shops = tickAllShopsDay(t, db);
      log(`day passed: closed ${closed.length}, forfeited ${shops.forfeited.length}, new merchants ${shops.bailoutReopened.length}`);
    } catch (err) {
      log(`day tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  void agentTick();
  const timers = [
    setInterval(() => void agentTick(), AGENT_CONFIG.tickGameMinutes * (GAME_HOUR_MS / 60)),
    setInterval(sweep, SWEEP_EVERY_MS),
    setInterval(day, 24 * GAME_HOUR_MS),
  ];
  for (const t of timers) t.unref?.();

  return {
    stop: () => timers.forEach((t) => clearInterval(t)),
  };
}
