import balance from '../../../shared/balance.json';
import { EconomyError, buy, fetchMerchant, fetchQuote, sell, type Merchant, type Quote } from './api.js';
import { itemName, shelfName } from './items.js';
import './shop-window.css';

// The window a player sees at a market stall: the merchant's purse, what's on each shelf and its price,
// what the merchant will pay for what you carry, and, on every price, the merchant's reason in their words.

interface MerchantConfig {
  id: string;
  name: string;
  personality: string;
}

const MERCHANTS = (balance as unknown as { economy: { merchants: { sindr: MerchantConfig[] } } }).economy.merchants.sindr;

export interface ShopWindowEvents {
  satchel(): Record<string, number>;
  coin(): number;
  changed(): Promise<void>;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// The shelf an item from the satchel would go on: exact key, else the word before the first underscore.
function shelfFor(itemId: string, inventory: Record<string, unknown>): string | null {
  if (itemId in inventory) return itemId;
  const head = itemId.split('_')[0] ?? itemId;
  return head in inventory ? head : null;
}

export class ShopWindow {
  private readonly el: HTMLDivElement;
  private merchantId: string | null = null;
  private busy = false;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    }
  };

  constructor(private readonly events: ShopWindowEvents) {
    this.el = document.createElement('div');
    this.el.className = 'shop-window';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.hidden = true;
    document.body.appendChild(this.el);
    window.addEventListener('keydown', this.onKey, { capture: true });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  async open(merchantId: string): Promise<void> {
    if (document.pointerLockElement) document.exitPointerLock();
    this.merchantId = merchantId;
    this.el.hidden = false;
    document.body.classList.add('shop-open');
    await this.render();
  }

  close(): void {
    this.el.hidden = true;
    this.merchantId = null;
    document.body.classList.remove('shop-open');
    document.querySelector<HTMLCanvasElement>('canvas')?.focus();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.el.remove();
  }

  private async render(note = ''): Promise<void> {
    const id = this.merchantId;
    if (!id) return;
    const config = MERCHANTS.find((m) => m.id === id);
    const title = config?.name ?? id;
    let merchant: Merchant;
    try {
      merchant = await fetchMerchant(id);
    } catch (err) {
      this.el.innerHTML = this.frame(title, '', `<p class="shop-note">${escape(err instanceof Error ? err.message : 'The stall is unreachable')}</p>`);
      this.bindClose();
      return;
    }

    const shelves = Object.entries(merchant.inventory);
    const buyQuotes = await Promise.all(shelves.map(([key]) => fetchQuote(id, key, 'buy', 1).catch(() => null)));
    const carried = Object.entries(this.events.satchel()).filter(([itemId, n]) => n > 0 && shelfFor(itemId, merchant.inventory));
    const sellQuotes = await Promise.all(carried.map(([itemId]) => fetchQuote(id, itemId, 'sell', 1).catch(() => null)));

    const closed = merchant.status !== 'open';
    const statusLine = closed
      ? merchant.status === 'closed'
        ? 'Shutters down. This shop has closed.'
        : 'Short of coin: not buying until the purse recovers.'
      : '';

    const buyRows = shelves
      .map(([key, shelf], i) => this.row({
        name: shelfName(key),
        detail: `${shelf.stock} of ${shelf.maxStock} on the shelf`,
        fill: shelf.maxStock > 0 ? shelf.stock / shelf.maxStock : 0,
        quote: buyQuotes[i] ?? null,
        action: 'buy',
        item: key,
        disabled: closed || shelf.stock <= 0 || (buyQuotes[i]?.unitPrice ?? Infinity) > this.events.coin(),
        label: 'Buy one',
      }))
      .join('');

    const sellRows = carried.length
      ? carried
          .map(([itemId, n], i) => this.row({
            name: itemName(itemId, n),
            detail: `You carry ${n}`,
            fill: null,
            quote: sellQuotes[i] ?? null,
            action: 'sell',
            item: itemId,
            disabled: merchant.status !== 'open' || !sellQuotes[i]?.canExecute,
            label: 'Sell one',
          }))
          .join('')
      : '<p class="shop-empty">Nothing you carry is wanted at this stall.</p>';

    const body = `
      ${config ? `<p class="shop-personality">${escape(config.personality)}</p>` : ''}
      ${statusLine ? `<p class="shop-status">${escape(statusLine)}</p>` : ''}
      <section aria-label="For sale"><h3 class="shop-heading">For sale</h3>${buyRows}</section>
      <section aria-label="Sell to this stall"><h3 class="shop-heading">Sell what you carry</h3>${sellRows}</section>
      ${note ? `<p class="shop-note" role="status">${escape(note)}</p>` : ''}
    `;
    const purse = `<span class="shop-purse">Purse <strong>${merchant.balance.toLocaleString()}</strong></span><span class="shop-coin">You carry <strong>${this.events.coin().toLocaleString()}</strong> CHROMA</span>`;
    this.el.innerHTML = this.frame(title, purse, body);
    this.bindClose();
    this.el.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((b) =>
      b.addEventListener('click', () => void this.act(b.dataset.action as 'buy' | 'sell', b.dataset.item!)),
    );
    (this.el.querySelector('.shop-close') as HTMLElement | null)?.focus();
  }

  private frame(title: string, purse: string, body: string): string {
    return `
      <div class="shop-panel">
        <header class="shop-header">
          <div><h2 class="shop-title">${escape(title)}</h2><div class="shop-money">${purse}</div></div>
          <button type="button" class="shop-close" aria-label="Leave the stall">Leave</button>
        </header>
        <div class="shop-body">${body}</div>
        <footer class="shop-footer">Hover or focus a price to hear why. Esc to leave.</footer>
      </div>`;
  }

  private row(r: {
    name: string;
    detail: string;
    fill: number | null;
    quote: Quote | null;
    action: 'buy' | 'sell';
    item: string;
    disabled: boolean;
    label: string;
  }): string {
    const price = r.quote ? `${r.quote.unitPrice}` : '–';
    const why = r.quote?.summary ?? r.quote?.reason ?? '';
    // The summary is the strongest step; list the rest only when there is more than that one.
    const rest = (r.quote?.steps ?? []).filter((s) => s.words && s.words !== why);
    const steps = rest.map((s) => `<li>${escape(s.words)}</li>`).join('');
    return `
      <div class="shop-row">
        <div class="shop-item">
          <span class="shop-item-name">${escape(r.name)}</span>
          <span class="shop-item-detail">${escape(r.detail)}</span>
          ${r.fill === null ? '' : `<span class="shop-stock" aria-hidden="true"><span style="width:${Math.round(r.fill * 100)}%"></span></span>`}
        </div>
        <div class="shop-price" tabindex="0">
          <span class="shop-price-value">${price}</span><span class="shop-price-unit">CHROMA</span>
          ${why ? `<div class="shop-why" role="tooltip"><p>${escape(why)}</p>${steps ? `<ul>${steps}</ul>` : ''}</div>` : ''}
        </div>
        <button type="button" class="shop-act" data-action="${r.action}" data-item="${escape(r.item)}" ${r.disabled ? 'disabled' : ''}>${r.label}</button>
      </div>`;
  }

  private bindClose(): void {
    this.el.querySelector('.shop-close')?.addEventListener('click', () => this.close());
  }

  private async act(action: 'buy' | 'sell', item: string): Promise<void> {
    const id = this.merchantId;
    if (!id || this.busy) return;
    this.busy = true;
    let note = '';
    try {
      if (action === 'buy') {
        const r = await buy(id, item, 1);
        note = `Bought ${itemName(r.itemId)} for ${r.totalPrice} CHROMA.`;
      } else {
        const r = await sell(id, item, 1);
        note = `Sold ${itemName(item)} for ${r.totalPrice} CHROMA.`;
      }
      await this.events.changed();
    } catch (err) {
      note = err instanceof EconomyError ? err.message : 'The trade did not go through.';
    } finally {
      this.busy = false;
    }
    await this.render(note);
  }
}
