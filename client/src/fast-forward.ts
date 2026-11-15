import { itemDisplayName } from '@elements/shared';
import { getServerUrl } from './auth/server-api.js';

// Plays back a simulated week from /api/economy/fast-forward: 168 game hours over one minute.

interface Good { item: string; stock: number; maxStock: number; buy: number; sell: number; reason: number }
interface Keeper { id: string; name: string; status: string; purse: number; owner: string | null; goods: Good[] }
interface Move { contract: 'coin' | 'items'; from: string | null; to: string | null; amount: number; token?: string; reason: string }
interface Happening { kind: string; text: string; moves: Move[] }
interface Frame { hour: number; label: string; keepers: Keeper[]; events: Happening[] }
interface Week {
  seed: number; days: number; frames: Frame[]; reasons: string[]; supplyConserved: boolean; trades: number; refusals: number;
  contracts: { coin: string; items: string }; missing: string[];
}

const PLAY_MS = 60_000;
const STATUS: Record<string, string> = { open: 'Open', broke_buying_paused: 'Broke, not buying', closed: 'Shut' };
const KIND: Record<string, string> = {
  bank: 'Bank', robbery: 'Robbery', law: 'Law', bounty: 'Bounty', jail: 'Jail', trade: 'Trade', tribute: 'Tribute',
  caravan: 'Caravan', rival: 'Rival clan', firestorm: 'Firestorm', shop: 'Shop', memory: 'Memory', outsider: 'Outsider',
  hire: 'Hired fighter', market: 'Market',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const grid = $<HTMLDivElement>('ff-grid');
const label = $<HTMLSpanElement>('ff-label');
const progress = $<HTMLProgressElement>('ff-progress');
const eventsList = $<HTMLOListElement>('ff-events');
const playBtn = $<HTMLButtonElement>('ff-play');
const restartBtn = $<HTMLButtonElement>('ff-restart');
const newBtn = $<HTMLButtonElement>('ff-new');
const meta = $<HTMLParagraphElement>('ff-meta');

let week: Week | null = null;
let index = 0;
let timer: number | undefined;
let playing = false;
/** The price whose reason is open, kept across redraws. */
let openTip: string | null = null;

function goodName(item: string): string {
  if (item.startsWith('armour_shaper_')) return `${item.slice(14).toUpperCase()} Shaper armour`;
  return itemDisplayName(item);
}

function price(key: string, value: number, start: number, reason: string, off: boolean): string {
  const trend = off || value === start ? '' : value > start ? 'up' : 'down';
  const text = off ? 'not buying' : String(value);
  return `<button type="button" class="ff-price" ${trend ? `data-trend="${trend}"` : ''} ${off ? 'data-off' : ''} data-key="${key}" aria-expanded="${openTip === key}" aria-label="${text}. ${escapeHtml(reason)}">${text}<span class="ff-tip" aria-hidden="true">${escapeHtml(reason)}</span></button>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function render(): void {
  if (!week) return;
  const frame = week.frames[index]!;
  const first = week.frames[0]!;
  label.textContent = frame.label;
  progress.value = frame.hour;
  grid.innerHTML = frame.keepers.map((k) => {
    const start = first.keepers.find((s) => s.id === k.id)!;
    const status = k.owner ? `${STATUS[k.status] ?? k.status}, player-owned` : (STATUS[k.status] ?? k.status);
    const rows = k.goods.map((g) => {
      const s = start.goods.find((x) => x.item === g.item) ?? g;
      const reason = week!.reasons[g.reason] ?? '';
      const fill = Math.min(100, Math.round((g.stock / Math.max(1, g.maxStock)) * 100));
      return `<tr><td>${escapeHtml(goodName(g.item))}</td><td><span class="ff-stock" aria-hidden="true"><i style="transform:scaleX(${fill / 100})"></i></span>${g.stock}</td><td>${price(`${k.id}:${g.item}:buy`, g.buy, s.buy, reason, false)}</td><td>${price(`${k.id}:${g.item}:sell`, g.sell, s.sell, reason, g.sell === 0)}</td></tr>`;
    }).join('');
    const lead = week!.reasons[k.goods[0]?.reason ?? -1] ?? '';
    return `<article class="ff-card" data-status="${k.status}"><div class="ff-card-head"><h3>${escapeHtml(k.name)}</h3><span class="ff-status">${status}</span></div><p class="ff-purse">Purse <strong>${k.purse.toLocaleString('en')}</strong> CHROMA</p><table class="ff-goods"><thead><tr><th scope="col">Good</th><th scope="col">Stock</th><th scope="col">Buy</th><th scope="col">Sell</th></tr></thead><tbody>${rows}</tbody></table><p class="ff-reason">${escapeHtml(lead)}</p></article>`;
  }).join('');

  const happened = week.frames.slice(0, index + 1).flatMap((f) => f.events.map((e, i) => ({ when: f.label, key: `${f.hour}:${i}`, e })));
  const open = new Set([...eventsList.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.key));
  eventsList.innerHTML = happened.length
    ? happened.map((x) => eventItem(x.when, x.key, x.e, open.has(x.key))).join('')
    : '<li class="ff-empty"><span>Day 1 opens quietly. The story starts as the players arrive.</span></li>';
}

/** Chain names without the shared testnet suffix, which every world account carries. */
function who(account: string | null, contract: 'coin' | 'items'): string {
  if (!account) return contract === 'coin' ? 'the world' : 'the forge';
  // A player's account is a 64-character implicit NEAR account; the full name stays in the row's title.
  if (/^[0-9a-f]{64}$/.test(account)) return `player ${account.slice(0, 4)}…${account.slice(-4)}`;
  return account.replace(/\.elements-dev\.testnet$/, '');
}

function moveText(m: Move): string {
  const what = m.contract === 'coin' ? `${m.amount.toLocaleString('en')} CHROMA` : `${m.amount} x ${goodName(m.token ?? 'item')}`;
  return `<li><span class="ff-move-what">${escapeHtml(what)}</span><span class="ff-move-path" title="${escapeHtml(`${m.from ?? 'minted'} to ${m.to ?? 'burned'}`)}">${escapeHtml(who(m.from, m.contract))} <span aria-hidden="true">&rarr;</span><span class="ff-sr"> to </span> ${escapeHtml(who(m.to, m.contract))}</span><span class="ff-move-why">${escapeHtml(m.reason)}</span></li>`;
}

function eventItem(when: string, key: string, e: Happening, open: boolean): string {
  const tag = `<span class="ff-kind" data-kind="${escapeHtml(e.kind)}">${escapeHtml(KIND[e.kind] ?? e.kind)}</span>`;
  const body = e.moves.length
    ? `<details data-key="${key}" ${open ? 'open' : ''}><summary>${tag}${escapeHtml(e.text)}<span class="ff-move-count">${e.moves.length} NEAR ${e.moves.length === 1 ? 'move' : 'moves'}</span></summary><ol class="ff-moves">${e.moves.map(moveText).join('')}</ol></details>`
    : `<p>${tag}${escapeHtml(e.text)}</p>`;
  return `<li><span>${when}</span>${body}</li>`;
}

function step(): void {
  if (!week) return;
  if (index >= week.frames.length - 1) { setPlaying(false); return; }
  index++;
  render();
}

function setPlaying(on: boolean): void {
  playing = on;
  window.clearInterval(timer);
  if (on && week) timer = window.setInterval(step, PLAY_MS / (week.frames.length - 1));
  playBtn.textContent = on ? 'Pause' : index >= (week?.frames.length ?? 1) - 1 ? 'Play again' : 'Play';
}

async function load(seed: number): Promise<void> {
  setPlaying(false);
  for (const b of [playBtn, restartBtn, newBtn]) b.disabled = true;
  label.textContent = 'Running the week';
  try {
    const res = await fetch(`${getServerUrl()}/api/economy/fast-forward?seed=${seed}`);
    if (!res.ok) throw new Error(`The server answered ${res.status}`);
    week = (await res.json()) as Week;
    progress.max = week.frames.length - 1;
    index = 0;
    const moves = week.frames.reduce((n, f) => n + f.events.reduce((m, e) => m + e.moves.length, 0), 0);
    meta.textContent = `Week ${week.seed}: ${week.trades} trades, ${week.refusals} refused by the rules, ${moves} NEAR moves named. Coin supply conserved: ${week.supplyConserved ? 'yes' : 'no'}. Moves are written for ${week.contracts.coin} and ${week.contracts.items} and never sent.`;
    render();
    for (const b of [playBtn, restartBtn, newBtn]) b.disabled = false;
    setPlaying(true);
  } catch (err) {
    label.textContent = 'The week could not be run';
    meta.textContent = err instanceof Error ? err.message : String(err);
    newBtn.disabled = false;
  }
}

playBtn.addEventListener('click', () => {
  if (!week) return;
  if (!playing && index >= week.frames.length - 1) index = 0;
  setPlaying(!playing);
});
restartBtn.addEventListener('click', () => { index = 0; render(); setPlaying(true); });
newBtn.addEventListener('click', () => { void load(1 + Math.floor(Math.random() * 9999)); });

// Touch has no hover: a tap opens a price's reason, another tap or a tap elsewhere closes it.
document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.ff-price');
  for (const b of document.querySelectorAll<HTMLButtonElement>('.ff-price[aria-expanded="true"]')) if (b !== target) b.setAttribute('aria-expanded', 'false');
  if (target) {
    const open = target.getAttribute('aria-expanded') !== 'true';
    target.setAttribute('aria-expanded', String(open));
    openTip = open ? target.dataset.key ?? null : null;
  } else {
    openTip = null;
  }
});

void load(Number(new URLSearchParams(location.search).get('seed')) || 1);
