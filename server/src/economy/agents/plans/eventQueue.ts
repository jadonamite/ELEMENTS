import type { DatabaseSync } from 'node:sqlite';
import type { AgentEvent, EventTier, PlanPhase } from '@elements/shared';
import type { BudgetGovernor } from '../router/budgetGovernor.js';
import type { ModelRouter } from '../router/modelRouter.js';
import { generateBatchPlans, type AgentPlanContext, type BatchPlanResult } from './agentPlan.js';

export interface QueuedEventOptions {
  tier: EventTier;
  type: string;
  description: string;
  metadata?: Record<string, unknown> | undefined;
  timestamp?: number;
}

/** Most events an agent keeps waiting for its next plan. */
const KEEP_EVENTS = 30;

/**
 * Events are queued, never sent. Every event adds a line to the agent's next plan. A significant one also
 * marks the agent dirty; dirty agents in a place are re-planned together in one call, no more often than the
 * place's flush interval, and an agent no more often than its cooldown. Under budget pressure the governor
 * stretches both, then stops marking agents dirty: their events wait for the next phase plan.
 */
export class AgentEventQueue {
  private readonly eventsByAgent = new Map<string, AgentEvent[]>();
  private readonly dirtyAgentsByPlace = new Map<string, Set<string>>();
  private readonly lastAgentFlush = new Map<string, number>();
  private readonly lastPlaceFlush = new Map<string, number>();
  private readonly flushing = new Set<string>();
  /** Counts for the load test and the handover: events by tier, deferrals, flushes. */
  readonly stats = { ordinary: 0, significant: 0, face_to_face: 0, deferred: 0, flushes: 0, flushedAgents: 0 };

  recordEvent(placeId: string, agentId: string, options: QueuedEventOptions, governor?: BudgetGovernor, now = Date.now()): AgentEvent {
    const event: AgentEvent = {
      id: `evt_${now}_${Math.random().toString(36).slice(2, 8)}`,
      tier: options.tier,
      type: options.type,
      description: options.description,
      timestamp: options.timestamp ?? now,
      metadata: options.metadata,
    };
    const list = this.eventsByAgent.get(agentId) ?? [];
    list.push(event);
    if (list.length > KEEP_EVENTS) list.splice(0, list.length - KEEP_EVENTS);
    this.eventsByAgent.set(agentId, list);
    this.stats[options.tier]++;

    if (options.tier === 'significant') {
      if (governor?.shouldDeferTier2(now)) this.stats.deferred++;
      else this.markDirty(placeId, agentId);
    }
    return event;
  }

  markDirty(placeId: string, agentId: string): void {
    let set = this.dirtyAgentsByPlace.get(placeId);
    if (!set) this.dirtyAgentsByPlace.set(placeId, (set = new Set()));
    set.add(agentId);
  }

  isAgentDirty(placeId: string, agentId: string): boolean {
    return this.dirtyAgentsByPlace.get(placeId)?.has(agentId) ?? false;
  }

  getDirtyAgents(placeId: string): string[] {
    return [...(this.dirtyAgentsByPlace.get(placeId) ?? [])];
  }

  getRecentEvents(agentId: string): AgentEvent[] {
    return [...(this.eventsByAgent.get(agentId) ?? [])];
  }

  /** The event lines waiting for an agent's next plan; they are cleared once planned. */
  eventLines(agentId: string): string[] {
    return (this.eventsByAgent.get(agentId) ?? []).map((e) => e.description);
  }

  clearRecentEvents(agentId: string): void {
    this.eventsByAgent.delete(agentId);
  }

  canFlushPlace(placeId: string, governor: BudgetGovernor, now = Date.now()): boolean {
    if (this.flushing.has(placeId)) return false;
    return now - (this.lastPlaceFlush.get(placeId) ?? -Infinity) >= governor.getBatchFlushIntervalMs(now);
  }

  canFlushAgent(agentId: string, governor: BudgetGovernor, now = Date.now()): boolean {
    return now - (this.lastAgentFlush.get(agentId) ?? -Infinity) >= governor.getCooldownMs(now);
  }

  /**
   * Re-plans a place's dirty agents that are past their cooldown, in one call. `contextFor` builds each agent's
   * plan context (with its event lines); agents still cooling down stay dirty for a later flush.
   */
  async flushDirtyAgents(params: {
    placeId: string;
    phase: PlanPhase;
    contextFor: (agentId: string) => AgentPlanContext | null;
    router: ModelRouter;
    governor: BudgetGovernor;
    db?: DatabaseSync | undefined;
    now?: number;
  }): Promise<BatchPlanResult | null> {
    const now = params.now ?? Date.now();
    const { placeId, router, governor } = params;
    const dirty = this.dirtyAgentsByPlace.get(placeId);
    if (!dirty || dirty.size === 0 || !this.canFlushPlace(placeId, governor, now)) return null;

    const ready = [...dirty].filter((id) => this.canFlushAgent(id, governor, now));
    const contexts = ready.map((id) => params.contextFor(id)).filter((c): c is AgentPlanContext => c !== null);
    if (contexts.length === 0) return null;

    this.lastPlaceFlush.set(placeId, now);
    this.flushing.add(placeId);
    for (const c of contexts) {
      dirty.delete(c.id);
      this.lastAgentFlush.set(c.id, now);
    }
    try {
      const result = await generateBatchPlans({ placeId, agents: contexts, phase: params.phase, router, db: params.db, now, intent: 'event' });
      for (const c of contexts) this.clearRecentEvents(c.id);
      this.stats.flushes++;
      this.stats.flushedAgents += contexts.length;
      return result;
    } finally {
      this.flushing.delete(placeId);
    }
  }
}
