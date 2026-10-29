import type { MoveInput } from './controller.js';
import type { CombatAction } from './combat.js';

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyR']);
/** Keys that trigger one move per press. */
const actionKeys: Record<string, CombatAction> = {
  KeyQ: 'uppercut', KeyE: 'ground_pound', KeyF: 'dash', Space: 'dodge',
};

export function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null);
}

export class GameInput {
  private readonly keys = new Set<string>();
  private readonly actions: CombatAction[] = [];
  private readonly events = new AbortController();
  private disposed = false;
  onLockToggle?: () => void;
  onStanceToggle?: () => void;
  onBendingToggle?: () => void;

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
          if (!this.disposed) status('The mouse could not be captured. Select Enter the arena to try again.');
        });
      } catch {
        status('The mouse could not be captured. Select Enter the arena to try again.');
      }
    };
    canvas.addEventListener('click', capture, options);
    button.addEventListener('click', capture, options);
    window.addEventListener('keydown', event => {
      if (isEditable(event.target) || document.activeElement !== canvas) return;
      if (event.code === 'Tab') {
        event.preventDefault();
        this.onLockToggle?.();
        return;
      }
      if (event.code === 'KeyX' && !event.repeat) {
        event.preventDefault();
        this.onStanceToggle?.();
        return;
      }
      if (event.code === 'KeyB' && !event.repeat) {
        event.preventDefault();
        this.onBendingToggle?.();
        return;
      }
      if (movementKeys.has(event.code)) {
        event.preventDefault();
        this.keys.add(event.code);
      }
      const action = actionKeys[event.code];
      if (action) {
        event.preventDefault();
        if (!event.repeat) this.actions.push(action);
      }
    }, options);
    window.addEventListener('keyup', event => { this.keys.delete(event.code); }, options);
    window.addEventListener('blur', clear, options);
    document.addEventListener('focusin', event => { if (event.target !== canvas) clear(); }, options);
    document.addEventListener('visibilitychange', clear, options);
    document.addEventListener('pointerlockchange', () => {
      clear();
      const locked = document.pointerLockElement === canvas;
      button.textContent = 'Enter the arena';
      status(locked ? '' : 'Paused. Press Escape any time to release the mouse.');
    }, options);
    document.addEventListener('pointerlockerror', () => {
      clear();
      status('The mouse could not be captured. Select Enter the arena to try again.');
    }, options);
    // Mouse buttons attack only while the mouse is captured; the first click captures it.
    document.addEventListener('mousedown', event => {
      if (document.pointerLockElement !== canvas) return;
      if (event.button === 0) this.actions.push('light');
      if (event.button === 2) this.actions.push('heavy');
    }, options);
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === canvas) orbit(event.movementX, event.movementY);
    }, options);
  }

  /** Move presses since the last call, oldest first. */
  takeActions(): CombatAction[] {
    return this.actions.splice(0);
  }

  get blocking(): boolean {
    return this.keys.has('KeyR');
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
