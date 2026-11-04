import { decideHall, decideSalvage, type HallAction, type HallObservation, type ItemKindDef, type SalvageAction, type SalvageConfig, type SalvageState } from '@elements/shared';

export interface HallDecider { decide(obs: HallObservation): Promise<{ actions: HallAction[]; reasoning: string }> }
export interface SalvageDecider { decide(s: SalvageState, kinds: Record<string, ItemKindDef>, cfg: SalvageConfig): Promise<{ actions: SalvageAction[]; reasoning: string }> }

export class RuleHallDecider implements HallDecider {
  async decide(obs: HallObservation) { return decideHall(obs); }
}

export class RuleSalvageDecider implements SalvageDecider {
  async decide(s: SalvageState, kinds: Record<string, ItemKindDef>, cfg: SalvageConfig) { return decideSalvage(s, kinds, cfg); }
}

/**
 * The Hall broker's mind on NEAR AI Cloud: the model reads the Hall's books and proposes actions in the broker's voice.
 * Every proposal still passes the Hall's rule file before it happens. Without configuration, or when the call fails,
 * the rule decider stands in.
 */
export class NearAiHallDecider implements HallDecider {
  constructor(private readonly fallback: HallDecider = new RuleHallDecider(), private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  async decide(obs: HallObservation) {
    const base = process.env.NEAR_AI_BASE_URL, key = process.env.NEAR_AI_API_KEY, model = process.env.NEAR_AI_MODEL;
    if (!base || !key || !model) return this.fallback.decide(obs);
    const books = {
      purse: obs.hall.purse,
      keyStock: obs.hall.keyStock,
      openComplaints: obs.hall.complaints.filter((c) => c.status === 'open').map((c) => ({ id: c.id, kind: c.kind, against: c.against, recordSays: obs.judgements[c.id] })),
      openJobs: obs.hall.jobs.filter((j) => !j.takenBy).length,
      keys: Object.fromEntries(Object.entries(obs.keys).map(([id, k]) => [id, { craftCost: k.craftCost, maxStock: k.maxStock }])),
    };
    const system = [
      'You are the Dim broker who runs the Raid Hall in Sindr: you sell keys the Dim craft, hire out Lit fighters, post jobs for parties and settle complaints.',
      'You may: restock_keys {keyId, quantity}; post_job {dungeon, title, reward}; withdraw_job {jobId}; rule {complaintId, uphold, ruling}; bar {id, days}; say {line}.',
      'You never set prices or wages. You may only uphold a complaint the record supports.',
      'Reply only with JSON: {"actions": [...], "reasoning": "one sentence in your own voice"}.',
    ].join(' ');
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await this.fetchFn(`${base.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(books) }], temperature: 0.4 }),
      });
      clearTimeout(timer);
      if (!res.ok) return this.fallback.decide(obs);
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? '';
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { actions?: HallAction[]; reasoning?: string };
      if (!Array.isArray(parsed.actions)) return this.fallback.decide(obs);
      return { actions: parsed.actions, reasoning: parsed.reasoning ?? 'The broker keeps the books.' };
    } catch {
      return this.fallback.decide(obs);
    }
  }
}
