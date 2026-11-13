import type { ModelCallPayload, ModelCallResult, ProviderConfig, ProviderKey } from './types.js';

export function getProviderConfigs(): Record<ProviderKey, ProviderConfig> {
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';

  return {
    nvidia: {
      key: 'nvidia',
      name: 'NVIDIA NIM',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKeyEnv: 'NVIDIA_API_KEY',
      models: {
        plan: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
        event: 'nvidia/nemotron-3.5-bolt-e4b',
        conversation: 'nvidia/nemotron-3.5-bolt-e4b',
      },
      rpm: 40,
      rpd: 1000,
      timeoutMs: 5000,
      extraBody: {
        chat_template_kwargs: { enable_thinking: false },
      },
    },
    cloudflare: {
      key: 'cloudflare',
      name: 'Cloudflare Workers AI',
      baseUrl: cfAccountId
        ? `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/v1`
        : 'https://api.cloudflare.com/client/v4/ai/v1',
      apiKeyEnv: 'CLOUDFLARE_API_TOKEN',
      models: {
        plan: '@cf/qwen/qwen3-30b-a3b-fp8',
        event: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        conversation: '@cf/qwen/qwen3-30b-a3b-fp8',
      },
      rpm: 30,
      rpd: 520,
      timeoutMs: 6000,
    },
    gemini: {
      key: 'gemini',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKeyEnv: 'GEMINI_API_KEY',
      models: {
        plan: 'gemini-flash-lite-latest',
        event: 'gemini-flash-lite-latest',
        conversation: 'gemini-flash-lite-latest',
      },
      rpm: 15,
      rpd: 500,
      timeoutMs: 5000,
    },
    groq: {
      key: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKeyEnv: 'GROQ_API_KEY',
      models: {
        plan: 'openai/gpt-oss-20b',
        event: 'openai/gpt-oss-20b',
        conversation: 'openai/gpt-oss-20b',
      },
      rpm: 30,
      rpd: 1000,
      timeoutMs: 4000,
    },
    openrouter: {
      key: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      models: {
        plan: 'meta-llama/llama-3.3-70b-instruct:free',
        event: 'meta-llama/llama-3.3-70b-instruct:free',
        conversation: 'meta-llama/llama-3.3-70b-instruct:free',
      },
      rpm: 20,
      rpd: 50,
      timeoutMs: 6000,
    },
    nearai: {
      key: 'nearai',
      name: 'NEAR AI Cloud (Daily Judge)',
      baseUrl: process.env.NEAR_AI_BASE_URL ?? 'https://cloud-api.near.ai/v1',
      apiKeyEnv: 'NEAR_AI_API_KEY',
      models: {
        judge: 'google/gemini-2.5-flash-lite',
      },
      rpm: 10,
      rpd: 50,
      timeoutMs: 8000,
    },
    rule: {
      key: 'rule',
      name: 'Rule Decider Fallback',
      baseUrl: '',
      apiKeyEnv: '',
      models: {},
      rpm: 100000,
      rpd: 10000000,
      timeoutMs: 100,
    },
  };
}

export async function executeProviderCall(
  config: ProviderConfig,
  apiKey: string,
  payload: ModelCallPayload,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ModelCallResult> {
  const model =
    config.models[payload.intent] ??
    config.models.plan ??
    config.models.event ??
    'default';

  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const requestBody: Record<string, unknown> = {
    model,
    messages: payload.messages,
    temperature: payload.temperature ?? 0.2,
    ...(config.extraBody ?? {}),
  };

  if (payload.responseFormat) {
    requestBody.response_format = payload.responseFormat;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
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

    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const content = json?.choices?.[0]?.message?.content ?? '';
    const tokensEstimate = json?.usage?.total_tokens ?? Math.ceil(content.length / 4);

    return {
      provider: config.key,
      model,
      content,
      latencyMs,
      tokensEstimate,
    };
  } finally {
    clearTimeout(timer);
  }
}
