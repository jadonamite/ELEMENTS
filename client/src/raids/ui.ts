import type { ItemKindDef, LootRule } from '../../../shared/src/index.js';
import type { Board, RunView } from './net.js';

/** Small element builder: text always goes in as text, never as markup. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean> = {}, ...kids: Array<Node | string | null | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === 'class') el.className = String(v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid !== null && kid !== false) el.append(kid);
  return el;
}

export const layer = h('div', { class: 'raid-layer' });
document.body.append(layer);

export type Tab = 'counter' | 'fighters' | 'party' | 'board' | 'salvage';

export interface CounterActions {
  buyKey(id: string): Promise<void>;
  hire(id: string): Promise<void>;
  dismiss(id: string): Promise<void>;
  invite(name: string): Promise<void>;
  accept(partyId: string): Promise<void>;
  leave(): Promise<void>;
  lootRule(rule: LootRule): Promise<void>;
  needs(kinds: string[]): Promise<void>;
  sell(kind: string, qty: number): Promise<void>;
  enter(): Promise<void>;
  complain(kind: string, against: string, runId: string | null): Promise<void>;
  close(): void;
}

const tabNames: Record<Tab, string> = { counter: 'Keys', fighters: 'Fighters', party: 'Party', board: 'Board', salvage: 'Salvage' };
const ruleNames: Record<LootRule, string> = { equal: 'Equal shares', need: 'By need', leader: 'Leader decides' };

/** The Hall's counter: every screen the Raid Hall offers, as tabs. */
export class Counter {
  readonly el = h('section', { class: 'raid-counter raid-panel', role: 'dialog', 'aria-label': 'The Raid Hall' });
  tab: Tab = 'counter';
  private board: Board | null = null;
  private error = h('p', { class: 'raid-error', role: 'status' });
  private body = h('div', { class: 'raid-body' });
  private tabs = h('nav', { class: 'raid-tabs', role: 'tablist' });
  private sub = h('p', { class: 'raid-sub' });
  lastRunId: string | null = null;

  constructor(private readonly act: CounterActions, private readonly kinds: Record<string, ItemKindDef>) {
    const close = h('button', { class: 'raid-btn', type: 'button', 'aria-label': 'Close' }, 'Close');
    close.addEventListener('click', () => act.close());
    this.el.append(h('header', {}, h('div', {}, h('h1', { class: 'raid-title' }, 'The Raid Hall, Sindr'), this.sub), close), this.tabs, this.body);
    for (const t of Object.keys(tabNames) as Tab[]) {
      const b = h('button', { type: 'button', role: 'tab' }, tabNames[t]);
      b.addEventListener('click', () => { this.tab = t; this.render(); });
      this.tabs.append(b);
    }
    this.el.hidden = true;
    layer.append(this.el);
  }

  open(tab: Tab): void { this.tab = tab; this.el.hidden = false; this.render(); }
  get isOpen(): boolean { return !this.el.hidden; }
  hide(): void { this.el.hidden = true; }

  update(board: Board): void { this.board = board; if (this.isOpen) this.render(); }

  private run(fn: () => Promise<void>): () => void {
    return () => { this.error.textContent = ''; fn().catch((e: unknown) => { this.error.textContent = e instanceof Error ? e.message : String(e); }); };
  }

  private btn(label: string, fn: () => Promise<void>, opts: { primary?: boolean; disabled?: boolean; name?: string } = {}): HTMLButtonElement {
    const b = h('button', { class: `raid-btn${opts.primary ? ' primary' : ''}`, type: 'button', disabled: !!opts.disabled, ...(opts.name ? { 'data-act': opts.name } : {}) }, label);
    b.addEventListener('click', this.run(fn));
    return b;
  }

  private itemName(k: string): string { return this.kinds[k]?.name ?? k.replace(/_/g, ' '); }

  render(): void {
    const b = this.board;
    for (const el of this.tabs.children) el.setAttribute('aria-selected', String(el.textContent === tabNames[this.tab]));
    this.body.replaceChildren();
    if (!b) { this.body.append(h('p', { class: 'raid-note' }, 'The broker looks up from the ledger.')); return; }
    const keys = Object.values(b.pack.keys).reduce((a, c) => a + c, 0);
    this.sub.textContent = `${b.you}: ${b.chroma} CHROMA carried, ${keys} key${keys === 1 ? '' : 's'}${b.barred ? ', barred from the Hall' : ''}`;
    const mind = b.hall.mind[0]?.thought;
    const leader = !b.party || b.party.leaderId === b.you;
    switch (this.tab) {
      case 'counter': {
        if (mind) this.body.append(h('p', { class: 'raid-mind' }, mind));
        for (const k of b.keys) {
          this.body.append(h('div', { class: 'raid-row' },
            h('div', {}, h('h3', {}, k.name), h('p', {}, `${k.price} CHROMA. ${k.stock} on the shelf. Crafted by the Dim; opens the Undervault for one run.`)),
            this.btn(`Buy for ${k.price}`, () => this.act.buyKey(k.id), { disabled: k.stock === 0 || b.chroma < k.price, name: `buy-${k.id}` })));
        }
        const hired = b.party?.hired.length ?? 0;
        const members = b.party?.members.length ?? 1;
        this.body.append(h('div', { class: 'raid-row' },
          h('div', {}, h('h3', {}, 'Go down'), h('p', {}, `${members} player${members === 1 ? '' : 's'} and ${hired} hired fighter${hired === 1 ? '' : 's'}. The leader turns the key; the rooms are drawn fresh each run. Lose, and the ruin keeps a quarter of what each of you carries.`)),
          this.btn('Turn the key', () => this.act.enter(), { primary: true, disabled: !leader || keys === 0, name: 'enter' })));
        break;
      }
      case 'fighters': {
        this.body.append(h('p', { class: 'raid-note' }, 'Lit fighters for hire, paid per run. The wage goes into the Hall\'s keeping and is paid out when they come back standing. One who runs or dies is not paid. The Hall takes a cut.'));
        for (const f of b.roster) {
          const mine = b.party?.hired.includes(f.id);
          const ans = f.answer;
          const record = `${f.record.runs} runs, ${f.record.kills} kills${f.record.fled ? `, ran ${f.record.fled} time${f.record.fled === 1 ? '' : 's'}` : ''}`;
          const memo = f.memory[b.you];
          this.body.append(h('div', { class: 'raid-row' },
            h('div', {},
              h('h3', {}, `${f.name}, ${f.element}`),
              h('p', {}, `Skill ${f.skill}. Health ${f.health}. Wage ${f.wage} a run. ${record}.`),
              memo ? h('p', {}, `Remembers you: ${memo.runs} run${memo.runs === 1 ? '' : 's'} together, feeling ${memo.score}.`) : null,
              ans ? h('p', { class: ans.accept ? 'yes' : 'no' }, mine ? 'Hired. Walks with you.' : ans.reason) : null),
            mine ? this.btn('Dismiss', () => this.act.dismiss(f.id), { disabled: !leader, name: `dismiss-${f.id}` })
              : this.btn(`Hire for ${f.wage}`, () => this.act.hire(f.id), { disabled: !leader || !ans?.accept || b.chroma < f.wage, name: `hire-${f.id}` })));
        }
        break;
      }
      case 'party': {
        const p = b.party;
        for (const inv of b.invites) {
          this.body.append(h('div', { class: 'raid-row' }, h('div', {}, h('h3', {}, `${inv.leader} invites you`), h('p', {}, 'Join their party for the next run.')),
            this.btn('Join', () => this.act.accept(inv.partyId), { primary: true, name: `join-${inv.partyId}` })));
        }
        const name = h('input', { 'aria-label': 'Player to invite', placeholder: 'Player name', name: 'invite' });
        this.body.append(h('div', { class: 'raid-inline' }, name, this.btn('Invite', () => this.act.invite(name.value.trim()), { name: 'invite' })));
        if (!p) { this.body.append(h('p', { class: 'raid-note' }, 'No party yet. Invite someone, or go alone with hired fighters.')); break; }
        for (const m of p.members) {
          this.body.append(h('div', { class: 'raid-row' }, h('div', {}, h('h3', {}, `${m}${m === p.leaderId ? ' (leader)' : ''}`), h('p', {}, `${p.memberChroma[m] ?? 0} CHROMA carried${p.needs[m]?.length ? `. Needs ${p.needs[m]!.map((k) => this.itemName(k)).join(', ')}` : ''}`)), h('span', {})));
        }
        for (const inv of p.invites) this.body.append(h('p', { class: 'raid-note' }, `Waiting on ${inv.accountId}.`));
        const sel = h('select', { 'aria-label': 'Loot split', name: 'loot-rule', disabled: p.leaderId !== b.you });
        for (const r of Object.keys(ruleNames) as LootRule[]) { const o = h('option', { value: r }, ruleNames[r]); if (r === p.lootRule) o.selected = true; sel.append(o); }
        sel.addEventListener('change', this.run(() => this.act.lootRule(sel.value as LootRule)));
        this.body.append(h('div', { class: 'raid-row' }, h('div', {}, h('h3', {}, 'Loot split'), h('p', {}, 'Agreed before going in and fixed for the run. Hired fighters take wages, not shares.')), sel));
        const needKinds = Object.keys(this.kinds).filter((k) => this.kinds[k]!.rarity !== 'common');
        const needSel = h('select', { 'aria-label': 'What you need', name: 'needs', multiple: true, size: '3' });
        for (const k of needKinds) { const o = h('option', { value: k }, this.itemName(k)); if (p.needs[b.you]?.includes(k)) o.selected = true; needSel.append(o); }
        this.body.append(h('div', { class: 'raid-inline' }, needSel, this.btn('Declare need', () => this.act.needs([...needSel.selectedOptions].map((o) => o.value)))));
        this.body.append(this.btn('Leave the party', () => this.act.leave()));
        break;
      }
      case 'board': {
        if (mind) this.body.append(h('p', { class: 'raid-mind' }, mind));
        this.body.append(h('h2', { class: 'raid-title' }, 'Jobs'));
        for (const j of b.hall.jobs.filter((x) => !x.takenBy)) this.body.append(h('div', { class: 'raid-row' }, h('div', {}, h('h3', {}, j.title), h('p', {}, `${j.reward} CHROMA from the Hall`)), h('span', {})));
        this.body.append(h('h2', { class: 'raid-title' }, 'Complaints on record'));
        const list = [...b.hall.complaints].reverse();
        if (!list.length) this.body.append(h('p', { class: 'raid-note' }, 'Nobody has complained yet.'));
        for (const c of list) {
          const what = { fighter_fled: 'Ran from a raid', bad_split: 'A bad loot split', cheated_buyer: 'Cheated a buyer', left_to_die: 'Left a hired fighter behind' }[c.kind];
          const name = b.roster.find((f) => f.id === c.against)?.name ?? c.against;
          const status = c.status === 'open' ? 'Waiting on the broker' : c.status === 'upheld' ? `Upheld. ${c.ruling ?? ''}` : `Dismissed. ${c.ruling ?? ''}`;
          this.body.append(h('div', { class: 'raid-row', 'data-complaint': c.kind }, h('div', {}, h('h3', {}, `${what}: ${name}`), h('p', {}, c.note), h('p', { class: c.status === 'upheld' ? 'no' : '' }, status)), h('span', {})));
        }
        const barred = Object.entries(b.hall.barred).filter(([, until]) => until > Date.now());
        if (barred.length) this.body.append(h('p', { class: 'raid-note' }, `Barred: ${barred.map(([id]) => b.roster.find((f) => f.id === id)?.name ?? id).join(', ')}`));
        if (this.lastRunId && b.party && b.party.members.length > 1) {
          const who = h('select', { 'aria-label': 'Against whom' });
          for (const m of b.party.members.filter((m) => m !== b.you)) who.append(h('option', { value: m }, m));
          this.body.append(h('div', { class: 'raid-inline' }, who, this.btn('Complain of a bad split', () => this.act.complain('bad_split', who.value, this.lastRunId))));
        }
        break;
      }
      case 'salvage': {
        this.body.append(h('h2', { class: 'raid-title' }, b.salvage.name));
        const sm = b.salvage.mind[0]?.thought;
        if (sm) this.body.append(h('p', { class: 'raid-mind' }, sm));
        this.body.append(h('p', { class: 'raid-note' }, `Buys rare materials, gear and shards straight after a raid, for less than a merchant would pay. Paying ${Math.round((1 - b.salvage.discount) * 100)} in the hundred of base today.`));
        if (!b.salvage.quotes.length) this.body.append(h('p', { class: 'raid-note' }, 'You carry nothing the buyer wants.'));
        for (const q of b.salvage.quotes) {
          this.body.append(h('div', { class: 'raid-row' },
            h('div', {}, h('h3', {}, `${q.have} ${q.name}`), h('p', {}, q.accepts ? `${q.unitPrice} each, takes ${q.accepts}` : (q.reason ?? 'Not today'))),
            this.btn(q.accepts ? `Sell for ${q.unitPrice * q.accepts}` : 'Sell', () => this.act.sell(q.kind, q.accepts), { disabled: !q.accepts, name: `sell-${q.kind}` })));
        }
        break;
      }
    }
    this.body.append(this.error);
  }
}

export interface FrameRow { name: string; tag: string; hp: number; max: number; fighter: boolean; out: string | null }

/** Party members' health, players then hired fighters. */
export class PartyFrame {
  readonly el = h('section', { class: 'raid-frame', 'aria-label': 'Party' });
  constructor() { layer.append(this.el); }
  set(rows: FrameRow[]): void {
    this.el.replaceChildren(...rows.map((r) => h('div', { class: `raid-member${r.fighter ? ' fighter' : ''}${r.out ? ' out' : ''}` },
      h('div', { class: 'name' }, h('span', {}, r.name), h('span', { class: 'tag' }, r.out ?? r.tag)),
      h('div', { class: 'raid-bar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(r.max), 'aria-valuenow': String(Math.round(r.hp)) }, h('i', { style: `width:${Math.max(0, Math.min(100, (r.hp / Math.max(1, r.max)) * 100))}%` })))));
  }
}

export class Status {
  readonly el = h('div', { class: 'raid-status' });
  private title = h('strong', {});
  private line = h('span', {});
  constructor() { this.el.append(this.title, this.line); layer.append(this.el); }
  set(title: string, line: string): void { this.title.textContent = title; this.line.textContent = line; }
}

export class Banner {
  readonly el = h('div', { class: 'raid-banner', 'aria-live': 'polite' });
  private timer = 0;
  constructor() { layer.append(this.el); this.el.style.opacity = '0'; }
  show(title: string, sub = '', seconds = 3.5): void {
    this.el.replaceChildren(h('h2', {}, title), sub ? h('p', {}, sub) : '');
    this.el.style.opacity = '1';
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.el.style.opacity = '0'; }, seconds * 1000);
  }
}

export class Prompt {
  readonly el = h('div', { class: 'raid-prompt' });
  constructor() { layer.append(this.el); this.el.hidden = true; }
  set(text: string | null): void {
    if (!text) { this.el.hidden = true; return; }
    this.el.hidden = false;
    this.el.replaceChildren(h('kbd', {}, 'C'), text);
  }
}

export class Log {
  readonly el = h('div', { class: 'raid-log', 'aria-live': 'polite' });
  private seen = new Set<string>();
  constructor() { layer.append(this.el); }
  add(text: string, kind = ''): void {
    this.el.append(h('p', { class: kind }, text));
    while (this.el.children.length > 6) this.el.firstElementChild?.remove();
  }
  fromRun(run: RunView): void {
    for (const e of run.events) {
      const key = `${e.at}:${e.text}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.add(e.text, e.kind);
    }
  }
  reset(): void { this.seen.clear(); this.el.replaceChildren(); }
}

export class BossBar {
  readonly el = h('div', { class: 'raid-boss' });
  constructor() { layer.append(this.el); this.el.hidden = true; }
  set(name: string | null, hp = 0, max = 1): void {
    if (!name) { this.el.hidden = true; return; }
    this.el.hidden = false;
    this.el.replaceChildren(h('strong', {}, name), h('div', { class: 'raid-bar' }, h('i', { style: `width:${Math.max(0, hp / max) * 100}%` })));
  }
}

export function modal(cls: string, ...kids: Array<Node | string>): { el: HTMLElement; close: () => void } {
  const el = h('section', { class: `${cls} raid-panel`, role: 'dialog' }, ...kids);
  layer.append(el);
  return { el, close: () => el.remove() };
}

export class NameTags {
  private readonly tags = new Map<string, HTMLElement>();
  place(id: string, text: string, sub: string, x: number, y: number, visible: boolean): void {
    let el = this.tags.get(id);
    if (!el) { el = h('div', { class: 'raid-name' }); layer.append(el); this.tags.set(id, el); }
    el.hidden = !visible;
    if (!visible) return;
    if (el.dataset.t !== text + sub) { el.replaceChildren(text, h('small', {}, sub)); el.dataset.t = text + sub; }
    el.style.left = `${x}px`; el.style.top = `${y}px`;
  }
  drop(id: string): void { this.tags.get(id)?.remove(); this.tags.delete(id); }
  clear(): void { for (const id of [...this.tags.keys()]) this.drop(id); }
}
