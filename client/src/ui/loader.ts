import type { Element } from '../../../shared/src/index.js';
import type { ControlAction, InputDevice } from '../controls/actions.js';
import { actionGlyph } from '../controls/glyphs.js';
import hintData from '../../public/hints/hints.json';
import { nextLoaderPicture, loaderPictureDetails } from './loader-pictures.js';
import { loaderDiagram, diagramStrokeProgress } from './loader-diagram.js';
import { elementGlyph, GLYPH_ELEMENTS, elementTurnFrame, elementInkFrame } from './loader-turn.js';

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

function inkMask(id: string, className: string): string {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="72" height="72"><path class="${className}" fill="white" filter="url(#loader-ink-soften)" d="${elementInkFrame(0).d}"/></mask>`;
}

function elementMarks(): string {
  return GLYPH_ELEMENTS.map((element, i) => {
    const glyph = elementGlyph(i);
    const path = `${glyph.d}${glyph.detail}`;
    return `<svg class="loader-element" data-element="${element}" viewBox="0 0 64 84" aria-hidden="true">
      <defs>${inkMask(`loader-reveal-${i}`, 'loader-element-reveal')}</defs>
      <path class="loader-element-ghost" fill-rule="evenodd" d="${path}"/>
      <path class="loader-element-ink" fill-rule="evenodd" d="${path}" mask="url(#loader-reveal-${i})"/>
      <text class="loader-element-label" x="32" y="78" text-anchor="middle">${element}</text>
    </svg>`;
  }).join('');
}

function turningEmblem(): string {
  const ring = elementGlyph(0).detail;
  const shape = (kind: string): string => `<path class="loader-turn-${kind}-shape loader-turn-outline" fill-rule="evenodd"/><g mask="url(#loader-turn-ink)"><path class="loader-turn-${kind}-shape loader-turn-solid" fill-rule="evenodd"/></g>`;
  return `<svg class="loader-turn" viewBox="0 0 64 84" aria-hidden="true">
    <defs><filter id="loader-ink-soften" x="-4" y="-4" width="72" height="72" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation=".25"/></filter>${inkMask('loader-turn-ink', 'loader-turn-reveal')}</defs>
    <path class="loader-turn-outline" fill-rule="evenodd" d="${ring}"/>
    <path class="loader-turn-solid" fill-rule="evenodd" d="${ring}" mask="url(#loader-turn-ink)"/>
    ${shape('current')}${shape('next')}
    <text class="loader-turn-label" x="32" y="78" text-anchor="middle"></text>
  </svg>`;
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
  private readonly turningReveal: SVGPathElement;
  private displayedProgress = 0;
  private lastInkTime = 0;
  private readonly diagram: SVGSVGElement;
  private diagramLines: SVGPathElement[] = [];
  private diagramObserver: ResizeObserver | null = null;
  private readonly ticks: HTMLElement[];
  private readonly turningLabel: SVGTextElement;
  private turnFrame: number | null = null;
  private turnStarted: number | null = null;
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
    const diagramSeed = Math.floor(Math.random() * 0xffffffff);
    this.root = document.createElement('div');
    this.root.id = 'elements-loader';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', `${destination} loading screen`);
    this.root.innerHTML = `
      <div class="loader-frame" aria-hidden="true"></div>
      <div class="loader-inner">
        <svg class="loader-diagram" viewBox="0 0 1000 1000" aria-hidden="true">${loaderDiagram(plate, 1000, 1000, diagramSeed)}</svg>
        <header class="loader-header">
          <h1 class="loader-title">ELEMENTS</h1>
          <p class="loader-destination">${destination}</p>
        </header>
        <figure class="loader-ink">
          <figcaption class="loader-marginalia loader-plate-caption">${plate.caption}</figcaption>
          <span class="loader-marginalia loader-plate-nation">${plate.nation}</span>
          <img class="loader-ink-figure" alt="${plate.caption}, an ink study" src="${picture}" width="667" height="1000" fetchpriority="high">
          <span class="loader-marginalia loader-plate-number">PLATE ${plate.number}</span>
          ${turningEmblem()}
          <span class="loader-marginalia loader-plate-index">${plate.number} / 030</span>
          <span class="loader-marginalia loader-plate-stamp" aria-hidden="true">EL.${plate.element.slice(0, 2)}.${plate.number}<br>INK STUDY<br><span class="loader-plate-coordinates">${plate.head.map(v => v.toFixed(2)).join(" / ")}</span></span>
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
    this.marks = Array.from(this.root.querySelectorAll<SVGPathElement>('.loader-element-reveal'));
    this.diagram = this.root.querySelector<SVGSVGElement>('.loader-diagram')!;
    this.diagramLines = Array.from(this.diagram.querySelectorAll<SVGPathElement>('.loader-diagram-line'));
    this.turningReveal = this.root.querySelector<SVGPathElement>('.loader-turn-reveal')!;
    this.turningLabel = this.root.querySelector<SVGTextElement>('.loader-turn-label')!;
    this.renderTurn(0);
    this.ticks = Array.from(this.root.querySelectorAll<HTMLElement>('.loader-tick-ink'));
    this.panel = this.root.querySelector<HTMLElement>('.loader-hint')!;
    this.badge = this.root.querySelector<HTMLElement>('.loader-hint-badge')!;
    this.content = this.root.querySelector<HTMLElement>('.loader-hint-content')!;
    this.glyph = this.root.querySelector<HTMLElement>('.loader-hint-glyph')!;
    this.text = this.root.querySelector<HTMLElement>('.loader-hint-text')!;
    this.announcement = this.root.querySelector<HTMLElement>('.loader-announcement')!;
    this.setProgress(0);
    document.body.appendChild(this.root);
    const figure = this.root.querySelector<HTMLElement>('.loader-ink')!;
    const sheet = this.root.querySelector<HTMLElement>('.loader-inner')!;
    const fitDiagram = (): void => {
      if (this.disposed) return;
      const { width = 1000, height = 1000, left = 0, top = 0 } = sheet.getBoundingClientRect?.() ?? {};
      const portrait = figure.getBoundingClientRect?.();
      if (width <= 0 || height <= 0) return;
      this.diagram.setAttribute('viewBox', `0 0 ${width} ${height}`);
      this.diagram.innerHTML = loaderDiagram(plate, width, height, diagramSeed, portrait ? {
        x: portrait.left - left, y: portrait.top - top, width: portrait.width, height: portrait.height,
      } : undefined);
      this.diagramLines = Array.from(this.diagram.querySelectorAll<SVGPathElement>('.loader-diagram-line'));
      this.drawDiagram();
    };
    fitDiagram();
    this.startTurning();
    if (typeof ResizeObserver !== 'undefined') {
      this.diagramObserver = new ResizeObserver(fitDiagram);
      this.diagramObserver.observe(sheet);
      this.diagramObserver.observe(figure);
    }
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

  private renderTurn(elapsed: number): void {
    const frame = elementTurnFrame(elapsed, this.reducedMotion());
    this.root.querySelectorAll<SVGPathElement>('.loader-turn-current-shape').forEach(path => {
      path.setAttribute('d', frame.d);
      path.setAttribute('transform', `rotate(${frame.angle} 32 32)`);
      path.style.opacity = String(frame.opacity);
    });
    this.root.querySelectorAll<SVGPathElement>('.loader-turn-next-shape').forEach(path => {
      path.setAttribute('d', frame.next.d);
      path.style.opacity = String(frame.next.opacity);
    });
    this.turningLabel.textContent = frame.next.opacity > .5 ? frame.next.element : frame.element;
    this.turningLabel.style.opacity = this.reducedMotion() ? '1' : String(Math.pow(Math.abs(Math.cos(frame.angle * Math.PI / 360)), 6));
  }

  private renderInk(elapsed: number, immediate = false): void {
    const reduced = this.reducedMotion();
    const delta = Math.max(0, Math.min(100, elapsed - this.lastInkTime));
    this.lastInkTime = elapsed;
    this.displayedProgress = immediate || reduced || this.currentProgress === 1
      ? this.currentProgress
      : this.displayedProgress + (this.currentProgress - this.displayedProgress) * (1 - Math.exp(-delta / 280));
    this.turningReveal.setAttribute('d', elementInkFrame(this.displayedProgress, elapsed, reduced).d);
    this.marks.forEach((mark, i) => {
      const share = Math.min(1, Math.max(0, this.displayedProgress * 4 - i));
      mark.setAttribute('d', elementInkFrame(share, elapsed, reduced).d);
    });
  }

  private startTurning(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    const update = (now: number): void => {
      if (this.disposed || this.isReady) return;
      this.turnStarted ??= now;
      this.renderTurn(now - this.turnStarted);
      this.renderInk(now - this.turnStarted);
      this.turnFrame = requestAnimationFrame(update);
    };
    this.turnFrame = requestAnimationFrame(update);
  }

  /** Only completed loading work advances the ink. */
  setProgress(fraction: number, stageName?: string): void {
    if (this.disposed || !Number.isFinite(fraction) || fraction < this.currentProgress) return;
    this.currentProgress = Math.min(1, Math.max(0, fraction));
    this.drawDiagram();
    const percent = Math.round(this.currentProgress * 100);
    this.renderInk(this.lastInkTime, typeof requestAnimationFrame === 'undefined');
    this.ticks.forEach((tick, i) => tick.style.opacity = this.currentProgress > 0 && i / 50 <= this.currentProgress ? '1' : '0');
    this.percentage.textContent = `${percent}%`;
    this.progress.setAttribute('aria-valuenow', String(percent));
    if (stageName && this.stage.textContent !== stageName) {
      this.stage.textContent = stageName;
      this.announcement.textContent = `${stageName} (${percent}%)`;
    }
  }

  private drawDiagram(): void {
    const reduced = this.reducedMotion();
    this.diagramLines.forEach((line, index) => {
      line.style.strokeDashoffset = String(100 * (1 - diagramStrokeProgress(this.currentProgress, index, reduced)));
    });
    // Reduced motion keeps the complete diagram still throughout the load.
    this.diagram.style.opacity = reduced ? '1' : String(.35 + this.currentProgress * .65);
    this.diagram.querySelector<SVGElement>('.loader-diagram-disc')!.style.opacity = reduced ? '1' : String(this.currentProgress);
    this.diagram.querySelector<SVGElement>('.loader-diagram-labels')!.style.opacity = reduced ? '1' : String(this.currentProgress);
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
    if (this.turnFrame !== null) cancelAnimationFrame(this.turnFrame);
    this.turnFrame = null;
    this.root.classList.add('loader-hidden');
    this.dismissTimer = setTimeout(() => this.dispose(), this.reducedMotion() ? 0 : 300);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.diagramObserver?.disconnect();
    if (this.turnFrame !== null) cancelAnimationFrame(this.turnFrame);
    this.turnFrame = null;
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
