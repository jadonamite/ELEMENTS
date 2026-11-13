import type { DatabaseSync } from 'node:sqlite';
import { type AgentPlan, type PlanPhase, speaksBanished, cleanLine } from '@elements/shared';
import { getDatabase } from '../../../db.js';
import { getLatestAgentPlan, saveAgentPlan } from '../db.js';
import { crowdMindsIn, findMind, townsfolkIn, type Mind } from '../minds.js';
import { parseModelJson } from '../plans/agentPlan.js';
import type { ModelRouter } from '../router/modelRouter.js';

export interface TownsfolkMindState {
  id: string;
  name: string;
  role: string;
  placeId: string;
  mood: string;
  routine: string;
  preparedLines: string[];
  phase: PlanPhase;
}

const MOODS: Record<PlanPhase, string> = {
  morning: 'brisk',
  midday: 'steady',
  evening: 'weary but content',
  night: 'quiet and watchful',
};

const ROUTINES: Record<string, Record<PlanPhase, string>> = {
  smith: { morning: 'Stoke the hearth and check the ingots.', midday: 'Hammer blanks and fit grips.', evening: 'Temper edges and bank the coals.', night: 'Lock the racks and tally the coal.' },
  trader: { morning: 'Lay out goods and hear the road news.', midday: 'Haggle through the busy hours.', evening: 'Pack the unsold and count the day.', night: 'Rest and plan tomorrow’s buying.' },
  innkeeper: { morning: 'Air the common room and take the bread.', midday: 'Serve stew to the road crews.', evening: 'Pour for the evening crowd and listen.', night: 'Bolt the doors and settle the ledger.' },
  guard: { morning: 'Walk the post and check the stalls opened peacefully.', midday: 'Watch the square for cutpurses.', evening: 'See the merchants packed safely.', night: 'Hold the gate and challenge anyone lurking.' },
  worshipper: { morning: 'Light the shrine embers and sweep the steps.', midday: 'Offer blessings to passing travellers.', evening: 'Tend the evening incense.', night: 'Keep the brazier lit through the dark.' },
  porter: { morning: 'Unload the early carts.', midday: 'Haul barrels to the stalls.', evening: 'Stack the empty crates.', night: 'Rest by the brazier at the gate.' },
  child: { morning: 'Run errands for a coin.', midday: 'Chase pigeons through the market.', evening: 'Hurry home before the bells.', night: 'Asleep, or pretending to be.' },
};

/** A townsperson's written plan: the routine of their trade for the phase. */
export function createDeterministicTownsfolkPlan(mind: Pick<Mind, 'role'>, phase: PlanPhase, now: number): AgentPlan {
  const routine = ROUTINES[mind.role]?.[phase] ?? 'Go about the day.';
  return {
    phase,
    focus: routine,
    mood: MOODS[phase],
    targetStockRatio: {},
    bargainWillingness: 0,
    preparedLines: [routine, 'The town keeps moving while everyone does their part.'],
    createdAt: now,
  };
}

/**
 * One call plans the light minds of a place for a phase: every named townsperson and one mind per crowd trade.
 * Anyone the reply leaves out keeps the written routine of their trade.
 */
export async function generateTownsfolkBatchPlans(params: {
  placeId: string;
  phase: PlanPhase;
  router: ModelRouter;
  db?: DatabaseSync | undefined;
  now?: number;
  /** Lines about what happened in the place since the last plan, for the town's talk. */
  news?: string[];
}): Promise<{ plans: Record<string, AgentPlan>; source: string }> {
  const now = params.now ?? Date.now();
  const db = params.db ?? getDatabase();
  const { placeId, phase, router } = params;
  const minds = [...townsfolkIn(placeId), ...crowdMindsIn(placeId)];
  const plans: Record<string, AgentPlan> = {};
  if (minds.length === 0) return { plans, source: 'none' };

  const systemPrompt = [
    `You give the townsfolk of ${placeId} a mood and a routine for the ${phase}, in a world where the old names of the elements are banished by the Lord's Edict.`,
    'For each person: focus (their routine now, one sentence), mood (one or two words), and 2 short spoken lines in their own voice.',
    'Never use the words fire, flame, water, earth, air or wind: say Crimson, Azure, Ochre, Pale, embers, hearth or brazier.',
    'Reply with JSON only: { "plans": { "<id>": { "focus": "", "mood": "", "preparedLines": ["", ""] } } }',
  ].join(' ');

  const result = await router.route({
    intent: 'plan',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          place: placeId,
          phase,
          news: params.news?.slice(-8),
          people: minds.map((m) => ({ id: m.id, name: m.kind === 'crowd' ? `any ${m.role}` : m.name, trade: m.role, character: m.character })),
        }),
      },
    ],
    responseFormat: { type: 'json_object' },
    metadata: { placeId, agentIds: minds.map((m) => m.id) },
  });

  const parsed = parseModelJson<{ plans?: Record<string, Partial<AgentPlan>> }>(result?.content)?.plans ?? {};
  let fromModel = 0;
  for (const mind of minds) {
    const raw = parsed[mind.id];
    const written = createDeterministicTownsfolkPlan(mind, phase, now);
    let plan = written;
    if (raw && typeof raw.focus === 'string' && typeof raw.mood === 'string' && Array.isArray(raw.preparedLines)) {
      const lines = raw.preparedLines.filter((l): l is string => typeof l === 'string' && l.trim().length > 0 && l.length <= 200 && !speaksBanished(l)).slice(0, 3);
      plan = {
        ...written,
        focus: cleanLine(raw.focus.slice(0, 200), written.focus),
        mood: cleanLine(raw.mood.slice(0, 40), written.mood),
        preparedLines: lines.length > 0 ? lines : written.preparedLines,
      };
      fromModel++;
    }
    saveAgentPlan(mind.id, plan, db);
    plans[mind.id] = plan;
  }
  return { plans, source: result && fromModel > 0 ? `${result.provider}:${result.model}` : 'written' };
}

/** What a townsperson (or a crowd trade) has in mind now, for the browser. */
export function getTownsfolkMindState(npcId: string, db: DatabaseSync = getDatabase(), now = Date.now()): TownsfolkMindState | null {
  const mind = findMind(npcId);
  if (!mind) return null;
  const plan = getLatestAgentPlan(mind.id, db) ?? createDeterministicTownsfolkPlan(mind, 'morning', now);
  return {
    id: mind.id,
    name: mind.name,
    role: mind.role,
    placeId: mind.place,
    mood: plan.mood,
    routine: plan.focus,
    preparedLines: plan.preparedLines,
    phase: plan.phase,
  };
}
