import type { Element } from '../../../shared/src/index.js';
import type { ControlAction, InputDevice } from '../controls/actions.js';
import { actionGlyph } from '../controls/glyphs.js';

export interface Hint {
  id: string;
  kind: 'lore' | 'controls' | 'fighting' | 'world' | 'tip';
  title: string;
  text: string;
  action?: ControlAction;
  element: Element | null;
  where: Array<'town' | 'arena'>;
  minSeconds?: number;
}

export interface LoaderOptions {
  destination: 'town' | 'arena';
  element?: Element | null | undefined;
  onEnter: () => void;
  onChangeFighter?: (() => void) | undefined;
}

const STORAGE_SEEN_KEY = 'elements_loader_seen_hints';

export class Loader {
  private readonly root: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly percentageEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly barTrack: HTMLElement;
  private readonly hintCard: HTMLElement;
  private readonly hintBadge: HTMLElement;
  private readonly hintContent: HTMLElement;
  private readonly hintGlyph: HTMLElement;
  private readonly hintTitle: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly enterBtn: HTMLButtonElement;
  private readonly announcement: HTMLElement;

  private currentProgress = 0;
  private currentStage = 'Reading the world manifest';
  private hints: Hint[] = [];
  private activeHint: Hint | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private currentDevice: InputDevice = 'desktop';
  private readonly destination: 'town' | 'arena';
  private readonly playerElement: Element | null;
  private readonly onEnterCallback: () => void;
  private readonly onChangeFighter?: (() => void) | undefined;
  private isReady = false;

  constructor(options: LoaderOptions) {
    this.destination = options.destination;
    this.playerElement = options.element ?? null;
    this.onEnterCallback = options.onEnter;
    this.onChangeFighter = options.onChangeFighter;

    const hasTouch = typeof window !== 'undefined' &&
      (Boolean(window.matchMedia?.('(pointer: coarse)').matches) ||
      ('ontouchstart' in window) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));
    this.currentDevice = hasTouch ? 'touch' : 'desktop';

    this.root = document.createElement('div');
    this.root.id = 'elements-loader';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', `${options.destination === 'town' ? 'Sindr' : 'Arena'} loading screen`);

    const destLabel = options.destination === 'town' ? 'Sindr' : 'The Arena';

    this.root.innerHTML = `
      <div class="loader-inner">
        <header class="loader-header">
          <h1 class="loader-title">ELEMENTS</h1>
          <p class="loader-destination">Entering ${destLabel}</p>
        </header>

        <section class="loader-progress-section" aria-label="Loading progress">
          <div class="loader-bar-track" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" aria-label="Load progress">
            <div class="loader-bar-fill"></div>
          </div>
          <div class="loader-progress-meta">
            <span class="loader-stage">${this.currentStage}</span>
            <span class="loader-percentage">0%</span>
          </div>
        </section>

        <article class="loader-hint-card" aria-label="Game tip">
          <div class="loader-hint-top">
            <span class="loader-hint-badge" data-kind="controls">CONTROLS</span>
          </div>
          <div class="loader-hint-content">
            <div class="loader-hint-glyph" aria-hidden="true"></div>
            <div class="loader-hint-body">
              <h2 class="loader-hint-title">Move</h2>
              <p class="loader-hint-text">Traverse streets, markets, and open ground.</p>
            </div>
          </div>
        </article>

        <div class="loader-action">
          <button type="button" class="loader-enter-btn" disabled>Loading ${destLabel}...</button>
        </div>

        <div class="loader-announcement" role="status" aria-live="polite"></div>
      </div>
    `;

    this.barFill = this.root.querySelector<HTMLElement>('.loader-bar-fill')!;
    this.percentageEl = this.root.querySelector<HTMLElement>('.loader-percentage')!;
    this.stageEl = this.root.querySelector<HTMLElement>('.loader-stage')!;
    this.barTrack = this.root.querySelector<HTMLElement>('.loader-bar-track')!;
    this.hintCard = this.root.querySelector<HTMLElement>('.loader-hint-card')!;
    this.hintBadge = this.root.querySelector<HTMLElement>('.loader-hint-badge')!;
    this.hintContent = this.root.querySelector<HTMLElement>('.loader-hint-content')!;
    this.hintGlyph = this.root.querySelector<HTMLElement>('.loader-hint-glyph')!;
    this.hintTitle = this.root.querySelector<HTMLElement>('.loader-hint-title')!;
    this.hintText = this.root.querySelector<HTMLElement>('.loader-hint-text')!;
    this.enterBtn = this.root.querySelector<HTMLButtonElement>('.loader-enter-btn')!;
    this.announcement = this.root.querySelector<HTMLElement>('.loader-announcement')!;

    this.enterBtn.addEventListener('click', () => this.handleEnter());

    window.addEventListener('pointerdown', this.onPointer);
    window.addEventListener('keydown', this.onKeyDown);

    document.body.appendChild(this.root);
    (window as unknown as { elementsLoader?: Loader }).elementsLoader = this;

    void this.loadHints();
  }

  private readonly onPointer = (event: PointerEvent): void => {
    const dev: InputDevice = event.pointerType === 'touch' ? 'touch' : 'desktop';
    if (dev !== this.currentDevice) {
      this.currentDevice = dev;
      this.renderHintGlyph();
    }
  };

  private readonly onKeyDown = (): void => {
    if (this.currentDevice !== 'desktop') {
      this.currentDevice = 'desktop';
      this.renderHintGlyph();
    }
  };

  /** Real progress update (monotonic, 0.0 to 1.0). */
  setProgress(fraction: number, stageName?: string): void {
    if (this.disposed) return;
    if (fraction < this.currentProgress) return;
    const clamped = Math.min(1, Math.max(this.currentProgress, fraction));
    this.currentProgress = clamped;
    const percent = Math.round(clamped * 100);

    this.barFill.style.width = `${percent}%`;
    this.percentageEl.textContent = `${percent}%`;
    this.barTrack.setAttribute('aria-valuenow', String(percent));

    if (stageName && stageName !== this.currentStage) {
      this.currentStage = stageName;
      this.stageEl.textContent = stageName;
      this.announcement.textContent = `${stageName} (${percent}%)`;
    }
  }

  /** Marks the load complete and hands over to "Enter Sindr" / "Enter the arena". */
  ready(label?: string): void {
    if (this.disposed || this.isReady) return;
    this.isReady = true;
    this.setProgress(1, `${this.destination === 'town' ? 'Sindr' : 'The arena'} is ready`);

    const enterLabel = label ?? (this.destination === 'town' ? 'Enter Sindr' : 'Enter the arena');
    this.enterBtn.disabled = false;
    this.enterBtn.textContent = enterLabel;
    this.enterBtn.focus();
    this.announcement.textContent = `${enterLabel} is ready`;

    if (this.onChangeFighter) {
      const secBtn = document.createElement('button');
      secBtn.type = 'button';
      secBtn.className = 'loader-secondary-btn';
      secBtn.textContent = 'Change fighter';
      secBtn.addEventListener('click', () => {
        this.dismiss();
        this.onChangeFighter?.();
      });
      this.root.querySelector('.loader-action')!.appendChild(secBtn);
    }
  }

  private handleEnter(): void {
    if (this.disposed || !this.isReady) return;
    this.dismiss();
    this.onEnterCallback();
  }

  dismiss(): void {
    if (this.disposed) return;
    this.root.classList.add('loader-hidden');
    const prefersReducedMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const delay = prefersReducedMotion ? 0 : 400;
    setTimeout(() => {
      this.dispose();
    }, delay);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    window.removeEventListener('pointerdown', this.onPointer);
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
    if ((window as unknown as { elementsLoader?: unknown }).elementsLoader === this) {
      delete (window as unknown as { elementsLoader?: unknown }).elementsLoader;
    }
  }

  private async loadHints(): Promise<void> {
    try {
      const res = await fetch('/hints/hints.json');
      if (!res.ok || this.disposed) return;
      const data = (await res.json()) as { hints: Hint[] };
      if (!Array.isArray(data.hints) || this.disposed) return;

      this.hints = data.hints.filter(h => h.where.includes(this.destination));
      if (this.hints.length === 0 || this.disposed) return;

      this.startRotation();
    } catch (err) {
      if (!this.disposed) console.warn('Hints failed to load:', err);
    }
  }

  private startRotation(): void {
    if (this.hints.length === 0 || this.disposed) return;

    const seen = this.getSeenIds();
    let picked: Hint | null = null;

    if (seen.length === 0) {
      // First visit: always a controls hint
      const controlsHints = this.hints.filter(h => h.kind === 'controls');
      picked = controlsHints[Math.floor(Math.random() * controlsHints.length)] ?? this.hints[0]!;
    } else {
      picked = this.pickNextHint(seen);
    }

    if (picked) {
      this.showHint(picked);
    }
  }

  private pickNextHint(seen: string[]): Hint {
    const unseen = this.hints.filter(h => !seen.includes(h.id));
    const pool = unseen.length > 0 ? unseen : this.hints;

    if (unseen.length === 0) {
      this.saveSeenIds([]);
    }

    // Weight player element
    if (this.playerElement) {
      const elementHints = pool.filter(h => h.element === this.playerElement);
      if (elementHints.length > 0 && Math.random() < 0.45) {
        return elementHints[Math.floor(Math.random() * elementHints.length)]!;
      }
    }

    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  showHint(hint: Hint, instant = false): void {
    if (this.disposed) return;
    this.activeHint = hint;

    const seen = this.getSeenIds();
    if (!seen.includes(hint.id)) {
      seen.push(hint.id);
      this.saveSeenIds(seen);
    }

    const prefersReducedMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    const applyContent = (): void => {
      this.hintBadge.dataset.kind = hint.kind;
      this.hintBadge.textContent = hint.kind.toUpperCase();
      this.hintTitle.textContent = hint.title;
      this.hintText.textContent = hint.text;
      this.renderHintGlyph();
      this.announcement.textContent = `${hint.kind}: ${hint.title}. ${hint.text}`;
    };

    if (instant || prefersReducedMotion) {
      applyContent();
    } else {
      this.hintContent.classList.add('hint-fading');
      setTimeout(() => {
        if (this.disposed) return;
        applyContent();
        this.hintContent.classList.remove('hint-fading');
      }, 150);
    }

    // Schedule next hint rotation
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }

    const words = hint.text.trim().split(/\s+/).length;
    const duration = Math.max(4000, 500 + words * 300, (hint.minSeconds ?? 4) * 1000);

    this.timer = globalThis.setTimeout(() => {
      if (!this.disposed && this.hints.length > 0) {
        const next = this.pickNextHint(this.getSeenIds());
        if (next) this.showHint(next);
      }
    }, duration);
  }

  private renderHintGlyph(): void {
    if (!this.activeHint?.action) {
      this.hintGlyph.innerHTML = '';
      this.hintGlyph.style.display = 'none';
      return;
    }

    this.hintGlyph.style.display = 'flex';
    try {
      this.hintGlyph.innerHTML = actionGlyph(this.activeHint.action, this.currentDevice);
    } catch {
      this.hintGlyph.innerHTML = '';
      this.hintGlyph.style.display = 'none';
    }
  }

  private getSeenIds(): string[] {
    try {
      const raw = localStorage.getItem(STORAGE_SEEN_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  private saveSeenIds(ids: string[]): void {
    try {
      localStorage.setItem(STORAGE_SEEN_KEY, JSON.stringify(ids));
    } catch {
      // Storage unavailable
    }
  }

  // Testing helpers
  setDevice(device: InputDevice): void {
    this.currentDevice = device;
    this.renderHintGlyph();
  }

  getHint(): Hint | null {
    return this.activeHint;
  }
}
