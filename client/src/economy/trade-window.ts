import { type TradeState } from './door.js';
import { itemName } from './items.js';
import './trade-window.css';

export interface TradeWindowEvents {
  coin(): number;
  satchel(): Record<string, number>;
  changed(): Promise<void>;
  offer(partnerId: string, chroma: number, items: Record<string, number>): void;
  accept(): void;
  cancel(): void;
  listen(listener: ((state: TradeState) => void) | null): void;
  isGuest(): boolean;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export class TradeWindow {
  private readonly el: HTMLDivElement;
  private partnerId: string | null = null;
  private partnerName: string = '';

  private myChroma = 0;
  private myItems: Record<string, number> = {};
  private myAccepted = false;

  private theirChroma = 0;
  private theirItems: Record<string, number> = {};
  private theirAccepted = false;

  private notice = '';
  private isDone = false;

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    }
  };

  constructor(private readonly events: TradeWindowEvents) {
    this.el = document.createElement('div');
    this.el.className = 'trade-window';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.hidden = true;
    document.body.appendChild(this.el);
    window.addEventListener('keydown', this.onKey, { capture: true });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(partnerId: string, partnerName?: string): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.partnerId = partnerId;
    this.partnerName = partnerName || partnerId.slice(0, 8);
    this.myChroma = 0;
    this.myItems = {};
    this.myAccepted = false;
    this.theirChroma = 0;
    this.theirItems = {};
    this.theirAccepted = false;
    this.notice = '';
    this.isDone = false;

    this.el.hidden = false;
    document.body.classList.add('trade-open');

    this.events.listen((state) => this.onTradeState(state));

    if (this.events.isGuest()) {
      this.notice = 'Guests cannot trade. Sign in to trade with other players.';
    } else {
      this.events.offer(partnerId, 0, {});
    }

    this.render();
  }

  close(): void {
    if (this.partnerId && !this.isDone) {
      this.events.cancel();
    }
    this.events.listen(null);
    this.el.hidden = true;
    this.partnerId = null;
    document.body.classList.remove('trade-open');
    document.querySelector<HTMLCanvasElement>('canvas')?.focus();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.events.listen(null);
    this.el.remove();
  }

  private onTradeState(state: TradeState): void {
    if (!this.isOpen) return;

    if (state.error) {
      this.notice = state.error;
      this.myAccepted = false;
      this.theirAccepted = false;
    }

    if (state.done) {
      this.isDone = true;
      this.notice = 'Trade complete';
      void this.events.changed();
      this.render();
      setTimeout(() => {
        if (this.isOpen) this.close();
      }, 1800);
      return;
    }

    if (state.mine) {
      this.myChroma = state.mine.chroma;
      this.myItems = { ...state.mine.items };
      this.myAccepted = state.mine.accepted;
    }

    if (state.theirs) {
      this.theirChroma = state.theirs.chroma;
      this.theirItems = { ...state.theirs.items };
      this.theirAccepted = state.theirs.accepted;
    } else if (state.theirs === null) {
      this.theirChroma = 0;
      this.theirItems = {};
      this.theirAccepted = false;
    }

    this.render();
  }

  private render(): void {
    const partnerId = this.partnerId;
    if (!partnerId) return;

    const availableCoin = this.events.coin();
    const satchel = this.events.satchel();

    const noticeClass = this.isDone ? 'trade-notice success' : 'trade-notice';
    const noticeHtml = this.notice ? `<p class="${noticeClass}">${escape(this.notice)}</p>` : '';

    const satchelEntries = Object.entries(satchel).filter(([, count]) => count > 0);
    const myItemsHtml = satchelEntries.length === 0
      ? '<p class="trade-empty">No items in your satchel.</p>'
      : satchelEntries.map(([itemId, total]) => {
          const offered = this.myItems[itemId] ?? 0;
          return `
            <div class="trade-item-row">
              <span class="trade-item-name">${escape(itemName(itemId))}</span>
              <div class="trade-item-counters">
                <button type="button" class="trade-item-btn trade-minus-btn" data-item="${escape(itemId)}" ${offered <= 0 || this.myAccepted || this.isDone ? 'disabled' : ''}>-</button>
                <span class="trade-item-qty">${offered} / ${total}</span>
                <button type="button" class="trade-item-btn trade-plus-btn" data-item="${escape(itemId)}" ${offered >= total || this.myAccepted || this.isDone ? 'disabled' : ''}>+</button>
              </div>
            </div>
          `;
        }).join('');

    const theirItemsEntries = Object.entries(this.theirItems).filter(([, count]) => count > 0);
    const theirItemsHtml = theirItemsEntries.length === 0
      ? '<p class="trade-empty">No items offered.</p>'
      : theirItemsEntries.map(([itemId, count]) => `
          <div class="trade-their-item-row">
            <span>${escape(itemName(itemId))}</span>
            <strong>x${count}</strong>
          </div>
        `).join('');

    const myBadge = this.myAccepted
      ? '<span class="trade-badge accepted">Accepted</span>'
      : '<span class="trade-badge">Offering</span>';

    const theirBadge = this.theirAccepted
      ? '<span class="trade-badge accepted">Accepted</span>'
      : '<span class="trade-badge">Offering</span>';

    this.el.innerHTML = `
      <div class="trade-panel">
        <div class="trade-header">
          <div>
            <h2 class="trade-title">Player Trade</h2>
            <div class="trade-partner">Trading with <strong>${escape(this.partnerName)}</strong></div>
          </div>
          <button class="trade-close" type="button">Cancel</button>
        </div>
        <div class="trade-body">
          ${noticeHtml}
          <div class="trade-grid">
            <div class="trade-side trade-mine">
              <div class="trade-side-header">
                <h3>Your Offer</h3>
                ${myBadge}
              </div>
              <div class="trade-chroma-control">
                <span class="trade-control-label">CHROMA (Carried: <strong>${availableCoin}</strong>)</span>
                <div class="trade-chroma-row">
                  <input type="number" class="trade-chroma-input" min="0" max="${availableCoin}" step="1" value="${this.myChroma}" ${this.myAccepted || this.isDone ? 'disabled' : ''} />
                  <button type="button" class="trade-mini-btn" data-val="10" ${availableCoin < 10 || this.myAccepted || this.isDone ? 'disabled' : ''}>+10</button>
                  <button type="button" class="trade-mini-btn" data-val="50" ${availableCoin < 50 || this.myAccepted || this.isDone ? 'disabled' : ''}>+50</button>
                  <button type="button" class="trade-mini-btn" data-val="all" ${availableCoin <= 0 || this.myAccepted || this.isDone ? 'disabled' : ''}>All</button>
                </div>
              </div>
              <div class="trade-items-control">
                <span class="trade-control-label">Items</span>
                <div class="trade-items-list">
                  ${myItemsHtml}
                </div>
              </div>
              <button type="button" class="trade-btn trade-update-btn" ${this.myAccepted || this.isDone ? 'disabled' : ''}>Update Offer</button>
            </div>
            <div class="trade-side trade-theirs">
              <div class="trade-side-header">
                <h3>Their Offer</h3>
                ${theirBadge}
              </div>
              <div class="trade-their-summary">
                <div class="trade-their-chroma">
                  <span>CHROMA:</span>
                  <strong>${this.theirChroma}</strong>
                </div>
                <div class="trade-items-control">
                  <span class="trade-control-label">Items</span>
                  <div class="trade-their-items-list">
                    ${theirItemsHtml}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="trade-footer">
          <div class="trade-message">
            ${this.isDone ? 'Trade complete.' : this.myAccepted ? 'You accepted. Waiting for partner.' : 'Adjust your offer, then accept.'}
          </div>
          <div class="trade-actions">
            <button type="button" class="trade-btn trade-cancel-btn">Cancel</button>
            <button type="button" class="trade-btn trade-accept-btn" ${this.myAccepted || this.isDone ? 'disabled' : ''}>
              ${this.myAccepted ? 'Accepted' : 'Accept Trade'}
            </button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(partnerId, availableCoin, satchel);
  }

  private bindEvents(partnerId: string, availableCoin: number, satchel: Record<string, number>): void {
    const cancelAction = () => this.close();
    this.el.querySelector('.trade-close')?.addEventListener('click', cancelAction);
    this.el.querySelector('.trade-cancel-btn')?.addEventListener('click', cancelAction);

    const chromaInput = this.el.querySelector<HTMLInputElement>('.trade-chroma-input');

    this.el.querySelectorAll<HTMLButtonElement>('.trade-mini-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!chromaInput) return;
        const val = btn.dataset.val;
        let next = parseInt(chromaInput.value, 10) || 0;
        if (val === 'all') {
          next = availableCoin;
        } else if (val) {
          next = Math.min(availableCoin, next + parseInt(val, 10));
        }
        chromaInput.value = String(next);
        this.myChroma = next;
      });
    });

    this.el.querySelectorAll<HTMLButtonElement>('.trade-plus-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.dataset.item;
        if (!item) return;
        const total = satchel[item] ?? 0;
        const current = this.myItems[item] ?? 0;
        if (current < total) {
          this.myItems[item] = current + 1;
          this.render();
        }
      });
    });

    this.el.querySelectorAll<HTMLButtonElement>('.trade-minus-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.dataset.item;
        if (!item) return;
        const current = this.myItems[item] ?? 0;
        if (current > 1) {
          this.myItems[item] = current - 1;
          this.render();
        } else if (current === 1) {
          delete this.myItems[item];
          this.render();
        }
      });
    });

    const sendOffer = () => {
      if (chromaInput) {
        const val = parseInt(chromaInput.value, 10) || 0;
        this.myChroma = Math.max(0, Math.min(availableCoin, val));
      }
      this.myAccepted = false;
      this.events.offer(partnerId, this.myChroma, this.myItems);
      this.render();
    };

    this.el.querySelector('.trade-update-btn')?.addEventListener('click', sendOffer);

    this.el.querySelector('.trade-accept-btn')?.addEventListener('click', () => {
      if (this.myAccepted || this.isDone) return;
      if (chromaInput) {
        const val = parseInt(chromaInput.value, 10) || 0;
        this.myChroma = Math.max(0, Math.min(availableCoin, val));
      }
      this.myAccepted = true;
      this.events.offer(partnerId, this.myChroma, this.myItems);
      this.events.accept();
      this.render();
    });
  }
}
