import type { Element } from '../../../shared/src/index.js';
import type { ControlAction, InputDevice } from '../controls/actions.js';
import { actionGlyph } from '../controls/glyphs.js';
import hintData from '../../public/hints/hints.json';
import { nextLoaderPicture } from './loader-pictures.js';

export interface Hint {
  id: string;
  kind: 'lore' | 'controls' | 'fighting' | 'world' | 'tip';
  title: string;
  text: string;
  action?: ControlAction;
  element: Element | null;
  where: Array<'town' | 'arena'>;
  minSeconds?: number;
  source?: string;
}

export interface LoaderOptions {
  destination: 'town' | 'arena';
  onEnter: () => void;
}

export type HintClass = 'know' | 'hint';
export const hintClass = (kind: Hint['kind']): HintClass => kind === 'lore' || kind === 'world' ? 'know' : 'hint';
const PANEL_LABEL: Record<HintClass, string> = { know: 'Did you know', hint: 'Hint' };
const HINTS_KEY = 'elements_loader_seen_hints';
const LAST_CLASS_KEY = 'elements_loader_last_class';

function readIds(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export function hintDuration(hint: Pick<Hint, 'title' | 'text' | 'minSeconds'>): number {
  const words = `${hint.title} ${hint.text}`.trim().split(/\s+/).length;
  return Math.max(5000, words * 300, (hint.minSeconds ?? 0) * 1000);
}

const MARKS = [
  // Fire, water, air and earth, each revealed by its share of real progress.
  'M25 58C9 48 13 35 24 24C23 36 31 36 29 16C45 28 52 41 43 52C39 58 31 61 25 58ZM27 49C34 54 40 43 33 37C34 44 29 42 27 49Z',
  'M17 34C27 24 37 38 48 28L49 34C36 46 27 32 16 42ZM13 45C26 35 36 51 51 39L50 47C36 59 26 43 14 53ZM22 23C27 18 34 22 40 19L42 24C32 30 29 23 22 29Z',
  'M10 34C24 22 36 36 43 29C49 23 40 20 36 24L34 19C46 9 58 24 48 33C38 43 25 28 11 41ZM10 45C24 34 37 50 49 39L52 44C37 60 26 43 12 52ZM18 21L28 18L30 22L20 27Z',
  'M10 52L23 30L34 49L43 34L56 55L48 56L43 46L38 55L27 55L23 43L17 54ZM22 25L26 17L35 20L32 28ZM14 59L49 58L52 62L11 63Z',
];

function elementMarks(): string {
  return MARKS.map((path, i) => `<svg class="loader-element" data-element="${['fire', 'water', 'air', 'earth'][i]}" viewBox="0 0 64 72" aria-hidden="true">
    <defs><clipPath id="loader-reveal-${i}"><rect class="loader-element-reveal" x="0" y="0" width="64" height="72"/></clipPath></defs>
    <path class="loader-element-ghost" d="${path}"/>
    <path class="loader-element-ink" d="${path}" clip-path="url(#loader-reveal-${i})"/>
  </svg>`).join('');
}

export class Loader {
  private readonly root: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly percentage: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly marks: SVGRectElement[];
  private readonly panel: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly content: HTMLElement;
  private readonly glyph: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly announcement: HTMLElement;
  private readonly hints: Hint[];
  private readonly onEnter: () => void;
  private seen = readIds();
  private active: Hint | null = null;
  private currentProgress = 0;
  private device: InputDevice = 'desktop';
  private disposed = false;
  private isReady = false;
  private rotationTimer: ReturnType<typeof setTimeout> | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LoaderOptions) {
    this.onEnter = options.onEnter;
    this.hints = (hintData.hints as Hint[]).filter(h => h.where.includes(options.destination));
    this.device = window.matchMedia?.('(pointer: coarse)').matches ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ? 'touch' : 'desktop';
    const destination = options.destination === 'town' ? 'Sindr' : 'The arena';
    this.root = document.createElement('div');
    this.root.id = 'elements-loader';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', `${destination} loading screen`);
    this.root.innerHTML = `
      <div class="loader-page" aria-hidden="true"></div>
      <div class="loader-paper" aria-hidden="true"></div>
      <div class="loader-inner">
        <header class="loader-header">
          <h1 class="loader-title">ELEMENTS</h1>
          <p class="loader-destination">Entering ${destination}</p>
        </header>
        <figure class="loader-ink" aria-hidden="true">
          <img class="loader-ink-figure" alt="" src="${nextLoaderPicture()}" width="1000" height="667" fetchpriority="high">
        </figure>
        <article class="loader-hint" aria-label="Did you know">
          <span class="loader-hint-badge">Did you know</span>
          <div class="loader-hint-content">
            <div class="loader-hint-glyph" aria-hidden="true"></div>
            <div class="loader-hint-body">
              <h2 class="loader-hint-title"></h2>
              <p class="loader-hint-text"></p>
            </div>
          </div>
        </article>
        <section class="loader-progress-section" aria-label="Loading progress">
          <div class="loader-elements" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" aria-label="Load progress">${elementMarks()}</div>
          <div class="loader-progress-meta">
            <span class="loader-stage">Reading the world manifest</span>
            <span class="loader-percentage">0%</span>
          </div>
        </section>
        <div class="loader-announcement" role="status" aria-live="polite" aria-atomic="true"></div>
      </div>`;
    this.progress = this.root.querySelector<HTMLElement>('.loader-elements')!;
    this.percentage = this.root.querySelector<HTMLElement>('.loader-percentage')!;
    this.stage = this.root.querySelector<HTMLElement>('.loader-stage')!;
    this.marks = Array.from(this.root.querySelectorAll<SVGRectElement>('.loader-element-reveal'));
    this.panel = this.root.querySelector<HTMLElement>('.loader-hint')!;
    this.badge = this.root.querySelector<HTMLElement>('.loader-hint-badge')!;
    this.content = this.root.querySelector<HTMLElement>('.loader-hint-content')!;
    this.glyph = this.root.querySelector<HTMLElement>('.loader-hint-glyph')!;
    this.title = this.root.querySelector<HTMLElement>('.loader-hint-title')!;
    this.text = this.root.querySelector<HTMLElement>('.loader-hint-text')!;
    this.announcement = this.root.querySelector<HTMLElement>('.loader-announcement')!;
    document.body.appendChild(this.root);
    window.addEventListener('pointerdown', this.onPointer);
    window.addEventListener('keydown', this.onKeyDown);
    (window as unknown as { elementsLoader?: Loader }).elementsLoader = this;
    let first: HintClass = 'know';
    try { if (localStorage.getItem(LAST_CLASS_KEY) === 'know') first = 'hint'; } catch { /* Private mode. */ }
    const hint = this.pickHint(first);
    if (hint) this.showHint(hint, true);
  }

  private readonly onPointer = (event: PointerEvent): void => this.setDevice(event.pointerType === 'touch' ? 'touch' : 'desktop');
  private readonly onKeyDown = (): void => this.setDevice('desktop');

  /** Only completed loading work advances the ink. */
  setProgress(fraction: number, stageName?: string): void {
    if (this.disposed || !Number.isFinite(fraction) || fraction < this.currentProgress) return;
    this.currentProgress = Math.min(1, Math.max(0, fraction));
    const percent = Math.round(this.currentProgress * 100);
    this.marks.forEach((mark, i) => mark.style.transform = `scaleX(${Math.min(1, Math.max(0, this.currentProgress * 4 - i))})`);
    this.percentage.textContent = `${percent}%`;
    this.progress.setAttribute('aria-valuenow', String(percent));
    if (stageName && this.stage.textContent !== stageName) {
      this.stage.textContent = stageName;
      this.announcement.textContent = `${stageName} (${percent}%)`;
    }
  }

  /** Hand over immediately; audio and mouse capture wait for in-game input. */
  ready(): void {
    if (this.disposed || this.isReady) return;
    this.isReady = true;
    this.setProgress(1, 'Ready');
    this.dismiss();
    this.onEnter();
  }

  dismiss(): void {
    if (this.disposed || this.dismissTimer !== null) return;
    this.clearHintTimers();
    this.root.classList.add('loader-hidden');
    this.dismissTimer = setTimeout(() => this.dispose(), this.reducedMotion() ? 0 : 300);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHintTimers();
    if (this.dismissTimer !== null) clearTimeout(this.dismissTimer);
    window.removeEventListener('pointerdown', this.onPointer);
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
    if ((window as unknown as { elementsLoader?: unknown }).elementsLoader === this) delete (window as unknown as { elementsLoader?: unknown }).elementsLoader;
  }

  private reducedMotion(): boolean { return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches); }

  private clearHintTimers(): void {
    if (this.rotationTimer !== null) clearTimeout(this.rotationTimer);
    if (this.transitionTimer !== null) clearTimeout(this.transitionTimer);
    this.rotationTimer = null;
    this.transitionTimer = null;
  }

  private pickHint(kind: HintClass): Hint | null {
    const available = this.hints.filter(h => hintClass(h.kind) === kind);
    let pool = available.filter(h => !this.seen.includes(h.id));
    if (pool.length === 0) {
      this.seen = this.seen.filter(id => !available.some(h => h.id === id));
      pool = available;
    }
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  /** Replace the single panel, then give the new text its full reading time. */
  showHint(hint: Hint, instant = false): void {
    if (this.disposed || this.isReady) return;
    this.clearHintTimers();
    const apply = (): void => {
      if (this.disposed) return;
      this.active = hint;
      const kind = hintClass(hint.kind);
      this.panel.dataset.class = kind;
      this.panel.setAttribute('aria-label', PANEL_LABEL[kind]);
      this.badge.dataset.kind = hint.kind;
      this.badge.textContent = PANEL_LABEL[kind];
      this.title.textContent = hint.title;
      this.text.textContent = hint.text;
      this.renderGlyph();
      this.content.classList.remove('hint-fading');
      this.announcement.textContent = `${PANEL_LABEL[kind]}: ${hint.title}. ${hint.text}`;
      if (!this.seen.includes(hint.id)) this.seen.push(hint.id);
      try {
        localStorage.setItem(HINTS_KEY, JSON.stringify(this.seen));
        localStorage.setItem(LAST_CLASS_KEY, kind);
      } catch { /* Private mode. */ }
      this.rotationTimer = setTimeout(() => {
        const next = this.pickHint(kind === 'know' ? 'hint' : 'know');
        if (next) this.showHint(next);
      }, hintDuration(hint));
    };
    if (instant || this.reducedMotion()) apply();
    else {
      this.content.classList.add('hint-fading');
      this.transitionTimer = setTimeout(apply, 200);
    }
  }

  private renderGlyph(): void {
    const action = this.active?.action;
    this.glyph.innerHTML = action ? actionGlyph(action, this.device) : '';
    this.glyph.style.display = action ? 'flex' : 'none';
  }

  setDevice(device: InputDevice): void { this.device = device; this.renderGlyph(); }
  getHint(kind?: HintClass): Hint | null { return !kind || (this.active && hintClass(this.active.kind) === kind) ? this.active : null; }
}
