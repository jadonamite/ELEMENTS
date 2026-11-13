import type { DatabaseSync } from 'node:sqlite';
import { type AgentPlan, type PlanPhase } from '@elements/shared';
import { getDatabase } from '../../../db.js';
import { getLatestAgentPlan, saveAgentPlan } from '../db.js';
import type { ModelRouter } from '../router/modelRouter.js';
import { SINDR_TOWNSFOLK, type TownsfolkDefinition } from './townsfolkRoster.js';

export interface TownsfolkMindState {
  id: string;
  name: string;
  role: string;
  placeId: string;
  mood: string;
  routine: string;
  focus: string;
  preparedLines: string[];
  phase: PlanPhase;
}

export function createDeterministicTownsfolkPlan(
  def: TownsfolkDefinition,
  phase: PlanPhase,
  now: number,
): AgentPlan {
  const routine = def.defaultRoutines[phase];
  const moods: Record<PlanPhase, string> = {
    morning: 'brisk and dutiful',
    midday: 'steady and focused',
    evening: 'weary but content',
    night: 'quiet and watchful',
  };

  return {
    phase,
    focus: routine,
    mood: moods[phase],
    targetStockRatio: {},
    bargainWillingness: 0,
    preparedLines: [
      `At my post for the ${phase}; ${routine.toLowerCase()}`,
      `Sindr stays in motion while everyone does their part.`,
    ],
    createdAt: now,
  };
}

export async function generateTownsfolkBatchPlans(params: {
  placeId: string;
  townsfolk?: TownsfolkDefinition[];
  phase: PlanPhase;
  router: ModelRouter;
  db?: DatabaseSync;
  now?: number;
}): Promise<Record<string, AgentPlan>> {
  const now = params.now ?? Date.now();
  const db = params.db ?? getDatabase();
  const { placeId, phase, router } = params;

  const roster = (params.townsfolk ?? SINDR_TOWNSFOLK).filter((t) => t.placeId === placeId);
  const plans: Record<string, AgentPlan> = {};

  if (roster.length === 0) return plans;

  const promptTownsfolk = roster.map((t) => ({
    id: t.id,
    name: t.name,
    role: t.role,
    personality: t.personality,
    defaultRoutine: t.defaultRoutines[phase],
  }));

  const systemPrompt = [
    `You are the mind engine for townsfolk NPCs in ${placeId}.`,
    `Current daily phase: ${phase.toUpperCase()}.`,
    'Plan a brief daily routine, mood, and 2 in-character spoken lines for each citizen.',
    'Keep lines grounded, medieval-fantasy, and respectful of lore.',
    'Respond ONLY with valid JSON in this exact structure:',
    '{ "plans": { "npc_id": { "focus": "string", "mood": "string", "preparedLines": ["line 1", "line 2"] } } }',
  ].join(' ');

  let parsedPlans: Record<string, Partial<AgentPlan>> = {};

  try {
    const result = await router.route({
      intent: 'plan',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ place: placeId, phase, townsfolk: promptTownsfolk }) },
      ],
      responseFormat: { type: 'json_object' },
      metadata: {
        placeId,
        agentIds: roster.map((t) => t.id),
      },
    });

    if (result?.content) {
      let cleaned = result.content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      }
      const parsed = JSON.parse(cleaned) as { plans?: Record<string, Partial<AgentPlan>> };
      if (parsed && typeof parsed.plans === 'object') {
        parsedPlans = parsed.plans;
      }
    }
  } catch {
    console.warn(`[Townsfolk] Batch plan failed for ${placeId}; using deterministic routines.`);
  }

  for (const def of roster) {
    const raw = parsedPlans[def.id];
    let plan: AgentPlan;

    if (
      raw &&
      typeof raw.focus === 'string' &&
      typeof raw.mood === 'string' &&
      Array.isArray(raw.preparedLines)
    ) {
      plan = {
        phase,
        focus: raw.focus,
        mood: raw.mood,
        targetStockRatio: {},
        bargainWillingness: 0,
        preparedLines: raw.preparedLines.filter((l) => typeof l === 'string'),
        createdAt: now,
      };
    } else {
      plan = createDeterministicTownsfolkPlan(def, phase, now);
    }

    saveAgentPlan(def.id, plan, db);
    plans[def.id] = plan;
  }

  return plans;
}

export function getTownsfolkMindState(
  npcId: string,
  db: DatabaseSync = getDatabase(),
  now = Date.now(),
): TownsfolkMindState | null {
  const def = SINDR_TOWNSFOLK.find((t) => t.id === npcId);
  if (!def) return null;

  const plan = getLatestAgentPlan(npcId, db);
  const phase = plan?.phase ?? 'morning';

  return {
    id: def.id,
    name: def.name,
    role: def.role,
    placeId: def.placeId,
    mood: plan?.mood ?? 'steady',
    routine: plan?.focus ?? def.defaultRoutines[phase],
    focus: plan?.focus ?? def.defaultRoutines[phase],
    preparedLines: plan?.preparedLines ?? [
      `At my post in ${def.placeId}.`,
      'Fair day in Sindr.',
    ],
    phase,
  };
}
