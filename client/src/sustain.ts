import balance from '../../shared/balance.json';
import { Stamina, actStaminaCost, moveStaminaCost, type GuardResult, type StaminaAct, type StaminaTuning } from '../../shared/src/index.js';

const tune = balance.combat.stamina as StaminaTuning;

/**
 * The hero's body between blows: stamina now. Every move start, jump, run and guarded blow asks here,
 * using the same shared rules the server runs; online the server's figures correct the prediction.
 */
export class Sustain {
  readonly stamina = new Stamina(tune);
  /** Seconds a broken guard keeps the hero reeling, unable to raise it. */
  private brokenFor = 0;
  /** Seconds the arc flashes after something was refused for want of stamina. */
  private flashFor = 0;
  /** Something was refused for want of stamina: the hero breathes hard. */
  onShort: (() => void) | null = null;
  /** The guard broke under a blow while winded. */
  onGuardBroken: (() => void) | null = null;

  get guardBroken(): boolean { return this.brokenFor > 0; }
  get flashing(): boolean { return this.flashFor > 0; }

  private refuse(): false {
    if (this.flashFor <= 0) this.onShort?.();
    this.flashFor = 0.6;
    return false;
  }

  /** May this move start? A refusal flashes the arc. */
  canStartMove(move: string): boolean {
    return this.stamina.can(moveStaminaCost(move, tune)) || this.refuse();
  }

  /** A move started: pay for it. True when it cost something, so the server should hear of it. */
  startedMove(move: string): boolean {
    const cost = moveStaminaCost(move, tune);
    this.stamina.spend(cost);
    return cost > 0;
  }

  /** Pays for a jump or super jump; false when it can't start. */
  act(act: StaminaAct): boolean {
    return this.stamina.spend(actStaminaCost(act, tune)) || this.refuse();
  }

  /** Whether the hero may run this frame. */
  get canRun(): boolean { return this.stamina.canRun; }

  /** A blow met the raised guard. */
  soak(damage: number): GuardResult {
    const result = this.stamina.soak(damage);
    if (result === 'broken') {
      this.brokenFor = tune.guardBreakSeconds;
      this.onGuardBroken?.();
    }
    return result;
  }

  parried(): void { this.stamina.refund(); }

  /** One frame: running drains, otherwise stamina comes back. */
  tick(dt: number, running: boolean, inFight: boolean, guarding: boolean): void {
    this.brokenFor = Math.max(0, this.brokenFor - dt);
    this.flashFor = Math.max(0, this.flashFor - dt);
    this.stamina.tick(dt, { running, inFight, guarding });
  }

  /** The server's figures for this hero. Small gaps are the prediction running ahead; large ones are corrected. */
  correct(current: number, cap: number, windedFor: number): void {
    const s = this.stamina;
    if (Math.abs(s.current - current) > 12 || s.cap !== cap || (windedFor > 0) !== s.winded) s.correct(current, cap, windedFor);
  }

  /** Back on your feet after falling. */
  reset(): void {
    this.stamina.fill();
    this.brokenFor = 0;
  }
}
