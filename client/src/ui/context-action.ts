import { type Camera, Vector3 } from 'three';
import type { GameInput } from '../input.js';
import type { Controls } from '../controls/index.js';

/** How far toward the screen edge an off-screen prompt sits, in screen units (1 = edge). */
const EDGE = 0.86;

/** Something the player can do right where they stand: its name, where it is, and what the key does. */
export interface ContextOffer {
  verb: string;
  /** World point the prompt floats at, usually above the person or thing. */
  at: Vector3;
  act(): void;
}

/** Asked each frame; returns its offer or null. Earlier sources win. */
export type ContextSource = () => ContextOffer | null;

/**
 * The one context key. Each frame it takes the first offer from its sources, shows it in the
 * world over that thing, and the key runs exactly the offer that is shown. The same key falls
 * through to its move when nothing is offered.
 */
export class ContextAction {
  private readonly el: HTMLButtonElement;
  private current: ContextOffer | null = null;
  private readonly point = new Vector3();

  private glyphReady = false;
  private device = '';
  private teachOffer = false;
  private lessonInitialized = false;
  constructor(private readonly sources: ContextSource[], private readonly camera: Camera,
    private readonly input: GameInput, private readonly controls: () => Controls | null) {
    this.el = document.createElement('button');
    this.el.className = 'context-prompt';
    this.el.type = 'button';
    this.el.innerHTML = '<span class="context-glyph"></span><span class="context-verb"></span>';
    this.el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') { e.preventDefault(); input.useDevice('touch'); }
    });
    this.el.addEventListener('click', e => { if ((e as PointerEvent).pointerType !== 'touch') input.press('interact'); });
    this.el.addEventListener('pointerup', e => { if (e.pointerType === 'touch') { e.preventDefault(); input.press('interact'); } });
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  update(): void {
    let offer: ContextOffer | null = null;
    for (const source of this.sources) {
      offer = source();
      if (offer) break;
    }
    if (offer?.verb !== this.current?.verb) {
      this.el.querySelector('.context-verb')!.textContent = offer?.verb ?? '';
      this.el.setAttribute('aria-label', offer?.verb ?? 'Interact');
      this.lessonInitialized = false;
    }
    const controls = this.controls();
    if (offer && !this.lessonInitialized && controls?.learning.ready) {
      this.teachOffer = controls.learning.needs('interact');
      controls.contextShown(); this.lessonInitialized = true; this.glyphReady = false;
    }
    if (controls && (!this.glyphReady || this.device !== this.input.device)) {
      this.glyphReady = true;
      this.device = this.input.device;
      this.el.querySelector('.context-glyph')!.innerHTML = controls.contextGlyph(this.teachOffer);
    }
    this.current = offer;
    if (!offer) {
      this.el.hidden = true;
      return;
    }
    this.point.copy(offer.at).project(this.camera);
    // Behind the camera the projection mirrors; flip it so the edge points the right way.
    const behind = this.point.z > 1;
    if (behind) this.point.set(-this.point.x, -this.point.y, 0);
    let off = Math.max(Math.abs(this.point.x), Math.abs(this.point.y));
    if (behind && off < 1e-3) { this.point.set(0, -1, 0); off = 1; }
    // Off screen (a challenger behind you), the prompt waits at the nearest edge.
    const atEdge = behind || off > EDGE;
    if (atEdge) this.point.multiplyScalar(EDGE / off);
    this.el.classList.toggle('at-edge', atEdge);
    this.el.hidden = false;
    const x = (this.point.x + 1) / 2 * window.innerWidth;
    const y = (1 - this.point.y) / 2 * window.innerHeight;
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  get hasOffer(): boolean { return this.current !== null; }

  /** Runs the offer shown. False when there is none, so the key does its move instead. */
  interact(): boolean {
    if (!this.current) return false;
    this.current.act();
    return true;
  }

  dispose(): void {
    this.el.remove();
  }
}
