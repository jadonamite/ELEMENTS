/** Stamina: what dodges, heavy attacks, running, jumps and a held guard spend. Runs the same in the browser and on the server. */

export interface StaminaTuning {
  /** Stamina a fit, fed fighter holds. Hunger and buffs scale it through the cap. */
  readonly max: number;
  readonly dodge: number;
  /** Heavy attack with a weapon, and with hands or legs. */
  readonly heavyWeapon: number;
  readonly heavyBody: number;
  /** Running, per second in fight stance; out of it the cost is scaled by `runCalmScale`. */
  readonly runPerSecond: number;
  readonly runCalmScale: number;
  readonly jump: number;
  readonly superJump: number;
  /** A blow on a raised guard costs this share of the damage it would have done. */
  readonly guardSoakScale: number;
  /** A parry gives this much back. */
  readonly parryRefund: number;
  /** Regeneration per second once `regenDelay` seconds have passed without a spend; halved under a raised guard. */
  readonly regenPerSecond: number;
  readonly regenDelay: number;
  readonly guardRegenScale: number;
  /** Seconds a fighter stays winded after reaching zero. */
  readonly windedSeconds: number;
  /** Seconds a broken guard leaves the fighter reeling, unable to raise it again. */
  readonly guardBreakSeconds: number;
  /** Seconds after a dodge starts that the server lets blows pass through. */
  readonly dodgeProtectSeconds: number;
}

/** The actions that cost stamina outside the move list. */
export type StaminaAct = 'dodge' | 'jump' | 'super_jump';

/** What a move costs to start. Light attacks, bending and reactions cost nothing. */
export function moveStaminaCost(move: string, t: StaminaTuning): number {
  if (move === 'dodge') return t.dodge;
  if (move.startsWith('bare_heavy') || move.startsWith('leg_heavy')) return t.heavyBody;
  if (move.startsWith('heavy')) return t.heavyWeapon;
  return 0;
}

export function actStaminaCost(act: StaminaAct, t: StaminaTuning): number {
  return act === 'dodge' ? t.dodge : act === 'jump' ? t.jump : t.superJump;
}

/** What a blow on a raised guard did. */
export type GuardResult = 'held' | 'broken';

export interface StaminaTick {
  /** Spending on running this tick. */
  running: boolean;
  /** In fight stance: running costs full price. */
  inFight: boolean;
  guarding: boolean;
  /** Regeneration multiplier from food, inns, tonics. */
  regenScale?: number;
}

/** One fighter's stamina. */
export class Stamina {
  current: number;
  cap: number;
  /** Seconds since the last spend. */
  private quiet = Infinity;
  /** Seconds of being winded left. */
  windedFor = 0;

  constructor(readonly tune: StaminaTuning, cap = tune.max) {
    this.cap = cap;
    this.current = cap;
  }

  get winded(): boolean { return this.windedFor > 0; }
  get full(): boolean { return this.current >= this.cap; }
  get share(): number { return this.cap > 0 ? this.current / this.cap : 0; }
  /** Running needs some stamina and breath. */
  get canRun(): boolean { return !this.winded && this.current > 0; }

  /** Whether an action of this cost may start now. Free actions always may. */
  can(cost: number): boolean {
    if (cost <= 0) return true;
    return !this.winded && this.current >= cost;
  }

  /** Pays for an action that is starting; false (and nothing paid) when it can't be afforded. */
  spend(cost: number): boolean {
    if (cost <= 0) return true;
    if (!this.can(cost)) return false;
    this.drain(cost);
    return true;
  }

  /** Takes stamina that is owed whatever is left: running, a soaked blow. Reaching zero winds the fighter. */
  drain(amount: number): void {
    if (amount <= 0) return;
    this.quiet = 0;
    this.current = Math.max(0, this.current - amount);
    if (this.current === 0 && !this.winded) this.windedFor = this.tune.windedSeconds;
  }

  /** A blow meets the raised guard. A winded fighter's guard breaks and the blow lands in full. */
  soak(damage: number): GuardResult {
    if (this.winded) return 'broken';
    this.drain(Math.max(0, damage) * this.tune.guardSoakScale);
    return 'held';
  }

  /** A parry gives some back. */
  refund(amount = this.tune.parryRefund): void {
    this.current = Math.min(this.cap, this.current + amount);
  }

  /** Refills to the cap at once (a tonic, waking up). */
  fill(): void {
    this.current = this.cap;
    this.windedFor = 0;
  }

  /** Changes how much can be held; what is held never exceeds it. */
  setCap(cap: number): void {
    this.cap = Math.max(0, cap);
    this.current = Math.min(this.current, this.cap);
  }

  /** Adds stamina from outside the fight regeneration (recovery once clear). */
  restore(amount: number): void {
    if (amount > 0) this.current = Math.min(this.cap, this.current + amount);
  }

  /** Advances one step: running drains, otherwise stamina comes back after a pause. */
  tick(dt: number, s: StaminaTick): void {
    if (dt <= 0) return;
    this.windedFor = Math.max(0, this.windedFor - dt);
    if (s.running && this.canRun) {
      this.drain(this.tune.runPerSecond * (s.inFight ? 1 : this.tune.runCalmScale) * dt);
      return;
    }
    this.quiet += dt;
    if (this.quiet < this.tune.regenDelay) return;
    const rate = this.tune.regenPerSecond * (s.guarding ? this.tune.guardRegenScale : 1) * (s.regenScale ?? 1);
    this.current = Math.min(this.cap, this.current + rate * dt);
  }

  /** Takes the server's figures, for a browser that predicted its own. */
  correct(current: number, cap: number, windedFor: number): void {
    this.cap = Math.max(0, cap);
    this.current = Math.min(this.cap, Math.max(0, current));
    this.windedFor = Math.max(0, windedFor);
  }
}
