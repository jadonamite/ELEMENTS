import { Camera, Vector3 } from 'three';

export interface Threat {
  readonly controller: { readonly position: Vector3 };
  readonly alive: boolean;
  readonly attacking: boolean;
  readonly challenging?: boolean;
}

/** Foes this close count as a threat worth an arrow. */
export const THREAT_RADIUS = 8;
/** Arrows sit on an ellipse round the hero, in pixels at 900 px screen height. */
const RING_X = 190;
const RING_Y = 150;
/** A foe this far inside the screen edge (in clip space) is already visible: no arrow. */
const ON_SCREEN = 0.85;

const point = new Vector3();
const offset = new Vector3();
const forward = new Vector3();
const right = new Vector3();
const up = new Vector3(0, 1, 0);

/**
 * Where to point an arrow for a foe: the ground bearing from the hero with the camera's
 * forward as 0 and its right as +PI/2, or null when the foe is far or already on screen.
 */
export function threatBearing(hero: Vector3, foe: Vector3, camera: Camera): number | null {
  offset.subVectors(foe, hero).setY(0);
  if (offset.length() > THREAT_RADIUS) return null;
  point.copy(foe).setY(foe.y + 1.2).project(camera);
  if (point.z < 1 && Math.abs(point.x) < ON_SCREEN && Math.abs(point.y) < ON_SCREEN) return null;
  camera.getWorldDirection(forward).setY(0);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  right.crossVectors(forward, up);
  return Math.atan2(offset.dot(right), offset.dot(forward));
}

/**
 * Arrows round the hero for foes close by but out of view: pale while they wait,
 * red as they swing, so a close fight camera never leaves attacks from behind unseen.
 */
export class ThreatArrows {
  private readonly root: HTMLDivElement;
  private readonly arrows = new Map<Threat, HTMLDivElement>();
  private readonly centre = new Vector3();

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'threat-arrows';
    this.root.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.root);
  }

  update(hero: Vector3, foes: readonly Threat[], camera: Camera): void {
    this.centre.copy(hero).setY(hero.y + 1).project(camera);
    const cx = (this.centre.x + 1) / 2 * window.innerWidth;
    const cy = (1 - this.centre.y) / 2 * window.innerHeight;
    const scale = window.innerHeight / 900;

    const shown = new Set<Threat>();
    for (const foe of foes) {
      if (!foe.alive || foe.challenging) continue;
      const angle = threatBearing(hero, foe.controller.position, camera);
      if (angle === null) continue;
      const x = cx + Math.sin(angle) * RING_X * scale;
      const y = cy - Math.cos(angle) * RING_Y * scale;
      let arrow = this.arrows.get(foe);
      if (!arrow) {
        arrow = document.createElement('div');
        arrow.className = 'threat-arrow';
        this.root.appendChild(arrow);
        this.arrows.set(foe, arrow);
      }
      arrow.classList.toggle('striking', foe.attacking);
      arrow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle}rad)`;
      shown.add(foe);
    }
    for (const [foe, arrow] of this.arrows) {
      if (shown.has(foe)) continue;
      arrow.remove();
      this.arrows.delete(foe);
    }
  }
}
