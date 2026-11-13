import type { GovernorPressureLevel, ProviderConfig, ProviderKey } from './types.js';

export interface GovernorOptions {
  providers: Record<string, ProviderConfig>;
  normalCooldownMs?: number;
  stretchedCooldownMs?: number;
  batchFlushNormalMs?: number;
  batchFlushStretchedMs?: number;
}

export class BudgetGovernor {
  private readonly providers: Record<string, ProviderConfig>;
  private readonly normalCooldownMs: number;
  private readonly stretchedCooldownMs: number;
  private readonly batchFlushNormalMs: number;
  private readonly batchFlushStretchedMs: number;

  // Timestamps of calls per provider
  private readonly callHistoryMinute = new Map<ProviderKey, number[]>();
  private readonly callHistoryDay = new Map<ProviderKey, number[]>();

  // Temporary health penalty / circuit breaker per provider (timestamp when cooldown expires)
  private readonly providerCooldownUntil = new Map<ProviderKey, number>();

  constructor(options: GovernorOptions) {
    this.providers = options.providers;
    this.normalCooldownMs = options.normalCooldownMs ?? 15000;
    this.stretchedCooldownMs = options.stretchedCooldownMs ?? 30000;
    this.batchFlushNormalMs = options.batchFlushNormalMs ?? 5000;
    this.batchFlushStretchedMs = options.batchFlushStretchedMs ?? 12000;
  }

  recordCall(provider: ProviderKey, now = Date.now()): void {
    const minList = this.callHistoryMinute.get(provider) ?? [];
    minList.push(now);
    this.callHistoryMinute.set(provider, minList);

    const dayList = this.callHistoryDay.get(provider) ?? [];
    dayList.push(now);
    this.callHistoryDay.set(provider, dayList);
  }

  recordFailure(provider: ProviderKey, cooldownMs = 30000, now = Date.now()): void {
    this.providerCooldownUntil.set(provider, now + cooldownMs);
  }

  isProviderHealthy(provider: ProviderKey, now = Date.now()): boolean {
    const cooldown = this.providerCooldownUntil.get(provider) ?? 0;
    return now >= cooldown;
  }

  hasBudget(provider: ProviderKey, now = Date.now()): boolean {
    if (!this.isProviderHealthy(provider, now)) return false;

    const config = this.providers[provider];
    if (!config) return true; // Rule provider or untracked

    // Prune minute history
    const oneMinAgo = now - 60_000;
    const minCalls = (this.callHistoryMinute.get(provider) ?? []).filter((t) => t > oneMinAgo);
    this.callHistoryMinute.set(provider, minCalls);
    if (minCalls.length >= config.rpm) return false;

    // Prune day history
    const oneDayAgo = now - 24 * 60 * 60_000;
    const dayCalls = (this.callHistoryDay.get(provider) ?? []).filter((t) => t > oneDayAgo);
    this.callHistoryDay.set(provider, dayCalls);
    if (dayCalls.length >= config.rpd) return false;

    return true;
  }

  getPressureLevel(now = Date.now()): GovernorPressureLevel {
    // Check key free batch workers: nvidia, cloudflare, gemini, groq
    const trackedKeys: ProviderKey[] = ['nvidia', 'cloudflare', 'gemini', 'groq'];
    let totalCapDay = 0;
    let totalUsedDay = 0;
    let availableCount = 0;

    for (const key of trackedKeys) {
      const cfg = this.providers[key];
      if (!cfg) continue;

      totalCapDay += cfg.rpd;
      const oneDayAgo = now - 24 * 60 * 60_000;
      const dayCalls = (this.callHistoryDay.get(key) ?? []).filter((t) => t > oneDayAgo);
      totalUsedDay += dayCalls.length;

      if (this.hasBudget(key, now)) {
        availableCount++;
      }
    }

    if (totalCapDay === 0 || availableCount === 0) {
      return 3; // Template Floor
    }

    const remainingFraction = Math.max(0, 1 - totalUsedDay / totalCapDay);

    if (remainingFraction > 0.40 && availableCount >= 2) {
      return 0; // Normal
    } else if (remainingFraction > 0.20 && availableCount >= 1) {
      return 1; // Stretched
    } else if (remainingFraction > 0.05 && availableCount >= 1) {
      return 2; // Deferred
    } else {
      return 3; // Template Floor
    }
  }

  getCooldownMs(now = Date.now()): number {
    const pressure = this.getPressureLevel(now);
    if (pressure === 0) return this.normalCooldownMs;
    if (pressure === 1) return this.stretchedCooldownMs;
    return this.stretchedCooldownMs * 2;
  }

  getBatchFlushIntervalMs(now = Date.now()): number {
    const pressure = this.getPressureLevel(now);
    if (pressure === 0) return this.batchFlushNormalMs;
    if (pressure === 1) return this.batchFlushStretchedMs;
    return this.batchFlushStretchedMs * 2;
  }

  shouldDeferTier2(now = Date.now()): boolean {
    return this.getPressureLevel(now) >= 2;
  }

  shouldUseTemplateFloor(now = Date.now()): boolean {
    return this.getPressureLevel(now) >= 3;
  }

  getUsageStats(now = Date.now()): Record<string, { minuteCalls: number; dayCalls: number; rpmLimit: number; rpdLimit: number; healthy: boolean }> {
    const stats: Record<string, { minuteCalls: number; dayCalls: number; rpmLimit: number; rpdLimit: number; healthy: boolean }> = {};
    const oneMinAgo = now - 60_000;
    const oneDayAgo = now - 24 * 60 * 60_000;

    for (const [key, cfg] of Object.entries(this.providers)) {
      const pKey = key as ProviderKey;
      const minCalls = (this.callHistoryMinute.get(pKey) ?? []).filter((t) => t > oneMinAgo);
      const dayCalls = (this.callHistoryDay.get(pKey) ?? []).filter((t) => t > oneDayAgo);
      stats[key] = {
        minuteCalls: minCalls.length,
        dayCalls: dayCalls.length,
        rpmLimit: cfg.rpm,
        rpdLimit: cfg.rpd,
        healthy: this.isProviderHealthy(pKey, now),
      };
    }
    return stats;
  }
}
