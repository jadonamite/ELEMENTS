import {
  type AgentAction,
  type AgentObservation,
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
}

export class NearAiDecider implements AgentDecider {
  private readonly baseUrl?: string | undefined;
  private readonly apiKey?: string | undefined;
  private readonly model?: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly ruleDecider: AgentDecider;
  private readonly timeoutMs: number;
  private hasLoggedMissingEnv = false;

  constructor(options: NearAiDeciderOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.NEAR_AI_BASE_URL;
    this.apiKey = options.apiKey ?? process.env.NEAR_AI_API_KEY;
    this.model = options.model ?? process.env.NEAR_AI_MODEL;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.ruleDecider = options.ruleDecider ?? new RuleDecider();
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async decide(obs: AgentObservation): Promise<AgentDeciderResult> {
    const baseUrl = this.baseUrl ?? process.env.NEAR_AI_BASE_URL;
    const apiKey = this.apiKey ?? process.env.NEAR_AI_API_KEY;
    const model = this.model ?? process.env.NEAR_AI_MODEL;

    if (!baseUrl || !apiKey || !model) {
      if (!this.hasLoggedMissingEnv) {
        console.warn(
          'NEAR AI configuration missing (NEAR_AI_BASE_URL, NEAR_AI_API_KEY, or NEAR_AI_MODEL); falling back to RuleDecider.',
        );
        this.hasLoggedMissingEnv = true;
      }
      return this.ruleDecider.decide(obs);
    }

    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const promptPayload = {
      merchantId: obs.merchantId,
      personality: obs.personality,
      purse: obs.purse,
      timeOfDay: obs.timeOfDay,
      isOpen: obs.isOpen,
      status: obs.status,
      stock: obs.stock,
      recentDemand: obs.demandWindows,
    };

    const systemPrompt = [
      'You are an NPC merchant in the fantasy market of Sindr.',
      obs.personality ? `Your personality: "${obs.personality}".` : '',
      'Decide your inventory and stall actions for this tick.',
      'You may restock from the Lord supply (costs basePrice * quantity from your purse), ship tribute to the treasury (earns basePrice * quantity), set open hours, or say a line.',
      'You CANNOT set prices directly. Prices are determined by the market rules.',
      'Respond ONLY with valid JSON in this exact structure:',
      '{ "actions": [ { "type": "restock", "itemType": "shard", "quantity": 10 } ], "reasoning": "One concise sentence in your character voice." }',
    ]
      .filter(Boolean)
      .join(' ');

    let rawText = '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(promptPayload) },
          ],
          temperature: 0.2,
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

    return {
      actions: validActions,
      reasoning,
    };
  }
}
