import type { Bag, Complaint, DungeonDef, Fighter, GearPiece, ItemKindDef, LootRule, PartyJob, RaidRun } from '../../../shared/src/index.js';

/** Talks to the raid routes. Every call carries the player's token; the server decides who they are. */

export interface RosterRow extends Fighter { wage: number; health: number; damage: number; answer?: { accept: boolean; reason: string } }
export interface PartyView {
  id: string; leaderId: string; members: string[]; invites: Array<{ accountId: string; expiresAt: number }>;
  lootRule: LootRule; needs: Record<string, string[]>; inRaid: string | null; hired: string[]; lastOrder: string[] | null;
  memberChroma: Record<string, number>;
}
export interface Board {
  you: string;
  chroma: number;
  pack: { items: Bag; keys: Bag; gear: GearPiece[] };
  party: PartyView | null;
  invites: Array<{ partyId: string; leader: string }>;
  keys: Array<{ id: string; name: string; dungeon: string; stock: number; price: number }>;
  roster: RosterRow[];
  hall: { purse: number; jobs: PartyJob[]; complaints: Complaint[]; barred: Record<string, number>; feeling: number; mind: Array<{ thought: string; at: number }> };
  salvage: { name: string; purse: number; discount: number; quotes: Array<{ kind: string; name: string; have: number; unitPrice: number; accepts: number; reason?: string }>; mind: Array<{ thought: string }> };
  barred: boolean;
}
export interface RunView extends RaidRun {
  presence: Record<string, { x: number; z: number; hp: number; maxHp: number; at: number }>;
  fighterHp: Record<string, number>;
  settled: boolean;
  summary: null | {
    outcome: 'won' | 'lost' | 'abandoned';
    shares: Record<string, Bag>;
    losses: Record<string, { chroma: number; items: Bag }>;
    fighters: Array<{ id: string; name: string; outcome: string; paid: number; refunded: number; trained: boolean; replacedBy?: string }>;
    complaints: string[];
  };
}
export interface RaidConfigView { dungeons: Record<string, DungeonDef>; itemKinds: Record<string, ItemKindDef> }

export class RaidNet {
  constructor(readonly base: string, private readonly token: string) {}

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await res.json().catch(() => ({})) as { result?: T; error?: string };
    if (!res.ok) throw new Error(json.error ?? `The Hall did not answer (${res.status})`);
    return json.result as T;
  }

  board() { return this.call<Board>('/api/raids/board'); }
  config() { return this.call<RaidConfigView>('/api/raids/config'); }
  invite(target: string) { return this.call('/api/raids/party/invite', { target }); }
  accept(partyId: string) { return this.call('/api/raids/party/accept', { partyId }); }
  leave() { return this.call('/api/raids/party/leave', {}); }
  lootRule(rule: LootRule) { return this.call('/api/raids/party/loot-rule', { rule }); }
  needs(kinds: string[]) { return this.call('/api/raids/party/needs', { kinds }); }
  buyKey(keyId: string) { return this.call<{ price: number }>('/api/raids/hall/buy-key', { keyId }); }
  hire(fighterId: string) { return this.call<{ wage: number }>('/api/raids/hall/hire', { fighterId }); }
  dismiss(fighterId: string) { return this.call('/api/raids/hall/dismiss', { fighterId }); }
  complain(kind: string, against: string, runId: string | null, note: string) { return this.call('/api/raids/hall/complain', { kind, against, runId, note }); }
  enter(dungeonId: string) { return this.call<RunView>('/api/raids/run/enter', { dungeonId }); }
  run(runId: string) { return this.call<RunView>(`/api/raids/run/${runId}`); }
  presence(runId: string, p: { x: number; z: number; hp: number; maxHp: number }) { return this.call<RunView>(`/api/raids/run/${runId}/presence`, p); }
  clear(runId: string, roomId: string, kills: Record<string, number>, bossKiller?: string) { return this.call<RunView>(`/api/raids/run/${runId}/clear`, { roomId, kills, ...(bossKiller ? { bossKiller } : {}) }); }
  down(runId: string) { return this.call<RunView>(`/api/raids/run/${runId}/down`, {}); }
  abandon(runId: string) { return this.call<RunView>(`/api/raids/run/${runId}/abandon`, {}); }
  fighterKilled(runId: string, fighterId: string) { return this.call<RunView>(`/api/raids/run/${runId}/fighter-killed`, { fighterId }); }
  fighterCheck(runId: string, fighterId: string, hp: number, situation: Record<string, number | boolean>) {
    return this.call<{ flee: boolean; morale: number; run: RunView }>(`/api/raids/run/${runId}/fighter-check`, { fighterId, hp, situation });
  }
  sell(kind: string, qty: number) { return this.call<{ paid: number; unitPrice: number }>('/api/raids/salvage/sell', { kind, qty }); }
  tick() { return this.call('/api/raids/agents/tick', {}); }
}
