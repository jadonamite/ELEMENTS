import { itemDisplayName } from '@elements/shared';
import { getServerUrl } from './auth/server-api.js';

// Plays back a simulated week from /api/economy/fast-forward: 168 game hours over one minute.

interface Good { item: string; stock: number; maxStock: number; buy: number; sell: number; reason: number }
interface Keeper { id: string; name: string; status: string; purse: number; owner: string | null; goods: Good[] }
interface Frame { hour: number; label: string; keepers: Keeper[]; events: string[] }
interface Week { seed: number; frames: Frame[]; reasons: string[]; supplyConserved: boolean; trades: number; refusals: number }

const PLAY_MS = 60_000;
const STATUS: Record<string, string> = { open: 'Open', broke_buying_paused: 'Broke, not buying', closed: 'Shut' };

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

  const happened = week.frames.slice(0, index + 1).flatMap((f) => f.events.map((e) => ({ when: f.label, e })));
  eventsList.innerHTML = happened.length
    ? happened.map((x) => `<li><span>${x.when}</span><span>${escapeHtml(x.e)}</span></li>`).join('')
    : '<li class="ff-empty"><span>Day 1: ordinary trading. The story starts on day 2.</span></li>';
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
    meta.textContent = `Week ${week.seed}: ${week.trades} trades, ${week.refusals} refused by the rules. Coin supply conserved: ${week.supplyConserved ? 'yes' : 'no'}.`;
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
