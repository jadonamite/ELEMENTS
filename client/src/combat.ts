import balance from '../../shared/balance.json';
import type { AnimationPlayer } from './anim/index.js';

/** What the player asked for this frame. */
export type CombatAction = 'light' | 'heavy' | 'uppercut' | 'ground_pound' | 'dash' | 'dodge';

interface MoveSpec { clip: string; next?: string; lunge: number; speed: number }
const tuning = balance.combat;
const moves = tuning.moves as Record<string, MoveSpec>;
const opener: Record<CombatAction, string> = {
  light: 'light_1', heavy: 'heavy_1', uppercut: 'uppercut',
  ground_pound: 'ground_pound', dash: 'dash_strike', dodge: 'dodge',
};

/**
 * Sword move state: one move at a time, light and heavy presses chain into
 * combos inside a window near the end of the current move, and block is held.
 */
export class Combat {
  private move: string | null = null;
  private elapsed = 0;
  private length = 0;
  private queued: string | null = null;
  blocking = false;

  constructor(private readonly anim: AnimationPlayer) {}

  /** The move playing now, or null while the hero is free to walk. */
  get current(): string | null { return this.move; }

  /** Forward speed in m/s the current move carries the hero, or 0. */
  get lunge(): number {
    if (!this.move) return 0;
    // Lunges only during the first part of a move, so recoveries stay planted.
    return this.elapsed < this.length * tuning.lungeFraction ? moves[this.move]!.lunge : 0;
  }

  press(action: CombatAction): boolean {
    if (this.blocking) return false;
    if (!this.move) { this.start(opener[action]); return true; }
    const spec = moves[this.move]!;
    const inWindow = this.elapsed >= this.length * (1 - tuning.comboWindow);
    const chains = (action === 'light' && this.move.startsWith('light')) ||
      (action === 'heavy' && this.move.startsWith('heavy'));
    if (chains && spec.next && inWindow) { this.queued = spec.next; return true; }
    // Dodge cancels any attack's recovery.
    if (action === 'dodge' && inWindow) { this.queued = 'dodge'; return true; }
    return false;
  }

  /** Advance the current move; returns true on the frame a move starts. */
  update(delta: number): boolean {
    if (!this.move) return false;
    this.elapsed += delta;
    if (this.elapsed < this.length) return false;
    const next = this.queued;
    this.move = null;
    this.queued = null;
    if (next) { this.start(next); return true; }
    return false;
  }

  private start(name: string): void {
    const spec = moves[name]!;
    this.move = name;
    this.elapsed = 0;
    this.queued = null;
    this.length = this.anim.duration(spec.clip) / spec.speed;
    this.anim.playOnce(spec.clip, tuning.fade);
    this.anim.setSpeed(spec.clip, spec.speed);
  }
}
