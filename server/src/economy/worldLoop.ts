import type { DatabaseSync } from 'node:sqlite';
import {
  AGENT_CONFIG,
  GAME_HOUR_MS,
  SINDR_MERCHANTS,
  type PlanPhase,
} from '@elements/shared';
import { getDatabase } from '../db.js';
import {
  ensureSindrMerchants,
  tickAllMerchantAgents,
  tickMerchantAgentsDay,
} from './agents/agentLoop.js';
import { NearAiDecider } from './agents/nearAiDecider.js';
import type { AgentDecider } from './agents/types.js';
import { sweepExpiredPiles } from './lootService.js';
import { tickAllShopsDay } from './shopService.js';
import { ModelRouter } from './agents/router/modelRouter.js';
import { AgentEventQueue } from './agents/plans/eventQueue.js';
import {
  generateBatchPlans,
  getPlanPhase,
  type AgentPlanContext,
} from './agents/plans/agentPlan.js';
import { generateTownsfolkBatchPlans } from './agents/townsfolk/townsfolkMinds.js';
import { runDailyJudge } from './agents/judge/dailyJudge.js';
import { getMerchant } from './merchantService.js';
import { getLatestDailyJudgeReport } from './agents/db.js';

const SWEEP_EVERY_MS = 30_000;

export interface EconomyLoopOptions {
  db?: DatabaseSync;
  decider?: AgentDecider;
  router?: ModelRouter;
  eventQueue?: AgentEventQueue;
  now?: () => number;
  log?: (line: string) => void;
}

export interface EconomyLoop {
  stop(): void;
  router: ModelRouter;
  eventQueue: AgentEventQueue;
}

export function startEconomyLoop(options: EconomyLoopOptions = {}): EconomyLoop {
  const db = options.db ?? getDatabase();
  const now = options.now ?? Date.now;
  const decider = options.decider ?? new NearAiDecider();
  const router = options.router ?? new ModelRouter();
  const eventQueue = options.eventQueue ?? new AgentEventQueue();
  const log = options.log ?? ((line: string) => console.log(`[economy] ${line}`));

  ensureSindrMerchants(db, now());

  let lastPhase: PlanPhase | null = null;
  let dayCount = 1;

  const runPhasePlans = async (currentNow: number): Promise<void> => {
    const currentHour = Math.floor((currentNow / GAME_HOUR_MS) % 24);
    const phase = getPlanPhase(currentHour);

    if (phase === lastPhase) return;
    lastPhase = phase;

    try {
      const contexts: AgentPlanContext[] = SINDR_MERCHANTS.map((m) => {
        const merchant = getMerchant(m.id, db);
        const guidance = getLatestDailyJudgeReport(db)?.agentGuidance?.[m.id]?.directive;
        return {
          id: m.id,
          role: 'merchant',
          name: m.name,
          nation: m.nation,
          personality: m.personality,
          purse: merchant?.balance ?? m.startingPurse,
          stock: merchant?.inventory ?? m.inventory,
          yesterdayGuidance: guidance,
        };
      });

      await generateBatchPlans({
        placeId: 'sindr_market',
        agents: contexts,
        phase,
        router,
        db,
        now: currentNow,
      });

      await generateTownsfolkBatchPlans({
        placeId: 'sindr_market',
        phase,
        router,
        db,
        now: currentNow,
      });

      log(`daily plans generated for phase ${phase}`);
    } catch (err) {
      log(`phase planning failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  let ticking = false;
  const agentTick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      const currentNow = now();
      void runPhasePlans(currentNow);

      // Check if dirty agents need to be flushed in sindr_market
      if (eventQueue.canFlushPlace('sindr_market', router.governor, currentNow)) {
        const dirty = eventQueue.getDirtyAgents('sindr_market');
        if (dirty.length > 0) {
          const contexts: AgentPlanContext[] = SINDR_MERCHANTS.map((m) => {
            const merchant = getMerchant(m.id, db);
            return {
              id: m.id,
              role: 'merchant',
              name: m.name,
              nation: m.nation,
              personality: m.personality,
              purse: merchant?.balance ?? m.startingPurse,
              stock: merchant?.inventory ?? m.inventory,
            };
          });
          void eventQueue.flushDirtyAgents({
            placeId: 'sindr_market',
            agents: contexts,
            router,
            governor: router.governor,
            now: currentNow,
          });
        }
      }

      const results = await tickAllMerchantAgents({ now: currentNow, decider, db });
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
      if (sweptPiles.length > 0) {
        log(`expired piles: ${sweptPiles.length}, ${reclaimedChroma} CHROMA back to treasury`);
      }
    } catch (err) {
      log(`loot sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const day = async (): Promise<void> => {
    try {
      const t = now();
      const { closed } = tickMerchantAgentsDay(t, db);
      const shops = tickAllShopsDay(t, db);
      log(
        `day passed: closed ${closed.length}, forfeited ${shops.forfeited.length}, new merchants ${shops.bailoutReopened.length}`,
      );

      // Daily Judge evaluation call on NEAR AI Cloud
      await runDailyJudge({
        dayNumber: dayCount++,
        router,
        db,
        now: t,
      });
      log(`daily judge concluded for day ${dayCount - 1}`);
    } catch (err) {
      log(`day tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  void agentTick();
  const timers = [
    setInterval(() => void agentTick(), AGENT_CONFIG.tickGameMinutes * (GAME_HOUR_MS / 60)),
    setInterval(sweep, SWEEP_EVERY_MS),
    setInterval(() => void day(), 24 * GAME_HOUR_MS),
  ];
  for (const t of timers) t.unref?.();

  return {
    stop: () => timers.forEach((t) => clearInterval(t)),
    router,
    eventQueue,
  };
}
