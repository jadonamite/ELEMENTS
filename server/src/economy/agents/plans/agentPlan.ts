import type { DatabaseSync } from 'node:sqlite';
import {
  type AgentPlan,
  type PlanPhase,
  GAME_HOUR_MS,
  SINDR_MERCHANTS,
} from '@elements/shared';
import { getDatabase } from '../../../db.js';
import { saveAgentPlan } from '../db.js';
import type { ModelRouter } from '../router/modelRouter.js';

export interface AgentPlanContext {
  id: string;
  role: string;
  name: string;
  nation?: string;
  personality: string;
  purse: number;
  stock: Record<string, { stock: number; maxStock: number }>;
  yesterdayGuidance?: string;
}

export function getPlanPhase(hour: number): PlanPhase {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'midday';
  if (h >= 18 && h < 20) return 'evening';
  return 'night';
}

export function createDeterministicPlan(
  agentId: string,
  role: string,
  personality: string,
  phase: PlanPhase,
  now: number,
  guidance?: string,
): AgentPlan {
  const configs: Record<
    PlanPhase,
    { focus: string; mood: string; targetRatio: number; bargain: number; lines: string[] }
  > = {
    morning: {
      focus: 'Replenish racks from stores and greet early traders.',
      mood: 'brisk',
      targetRatio: 0.8,
      bargain: 0.5,
      lines: [
        'Fresh goods on the counter this morning.',
        'The sun is up; see what arrived from the road.',
      ],
    },
    midday: {
      focus: 'Trade briskly during peak market hours; hold prices steady.',
      mood: 'focused',
      targetRatio: 0.6,
      bargain: 0.3,
      lines: [
        'Full market today; take what you need while stock lasts.',
        'No time for slow talk; coin on the wood.',
      ],
    },
    evening: {
      focus: "Prepare for sunset; bundle excess inventory for the Lord's tribute.",
      mood: 'calculating',
      targetRatio: 0.5,
      bargain: 0.7,
      lines: [
        "The Lord's cart leaves soon; making room on the racks.",
        'Fair deals before the bells ring for dusk.',
      ],
    },
    night: {
      focus: 'Bar the shutters and safeguard coin until dawn.',
      mood: 'cautious',
      targetRatio: 0.4,
      bargain: 0.1,
      lines: [
        'Shutters are barred; return at first light.',
        'Night belongs to the patrol and the shadows.',
      ],
    },
  };

  const cfg = configs[phase];
  const merchantConfig = SINDR_MERCHANTS.find((m) => m.id === agentId);
  const targetStockRatio: Record<string, number> = {};
  if (merchantConfig) {
    for (const key of Object.keys(merchantConfig.inventory)) {
      targetStockRatio[key] = cfg.targetRatio;
    }
  } else {
    targetStockRatio['default'] = cfg.targetRatio;
  }

  return {
    phase,
    focus: cfg.focus,
    mood: cfg.mood,
    targetStockRatio,
    bargainWillingness: cfg.bargain,
    preparedLines: cfg.lines,
    guidance: guidance ?? undefined,
    createdAt: now,
  };
}

export async function generateBatchPlans(params: {
  placeId: string;
  agents: AgentPlanContext[];
  phase: PlanPhase;
  router: ModelRouter;
  db?: DatabaseSync;
  now: number;
}): Promise<Record<string, AgentPlan>> {
  const { placeId, agents, phase, router, now } = params;
  const db = params.db ?? getDatabase();
  const plans: Record<string, AgentPlan> = {};

  if (agents.length === 0) return plans;

  // Build batched prompt payload
  const promptAgents = agents.map((a) => ({
    id: a.id,
    role: a.role,
    name: a.name,
    personality: a.personality,
    purse: a.purse,
    stock: a.stock,
    yesterdayGuidance: a.yesterdayGuidance,
  }));

  const systemPrompt = [
    `You are the mind engine for agents in ${placeId}.`,
    `Current daily phase: ${phase.toUpperCase()}.`,
    'Plan strategy, mood, target stock ratio (0.1 to 1.0), bargaining willingness (0.0 to 1.0), and 2 concise in-character spoken lines for each agent.',
    'Respond ONLY with valid JSON in this exact structure:',
    '{ "plans": { "agent_id": { "focus": "string", "mood": "string", "targetStockRatio": { "item": 0.8 }, "bargainWillingness": 0.5, "preparedLines": ["line 1", "line 2"] } } }',
  ].join(' ');

  const result = await router.route({
    intent: 'plan',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ place: placeId, phase, agents: promptAgents }) },
    ],
    responseFormat: { type: 'json_object' },
    metadata: {
      placeId,
      agentIds: agents.map((a) => a.id),
    },
  });

  let parsedPlans: Record<string, Partial<AgentPlan>> = {};
  if (result?.content) {
    try {
      let cleaned = result.content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      }
      const parsed = JSON.parse(cleaned) as { plans?: Record<string, Partial<AgentPlan>> };
      if (parsed && typeof parsed.plans === 'object') {
        parsedPlans = parsed.plans;
      }
    } catch {
      console.warn(`[Plans] Failed to parse model plan response for ${placeId}; using deterministic fallbacks.`);
    }
  }

  for (const agent of agents) {
    const rawPlan = parsedPlans[agent.id];
    let plan: AgentPlan;

    if (
      rawPlan &&
      typeof rawPlan.focus === 'string' &&
      typeof rawPlan.mood === 'string' &&
      Array.isArray(rawPlan.preparedLines)
    ) {
      plan = {
        phase,
        focus: rawPlan.focus,
        mood: rawPlan.mood,
        targetStockRatio:
          typeof rawPlan.targetStockRatio === 'object' && rawPlan.targetStockRatio !== null
            ? (rawPlan.targetStockRatio as Record<string, number>)
            : { default: 0.7 },
        bargainWillingness:
          typeof rawPlan.bargainWillingness === 'number' ? rawPlan.bargainWillingness : 0.5,
        preparedLines: rawPlan.preparedLines.filter((l) => typeof l === 'string'),
        guidance: agent.yesterdayGuidance,
        createdAt: now,
      };
    } else {
      plan = createDeterministicPlan(
        agent.id,
        agent.role,
        agent.personality,
        phase,
        now,
        agent.yesterdayGuidance,
      );
    }

    saveAgentPlan(agent.id, plan, db);
    plans[agent.id] = plan;
  }

  return plans;
}
