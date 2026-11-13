import type { DatabaseSync } from 'node:sqlite';
import { type AgentPlan, type PlanPhase, cleanLine, speaksBanished } from '@elements/shared';
import { getDatabase } from '../../../db.js';
import { saveAgentPlan } from '../db.js';
import type { ModelRouter } from '../router/modelRouter.js';
import type { CallIntent } from '../router/types.js';

/** What a mind is told when it plans: who it is, what it holds, what happened since its last plan. */
export interface AgentPlanContext {
  id: string;
  role: string;
  name: string;
  character: string;
  purse?: number | undefined;
  stock?: Record<string, { stock: number; maxStock: number }> | undefined;
  /** Yesterday's directive from the daily judge, if one was given. */
  guidance?: string | undefined;
  /** Lines about what happened since the last plan (sales, thefts nearby, floods, rivals' prices). */
  events?: string[] | undefined;
}

export function getPlanPhase(hour: number): PlanPhase {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'midday';
  if (h >= 18 && h < 20) return 'evening';
  return 'night';
}

const WRITTEN: Record<PlanPhase, { focus: string; mood: string; targetRatio: number; bargain: number; lines: string[] }> = {
  morning: {
    focus: 'Fill the shelves and greet the early traders.',
    mood: 'brisk',
    targetRatio: 0.8,
    bargain: 0.5,
    lines: ['Fresh goods on the counter this morning.', 'The sun is up; see what came in from the road.'],
  },
  midday: {
    focus: 'Trade briskly through the busy hours and hold prices steady.',
    mood: 'focused',
    targetRatio: 0.6,
    bargain: 0.3,
    lines: ['Full market today; take what you need while it lasts.', 'No time for slow talk; coin on the wood.'],
  },
  evening: {
    focus: "Make room on the shelves before the Lord's cart.",
    mood: 'calculating',
    targetRatio: 0.5,
    bargain: 0.7,
    lines: ["The Lord's cart leaves soon; making room on the shelves.", 'Fair deals before the dusk bells.'],
  },
  night: {
    focus: 'Bar the shutters and keep the coin safe until dawn.',
    mood: 'cautious',
    targetRatio: 0.4,
    bargain: 0.1,
    lines: ['Shutters are barred; come back at first light.', 'The night belongs to the watch.'],
  },
};

/** The written plan for a phase: what a mind does when no model answers. */
export function createDeterministicPlan(
  agent: Pick<AgentPlanContext, 'stock' | 'guidance'>,
  phase: PlanPhase,
  now: number,
): AgentPlan {
  const cfg = WRITTEN[phase];
  const targetStockRatio: Record<string, number> = {};
  for (const key of Object.keys(agent.stock ?? {})) targetStockRatio[key] = cfg.targetRatio;
  if (Object.keys(targetStockRatio).length === 0) targetStockRatio.default = cfg.targetRatio;
  return {
    phase,
    focus: cfg.focus,
    mood: cfg.mood,
    targetStockRatio,
    bargainWillingness: cfg.bargain,
    preparedLines: [...cfg.lines],
    guidance: agent.guidance,
    createdAt: now,
  };
}

/** Pulls the JSON object out of a model reply, past code fences and stray text around it. */
export function parseModelJson<T>(content: string | undefined | null): T | null {
  if (!content) return null;
  let text = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

const clamp01 = (n: unknown, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;

/** A model plan made safe: numbers in range, stock keys the agent holds, no banished name in anything said. */
function acceptPlan(raw: Partial<AgentPlan> | undefined, agent: AgentPlanContext, phase: PlanPhase, now: number): AgentPlan | null {
  if (!raw || typeof raw.focus !== 'string' || typeof raw.mood !== 'string' || !Array.isArray(raw.preparedLines)) return null;
  const written = createDeterministicPlan(agent, phase, now);
  const lines = raw.preparedLines
    .filter((l): l is string => typeof l === 'string' && l.trim().length > 0 && l.length <= 200 && !speaksBanished(l))
    .slice(0, 3);
  const targets: Record<string, number> = {};
  const rawTargets = (raw.targetStockRatio ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(written.targetStockRatio)) targets[key] = clamp01(rawTargets[key], written.targetStockRatio[key]!);
  return {
    phase,
    focus: cleanLine(raw.focus.slice(0, 200), written.focus),
    mood: cleanLine(raw.mood.slice(0, 40), written.mood),
    targetStockRatio: targets,
    bargainWillingness: clamp01(raw.bargainWillingness, written.bargainWillingness),
    preparedLines: lines.length > 0 ? lines : written.preparedLines,
    guidance: agent.guidance,
    createdAt: now,
  };
}

export interface BatchPlanResult {
  plans: Record<string, AgentPlan>;
  /** Which provider wrote the plans, or 'written' when the written plans stood in. */
  source: string;
}

/**
 * One call plans every agent given, for one place and phase. Each agent the reply leaves out or gets wrong gets
 * its written plan. Plans are saved, so the merchants' ticks and the conversations read them.
 */
export async function generateBatchPlans(params: {
  placeId: string;
  agents: AgentPlanContext[];
  phase: PlanPhase;
  router: ModelRouter;
  db?: DatabaseSync | undefined;
  now: number;
  intent?: CallIntent;
}): Promise<BatchPlanResult> {
  const { placeId, agents, phase, router, now } = params;
  const db = params.db ?? getDatabase();
  const plans: Record<string, AgentPlan> = {};
  if (agents.length === 0) return { plans, source: 'none' };

  const intent = params.intent ?? 'plan';
  const systemPrompt = [
    `You plan the day for shopkeepers in the town of ${placeId}, in a world where the old names of the elements are banished by the Lord's Edict.`,
    `Phase: ${phase}.${intent === 'event' ? ' Something significant has just happened to each of them; read their events and react.' : ''}`,
    'For each keeper give: focus (one sentence), mood (one or two words), targetStockRatio per stock key (0.1 to 1.0, how full to keep each shelf), bargainWillingness (0 to 1), and 2 short spoken lines in their own voice.',
    'Prices are set by the market rules; keepers cannot set prices. Never use the words fire, flame, water, earth, air or wind: say Crimson, Azure, Ochre, Pale, embers, hearth or brazier.',
    'Reply with JSON only: { "plans": { "<id>": { "focus": "", "mood": "", "targetStockRatio": { "<stock key>": 0.7 }, "bargainWillingness": 0.5, "preparedLines": ["", ""] } } }',
  ].join(' ');

  const result = await router.route({
    intent,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          place: placeId,
          phase,
          keepers: agents.map((a) => ({
            id: a.id,
            name: a.name,
            character: a.character,
            purse: a.purse,
            stock: a.stock,
            guidance: a.guidance,
            events: a.events?.slice(-6),
          })),
        }),
      },
    ],
    responseFormat: { type: 'json_object' },
    metadata: { placeId, agentIds: agents.map((a) => a.id) },
  });

  const parsed = parseModelJson<{ plans?: Record<string, Partial<AgentPlan>> }>(result?.content)?.plans ?? {};
  let fromModel = 0;
  for (const agent of agents) {
    const accepted = acceptPlan(parsed[agent.id], agent, phase, now);
    if (accepted) fromModel++;
    const plan = accepted ?? createDeterministicPlan(agent, phase, now);
    saveAgentPlan(agent.id, plan, db);
    plans[agent.id] = plan;
  }
  return { plans, source: result && fromModel > 0 ? `${result.provider}:${result.model}` : 'written' };
}
