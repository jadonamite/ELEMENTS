import { BudgetGovernor } from './budgetGovernor.js';
import { economyNow } from '../clock.js';
import {
  executeProviderCall,
  getProviderConfigs,
  getProviderOrder,
  getRouterCooldowns,
  ProviderHttpError,
} from './providers.js';
import type {
  ModelCallPayload,
  ModelCallResult,
  ProviderConfig,
  ProviderKey,
  TelemetryLog,
} from './types.js';

export interface ModelRouterOptions {
  governor?: BudgetGovernor;
  providerConfigs?: Partial<Record<ProviderKey, ProviderConfig>>;
  order?: ProviderKey[];
  fetchFn?: typeof fetch;
  /** Reads a provider's key; the environment by default. */
  keyFor?: (env: string) => string | undefined;
  /** Clock for budgets and telemetry; wall time by default. */
  now?: () => number;
  log?: (line: string) => void;
}

/** Providers a face-to-face line may try before a written line answers: the player is waiting. */
const TALK_ATTEMPTS = 2;

/** Statuses that mean the account itself is refused (no credit, bad or revoked key): retrying cannot help. */
const ACCOUNT_REFUSED = new Set([401, 402, 403]);

/**
 * Every model call in the game goes through here. Plans, event flushes, conversations and the chronicle try the
 * free providers in order and get null when none can answer, so the caller falls back to its written lines.
 * The daily judge goes to NEAR AI only. A provider that refuses the account itself is switched off for the life
 * of the process, with one log line.
 */
export class ModelRouter {
  readonly governor: BudgetGovernor;
  private readonly providerConfigs: Partial<Record<ProviderKey, ProviderConfig>>;
  private readonly order: ProviderKey[];
  private readonly fetchFn: typeof fetch;
  private readonly keyFor: (env: string) => string | undefined;
  private readonly clock: () => number;
  private readonly log: (line: string) => void;
  private readonly telemetryLogs: TelemetryLog[] = [];
  private readonly switchedOff = new Map<ProviderKey, string>();

  constructor(options: ModelRouterOptions = {}) {
    this.providerConfigs = options.providerConfigs ?? getProviderConfigs();
    this.keyFor = options.keyFor ?? ((env) => process.env[env] || undefined);
    this.order = (options.order ?? getProviderOrder()).filter((k) => k !== 'nearai');
    const cooldowns = getRouterCooldowns();
    this.governor =
      options.governor ??
      new BudgetGovernor({
        providers: this.providerConfigs,
        pool: this.order.filter((k) => this.hasKey(k)),
        normalCooldownMs: cooldowns.normalMs,
        stretchedCooldownMs: cooldowns.stretchedMs,
        batchFlushNormalMs: cooldowns.batchFlushNormalMs,
        batchFlushStretchedMs: cooldowns.batchFlushStretchedMs,
      });
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.clock = options.now ?? economyNow;
    this.log = options.log ?? ((line) => console.log(`[router] ${line}`));
  }

  private hasKey(key: ProviderKey): boolean {
    const cfg = this.providerConfigs[key];
    return !!cfg && !!this.keyFor(cfg.apiKeyEnv);
  }

  /** True while the daily judge can be asked: NEAR AI has a key and has not refused the account. */
  judgeAvailable(): boolean {
    return this.hasKey('nearai') && !this.switchedOff.has('nearai');
  }

  /** Why a provider was switched off, if it was. */
  offReason(key: ProviderKey): string | undefined {
    return this.switchedOff.get(key);
  }

  async route(payload: ModelCallPayload): Promise<ModelCallResult | null> {
    if (payload.intent === 'judge') return this.judge(payload);

    const now = this.clock();
    if (payload.intent === 'conversation' && this.governor.shouldUseTemplateFloor(now)) return null;

    let attempts = 0;
    for (const key of this.order) {
      if (this.switchedOff.has(key) || !this.hasKey(key)) continue;
      if (!this.governor.hasBudget(key, now)) continue;
      if (payload.intent === 'conversation' && attempts >= TALK_ATTEMPTS) break;
      attempts++;
      const result = await this.attempt(key, payload, now);
      if (result) return result;
    }
    this.log(`no free provider could answer ${payload.intent}; written lines stand in`);
    return null;
  }

  private async judge(payload: ModelCallPayload): Promise<ModelCallResult | null> {
    if (!this.judgeAvailable()) return null;
    const now = this.clock();
    if (!this.governor.hasBudget('nearai', now)) return null;
    return this.attempt('nearai', payload, now);
  }

  private async attempt(key: ProviderKey, payload: ModelCallPayload, now: number): Promise<ModelCallResult | null> {
    const config = this.providerConfigs[key]!;
    const apiKey = this.keyFor(config.apiKeyEnv)!;
    const started = Date.now();
    // A call counts against the budget whether or not it succeeds: the provider counted it.
    this.governor.recordCall(key, now);
    try {
      const result = await executeProviderCall(config, apiKey, payload, this.fetchFn);
      this.recordTelemetry({ timestamp: now, intent: payload.intent, provider: key, model: result.model, success: true, latencyMs: result.latencyMs });
      this.log(`${key}/${result.model} ${payload.intent} ${result.latencyMs} ms`);
      return result;
    } catch (err: unknown) {
      const status = err instanceof ProviderHttpError ? err.status : undefined;
      const msg = err instanceof Error ? err.message : String(err);
      this.recordTelemetry({
        timestamp: now,
        intent: payload.intent,
        provider: key,
        model: config.models[payload.intent] ?? 'default',
        success: false,
        ...(status !== undefined ? { statusCode: status } : {}),
        latencyMs: Date.now() - started,
        error: msg,
      });
      if (status !== undefined && ACCOUNT_REFUSED.has(status)) {
        this.switchedOff.set(key, msg);
        this.log(`${key} refused the account (${msg}); switched off until the server restarts`);
      } else {
        this.governor.recordFailure(key, status === 429 ? 60_000 : 30_000, now);
        this.log(`${key} failed ${payload.intent} (${msg}); trying the next provider`);
      }
      return null;
    }
  }

  private recordTelemetry(entry: TelemetryLog): void {
    this.telemetryLogs.push(entry);
    if (this.telemetryLogs.length > 2000) this.telemetryLogs.shift();
  }

  getRecentTelemetry(): TelemetryLog[] {
    return [...this.telemetryLogs];
  }
}
