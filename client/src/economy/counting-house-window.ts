import { type CountingHouseNote } from './api.js';
import './counting-house-window.css';

export interface CountingHouseWindowEvents {
  coin(): number;
  accountId(): string | null;
  changed(): Promise<void>;
  deposit(houseId: string, amount: number): Promise<CountingHouseNote>;
  withdraw(houseId: string, noteId: string): Promise<{ withdrawnAmount: number; note: CountingHouseNote }>;
  notes(houseId: string): Promise<CountingHouseNote[]>;
  isGuest(): boolean;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export class CountingHouseWindow {
  private readonly el: HTMLDivElement;
  private houseId: string | null = null;
  private busy = false;
  private notesList: CountingHouseNote[] = [];

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    }
  };

  constructor(private readonly events: CountingHouseWindowEvents) {
    this.el = document.createElement('div');
    this.el.className = 'counting-house-window';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.hidden = true;
    document.body.appendChild(this.el);
    window.addEventListener('keydown', this.onKey, { capture: true });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  async open(houseId: string): Promise<void> {
    if (document.pointerLockElement) document.exitPointerLock();
    this.houseId = houseId;
    this.el.hidden = false;
    document.body.classList.add('counting-house-open');
    await this.render();
  }

  close(): void {
    this.el.hidden = true;
    this.houseId = null;
    document.body.classList.remove('counting-house-open');
    document.querySelector<HTMLCanvasElement>('canvas')?.focus();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.el.remove();
  }

  private async render(notice = ''): Promise<void> {
    const id = this.houseId;
    if (!id) return;

    if (this.events.isGuest()) {
      this.el.innerHTML = `
        <div class="counting-house-panel">
          <div class="counting-house-header">
            <div>
              <h2 class="counting-house-title">Counting House</h2>
              <div class="counting-house-subtitle">Depository of Sindr</div>
            </div>
            <button class="counting-house-close" type="button">Close</button>
          </div>
          <div class="counting-house-body">
            <p class="counting-house-notice">Guests cannot access the vault. Sign in to deposit or redeem sealed notes.</p>
          </div>
        </div>
      `;
      this.bindClose();
      return;
    }

    try {
      this.notesList = await this.events.notes(id);
    } catch (err) {
      this.el.innerHTML = `
        <div class="counting-house-panel">
          <div class="counting-house-header">
            <div>
              <h2 class="counting-house-title">Counting House</h2>
              <div class="counting-house-subtitle">Depository of Sindr</div>
            </div>
            <button class="counting-house-close" type="button">Close</button>
          </div>
          <div class="counting-house-body">
            <p class="counting-house-notice">${escape(err instanceof Error ? err.message : 'Counting house is unreachable')}</p>
          </div>
        </div>
      `;
      this.bindClose();
      return;
    }

    const activeNotes = this.notesList.filter((n) => n.status === 'active');
    const vaultTotal = activeNotes.reduce((sum, n) => sum + n.amount, 0);
    const purseCoin = this.events.coin();

    const noticeHtml = notice ? `<p class="counting-house-notice">${escape(notice)}</p>` : '';

    const notesHtml = activeNotes.length === 0
      ? '<p class="counting-house-empty">No active sealed notes in the vault.</p>'
      : activeNotes.map((n) => `
          <div class="counting-house-note-row">
            <div class="counting-house-note-info">
              <span class="counting-house-note-amount">${n.amount} CHROMA</span>
              <span class="counting-house-note-id">${escape(n.noteId)}</span>
            </div>
            <button class="counting-house-btn counting-house-withdraw-btn" type="button" data-note-id="${escape(n.noteId)}">Withdraw</button>
          </div>
        `).join('');

    this.el.innerHTML = `
      <div class="counting-house-panel">
        <div class="counting-house-header">
          <div>
            <h2 class="counting-house-title">Counting House</h2>
            <div class="counting-house-subtitle">Depository of Sindr</div>
            <div class="counting-house-balances">
              <span>Purse: <strong>${purseCoin} CHROMA</strong></span>
              <span>Vault: <strong>${vaultTotal} CHROMA</strong> (${activeNotes.length} notes)</span>
            </div>
          </div>
          <button class="counting-house-close" type="button">Close</button>
        </div>
        <div class="counting-house-body">
          ${noticeHtml}
          <div class="counting-house-section">
            <h3 class="counting-house-heading">Deposit CHROMA</h3>
            <p class="counting-house-hint">Sealed notes are redeemable at any counting house across the nations.</p>
            <div class="counting-house-deposit-row">
              <input type="number" class="counting-house-input" min="1" max="${purseCoin}" step="1" placeholder="Amount" value="${purseCoin > 0 ? Math.min(purseCoin, 10) : ''}" ${purseCoin <= 0 ? 'disabled' : ''} />
              <div class="counting-house-quick-btns">
                <button type="button" class="counting-house-quick-btn" data-val="10" ${purseCoin < 10 ? 'disabled' : ''}>10</button>
                <button type="button" class="counting-house-quick-btn" data-val="50" ${purseCoin < 50 ? 'disabled' : ''}>50</button>
                <button type="button" class="counting-house-quick-btn" data-val="100" ${purseCoin < 100 ? 'disabled' : ''}>100</button>
                <button type="button" class="counting-house-quick-btn" data-val="all" ${purseCoin <= 0 ? 'disabled' : ''}>All</button>
              </div>
              <button type="button" class="counting-house-btn counting-house-deposit-btn" ${purseCoin <= 0 ? 'disabled' : ''}>Deposit</button>
            </div>
          </div>
          <div class="counting-house-section">
            <h3 class="counting-house-heading">Active Sealed Notes</h3>
            <div class="counting-house-notes-list">
              ${notesHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(id, purseCoin);
  }

  private bindClose(): void {
    this.el.querySelector('.counting-house-close')?.addEventListener('click', () => this.close());
  }

  private bindEvents(houseId: string, purseCoin: number): void {
    this.bindClose();

    const input = this.el.querySelector<HTMLInputElement>('.counting-house-input');
    const depositBtn = this.el.querySelector<HTMLButtonElement>('.counting-house-deposit-btn');

    this.el.querySelectorAll<HTMLButtonElement>('.counting-house-quick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!input) return;
        const val = btn.dataset.val;
        if (val === 'all') {
          input.value = String(purseCoin);
        } else if (val) {
          input.value = val;
        }
      });
    });

    depositBtn?.addEventListener('click', async () => {
      if (this.busy || !input) return;
      const amount = parseInt(input.value, 10);
      if (isNaN(amount) || amount <= 0) {
        await this.render('Enter a valid amount to deposit');
        return;
      }
      if (amount > purseCoin) {
        await this.render('You do not carry that much CHROMA');
        return;
      }
      this.busy = true;
      try {
        const note = await this.events.deposit(houseId, amount);
        await this.events.changed();
        await this.render(`Deposited ${amount} CHROMA. Sealed note ${note.noteId} issued.`);
      } catch (err) {
        await this.render(err instanceof Error ? err.message : 'Deposit failed');
      } finally {
        this.busy = false;
      }
    });

    this.el.querySelectorAll<HTMLButtonElement>('.counting-house-withdraw-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (this.busy) return;
        const noteId = btn.dataset.noteId;
        if (!noteId) return;
        this.busy = true;
        try {
          const result = await this.events.withdraw(houseId, noteId);
          await this.events.changed();
          await this.render(`Redeemed note for ${result.withdrawnAmount} CHROMA.`);
        } catch (err) {
          await this.render(err instanceof Error ? err.message : 'Withdrawal failed');
        } finally {
          this.busy = false;
        }
      });
    });
  }
}
