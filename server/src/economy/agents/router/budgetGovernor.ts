import type { GovernorPressureLevel, ProviderConfig, ProviderKey } from './types.js';

export interface GovernorOptions {
  providers: Partial<Record<ProviderKey, ProviderConfig>>;
  /** The free providers whose budget the pressure is read from; defaults to every provider but NEAR AI. */
  pool?: ProviderKey[];
  normalCooldownMs?: number;
  stretchedCooldownMs?: number;
  batchFlushNormalMs?: number;
  batchFlushStretchedMs?: number;
}

export class BudgetGovernor {
  private readonly providers: Partial<Record<ProviderKey, ProviderConfig>>;
  private readonly pool: ProviderKey[];
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
    this.pool = options.pool ?? (Object.keys(options.providers) as ProviderKey[]).filter((k) => k !== 'nearai');
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
    if (!config) return false;

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

  /**
   * How hard the pool is pressed, 0 to 3. Two measures, the worse wins:
   * - pace: calls in the last hour against an even share of the day's budget (the pool's daily total / 24).
   *   Half a share stretches, a full share defers significant events, two shares sends talk to written lines.
   * - the day: what is left of the pool's daily budget (under 40% stretches, 20% defers, 5% is the floor).
   * A minute when every provider is busy is not pressure: those calls just fall back on their own.
   */
  getPressureLevel(now = Date.now()): GovernorPressureLevel {
    let capDay = 0;
    let usedDay = 0;
    let usedHour = 0;
    for (const key of this.pool) {
      const cfg = this.providers[key];
      if (!cfg) continue;
      capDay += cfg.rpd;
      const calls = (this.callHistoryDay.get(key) ?? []).filter((t) => t > now - 24 * 60 * 60_000);
      usedDay += calls.length;
      usedHour += calls.filter((t) => t > now - 60 * 60_000).length;
    }
    if (capDay === 0) return 3;

    const pace = usedHour / (capDay / 24);
    const fromPace: GovernorPressureLevel = pace >= 2 ? 3 : pace >= 1 ? 2 : pace >= 0.5 ? 1 : 0;
    const left = Math.max(0, 1 - usedDay / capDay);
    const fromDay: GovernorPressureLevel = left <= 0.05 ? 3 : left <= 0.2 ? 2 : left <= 0.4 ? 1 : 0;
    return Math.max(fromPace, fromDay) as GovernorPressureLevel;
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
