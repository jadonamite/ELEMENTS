import { BudgetGovernor } from './budgetGovernor.js';
import { executeProviderCall, getProviderConfigs } from './providers.js';
import type {
  CallIntent,
  ModelCallPayload,
  ModelCallResult,
  ProviderConfig,
  ProviderKey,
  TelemetryLog,
} from './types.js';

export interface ModelRouterOptions {
  governor?: BudgetGovernor;
  providerConfigs?: Record<ProviderKey, ProviderConfig>;
  order?: ProviderKey[];
  fetchFn?: typeof fetch;
}

export class ModelRouter {
  readonly governor: BudgetGovernor;
  private readonly providerConfigs: Record<ProviderKey, ProviderConfig>;
  private readonly order: ProviderKey[];
  private readonly fetchFn: typeof fetch;
  private readonly telemetryLogs: TelemetryLog[] = [];

  constructor(options: ModelRouterOptions = {}) {
    this.providerConfigs = options.providerConfigs ?? getProviderConfigs();
    this.governor =
      options.governor ??
      new BudgetGovernor({
        providers: this.providerConfigs,
      });
    this.order = options.order ?? ['nvidia', 'cloudflare', 'gemini', 'groq', 'openrouter'];
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async route(payload: ModelCallPayload): Promise<ModelCallResult | null> {
    const now = Date.now();

    // 1. Daily Judge calls go exclusively to NEAR AI Cloud
    if (payload.intent === 'judge') {
      return this.callSpecificProvider('nearai', payload, now);
    }

    // 2. If Governor is at Template Floor (pressure level 3), skip models for conversations
    if (this.governor.shouldUseTemplateFloor(now) && payload.intent === 'conversation') {
      return null;
    }

    // 3. Try providers in priority order
    for (const providerKey of this.order) {
      const config = this.providerConfigs[providerKey];
      if (!config) continue;

      const apiKey = process.env[config.apiKeyEnv];
      if (!apiKey) continue;

      if (!this.governor.hasBudget(providerKey, now)) {
        continue;
      }

      const startTime = Date.now();
      try {
        const result = await executeProviderCall(config, apiKey, payload, this.fetchFn);
        this.governor.recordCall(providerKey, now);

        this.recordTelemetry({
          timestamp: now,
          intent: payload.intent,
          provider: providerKey,
          model: result.model,
          success: true,
          latencyMs: result.latencyMs,
        });

        console.log(
          `[Router] ${providerKey}/${result.model} (${payload.intent}): ${result.latencyMs}ms (~${result.tokensEstimate} tokens)`,
        );

        return result;
      } catch (err: unknown) {
        const latencyMs = Date.now() - startTime;
        const msg = err instanceof Error ? err.message : String(err);
        const is429 = msg.includes('429') || /rate limit/i.test(msg);

        this.governor.recordFailure(providerKey, is429 ? 60000 : 30000, now);
        this.recordTelemetry({
          timestamp: now,
          intent: payload.intent,
          provider: providerKey,
          model: config.models[payload.intent] ?? 'default',
          success: false,
          latencyMs,
          error: msg,
        });

        console.warn(
          `[Router] ${providerKey} failed (${msg}); routing to next provider in pool.`,
        );
      }
    }

    // All available model providers in chain exhausted
    console.warn(`[Router] All model providers exhausted for ${payload.intent}; falling back to deterministic floor.`);
    return null;
  }

  private async callSpecificProvider(
    providerKey: ProviderKey,
    payload: ModelCallPayload,
    now: number,
  ): Promise<ModelCallResult | null> {
    const config = this.providerConfigs[providerKey];
    if (!config) return null;

    const apiKey = process.env[config.apiKeyEnv];
    if (!apiKey) {
      console.warn(`[Router] API key missing for ${providerKey} (${config.apiKeyEnv}); cannot execute.`);
      return null;
    }

    const startTime = Date.now();
    try {
      const result = await executeProviderCall(config, apiKey, payload, this.fetchFn);
      this.governor.recordCall(providerKey, now);

      this.recordTelemetry({
        timestamp: now,
        intent: payload.intent,
        provider: providerKey,
        model: result.model,
        success: true,
        latencyMs: result.latencyMs,
      });

      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.recordTelemetry({
        timestamp: now,
        intent: payload.intent,
        provider: providerKey,
        model: config.models[payload.intent] ?? 'default',
        success: false,
        latencyMs: Date.now() - startTime,
        error: msg,
      });
      console.warn(`[Router] Provider ${providerKey} failed for ${payload.intent}: ${msg}`);
      return null;
    }
  }

  private recordTelemetry(log: TelemetryLog): void {
    this.telemetryLogs.push(log);
    if (this.telemetryLogs.length > 500) {
      this.telemetryLogs.shift();
    }
  }

  getRecentTelemetry(): TelemetryLog[] {
    return [...this.telemetryLogs];
  }
}
