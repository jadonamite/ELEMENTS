import {
  type AgentAction,
  type AgentObservation,
  AGENT_CONFIG,
  validateAction,
} from '@elements/shared';
import type { AgentDecider, AgentDeciderResult } from './types.js';
import { RuleDecider } from './ruleDecider.js';

export interface NearAiDeciderOptions {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  model?: string | undefined;
  fetchFn?: typeof fetch | undefined;
  ruleDecider?: AgentDecider | undefined;
  timeoutMs?: number | undefined;
  maxCallsPerHour?: number | undefined;
}

export class NearAiDecider implements AgentDecider {
  private readonly baseUrl: string;
  private readonly apiKey?: string | undefined;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;
  private readonly ruleDecider: AgentDecider;
  private readonly timeoutMs: number;
  private readonly maxCallsPerHour: number;
  private hasLoggedMissingEnv = false;

  private callTimestamps: number[] = [];
  private lastCallTickByMerchant = new Map<string, number>();

  constructor(options: NearAiDeciderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.NEAR_AI_BASE_URL ?? 'https://cloud-api.near.ai/v1').replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env.NEAR_AI_API_KEY;
    this.model = options.model ?? process.env.NEAR_AI_MODEL ?? 'openai/gpt-4.1-mini';
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.ruleDecider = options.ruleDecider ?? new RuleDecider();
    this.timeoutMs = options.timeoutMs ?? AGENT_CONFIG.timeoutMs ?? 5000;
    this.maxCallsPerHour = options.maxCallsPerHour ?? AGENT_CONFIG.maxCallsPerHour ?? 20;
  }

  async decide(obs: AgentObservation): Promise<AgentDeciderResult> {
    const apiKey = this.apiKey ?? process.env.NEAR_AI_API_KEY;

    if (!apiKey) {
      if (!this.hasLoggedMissingEnv) {
        console.warn(
          'NEAR AI configuration missing NEAR_AI_API_KEY; falling back to RuleDecider.',
        );
        this.hasLoggedMissingEnv = true;
      }
      return this.ruleDecider.decide(obs);
    }

    const now = obs.now ?? Date.now();

    // 1. Enforce per-hour call cap (sliding 1-hour window)
    const oneHourAgo = now - 60 * 60 * 1000;
    this.callTimestamps = this.callTimestamps.filter((t) => t > oneHourAgo);
    if (this.callTimestamps.length >= this.maxCallsPerHour) {
      console.warn(
        `[NearAiDecider] Hourly call cap reached (${this.maxCallsPerHour}/hr); falling back to RuleDecider to protect costs.`,
      );
      return this.ruleDecider.decide(obs);
    }

    // 2. Enforce rate cap: at most one call per merchant per tick
    if (obs.now !== undefined) {
      const lastTick = this.lastCallTickByMerchant.get(obs.merchantId);
      if (lastTick !== undefined && lastTick === obs.now) {
        console.warn(
          `[NearAiDecider] Merchant ${obs.merchantId} already queried NEAR AI this tick; falling back to RuleDecider.`,
        );
        return this.ruleDecider.decide(obs);
      }
    }

    const endpoint = `${this.baseUrl}/chat/completions`;

    // Strictly anonymized payload: send roles, inventory, market conditions and numbers only.
    // Never send player names, account IDs, or private data.
    const promptPayload = {
      merchantId: obs.merchantId,
      personality: obs.personality,
      purse: obs.purse,
      solvency: obs.solvencyUrgency ?? {
        distanceToBroke: obs.purse - 1000,
        isWarning: obs.purse < 1500,
        isBroke: obs.purse < 1000,
        daysBroke: obs.daysBroke ?? 0,
      },
      timeOfDay: obs.timeOfDay,
      isOpen: obs.isOpen,
      status: obs.status,
      stock: obs.stock,
      demandWindows: obs.demandWindows,
      marketConditions: obs.floodingSummary,
      customerMemory: obs.customerMemory,
      tributeStatus: obs.tributeStatus,
    };

    const systemPrompt = [
      'You are an NPC merchant in the fantasy market of Sindr.',
      obs.personality ? `Your personality: "${obs.personality}".` : '',
      'Decide your inventory and stall actions for this tick.',
      'You may restock from the Lord supply (costs basePrice * quantity from your purse), ship tribute to the treasury (earns basePrice * tributePriceRatio), set open hours, or say a line.',
      'You CANNOT set prices directly. Prices are determined strictly by market rules.',
      'Weigh your purse solvency against the broke line of 1000 CHROMA, customer relationships, incoming item supply, and tribute deadlines.',
      'Respond ONLY with valid JSON in this exact structure:',
      '{ "actions": [ { "type": "restock", "itemType": "shard", "quantity": 10 } ], "reasoning": "One concise sentence in your character voice." }',
    ]
      .filter(Boolean)
      .join(' ');

    let rawText = '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      // Record call timestamp for cost and tick caps
      this.callTimestamps.push(now);
      if (obs.now !== undefined) {
        this.lastCallTickByMerchant.set(obs.merchantId, obs.now);
      }

      const res = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(promptPayload) },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        console.warn(
          `NEAR AI Cloud request failed with status ${res.status}; falling back to RuleDecider for this tick.`,
        );
        return this.ruleDecider.decide(obs);
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      rawText = json?.choices?.[0]?.message?.content ?? '';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `NEAR AI Cloud error or timeout (${this.timeoutMs}ms): ${message}; falling back to RuleDecider for this tick.`,
      );
      return this.ruleDecider.decide(obs);
    }

    if (!rawText.trim()) {
      return this.ruleDecider.decide(obs);
    }

    // Defensive parsing: strip code blocks if present
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    }

    let parsed: { actions?: unknown[]; reasoning?: unknown };
    try {
      parsed = JSON.parse(cleaned) as { actions?: unknown[]; reasoning?: unknown };
    } catch {
      console.warn(
        'Failed to parse JSON reply from NEAR AI Cloud; falling back to RuleDecider for this tick.',
      );
      return this.ruleDecider.decide(obs);
    }

    const proposedActions = Array.isArray(parsed.actions) ? (parsed.actions as AgentAction[]) : [];
    const reasoning =
      typeof parsed.reasoning === 'string' && parsed.reasoning.trim().length > 0
        ? parsed.reasoning.trim()
        : 'Steady trade across the stalls today.';

    const validActions: AgentAction[] = [];
    for (const act of proposedActions) {
      const validation = validateAction(obs, act);
      if (validation.valid) {
        validActions.push(act);
      } else {
        console.warn(
          `Dropping invalid action from NEAR AI Cloud (${validation.reason}):`,
          act,
        );
      }
    }

    // Log line per decision
    const actionDesc = validActions.map((a) => `${a.type}${'quantity' in a ? `(${a.quantity})` : ''}`).join(', ') || 'none';
    console.log(
      `[MerchantMind:${obs.merchantId}] Decided via NearAi: "${reasoning}" (actions: ${actionDesc})`,
    );

    return {
      actions: validActions,
      reasoning,
    };
  }
}
