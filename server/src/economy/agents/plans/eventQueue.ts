import {
  type AgentAction,
  type AgentEvent,
  type EventTier,
} from '@elements/shared';
import type { BudgetGovernor } from '../router/budgetGovernor.js';
import type { ModelRouter } from '../router/modelRouter.js';
import type { AgentPlanContext } from './agentPlan.js';

export interface QueuedEventOptions {
  tier: EventTier;
  type: string;
  description: string;
  metadata?: Record<string, unknown> | undefined;
  timestamp?: number;
}

export interface FlushResult {
  agentId: string;
  reasoning: string;
  actions: AgentAction[];
}

export class AgentEventQueue {
  private readonly eventsByAgent = new Map<string, AgentEvent[]>();
  private readonly dirtyAgentsByPlace = new Map<string, Set<string>>();
  private readonly lastAgentFlush = new Map<string, number>();
  private readonly lastPlaceFlush = new Map<string, number>();

  recordEvent(
    placeId: string,
    agentId: string,
    options: QueuedEventOptions,
    governor?: BudgetGovernor,
    now = Date.now(),
  ): AgentEvent {
    const event: AgentEvent = {
      id: `evt_${now}_${Math.random().toString(36).slice(2, 8)}`,
      tier: options.tier,
      type: options.type,
      description: options.description,
      timestamp: options.timestamp ?? now,
      metadata: options.metadata,
    };

    // Append to agent's event history
    const list = this.eventsByAgent.get(agentId) ?? [];
    list.push(event);
    if (list.length > 30) {
      list.splice(0, list.length - 30);
    }
    this.eventsByAgent.set(agentId, list);

    // Tier 1: face_to_face is handled synchronously by conversation engine
    // Tier 2: significant marks agent dirty unless governor defers
    if (options.tier === 'significant') {
      const shouldDefer = governor ? governor.shouldDeferTier2(now) : false;
      if (!shouldDefer) {
        this.markDirty(placeId, agentId);
      }
    }
    // Tier 3: ordinary is solely folded into next observation, no wake

    return event;
  }

  markDirty(placeId: string, agentId: string): void {
    let placeSet = this.dirtyAgentsByPlace.get(placeId);
    if (!placeSet) {
      placeSet = new Set<string>();
      this.dirtyAgentsByPlace.set(placeId, placeSet);
    }
    placeSet.add(agentId);
  }

  isAgentDirty(placeId: string, agentId: string): boolean {
    return this.dirtyAgentsByPlace.get(placeId)?.has(agentId) ?? false;
  }

  getDirtyAgents(placeId: string): string[] {
    const set = this.dirtyAgentsByPlace.get(placeId);
    return set ? Array.from(set) : [];
  }

  getRecentEvents(agentId: string): AgentEvent[] {
    return [...(this.eventsByAgent.get(agentId) ?? [])];
  }

  clearRecentEvents(agentId: string): void {
    this.eventsByAgent.set(agentId, []);
  }

  canFlushPlace(placeId: string, governor: BudgetGovernor, now = Date.now()): boolean {
    const lastFlush = this.lastPlaceFlush.get(placeId) ?? 0;
    const interval = governor.getBatchFlushIntervalMs(now);
    return now - lastFlush >= interval;
  }

  canFlushAgent(agentId: string, governor: BudgetGovernor, now = Date.now()): boolean {
    const lastFlush = this.lastAgentFlush.get(agentId) ?? 0;
    const cooldown = governor.getCooldownMs(now);
    return now - lastFlush >= cooldown;
  }

  async flushDirtyAgents(params: {
    placeId: string;
    agents: AgentPlanContext[];
    router: ModelRouter;
    governor: BudgetGovernor;
    now?: number;
  }): Promise<Record<string, FlushResult>> {
    const now = params.now ?? Date.now();
    const { placeId, agents, router, governor } = params;

    const dirtySet = this.dirtyAgentsByPlace.get(placeId);
    if (!dirtySet || dirtySet.size === 0) {
      return {};
    }

    // Filter agents: must be dirty and past cooldown
    const eligibleAgents = agents.filter(
      (a) => dirtySet.has(a.id) && this.canFlushAgent(a.id, governor, now),
    );

    if (eligibleAgents.length === 0) {
      return {};
    }

    this.lastPlaceFlush.set(placeId, now);

    // Build batch payload for significant events
    const batchInput = eligibleAgents.map((a) => ({
      agentId: a.id,
      role: a.role,
      name: a.name,
      purse: a.purse,
      recentEvents: (this.eventsByAgent.get(a.id) ?? []).slice(-5),
    }));

    const systemPrompt = [
      `You are the responsive mind engine for agents in ${placeId}.`,
      'A significant event has occurred (purse near broke line, large sale/purchase, or local disturbance).',
      'Provide concise, urgent action reactions and a 1-sentence reasoning line per agent.',
      'Respond ONLY with valid JSON in this exact structure:',
      '{ "reactions": { "agent_id": { "reasoning": "string", "actions": [] } } }',
    ].join(' ');

    const results: Record<string, FlushResult> = {};

    let modelResponse: Record<string, { reasoning?: string; actions?: AgentAction[] }> = {};

    // Only route to model if governor allows
    if (!governor.shouldUseTemplateFloor(now)) {
      const callResult = await router.route({
        intent: 'event',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ place: placeId, agents: batchInput }) },
        ],
        responseFormat: { type: 'json_object' },
        metadata: {
          placeId,
          agentIds: eligibleAgents.map((a) => a.id),
        },
      });

      if (callResult?.content) {
        try {
          let cleaned = callResult.content.trim();
          if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
          }
          const parsed = JSON.parse(cleaned) as {
            reactions?: Record<string, { reasoning?: string; actions?: AgentAction[] }>;
          };
          if (parsed && typeof parsed.reactions === 'object') {
            modelResponse = parsed.reactions;
          }
        } catch {
          console.warn(`[EventQueue] Failed to parse batch event response for ${placeId}; using deterministic fallbacks.`);
        }
      }
    }

    for (const agent of eligibleAgents) {
      const reaction = modelResponse[agent.id];
      if (reaction && typeof reaction.reasoning === 'string' && Array.isArray(reaction.actions)) {
        results[agent.id] = {
          agentId: agent.id,
          reasoning: reaction.reasoning,
          actions: reaction.actions,
        };
      } else {
        // Fallback: rule-based reaction
        const lastEvt = (this.eventsByAgent.get(agent.id) ?? []).slice(-1)[0];
        results[agent.id] = {
          agentId: agent.id,
          reasoning: lastEvt
            ? `Noticed ${lastEvt.description}; adjusting caution.`
            : 'Activity in the square calls for closer attention.',
          actions: [],
        };
      }

      // Mark agent clean and update cooldown
      dirtySet.delete(agent.id);
      this.lastAgentFlush.set(agent.id, now);
    }

    return results;
  }
}
