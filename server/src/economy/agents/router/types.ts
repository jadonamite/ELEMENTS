export type ProviderKey =
  | 'nvidia'
  | 'cloudflare'
  | 'gemini'
  | 'groq'
  | 'openrouter'
  | 'nearai'
  | 'rule';

export type CallIntent = 'plan' | 'event' | 'conversation' | 'judge';

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
    judge?: string;
  };
  rpm: number;
  rpd: number;
  timeoutMs: number;
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
