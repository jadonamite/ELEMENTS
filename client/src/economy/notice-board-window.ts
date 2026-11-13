import { type Bounty, type DailyChronicle, type Standing } from './api.js';
import './notice-board-window.css';

// The notice board in the market square: what the watch has against you, who else it is paying
// for, and the daily market chronicle. It reads; it does not trade or change a thing.

export interface NoticeBoardEvents {
  standing(): Standing;
  accountId(): string | null;
  bounties(): Promise<Bounty[]>;
  chronicle?(): Promise<DailyChronicle | null>;
  isGuest(): boolean;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A player's handle as the watch posts it: the first eight characters of the account. */
const handle = (accountId: string): string => accountId.slice(0, 8);

export class NoticeBoardWindow {
  private readonly el: HTMLDivElement;

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    }
  };

  constructor(private readonly events: NoticeBoardEvents) {
    this.el = document.createElement('div');
    this.el.className = 'notice-board-window';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Notice board');
    this.el.hidden = true;
    document.body.appendChild(this.el);
    window.addEventListener('keydown', this.onKey, { capture: true });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  async open(): Promise<void> {
    if (document.pointerLockElement) document.exitPointerLock();
    this.el.hidden = false;
    document.body.classList.add('notice-board-open');
    await this.render();
  }

  close(): void {
    this.el.hidden = true;
    document.body.classList.remove('notice-board-open');
    document.querySelector<HTMLCanvasElement>('canvas')?.focus();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.el.remove();
  }

  private async render(): Promise<void> {
    const standing = this.events.standing();
    const me = this.events.accountId();

    let bounties: Bounty[] = [];
    let failed = false;
    try {
      bounties = await this.events.bounties();
    } catch {
      failed = true;
    }

    const mine = me ? bounties.find((b) => b.targetAccountId === me) : undefined;
    const others = bounties.filter((b) => b !== mine);

    let standingHtml: string;
    if (this.events.isGuest()) {
      standingHtml = '<p class="notice-board-clear">Guests are not known to the watch.</p>';
    } else if (mine) {
      standingHtml = `<p class="notice-board-wanted">Wanted: you. ${mine.rewardChroma} CHROMA to whoever brings you down.</p>`;
    } else if (standing.redFlags > 0) {
      standingHtml = `<p class="notice-board-marked">${standing.redFlags} red ${standing.redFlags === 1 ? 'flag' : 'flags'} against your name. Three at once and the watch posts a price.</p>`;
    } else {
      standingHtml = '<p class="notice-board-clear">The watch has no quarrel with you.</p>';
    }

    const rows = others.map((b) => `
      <li class="notice-board-row">
        <div class="notice-board-row-head">
          <span class="notice-board-name">Outlaw ${escape(handle(b.targetAccountId))}</span>
          <span class="notice-board-reward">${b.rewardChroma} CHROMA</span>
        </div>
        <span class="notice-board-reason">${escape(b.reason)}</span>
      </li>
    `).join('');

    const listHtml = failed
      ? '<p class="notice-board-empty">The notices have blown away. The board could not be read.</p>'
      : others.length === 0
        ? '<p class="notice-board-empty">No other name is posted today.</p>'
        : `<ul class="notice-board-list">${rows}</ul>`;

    let chronicle: DailyChronicle | null = null;
    if (this.events.chronicle) {
      try {
        chronicle = await this.events.chronicle();
      } catch {
        // Continue without chronicle if unavailable
      }
    }

    const chronicleHtml = chronicle
      ? `
      <div class="notice-board-section">
        <h3 class="notice-board-heading">${escape(chronicle.title)}</h3>
        <p class="notice-board-clear"><strong>${escape(chronicle.headline)}</strong></p>
        ${chronicle.paragraphs.map((p) => `<p class="notice-board-reason">${escape(p)}</p>`).join('')}
        ${
          chronicle.shortNotices.length > 0
            ? `<ul class="notice-board-list">${chronicle.shortNotices
                .map((n) => `<li class="notice-board-row"><span class="notice-board-reason">${escape(n)}</span></li>`)
                .join('')}</ul>`
            : ''
        }
      </div>`
      : '';

    this.el.innerHTML = `
      <div class="notice-board-panel">
        <div class="notice-board-header">
          <div>
            <h2 class="notice-board-title">Notice board</h2>
            <div class="notice-board-subtitle">Sindr, by order of the watch</div>
          </div>
          <button class="notice-board-close" type="button">Close</button>
        </div>
        <div class="notice-board-body">
          ${standingHtml}
          ${chronicleHtml}
          <div class="notice-board-section">
            <h3 class="notice-board-heading">Posted by the watch</h3>
            ${listHtml}
          </div>
          <p class="notice-board-hint">A price is paid to whoever brings the outlaw down. The watch collects its fines in CHROMA.</p>
        </div>
      </div>
    `;

    this.el.querySelector('.notice-board-close')?.addEventListener('click', () => this.close());
  }
}
