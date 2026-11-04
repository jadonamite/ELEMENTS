import { type Camera, Vector3 } from 'three';

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
  private readonly el: HTMLDivElement;
  private current: ContextOffer | null = null;
  private readonly point = new Vector3();

  constructor(private readonly sources: ContextSource[], private readonly camera: Camera, key = 'E') {
    this.el = document.createElement('div');
    this.el.className = 'context-prompt';
    this.el.setAttribute('role', 'status');
    this.el.innerHTML = `<kbd>${key}</kbd><span></span>`;
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  update(): void {
    let offer: ContextOffer | null = null;
    for (const source of this.sources) {
      offer = source();
      if (offer) break;
    }
    if (offer?.verb !== this.current?.verb) this.el.querySelector('span')!.textContent = offer?.verb ?? '';
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
