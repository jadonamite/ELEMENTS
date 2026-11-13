import balance from '../../../shared/balance.json';
import {
  EconomyError,
  buyShop,
  fetchMerchant,
  fetchMerchantMind,
  fetchQuote,
  fetchShopOwnership,
  fetchShopsForSale,
  setShopPrices,
  withdrawShopProfit,
  type Merchant,
  type MerchantMind,
  type Quote,
  type ShopForSale,
  type ShopOwnership,
} from './api.js';
import type { StallResult } from './door.js';
import { itemName, shelfName } from './items.js';
import { SINDR_TOWNSFOLK } from '../life/townsfolk.js';
import './shop-window.css';

// The window a player sees at a market stall: the merchant's purse, what's on each shelf and its price,
// what the merchant will pay for what you carry, and, on every price, the merchant's reason in their words.
// A stall whose keeper has gone broke is offered for sale here, and one you own is run from here.

interface MerchantConfig {
  id: string;
  name: string;
  personality: string;
}

const MERCHANTS = (balance as unknown as { economy: { merchants: { sindr: MerchantConfig[] } } }).economy.merchants.sindr;

/** Who keeps each shop, from the shared people list. */
const KEEPERS = new Map(SINDR_TOWNSFOLK.filter((p) => p.keeps).map((p) => [p.keeps!, p.name]));

export interface ShopWindowEvents {
  satchel(): Record<string, number>;
  coin(): number;
  changed(): Promise<void>;
  trade(action: 'buy' | 'sell', merchantId: string, item: string): Promise<StallResult>;
  /** Opens a talk with the stall's keeper; the window closes for it. */
  talk?(merchantId: string): void;
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

    const ownership = await fetchShopOwnership(id).catch(() => null);
    const mind = await fetchMerchantMind(id).catch(() => null);
    const forSale = merchant.status === 'closed' && !ownership
      ? await fetchShopsForSale().then((shops) => shops.find((s) => s.merchantId === id) ?? null).catch(() => null)
      : null;

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

    const mindLine = mind?.latestThought
      ? `<p class="shop-personality">${escape(mind.latestThought)}${mind.lastDecision ? ` &mdash; <em>${escape(mind.lastDecision)}</em>` : ''}</p>`
      : (config ? `<p class="shop-personality">${escape(config.personality)}</p>` : '');

    const body = `
      ${mindLine}
      ${statusLine ? `<p class="shop-status">${escape(statusLine)}</p>` : ''}
      <section aria-label="For sale"><h3 class="shop-heading">For sale</h3>${buyRows}</section>
      <section aria-label="Sell to this stall"><h3 class="shop-heading">Sell what you carry</h3>${sellRows}</section>
      ${this.ownerBlock(merchant, ownership, forSale)}
      ${note ? `<p class="shop-note" role="status">${escape(note)}</p>` : ''}
    `;
    const purse = `<span class="shop-purse">Purse <strong>${merchant.balance.toLocaleString()}</strong></span><span class="shop-coin">You carry <strong>${this.events.coin().toLocaleString()}</strong> CHROMA</span>`;
    this.el.innerHTML = this.frame(title, purse, body);
    this.bindClose();
    this.el.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((b) =>
      b.addEventListener('click', () => {
        const action = b.dataset.action!;
        if (action === 'buy' || action === 'sell') void this.act(action, b.dataset.item!);
        else if (action === 'buy_shop') void this.buy(id);
        else if (action === 'withdraw') void this.withdraw(id);
        else if (action === 'set_prices') void this.setPrices(id);
      }),
    );
    (this.el.querySelector('.shop-close') as HTMLElement | null)?.focus();
  }

  // The stall's owner half: buy a broken shop, run the one you hold, or read who holds it.
  private ownerBlock(merchant: Merchant, ownership: ShopOwnership | null, forSale: ShopForSale | null): string {
    if (ownership?.mine) {
      const shelves = Object.keys(merchant.inventory);
      const priceRows = shelves.map((key) => {
        const m = ownership.priceMultipliers[key] ?? 1;
        return `<label class="shop-price-row"><span>${escape(shelfName(key))}</span><input type="number" min="0.6" max="2.5" step="0.1" value="${m}" data-shelf="${escape(key)}" aria-label="Price multiplier for ${escape(shelfName(key))}"></label>`;
      }).join('');
      const upkeep = ownership.unpaidUpkeepDays > 0
        ? `${ownership.unpaidUpkeepDays} ${ownership.unpaidUpkeepDays === 1 ? 'day' : 'days'} of upkeep unpaid.`
        : 'Upkeep is paid.';
      return `
        <section aria-label="Your shop" class="shop-owner">
          <h3 class="shop-heading">Your shop</h3>
          <p class="shop-owner-line">The purse holds <strong>${merchant.balance.toLocaleString()}</strong> CHROMA of takings. ${escape(upkeep)}</p>
          <button type="button" class="shop-act shop-wide" data-action="withdraw" ${merchant.balance <= 0 ? 'disabled' : ''}>Take the takings</button>
          ${shelves.length ? `
            <h3 class="shop-heading shop-heading-sub">Your prices</h3>
            <p class="shop-owner-line">What the stall asks, against the going rate.</p>
            <div class="shop-price-grid">${priceRows}</div>
            <button type="button" class="shop-act shop-wide" data-action="set_prices">Set prices</button>` : ''}
        </section>`;
    }

    if (ownership) {
      return `<p class="shop-status">Held by ${escape(ownership.ownerHandle ?? 'another')}. Its keeper sets the prices.</p>`;
    }

    if (merchant.status === 'closed') {
      if (!forSale) {
        return '<p class="shop-status">Closed, and not yet offered for sale.</p>';
      }
      const short = this.events.coin() < forSale.salePrice;
      return `
        <section aria-label="For sale" class="shop-owner shop-for-sale">
          <h3 class="shop-heading">For sale</h3>
          <p class="shop-owner-line">The keeper went broke. The Lord sells the stall for <strong>${forSale.salePrice.toLocaleString()}</strong> CHROMA, ${forSale.remainingDays} ${forSale.remainingDays === 1 ? 'day' : 'days'} left on the listing.</p>
          <button type="button" class="shop-act shop-wide" data-action="buy_shop" ${short ? 'disabled' : ''}>${short ? 'You cannot afford the stall' : 'Buy this shop'}</button>
        </section>`;
    }

    return '';
  }

  private async buy(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let note: string;
    try {
      await buyShop(id);
      await this.events.changed();
      note = 'The stall is yours. Its keeper answers to you now.';
    } catch (err) {
      note = err instanceof EconomyError ? err.message : 'The purchase did not go through.';
    } finally {
      this.busy = false;
    }
    await this.render(note);
  }

  private async withdraw(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let note: string;
    try {
      const r = await withdrawShopProfit(id);
      await this.events.changed();
      note = `Took ${r.amount.toLocaleString()} CHROMA from the till.`;
    } catch (err) {
      note = err instanceof EconomyError ? err.message : 'The till would not open.';
    } finally {
      this.busy = false;
    }
    await this.render(note);
  }

  private async setPrices(id: string): Promise<void> {
    if (this.busy) return;
    const multipliers: Record<string, number> = {};
    this.el.querySelectorAll<HTMLInputElement>('input[data-shelf]').forEach((input) => {
      const value = Number(input.value);
      if (Number.isFinite(value)) multipliers[input.dataset.shelf!] = value;
    });
    this.busy = true;
    let note: string;
    try {
      await setShopPrices(id, multipliers);
      note = 'The stall asks the new prices.';
    } catch (err) {
      note = err instanceof EconomyError ? err.message : 'The prices were refused.';
    } finally {
      this.busy = false;
    }
    await this.render(note);
  }

  private frame(title: string, purse: string, body: string): string {
    return `
      <div class="shop-panel">
        <header class="shop-header">
          <div><h2 class="shop-title">${escape(title)}</h2><div class="shop-money">${purse}</div></div>
          <div class="shop-header-acts">
            ${this.events.talk && this.merchantId && KEEPERS.has(this.merchantId) ? `<button type="button" class="shop-close shop-talk">Talk to ${escape(KEEPERS.get(this.merchantId)!.split(' ')[0]!)}</button>` : ''}
            <button type="button" class="shop-close" aria-label="Leave the stall">Leave</button>
          </div>
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
    this.el.querySelector('.shop-close:not(.shop-talk)')?.addEventListener('click', () => this.close());
    this.el.querySelector('.shop-talk')?.addEventListener('click', () => {
      const id = this.merchantId;
      this.close();
      if (id) this.events.talk?.(id);
    });
  }

  private async act(action: 'buy' | 'sell', item: string): Promise<void> {
    const id = this.merchantId;
    if (!id || this.busy) return;
    this.busy = true;
    let note = '';
    try {
      if (action === 'buy') {
        const r = await this.events.trade('buy', id, item);
        note = `Bought ${itemName(r.itemId ?? item)} for ${r.totalPrice} CHROMA.`;
      } else {
        const r = await this.events.trade('sell', id, item);
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
