export type ProviderKey =
  | 'nvidia'
  | 'cloudflare'
  | 'gemini'
  | 'groq'
  | 'openrouter'
  | 'nearai';

/** What a call is for: phase plans, an event flush, a face-to-face line, the evening chronicle, the daily judge. */
export type CallIntent = 'plan' | 'event' | 'conversation' | 'chronicle' | 'judge';

export type GovernorPressureLevel = 0 | 1 | 2 | 3;

export interface ProviderConfig {
  key: ProviderKey;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  models: {
    plan?: string;
    event?: string;
    conversation?: string;
    chronicle?: string;
    judge?: string;
  };
  rpm: number;
  rpd: number;
  /** Batch calls (plans, flushes, the chronicle, the judge) may take this long. */
  timeoutMs: number;
  /** A face-to-face line may take this long before the next provider, or a written line, answers. */
  talkTimeoutMs?: number;
  /** The judge reads every keeper at once and runs in the background, so it may take this long. */
  judgeTimeoutMs?: number;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelCallPayload {
  intent: CallIntent;
  messages: ModelMessage[];
  temperature?: number;
  responseFormat?: { type: 'json_object' };
  metadata?: {
    placeId?: string;
    agentIds?: string[];
    [key: string]: unknown;
  };
}

export interface ModelCallResult {
  provider: ProviderKey;
  model: string;
  content: string;
  latencyMs: number;
  tokensEstimate: number;
}

export interface TelemetryLog {
  timestamp: number;
  intent: CallIntent;
  provider: ProviderKey;
  model: string;
  success: boolean;
  statusCode?: number;
  latencyMs: number;
  error?: string;
}
