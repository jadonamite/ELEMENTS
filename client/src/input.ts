import type { MoveInput } from './controller.js';
import type { CombatAction, FightingStyle } from './combat.js';
import { KEY_BINDINGS, type ControlAction, type InputDevice } from './controls/actions.js';

export function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null);
}
const COMBAT: Partial<Record<ControlAction, CombatAction>> = {
  strike: 'light', heavy: 'heavy', rise: 'uppercut', ground: 'ground_pound', bend_move: 'dash',
  ultimate: 'ultimate', spark: 'spark', dodge: 'dodge',
};

/** Device bindings feed semantic actions; gameplay reads only the resulting action state. */
export class GameInput {
  private readonly keys = new Set<string>();
  private readonly held = new Map<ControlAction, Set<string>>();
  private readonly actions: CombatAction[] = [];
  private readonly events = new AbortController();
  private disposed = false;
  private touchMove = { forward: 0, right: 0 };
  private currentDevice: InputDevice = 'desktop';
  allowed: (action: ControlAction) => boolean = () => true;
  onDeviceChange?: (device: InputDevice) => void;
  onAction?: (action: ControlAction) => void;
  onTargetTap?: (x: number, y: number) => boolean | void;
  onMenu?: () => void;
  onLockToggle?: () => void;
  onStanceToggle?: () => void;
  onBendingToggle?: () => void;
  onStyleSelect?: (style: FightingStyle) => void;
  onInteract?: () => boolean | void;
  onDuelToggle?: () => void;
  onSatchelToggle?: () => void;
  onTechnique?: () => void;
  onJump?: () => void;

  constructor(private readonly canvas: HTMLCanvasElement, button: HTMLButtonElement,
    private readonly orbit: (dx: number, dy: number) => void, status: (text: string) => void, entryLabel = 'Enter the arena') {
    const options = { signal: this.events.signal };
    let capturePending = false;
    const capture = (): void => {
      if (this.paused || capturePending || document.pointerLockElement === canvas) return;
      if (document.activeElement !== canvas) canvas.focus();
      if (this.device === 'touch') return;
      if (!canvas.requestPointerLock) { status('Mouse capture is unavailable. WASD and Shift still work.'); return; }
      try {
        capturePending = true;
        const request = canvas.requestPointerLock();
        if (request) void request.catch(() => {
          capturePending = false;
          if (!this.disposed) status('The mouse could not be captured. Click the game to try again.');
        }).finally(() => { capturePending = false; });
      } catch { capturePending = false; status('The mouse could not be captured. Click the game to try again.'); }
    };
    canvas.addEventListener('click', capture, options);
    button.addEventListener('click', capture, options);
    window.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') this.useDevice('touch');
      else if (event.pointerType === 'mouse') this.useDevice('desktop');
    }, options);
    window.addEventListener('keydown', event => {
      if (isEditable(event.target)) return;
      this.useDevice('desktop');
      const action = KEY_BINDINGS[event.code];
      if (!action || (action !== 'menu' && document.activeElement !== canvas)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (action !== 'menu' && !this.paused && document.pointerLockElement !== canvas) capture();
      this.keys.add(event.code);
      if (action === 'block' || action === 'run') this.hold(action, event.code, true);
      else if (action !== 'move') this.press(action);
    }, options);
    window.addEventListener('keyup', event => {
      this.keys.delete(event.code);
      const action = KEY_BINDINGS[event.code];
      if (action) this.hold(action, event.code, false);
    }, options);
    window.addEventListener('blur', () => this.clear(), options);
    document.addEventListener('focusin', event => { if (event.target !== canvas) this.clear(); }, options);
    document.addEventListener('visibilitychange', () => this.clear(), options);
    let wasLocked = false;
    document.addEventListener('pointerlockchange', () => {
      capturePending = false;
      button.textContent = entryLabel;
      const locked = document.pointerLockElement === canvas;
      if (!locked) this.clear();
      if (wasLocked && !locked && this.device === 'desktop' && !this.paused && document.hasFocus?.()) this.onMenu?.();
      wasLocked = locked;
      status('');
    }, options);
    document.addEventListener('pointerlockerror', () => {
      capturePending = false;
      this.clear(); status('The mouse could not be captured. Click the game to try again.');
    }, options);
    document.addEventListener('mousedown', event => {
      if (document.pointerLockElement !== canvas) return;
      this.useDevice('desktop');
      if (event.button === 0) this.press('strike');
      if (event.button === 2) this.press('heavy');
    }, options);
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === canvas && (event.movementX || event.movementY)) {
        this.useDevice('desktop'); this.look(event.movementX, event.movementY);
      }
    }, options);
  }
  get device(): InputDevice { return this.currentDevice; }
  useDevice(device: InputDevice): void {
    if (this.currentDevice === device) return;
    this.clear(); this.currentDevice = device;
    if (device === 'touch' && document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.onDeviceChange?.(device);
  }
  get paused(): boolean {
    return !!document.body?.matches('.home-open, .selecting, .shop-open') ||
      !!document.getElementById?.('opening-overlay') || !!document.getElementById?.('elements-loader') || document.hidden === true;
  }
  /** Public action entry point for touch and future controllers. */
  press(action: ControlAction, at?: { x: number; y: number }): boolean {
    if (this.disposed || (action !== 'menu' && this.paused) || !this.allowed(action)) return false;
    if (action === 'menu' && document.getElementById?.('opening-overlay')) return false;
    if (action === 'interact') {
      if (this.onInteract?.() === true) { this.onAction?.('interact'); return true; }
      return this.press('ground');
    }
    const combat = COMBAT[action];
    if (combat) this.actions.push(combat);
    else if (action === 'lock') {
      if (at) { if (this.onTargetTap?.(at.x, at.y) === false) return false; }
      else this.onLockToggle?.();
    }
    else if (action === 'stance') this.onStanceToggle?.();
    else if (action === 'bending') this.onBendingToggle?.();
    else if (action === 'weapon') this.onStyleSelect?.('weapon');
    else if (action === 'hands') this.onStyleSelect?.('bare_hands');
    else if (action === 'legs') this.onStyleSelect?.('legs');
    else if (action === 'jump') this.onJump?.();
    else if (action === 'technique') this.onTechnique?.();
    else if (action === 'duel') this.onDuelToggle?.();
    else if (action === 'satchel') this.onSatchelToggle?.();
    else if (action === 'menu') { this.clear(); this.onMenu?.(); }
    this.onAction?.(action);
    return true;
  }
  hold(action: ControlAction, source: string, down: boolean): void {
    if (!down) { this.held.get(action)?.delete(source); return; }
    if (this.disposed || this.paused || !this.allowed(action)) return;
    if (!this.held.has(action)) this.held.set(action, new Set());
    this.held.get(action)!.add(source);
  }
  move(forward: number, right: number): void {
    this.touchMove = { forward: Math.max(-1, Math.min(1, forward)), right: Math.max(-1, Math.min(1, right)) };
  }
  look(dx: number, dy: number): void {
    if (!this.paused && this.allowed('look')) { this.orbit(dx, dy); this.onAction?.('look'); }
  }
  takeActions(): CombatAction[] {
    const queued = this.actions.splice(0);
    return this.paused ? [] : queued;
  }
  get blocking(): boolean { return !this.paused && (this.held.get('block')?.size ?? 0) > 0; }
  read(): MoveInput {
    if (this.paused) return { forward: 0, right: 0, running: false };
    return {
      forward: Math.max(-1, Math.min(1, Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')) + this.touchMove.forward)),
      right: Math.max(-1, Math.min(1, Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')) + this.touchMove.right)),
      running: (this.held.get('run')?.size ?? 0) > 0,
    };
  }
  clear(): void { this.keys.clear(); this.held.clear(); this.actions.length = 0; this.move(0, 0); }
  dispose(): void {
    this.disposed = true; this.events.abort(); this.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
