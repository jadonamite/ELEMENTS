import { ModelRouter, type ProviderKey } from '../../src/economy/index.js';

/** One request a fake provider received. */
export interface FakeCall {
  url: string;
  provider: string;
  model: string;
  intent: 'plan' | 'event' | 'conversation' | 'chronicle' | 'judge' | 'unknown';
  system: string;
  user: string;
  at: number;
}

const HOSTS: Array<[string, ProviderKey]> = [
  ['integrate.api.nvidia.com', 'nvidia'],
  ['api.cloudflare.com', 'cloudflare'],
  ['generativelanguage.googleapis.com', 'gemini'],
  ['api.groq.com', 'groq'],
  ['openrouter.ai', 'openrouter'],
  ['near.ai', 'nearai'],
];

export const providerOf = (url: string): string => HOSTS.find(([h]) => url.includes(h))?.[1] ?? 'unknown';

function intentOf(system: string, user: string): FakeCall['intent'] {
  if (system.includes('judge the shopkeepers')) return 'judge';
  if (system.includes('evening chronicle')) return 'chronicle';
  if (system.includes('Something significant has just happened')) return 'event';
  if (system.includes('You plan the day') || system.includes('townsfolk of')) return 'plan';
  if (user && !user.startsWith('{')) return 'conversation';
  return 'unknown';
}

/** What the fake answers for a call; return a status number to refuse it. */
export type Responder = (call: FakeCall) => string | number;

/** A reasonable answer for every kind of call: plans for every id asked, a chronicle, a judge's verdicts, a line. */
export const defaultResponder: Responder = (call) => {
  const user = call.user.startsWith('{') ? JSON.parse(call.user) : null;
  if (call.intent === 'plan' || call.intent === 'event') {
    const ids: string[] = (user?.keepers ?? user?.people ?? []).map((a: { id: string }) => a.id);
    const plans: Record<string, unknown> = {};
    for (const id of ids) plans[id] = { focus: `Planned by ${call.provider}`, mood: 'steady', targetStockRatio: {}, bargainWillingness: 0.4, preparedLines: [`A line from ${call.provider}.`, 'Coin on the wood.'] };
    return JSON.stringify({ plans });
  }
  if (call.intent === 'chronicle') {
    return JSON.stringify({ title: 'The Sindr Chronicle', headline: 'Shelves full, purses fuller', paragraphs: ['The keepers traded well.', 'The watch kept the peace.'], shortNotices: ['Mind the alleys.', 'Bank your coin.', 'Fair prices at the terrace.'] });
  }
  if (call.intent === 'judge') {
    const ids: string[] = (user?.keepers ?? []).map((k: { id: string }) => k.id);
    return JSON.stringify({ agentGuidance: Object.fromEntries(ids.map((id) => [id, { verdict: 'Prudent.', score: 82, directive: 'Keep the shelves half full.' }])) });
  }
  return 'Good day, traveller. The shelves are full this morning.';
};

/** A fetch that answers like the providers do, recording each call. */
export function fakeFetch(responder: Responder = defaultResponder, clock: () => number = Date.now): { fetch: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string; messages?: Array<{ role: string; content: string }> };
    const system = body.messages?.find((m) => m.role === 'system')?.content ?? '';
    const user = body.messages?.find((m) => m.role === 'user')?.content ?? '';
    const call: FakeCall = { url, provider: providerOf(url), model: body.model ?? '', intent: intentOf(system, user), system, user, at: clock() };
    calls.push(call);
    const answer = responder(call);
    if (typeof answer === 'number') return new Response('refused', { status: answer, statusText: answer === 402 ? 'Payment Required' : answer === 429 ? 'Too Many Requests' : 'Error' });
    return new Response(JSON.stringify({ choices: [{ message: { content: answer } }], usage: { total_tokens: 100 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

/** Every key present, as on a configured server. */
export const allKeys = (env: string): string | undefined => (env === 'CLOUDFLARE_ACCOUNT_ID' ? 'acct' : `key-for-${env}`);

/** A router with every key set, talking to the fake. */
export function fakeRouter(options: { responder?: Responder; now?: () => number; keys?: (env: string) => string | undefined } = {}) {
  const clock = options.now ?? Date.now;
  const fake = fakeFetch(options.responder, clock);
  const lines: string[] = [];
  const router = new ModelRouter({ fetchFn: fake.fetch, keyFor: options.keys ?? allKeys, now: clock, log: (l) => lines.push(l) });
  return { router, calls: fake.calls, lines };
}
