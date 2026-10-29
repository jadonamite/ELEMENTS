import type { MoveInput } from './controller.js';

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']);

export function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null);
}

export class GameInput {
  private readonly keys = new Set<string>();
  private readonly events = new AbortController();
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, button: HTMLButtonElement,
    orbit: (dx: number, dy: number) => void, status: (text: string) => void) {
    const options = { signal: this.events.signal };
    const clear = (): void => this.keys.clear();
    const capture = (): void => {
      canvas.focus();
      if (!canvas.requestPointerLock) {
        status('Mouse capture is unavailable. WASD and Shift still work.');
        return;
      }
      try {
        const request = canvas.requestPointerLock();
        request?.catch(() => {
          if (!this.disposed) status('Mouse capture failed. Select Play to try again.');
        });
      } catch {
        status('Mouse capture failed. Select Play to try again.');
      }
    };
    canvas.addEventListener('click', capture, options);
    button.addEventListener('click', capture, options);
    window.addEventListener('keydown', event => {
      if (isEditable(event.target) || document.activeElement !== canvas) return;
      if (movementKeys.has(event.code)) {
        event.preventDefault();
        this.keys.add(event.code);
      }
    }, options);
    window.addEventListener('keyup', event => { this.keys.delete(event.code); }, options);
    window.addEventListener('blur', clear, options);
    document.addEventListener('focusin', event => { if (event.target !== canvas) clear(); }, options);
    document.addEventListener('visibilitychange', clear, options);
    document.addEventListener('pointerlockchange', () => {
      clear();
      const locked = document.pointerLockElement === canvas;
      button.textContent = locked ? 'Mouse captured' : 'Play';
      status(locked ? 'Move the mouse to look. Press Escape to release it.'
        : 'Select Play or click the arena to capture the mouse.');
    }, options);
    document.addEventListener('pointerlockerror', () => {
      clear();
      status('Mouse capture failed. Select Play to try again.');
    }, options);
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === canvas) orbit(event.movementX, event.movementY);
    }, options);
  }

  read(): MoveInput {
    return {
      forward: Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
      right: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      running: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.events.abort();
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
