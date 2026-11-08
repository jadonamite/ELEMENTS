import balance from '../../../shared/balance.json';
import { itemName } from './items.js';
import './satchel-window.css';

interface ArmourPieceInfo {
  name: string;
  outfit: string;
  armour: number;
  nation: string;
  set: string;
}

const armourPieces = ((balance as unknown as { economy?: { armour?: { pieces?: Record<string, ArmourPieceInfo> } } })
  ?.economy?.armour?.pieces ?? {}) as Record<string, ArmourPieceInfo>;

export interface SatchelWindowEvents {
  satchel(): Record<string, number>;
  coin(): number;
  worn(): { item: string | null; outfit: string; armour: number };
  wear(itemId: string | null): Promise<{ item: string | null; outfit: string; armour: number }>;
  changed(): Promise<void>;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export class SatchelWindow {
  private readonly el: HTMLDivElement;
  private busy = false;
  private note = '';

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
      return;
    }
    if ((e.key === 'i' || e.key === 'I') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.toggle();
    }
  };

  constructor(private readonly events: SatchelWindowEvents) {
    this.el = document.createElement('div');
    this.el.className = 'satchel-window';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Satchel');
    this.el.hidden = true;
    document.body.appendChild(this.el);
    window.addEventListener('keydown', this.onKey, { capture: true });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  async open(): Promise<void> {
    if (document.pointerLockElement) document.exitPointerLock();
    this.note = '';
    this.el.hidden = false;
    document.body.classList.add('satchel-open');
    await this.render();
  }

  close(): void {
    this.el.hidden = true;
    this.note = '';
    document.body.classList.remove('satchel-open');
    document.querySelector<HTMLCanvasElement>('canvas')?.focus();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else void this.open();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.el.remove();
  }

  private async render(): Promise<void> {
    const coin = this.events.coin();
    const satchel = this.events.satchel();
    const worn = this.events.worn();

    const wornPiece = worn.item ? armourPieces[worn.item] : null;
    const wornHtml = `
      <div class="satchel-worn-section">
        <div class="satchel-worn-head">
          <span class="satchel-section-label">Worn Armour</span>
        </div>
        <div class="satchel-worn-detail">
          <div>
            <div class="satchel-worn-name">${wornPiece ? escape(wornPiece.name) : 'Plain clothes (rags)'}</div>
            <div class="satchel-worn-stat">${wornPiece ? `+${wornPiece.armour} armour` : 'No armour bonus'}</div>
          </div>
          ${worn.item ? `<button type="button" class="satchel-btn satchel-btn-subtle satchel-takeoff-btn" ${this.busy ? 'disabled' : ''}>Take off</button>` : ''}
        </div>
      </div>
    `;

    const carried = Object.entries(satchel).filter(([, count]) => count > 0);
    const listHtml = carried.length === 0
      ? '<p class="satchel-empty">Your satchel is empty.</p>'
      : `<ul class="satchel-items">${carried.map(([itemId, count]) => {
          const piece = armourPieces[itemId];
          const isWorn = worn.item === itemId;
          let detail = `Carrying ${count}`;
          let actionBtn = '';
          if (piece) {
            detail = `+${piece.armour} armour · ${escape(piece.nation)} ${escape(piece.set)}`;
            if (isWorn) {
              actionBtn = `
                <span class="satchel-badge">Worn</span>
                <button type="button" class="satchel-btn satchel-btn-subtle" data-wear="takeoff" ${this.busy ? 'disabled' : ''}>Take off</button>
              `;
            } else {
              actionBtn = `
                <button type="button" class="satchel-btn satchel-btn-action" data-wear="${escape(itemId)}" ${this.busy ? 'disabled' : ''}>Put on</button>
              `;
            }
          }
          return `
            <li class="satchel-row ${isWorn ? 'is-worn' : ''}">
              <div class="satchel-item-info">
                <span class="satchel-item-name">${escape(itemName(itemId, count))}</span>
                <span class="satchel-item-detail">${detail}</span>
              </div>
              <div class="satchel-item-actions">
                ${actionBtn}
              </div>
            </li>
          `;
        }).join('')}</ul>`;

    const noteHtml = this.note ? `<p class="satchel-note">${escape(this.note)}</p>` : '';

    this.el.innerHTML = `
      <div class="satchel-panel">
        <header class="satchel-header">
          <div>
            <h2 class="satchel-title">Satchel</h2>
            <div class="satchel-subtitle">What you carry on the road</div>
            <div class="satchel-money">
              <span class="satchel-purse">Purse <strong>${coin.toLocaleString()}</strong> CHROMA</span>
            </div>
          </div>
          <button type="button" class="satchel-close" aria-label="Close satchel">Close</button>
        </header>
        <div class="satchel-body">
          ${noteHtml}
          ${wornHtml}
          <div class="satchel-list-section">
            <span class="satchel-section-label">Carried Items</span>
            ${listHtml}
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.el.querySelector('.satchel-close')?.addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });

    this.el.querySelector('.satchel-takeoff-btn')?.addEventListener('click', () => {
      void this.handleWear(null);
    });

    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('[data-wear]')) {
      btn.addEventListener('click', () => {
        const target = btn.dataset.wear;
        void this.handleWear(target === 'takeoff' ? null : target ?? null);
      });
    }
  }

  private async handleWear(itemId: string | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.note = '';
    await this.render();
    try {
      await this.events.wear(itemId);
      await this.events.changed();
    } catch (err) {
      this.note = err instanceof Error ? err.message : 'Could not change armour';
    } finally {
      this.busy = false;
      await this.render();
    }
  }
}
