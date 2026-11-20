import type { GameInput } from '../input.js';
import { ACTIONS, availableActions, definition, type ActionDefinition, type ControlAction } from './actions.js';
import { actionGlyph } from './glyphs.js';
import { ControlLearning } from './learning.js';
import { TouchControls } from './touch.js';
export interface ControlSituation {
  tier: number; hush: boolean; online: boolean; alive: boolean; nearFoe: boolean; incoming: boolean;
  bending: boolean; ultimateReady: boolean; interact: boolean;
}
const COMBAT_ACTIONS = new Set<ControlAction>(['strike', 'heavy', 'rise', 'ground', 'bend_move', 'ultimate', 'dodge', 'spark']);
const MOVE_ACTION: Record<string, ControlAction> = {
  light_1: 'strike', light_2: 'strike', light_3: 'strike', bare_light_1: 'strike', bare_light_2: 'strike', bare_light_3: 'strike',
  leg_light_1: 'strike', leg_light_2: 'strike', heavy_1: 'heavy', heavy_2: 'heavy', bare_heavy_1: 'heavy', leg_heavy_1: 'heavy',
  bend_palm: 'strike', bend_sweep: 'heavy', uppercut: 'rise', ground_pound: 'ground', dash_strike: 'bend_move', ultimate: 'ultimate',
  dodge: 'dodge', shard_spark: 'spark',
};
/** One catalogue and teaching policy drives prompts, world offers, Help, and device bindings. */
export class Controls {
  readonly learning: ControlLearning;
  private readonly touch: TouchControls;
  private readonly prompt = document.createElement('div');
  private choices: ActionDefinition[] = [];
  private available = new Set<ControlAction>();
  private layoutKey = '';
  private active: ControlAction | null = null;
  private until = 0;
  private gapUntil = 0;
  private leavingAt = 0;
  private started = 0;
  private lastDevice = '';
  private lastUsed = new Map<ControlAction, number>();
  private lastShown = new Map<ControlAction, number>();
  private unlocked: ControlAction[] = [];
  private previousTier: number | null = null;
  private help: HTMLElement | null = null;
  private helpKey = '';
  private state: ControlSituation;
  /** While a master teaches, only what he has taught so far answers (and is hinted); null when no lesson runs. */
  private lesson: ReadonlySet<ControlAction> | null = null;
  constructor(private readonly input: GameInput, canvas: HTMLCanvasElement, initial: ControlSituation,
    onTier: (tier: number) => void = () => {}) {
    this.state = initial; this.setAvailable();
    this.learning = new ControlLearning(onTier);
    this.prompt.className = 'control-lesson'; this.prompt.hidden = true;
    this.prompt.setAttribute('role', 'status'); this.prompt.setAttribute('aria-live', 'polite');
    document.body.append(this.prompt);
    input.allowed = action => this.allows(action);
    input.onAction = action => {
      if (!COMBAT_ACTIONS.has(action) && action !== 'jump' && action !== 'block') this.used(action);
    };
    input.onDeviceChange = device => document.body.classList.toggle('touch-input', device === 'touch');
    this.touch = new TouchControls(canvas, input);
  }
  get actions(): readonly ActionDefinition[] { return this.choices; }
  /** Narrows the controls to those taught so far (read live, so it grows as the lesson goes); null lifts it. */
  setLesson(taught: ReadonlySet<ControlAction> | null): void { this.lesson = taught; }
  /** Usable now: the tier offers it, and any lesson under way has taught it. The menu always answers. */
  private allows(action: ControlAction): boolean {
    return this.available.has(action) && (action === 'menu' || !this.lesson || this.lesson.has(action));
  }
  private setAvailable(): void {
    this.choices = availableActions(this.state.tier, this.state.hush, this.state.online);
    this.available = new Set(this.choices.map(a => a.id));
  }
  used(action: ControlAction): void {
    if (!this.available.has(action)) return;
    const now = performance.now();
    // Sustained movement/look/guard counts as separate practice episodes, not frames or pointer packets.
    if (now - (this.lastUsed.get(action) ?? -Infinity) < 4000) return;
    this.lastUsed.set(action, now); this.learning.record(action);
    if (this.active === action) { this.until = 0; }
  }
  usedMove(move: string): void { const action = MOVE_ACTION[move]; if (action) this.used(action); }
  contextGlyph(teaching = true): string {
    return this.input.device === 'touch' || teaching ? actionGlyph('interact', this.input.device) : '';
  }
  contextShown(): void { if (this.learning.needs('interact')) this.learning.record('interact', 'shown'); }
  mountHelp(container: HTMLElement): void { this.help = container; this.helpKey = ''; this.renderHelp(); }
  private renderHelp(): void {
    if (!this.help) return;
    const key = `${this.layoutKey}:${this.input.device}:${this.learning.syncError}`;
    if (key === this.helpKey) return;
    this.helpKey = key;
    this.help.innerHTML = '<h3>Controls</h3><p class="controls-help-note">' +
      (this.input.device === 'touch' ? 'Drag the left side to move. Swipe the right side to look. Tap a foe to lock on. Open More for your other actions.'
        : 'Click the world to capture the mouse. Escape releases it and opens the menu.') +
      '</p>' + (this.learning.syncError ? '<p role="status">Your learned controls are saved on this device. Your character will be updated when the connection returns.</p>' : '') +
      ['Moving', 'Fighting', 'Bending', 'The world'].map(group => {
        const entries = this.choices.filter(a => a.group === group);
        return entries.length ? `<section class="controls-group"><h4>${group}</h4><dl>${entries.map(a =>
          `<div><dt>${actionGlyph(a.id, this.input.device)}${this.input.device === 'touch' ? `<small>${a.hint ?? 'Tap'} ${a.touch}</small>` : ''}</dt><dd>${a.label}${a.id === 'strike' && !this.state.hush ? ' · throws an element with bending on' : a.id === 'heavy' && !this.state.hush ? ' · sweeps with bending on' : ''}</dd></div>`).join('')}</dl></section>` : '';
      }).join('');
  }
  update(state: ControlSituation, now = performance.now()): void {
    this.state = state; this.learning.checkIdentity(now);
    const key = `${state.tier}:${state.hush}:${state.online}`;
    if (key !== this.layoutKey) {
      const before = this.available;
      this.setAvailable();
      if (this.previousTier !== null && state.tier > this.previousTier) {
        this.unlocked.push(...this.choices.filter(a => !before.has(a.id)).map(a => a.id));
      }
      this.previousTier = state.tier; this.layoutKey = key;
    }
    this.touch.update(this.choices, this.learning); this.renderHelp();
    const paused = this.input.paused || !state.alive;
    if (paused) { this.prompt.hidden = true; this.active = null; this.leavingAt = 0; delete this.prompt.dataset.leaving; return; }
    if (!this.learning.ready) return;
    if (!this.started) this.started = now;
    const move = this.input.read();
    if (Math.abs(move.forward) + Math.abs(move.right) > .2) {
      this.used('move'); if (move.running) this.used('run');
    }
    if (this.active && now < this.until && this.allows(this.active)) {
      if (this.lastDevice !== this.input.device) this.draw(this.active);
      this.prompt.hidden = false; return;
    }
    if (this.active) {
      if (!this.leavingAt) { this.leavingAt = now; this.prompt.dataset.leaving = 'true'; }
      if (this.allows(this.active) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && now - this.leavingAt < 150) return;
      this.active = null; this.leavingAt = 0; delete this.prompt.dataset.leaving;
      this.prompt.hidden = true; this.gapUntil = now + 1200;
    }
    if (now < this.gapUntil) return;
    const useful: ControlAction[] = [];
    if (state.incoming) useful.push('block', 'parry', 'dodge');
    if (state.nearFoe) useful.push('strike', 'heavy', 'lock');
    if (state.ultimateReady && state.nearFoe) useful.push('ultimate');
    useful.push(...this.unlocked.filter(a => a === 'ultimate' ? state.ultimateReady : ['rise', 'ground', 'bend_move'].includes(a) ? state.bending : true));
    if (now - this.started < 25000) useful.push('move', 'look', 'run');
    if (now - this.started > 14000 && !state.hush) useful.push('bending');
    if (now - this.started > 10000 && state.nearFoe) {
      useful.push('bending'); if (state.bending) useful.push('rise', 'ground', 'bend_move');
      if (state.hush) useful.push('spark');
    }
    const action = useful.find(a => this.allows(a) && this.learning.needs(a) &&
      now - (this.lastShown.get(a) ?? -Infinity) >= 60000 && !(state.interact && a === 'ground'));
    if (!action) return;
    this.active = action; this.until = now + 4200; this.lastShown.set(action, now);
    this.unlocked = this.unlocked.filter(a => a !== action);
    this.learning.record(action, 'shown'); this.draw(action); this.prompt.hidden = false;
  }
  private draw(action: ControlAction): void {
    this.lastDevice = this.input.device;
    const def = definition(action);
    const hint = this.input.device === 'touch' ? `${def.hint ?? 'Tap'} ${def.touch}` : '';
    this.prompt.innerHTML = `${actionGlyph(action, this.input.device)}<span>${hint ? `<small>${hint}</small>` : ''}${def.label.split(' · ')[0]}</span>`;
    this.prompt.dataset.action = action;
  }
  /** Available only in debug builds through the existing inspection object. */
  glyphSheet(): string {
    return ACTIONS.map(a => `<div>${actionGlyph(a.id, 'desktop')}${actionGlyph(a.id, 'touch')}<span>${a.label.split(' · ')[0]}</span></div>`).join('');
  }
  dispose(): void {
    this.learning.dispose(); this.touch.dispose(); this.prompt.remove();
    document.body.classList.remove('touch-input');
    delete this.input.onDeviceChange; delete this.input.onAction; this.input.allowed = () => true;
  }
}
