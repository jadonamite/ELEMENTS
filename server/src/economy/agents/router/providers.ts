import { AGENT_ROUTER_CONFIG } from '@elements/shared';
import type { ModelCallPayload, ModelCallResult, ProviderConfig, ProviderKey } from './types.js';

/** Environment variable that holds each provider's key. */
const KEY_ENV: Record<ProviderKey, string> = {
  nvidia: 'NVIDIA_API_KEY',
  cloudflare: 'CLOUDFLARE_API_TOKEN',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  nearai: 'NEAR_AI_API_KEY',
};

interface RouterBalance {
  order?: ProviderKey[];
  cooldowns?: { normalMs?: number; stretchedMs?: number; batchFlushNormalMs?: number; batchFlushStretchedMs?: number };
  providers?: Partial<Record<ProviderKey, Omit<ProviderConfig, 'key' | 'apiKeyEnv'>>>;
}

const routerBalance = (): RouterBalance => (AGENT_ROUTER_CONFIG ?? {}) as RouterBalance;

/** Free providers in the order the router tries them; NEAR AI is never in it (it judges only). */
export function getProviderOrder(): ProviderKey[] {
  return (routerBalance().order ?? ['nvidia', 'cloudflare', 'gemini', 'groq', 'openrouter']).filter((k) => k !== 'nearai');
}

export function getRouterCooldowns(): Required<NonNullable<RouterBalance['cooldowns']>> {
  const c = routerBalance().cooldowns ?? {};
  return {
    normalMs: c.normalMs ?? 15_000,
    stretchedMs: c.stretchedMs ?? 30_000,
    batchFlushNormalMs: c.batchFlushNormalMs ?? 5_000,
    batchFlushStretchedMs: c.batchFlushStretchedMs ?? 12_000,
  };
}

/** Providers from balance.json, with URLs filled from the environment (Cloudflare's account, NEAR AI's base). */
export function getProviderConfigs(): Partial<Record<ProviderKey, ProviderConfig>> {
  const out: Partial<Record<ProviderKey, ProviderConfig>> = {};
  for (const [key, raw] of Object.entries(routerBalance().providers ?? {}) as Array<[ProviderKey, Omit<ProviderConfig, 'key' | 'apiKeyEnv'>]>) {
    if (!KEY_ENV[key]) continue;
    let baseUrl = raw.baseUrl;
    if (key === 'cloudflare') baseUrl = baseUrl.replace('{accountId}', process.env.CLOUDFLARE_ACCOUNT_ID ?? '');
    if (key === 'nearai' && process.env.NEAR_AI_BASE_URL) baseUrl = process.env.NEAR_AI_BASE_URL;
    const models = { ...raw.models };
    if (key === 'nearai' && process.env.NEAR_AI_MODEL) models.judge = process.env.NEAR_AI_MODEL;
    out[key] = { ...raw, key, baseUrl, models, apiKeyEnv: KEY_ENV[key] };
  }
  return out;
}

/** An HTTP refusal from a provider, with its status so the router can tell a spent account from a busy one. */
export class ProviderHttpError extends Error {
  constructor(readonly status: number, statusText: string) {
    super(`HTTP ${status}: ${statusText}`);
  }
}

export async function executeProviderCall(
  config: ProviderConfig,
  apiKey: string,
  payload: ModelCallPayload,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ModelCallResult> {
  const model = config.models[payload.intent] ?? config.models.plan ?? config.models.event ?? 'default';
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const requestBody: Record<string, unknown> = {
    model,
    messages: payload.messages,
    temperature: payload.temperature ?? 0.2,
    ...(config.extraBody ?? {}),
  };
  if (payload.responseFormat) requestBody.response_format = payload.responseFormat;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), payload.intent === 'conversation' ? (config.talkTimeoutMs ?? 4000) : config.timeoutMs);
  const startTime = Date.now();

  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(config.extraHeaders ?? {}),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startTime;
    if (!res.ok) throw new ProviderHttpError(res.status, res.statusText);

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    const content = json?.choices?.[0]?.message?.content ?? '';
    return {
      provider: config.key,
      model,
      content,
      latencyMs,
      tokensEstimate: json?.usage?.total_tokens ?? Math.ceil(content.length / 4),
    };
  } finally {
    clearTimeout(timer);
  }
}
