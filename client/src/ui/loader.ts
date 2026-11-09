import type { Element } from '../../../shared/src/index.js';
import type { ControlAction, InputDevice } from '../controls/actions.js';
import { actionGlyph } from '../controls/glyphs.js';
import hintData from '../../public/hints/hints.json';
import { nextLoaderPicture, loaderPictureDetails } from './loader-pictures.js';

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
  'M12 52L32 16L52 52Z',
  'M12 16L52 16L32 52Z',
  'M12 52L32 16L52 52ZM21 36H43',
  'M12 16L52 16L32 52ZM21 32H43',
];

function elementMarks(): string {
  return MARKS.map((path, i) => `<svg class="loader-element" data-element="${['IGNIS', 'AQUES', 'AURA', 'TERRA'][i]}" viewBox="0 0 64 72" aria-hidden="true">
    <path class="loader-element-ghost" d="${path}"/>
    <path class="loader-element-ink" pathLength="100" d="${path}"/>
  </svg>`).join('');
}

function progressTicks(): string {
  return Array.from({ length: 51 }, (_, i) => `<span class="loader-tick${i % 5 === 0 ? ' loader-tick-major' : ''}" style="left:${i * 2}%" aria-hidden="true"><i class="loader-tick-ink"></i></span>`).join('');
}

export class Loader {
  private readonly root: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly percentage: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly marks: SVGPathElement[];
  private readonly ticks: HTMLElement[];
  private readonly panel: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly content: HTMLElement;
  private readonly glyph: HTMLElement;
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
    const picture = nextLoaderPicture();
    const plate = loaderPictureDetails(picture);
    this.root = document.createElement('div');
    this.root.id = 'elements-loader';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', `${destination} loading screen`);
    this.root.innerHTML = `
      <div class="loader-frame" aria-hidden="true"></div>
      <div class="loader-inner">
        <header class="loader-header">
          <h1 class="loader-title">ELEMENTS</h1>
          <p class="loader-destination">${destination}</p>
        </header>
        <figure class="loader-ink">
          <figcaption class="loader-marginalia loader-plate-caption">${plate.caption}</figcaption>
          <span class="loader-marginalia loader-plate-nation">${plate.nation}</span>
          <img class="loader-ink-figure" alt="${plate.caption}, an ink study" src="${picture}" width="667" height="1000" fetchpriority="high">
          <span class="loader-marginalia loader-plate-number">PLATE ${plate.number}</span>
          <span class="loader-marginalia loader-plate-index">${plate.number} / 030</span>
        </figure>
        <article class="loader-hint" aria-label="Did you know">
          <span class="loader-hint-badge">Did you know</span>
          <div class="loader-hint-content">
            <div class="loader-hint-glyph" aria-hidden="true"></div>
            <div class="loader-hint-body">
              <p class="loader-hint-text"></p>
            </div>
          </div>
        </article>
        <section class="loader-progress-section" aria-label="Loading progress">
          <div class="loader-elements" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" aria-label="Load progress">${elementMarks()}<div class="loader-rule" aria-hidden="true">${progressTicks()}</div></div>
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
    this.marks = Array.from(this.root.querySelectorAll<SVGPathElement>('.loader-element-ink'));
    this.ticks = Array.from(this.root.querySelectorAll<HTMLElement>('.loader-tick-ink'));
    this.panel = this.root.querySelector<HTMLElement>('.loader-hint')!;
    this.badge = this.root.querySelector<HTMLElement>('.loader-hint-badge')!;
    this.content = this.root.querySelector<HTMLElement>('.loader-hint-content')!;
    this.glyph = this.root.querySelector<HTMLElement>('.loader-hint-glyph')!;
    this.text = this.root.querySelector<HTMLElement>('.loader-hint-text')!;
    this.announcement = this.root.querySelector<HTMLElement>('.loader-announcement')!;
    this.setProgress(0);
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
    this.marks.forEach((mark, i) => {
      const share = Math.min(1, Math.max(0, this.currentProgress * 4 - i));
      mark.style.strokeDashoffset = String(100 * (1 - (this.reducedMotion() ? Number(share > 0) : share)));
    });
    this.ticks.forEach((tick, i) => tick.style.opacity = this.currentProgress > 0 && i / 50 <= this.currentProgress ? '1' : '0');
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
      this.text.textContent = hint.text;
      this.renderGlyph();
      this.content.classList.remove('hint-fading');
      this.announcement.textContent = `${PANEL_LABEL[kind]}: ${hint.text}`;
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
