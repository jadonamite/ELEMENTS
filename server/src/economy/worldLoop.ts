import type { DatabaseSync } from 'node:sqlite';
import { AGENT_CONFIG, GAME_HOUR_MS, type PlanPhase } from '@elements/shared';
import { getDatabase } from '../db.js';
import { ensureSindrMerchants, tickAllMerchantAgents, tickMerchantAgentsDay } from './agents/agentLoop.js';
import { getLatestDailyJudgeReport } from './agents/db.js';
import { runDailyJudge, runEveningChronicle } from './agents/judge/dailyJudge.js';
import { keepersIn, mindPlaces } from './agents/minds.js';
import { generateBatchPlans, getPlanPhase, type AgentPlanContext } from './agents/plans/agentPlan.js';
import { getAgentRuntime, type AgentRuntime } from './agents/runtime.js';
import { economyNow } from './agents/clock.js';
import { generateTownsfolkBatchPlans } from './agents/townsfolk/townsfolkMinds.js';
import type { AgentDecider } from './agents/types.js';
import { RuleDecider } from './agents/ruleDecider.js';
import { sweepExpiredPiles } from './lootService.js';
import { getMerchant } from './merchantService.js';
import { tickAllShopsDay } from './shopService.js';

const SWEEP_EVERY_MS = 30_000;
const DAY_MS = 24 * GAME_HOUR_MS;

export interface EconomyLoopOptions {
  db?: DatabaseSync;
  /** How merchants act on their plan each tick; the rules by default. Never a model: ticks make no calls. */
  decider?: AgentDecider;
  runtime?: AgentRuntime;
  now?: () => number;
  log?: (line: string) => void;
  /** Real milliseconds between checks for a new phase, flushes and ticks (tests). */
  checkEveryMs?: number;
}

export interface EconomyLoop {
  stop(): void;
  runtime: AgentRuntime;
  /** Runs one check now: phase plans when the phase turned, the event flush, the merchants' tick when due. */
  step(): Promise<void>;
}

export function startEconomyLoop(options: EconomyLoopOptions = {}): EconomyLoop {
  const db = options.db ?? getDatabase();
  const now = options.now ?? economyNow;
  const decider = options.decider ?? new RuleDecider();
  const runtime = options.runtime ?? getAgentRuntime();
  const { router, queue } = runtime;
  const log = options.log ?? ((line: string) => console.log(`[economy] ${line}`));
  const tickMs = AGENT_CONFIG.tickGameMinutes * (GAME_HOUR_MS / 60);

  ensureSindrMerchants(db, now());

  /** A keeper's plan context: who they are, their purse and shelves, the judge's word, what happened. */
  const keeperContext = (place: string, id: string): AgentPlanContext | null => {
    const k = keepersIn(place).find((m) => m.id === id);
    if (!k?.merchant) return null;
    const state = getMerchant(k.id, db);
    return {
      id: k.id,
      role: 'keeper',
      name: k.name,
      character: k.character,
      purse: state?.balance ?? k.merchant.startingPurse,
      stock: state?.inventory ?? k.merchant.inventory,
      guidance: getLatestDailyJudgeReport(db)?.agentGuidance?.[k.id]?.directive,
      events: queue.eventLines(k.id),
    };
  };

  let lastPhase: PlanPhase | null = null;
  let lastDay = Math.floor(now() / DAY_MS);
  let lastTick = -Infinity;
  let inflight: Promise<void> | null = null;

  const planPhase = async (phase: PlanPhase, at: number): Promise<void> => {
    for (const place of mindPlaces()) {
      const contexts = keepersIn(place).map((k) => keeperContext(place, k.id)).filter((c): c is AgentPlanContext => c !== null);
      const news = contexts.flatMap((c) => c.events ?? []).slice(-8);
      const keepers = await generateBatchPlans({ placeId: place, agents: contexts, phase, router, db, now: at });
      for (const c of contexts) queue.clearRecentEvents(c.id);
      const folk = await generateTownsfolkBatchPlans({ placeId: place, phase, router, db, now: at, news });
      log(`${place} ${phase} plans: ${Object.keys(keepers.plans).length} keepers (${keepers.source}), ${Object.keys(folk.plans).length} townsfolk (${folk.source})`);
    }
    if (phase === 'evening') {
      const { report, source } = await runEveningChronicle({ router, db, now: at });
      log(`evening chronicle for day ${report.dayNumber} (${source}): ${report.chronicle.headline}`);
    }
  };

  const newDay = async (at: number): Promise<void> => {
    const { closed } = tickMerchantAgentsDay(at, db);
    const shops = tickAllShopsDay(at, db);
    log(`day passed: closed ${closed.length}, forfeited ${shops.forfeited.length}, new merchants ${shops.bailoutReopened.length}`);
    await runDailyJudge({ router, db, now: at, log });
  };

  const runStep = async (): Promise<void> => {
    try {
      const at = now();
      const day = Math.floor(at / DAY_MS);
      if (day !== lastDay) {
        lastDay = day;
        await newDay(at);
      }
      const phase = getPlanPhase(Math.floor((at / GAME_HOUR_MS) % 24));
      if (phase !== lastPhase) {
        lastPhase = phase;
        await planPhase(phase, at);
      }
      for (const place of mindPlaces()) {
        const flushed = await queue.flushDirtyAgents({
          placeId: place,
          phase,
          contextFor: (id) => keeperContext(place, id),
          router,
          governor: router.governor,
          db,
          now: at,
        });
        if (flushed) log(`${place} event flush: ${Object.keys(flushed.plans).length} keepers re-planned (${flushed.source})`);
      }
      if (at - lastTick >= tickMs) {
        lastTick = at;
        const results = await tickAllMerchantAgents({ now: at, decider, db });
        log(`merchants ticked: ${results.length}`);
      }
    } catch (err) {
      log(`economy step failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** One step at a time: a call while one runs waits for that one instead of starting another. */
  const step = (): Promise<void> => {
    inflight ??= runStep().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  const sweep = (): void => {
    try {
      const { sweptPiles, reclaimedChroma } = sweepExpiredPiles(Date.now(), db);
      if (sweptPiles.length > 0) log(`expired piles: ${sweptPiles.length}, ${reclaimedChroma} CHROMA back to treasury`);
    } catch (err) {
      log(`loot sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  void step();
  const timers = [setInterval(() => void step(), options.checkEveryMs ?? 5_000), setInterval(sweep, SWEEP_EVERY_MS)];
  for (const t of timers) t.unref?.();

  return {
    stop: () => timers.forEach((t) => clearInterval(t)),
    runtime,
    step,
  };
}
