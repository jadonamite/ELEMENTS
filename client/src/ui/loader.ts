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

/** The two panels: "Did you know" carries lore and the world, "Hint" carries controls and rules. */
export type HintClass = 'know' | 'hint';
export const hintClass = (kind: Hint['kind']): HintClass => (kind === 'lore' || kind === 'world' ? 'know' : 'hint');
const PANEL_LABEL: Record<HintClass, string> = { know: 'Did you know', hint: 'Hint' };

interface HintPanel {
  root: HTMLElement;
  badge: HTMLElement;
  content: HTMLElement;
  glyph: HTMLElement;
  title: HTMLElement;
  text: HTMLElement;
}

/** Ink portrait for the fighter being loaded: the Hush of their nation, in their sex. */
function portraitFor(element: Element | null): string {
  let sex = 'male';
  try {
    const raw = localStorage.getItem('elements_character');
    if (raw && (JSON.parse(raw) as { sex?: string }).sex === 'female') sex = 'female';
  } catch {
    // Storage unavailable
  }
  return `/assets/ui/loader/ink-${(element ?? 'IGNIS').toLowerCase()}_${sex}.jpg`;
}

function createPanel(c: HintClass): HintPanel {
  const root = document.createElement('article');
  root.className = 'loader-hint';
  root.dataset.class = c;
  root.setAttribute('aria-label', PANEL_LABEL[c]);
  root.innerHTML = `
    <span class="loader-hint-badge" data-kind="${c === 'know' ? 'lore' : 'controls'}">${PANEL_LABEL[c]}</span>
    <div class="loader-hint-content">
      <div class="loader-hint-glyph" aria-hidden="true"></div>
      <div class="loader-hint-body">
        <h2 class="loader-hint-title"></h2>
        <p class="loader-hint-text"></p>
      </div>
    </div>`;
  return {
    root,
    badge: root.querySelector<HTMLElement>('.loader-hint-badge')!,
    content: root.querySelector<HTMLElement>('.loader-hint-content')!,
    glyph: root.querySelector<HTMLElement>('.loader-hint-glyph')!,
    title: root.querySelector<HTMLElement>('.loader-hint-title')!,
    text: root.querySelector<HTMLElement>('.loader-hint-text')!,
  };
}

export class Loader {
  private readonly root: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly percentageEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly barTrack: HTMLElement;
  private readonly panels: Record<HintClass, HintPanel>;
  private readonly enterBtn: HTMLButtonElement;
  private readonly announcement: HTMLElement;

  private currentProgress = 0;
  private currentStage = 'Reading the world manifest';
  private hints: Hint[] = [];
  private readonly active: Record<HintClass, Hint | null> = { know: null, hint: null };
  private readonly timers: Record<HintClass, ReturnType<typeof setTimeout> | null> = { know: null, hint: null };
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
      <div class="loader-page" aria-hidden="true"></div>
      <div class="loader-paper" aria-hidden="true"></div>
      <div class="loader-inner">
        <figure class="loader-ink" aria-hidden="true">
          <img class="loader-ink-figure" alt="" src="${portraitFor(this.playerElement)}">
        </figure>
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

        <div class="loader-hints"></div>

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
    this.panels = { know: createPanel('know'), hint: createPanel('hint') };
    const hintsEl = this.root.querySelector<HTMLElement>('.loader-hints')!;
    hintsEl.appendChild(this.panels.know.root);
    hintsEl.appendChild(this.panels.hint.root);
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
      this.renderHintGlyph('hint');
    }
  };

  private readonly onKeyDown = (): void => {
    if (this.currentDevice !== 'desktop') {
      this.currentDevice = 'desktop';
      this.renderHintGlyph('hint');
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
    for (const c of ['know', 'hint'] as const) {
      const t = this.timers[c];
      if (t !== null) clearTimeout(t);
      this.timers[c] = null;
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
    for (const c of ['know', 'hint'] as const) {
      // A first visit opens on a controls hint.
      const first = c === 'hint' && seen.length === 0 ? this.hints.filter(h => h.kind === 'controls') : [];
      const picked = first.length ? first[Math.floor(Math.random() * first.length)]! : this.pickNextHint(c);
      if (picked) this.showHint(picked, true);
    }
  }

  private pickNextHint(c: HintClass): Hint | null {
    const ofClass = this.hints.filter(h => hintClass(h.kind) === c);
    if (ofClass.length === 0) return null;
    const seen = this.getSeenIds();
    let unseen = ofClass.filter(h => !seen.includes(h.id) && h !== this.active[c]);
    if (unseen.length === 0) {
      this.saveSeenIds(seen.filter(id => !ofClass.some(h => h.id === id)));
      unseen = ofClass.filter(h => h !== this.active[c]);
    }
    const pool = unseen.length > 0 ? unseen : ofClass;
    if (this.playerElement) {
      const own = pool.filter(h => h.element === this.playerElement);
      if (own.length > 0 && Math.random() < 0.45) return own[Math.floor(Math.random() * own.length)]!;
    }
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  /** Shows a hint in its panel ("Did you know" for lore and world, "Hint" for controls and rules). */
  showHint(hint: Hint, instant = false): void {
    if (this.disposed) return;
    const c = hintClass(hint.kind);
    const p = this.panels[c];
    this.active[c] = hint;

    const seen = this.getSeenIds();
    if (!seen.includes(hint.id)) {
      seen.push(hint.id);
      this.saveSeenIds(seen);
    }

    const prefersReducedMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const applyContent = (): void => {
      p.badge.dataset.kind = hint.kind;
      p.title.textContent = hint.title;
      p.text.textContent = hint.text;
      this.renderHintGlyph(c);
      this.announcement.textContent = `${PANEL_LABEL[c]}: ${hint.title}. ${hint.text}`;
    };

    if (instant || prefersReducedMotion) {
      applyContent();
    } else {
      p.content.classList.add('hint-fading');
      setTimeout(() => {
        if (this.disposed) return;
        applyContent();
        p.content.classList.remove('hint-fading');
      }, 250);
    }

    const prev = this.timers[c];
    if (prev !== null) clearTimeout(prev);
    const words = hint.text.trim().split(/\s+/).length;
    // Lore reads slower than a control reminder; the two panels also turn at different moments.
    const duration = Math.max(c === 'know' ? 7000 : 5000, 800 + words * 320, (hint.minSeconds ?? 4) * 1000);
    this.timers[c] = globalThis.setTimeout(() => {
      if (this.disposed) return;
      const next = this.pickNextHint(c);
      if (next) this.showHint(next);
    }, duration);
  }

  private renderHintGlyph(c: HintClass): void {
    const p = this.panels[c];
    const action = this.active[c]?.action;
    if (!action) {
      p.glyph.innerHTML = '';
      p.glyph.style.display = 'none';
      return;
    }
    p.glyph.style.display = 'flex';
    try {
      p.glyph.innerHTML = actionGlyph(action, this.currentDevice);
    } catch {
      p.glyph.innerHTML = '';
      p.glyph.style.display = 'none';
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
    this.renderHintGlyph('hint');
  }

  getHint(c: HintClass = 'hint'): Hint | null {
    return this.active[c];
  }
}
