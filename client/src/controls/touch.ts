import type { GameInput } from '../input.js';
import { definition, type ActionDefinition, type ControlAction } from './actions.js';
import { touchGlyph } from './glyphs.js';
import type { ControlLearning } from './learning.js';

/** A device adapter only: every gesture dispatches through GameInput. */
export class TouchControls {
  private readonly root = document.createElement('div');
  private readonly stick = document.createElement('div');
  private readonly cluster = document.createElement('div');
  private readonly more = document.createElement('div');
  private readonly events = new AbortController();
  private readonly pointers = new Map<number, { kind: 'move' | 'look'; x: number; y: number; lastX: number; lastY: number; travel: number }>();
  private lastActions: readonly ActionDefinition[] | null = null;
  private lastLearning = '';
  private readonly buttons = new Map<ControlAction, HTMLButtonElement>();
  constructor(private readonly canvas: HTMLCanvasElement, private readonly input: GameInput) {
    this.root.className = 'touch-controls';
    this.stick.className = 'touch-stick'; this.stick.innerHTML = '<span></span>'; this.stick.hidden = true;
    this.cluster.className = 'touch-cluster'; this.cluster.setAttribute('aria-label', 'Actions');
    this.more.className = 'touch-more'; this.more.hidden = true; this.more.setAttribute('aria-label', 'More actions');
    this.root.append(this.stick, this.more, this.cluster); document.body.append(this.root);
    const options = { signal: this.events.signal };
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || input.paused) return;
      e.preventDefault(); input.useDevice('touch'); canvas.focus();
      const kind = e.clientX < window.innerWidth * .45 ? 'move' : 'look';
      if ([...this.pointers.values()].some(p => p.kind === kind)) return;
      this.pointers.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, travel: 0 });
      canvas.setPointerCapture(e.pointerId);
      if (kind === 'move') {
        this.stick.hidden = false; this.stick.style.left = `${e.clientX}px`; this.stick.style.top = `${e.clientY}px`;
      }
    }, options);
    canvas.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      if (input.paused) { this.reset(); return; }
      e.preventDefault(); input.useDevice('touch');
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.travel = Math.max(p.travel, Math.hypot(dx, dy));
      if (p.kind === 'move') {
        const distance = Math.hypot(dx, dy), scale = 48 / Math.max(48, distance);
        const x = dx * scale, y = dy * scale;
        input.move(distance < 6 ? 0 : -y / 48, distance < 6 ? 0 : x / 48);
        this.stick.firstElementChild!.setAttribute('style', `transform:translate(${x}px,${y}px)`);
      } else input.look((e.clientX - p.lastX) * 2, (e.clientY - p.lastY) * 2);
      p.lastX = e.clientX; p.lastY = e.clientY;
    }, options);
    const end = (e: PointerEvent): void => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      this.pointers.delete(e.pointerId);
      if (p.kind === 'move') { input.move(0, 0); this.stick.hidden = true; }
      if (e.type === 'pointerup' && p.travel < 10 && !input.paused) input.press('lock', { x: e.clientX, y: e.clientY });
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, end as EventListener, options);
    window.addEventListener('blur', () => this.reset(), options);
    window.addEventListener('resize', () => this.reset(), options);
    document.addEventListener('visibilitychange', () => this.reset(), options);
    document.addEventListener('focusin', e => { if (e.target !== canvas) this.reset(); }, options);
    if (window.matchMedia('(pointer: coarse)').matches) input.useDevice('touch');
  }
  update(actions: readonly ActionDefinition[], learning: ControlLearning): void {
    const hidden = this.input.device !== 'touch' || this.input.paused;
    if (this.root.hidden !== hidden) { this.root.hidden = hidden; if (hidden) this.reset(); }
    if (actions !== this.lastActions) { this.layout(actions); this.lastLearning = ''; }
    const key = `${learning.version}:${learning.ready}`;
    if (key === this.lastLearning) return;
    this.lastLearning = key;
    for (const [action, button] of this.buttons) {
      button.classList.toggle('learned', learning.ready && !learning.needs(action));
    }
  }
  private layout(actions: readonly ActionDefinition[]): void {
    this.lastActions = actions; this.cluster.replaceChildren(); this.more.replaceChildren(); this.buttons.clear();
    const primary = new Set<ControlAction>(['strike', 'heavy', 'block', 'dodge', 'bending', 'spark', 'jump']);
    const hidden = new Set<ControlAction>(['move', 'look', 'interact', 'menu', 'parry', 'lock']);
    for (const action of actions) {
      if (hidden.has(action.id)) continue;
      (primary.has(action.id) ? this.cluster : this.more).append(this.button(action.id));
    }
    const moreButton = document.createElement('button'); moreButton.type = 'button'; moreButton.className = 'touch-action';
    moreButton.innerHTML = '<span class="more-mark" aria-hidden="true">···</span><span>More</span>';
    moreButton.setAttribute('aria-label', 'More actions'); moreButton.setAttribute('aria-expanded', String(!this.more.hidden));
    moreButton.addEventListener('click', () => {
      this.input.useDevice('touch'); this.more.hidden = !this.more.hidden;
      moreButton.setAttribute('aria-expanded', String(!this.more.hidden)); this.canvas.focus();
    }, { signal: this.events.signal });
    this.cluster.append(moreButton);
  }
  private button(action: ControlAction): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'touch-action';
    this.buttons.set(action, button);
    button.dataset.action = action; const def = definition(action);
    button.setAttribute('aria-label', `${def.hint === 'Hold' ? 'Hold to ' : ''}${def.label}`);
    button.innerHTML = `${touchGlyph(action)}<span class="touch-label" aria-hidden="true">${def.touch}</span>`;
    const options = { signal: this.events.signal };
    button.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault(); e.stopPropagation(); this.input.useDevice('touch');
      button.setPointerCapture(e.pointerId); button.classList.add('held');
      if (action === 'block' || action === 'run') this.input.hold(action, `touch-${e.pointerId}`, true);
      else this.input.press(action);
    }, options);
    const release = (e: PointerEvent): void => {
      button.classList.remove('held'); this.input.hold(action, `touch-${e.pointerId}`, false);
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, release as EventListener, options);
    button.addEventListener('click', e => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      this.input.useDevice('touch');
      if (action === 'block' || action === 'run') return;
      this.input.press(action);
    }, options);
    return button;
  }
  private reset(): void {
    this.pointers.clear(); this.stick.hidden = true; this.input.move(0, 0);
  }
  dispose(): void { this.events.abort(); this.reset(); this.root.remove(); }
}
