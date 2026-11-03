import balance from '../../shared/balance.json';
import type { AnimationPlayer } from './anim/index.js';
import { SWORD_WEAPON, type WeaponSlotData } from './weapon.js';
import { ELEMENT_CLIPS } from './element-moves.js';
import type { StrikeLimb } from './anim/strike-limb.js';
import type { Element } from '../../shared/src/index.js';

/** Moves every style maps the same way: bending slots, the ultimate and the Hush spark. */
const sharedOpeners: Partial<Record<CombatAction, string>> = {
  uppercut: 'uppercut', ground_pound: 'ground_pound', dash: 'dash_strike', ultimate: 'ultimate', spark: 'shard_spark',
};

/** What the player asked for this frame. */
export type CombatAction = 'light' | 'heavy' | 'uppercut' | 'ground_pound' | 'dash' | 'ultimate' | 'spark' | 'dodge';
export type FightingStyle = 'weapon' | 'bare_hands' | 'legs' | 'bending';
export type StrikingLimb = 'blade' | 'hand_r' | 'hand_l' | 'foot_r' | 'foot_l' | 'projectile' | 'area';

/** What judges a move: the blade, a hand or foot, a thrown projectile, or an area round the body. */
export type StrikeKind = 'blade' | 'limb' | 'projectile' | 'area';

export function strikeKind(move: string | null, style: FightingStyle = 'weapon'): StrikeKind {
  if (!move) return style === 'weapon' ? 'blade' : 'limb';
  if (move === 'ultimate') return 'area';
  if (move === 'shard_spark') return 'projectile';
  if (style === 'bare_hands') return move === 'ground_pound' ? 'area' : 'limb';
  if (style === 'legs') return move === 'ground_pound' ? 'area' : 'limb';
  if (style === 'bending') {
    if (move === 'bend_palm') return 'projectile';
    // The dash carries the body itself into the target, so it is judged around the body.
    return 'area';
  }
  if (move.startsWith('bare_')) return 'limb';
  if (move === 'bend_palm') return 'projectile';
  if (move === 'bend_sweep' || move === 'ground_pound') return 'area';
  return 'blade';
}

interface MoveSpec { clip: string; next?: string; lunge: number; speed: number }
/** Unarmed clips for the moves both styles share. */
const bareClips: Record<string, string> = { uppercut: 'punch_uppercut', dash_strike: 'punch_combo', ground_pound: 'ground_pound' };
const tuning = balance.combat;
const moves = tuning.moves as Record<string, MoveSpec>;

/**
 * Move state: one move at a time, light and heavy presses chain into
 * combos inside a window near the end of the current move, and block is held.
 * Weapon moves and combo sequences are completely data-driven by the equipped WeaponSlotData.
 */
export class Combat {
  private move: string | null = null;
  /** The clip the current move is playing. */
  private clip: string | null = null;
  private elapsed = 0;
  private length = 0;
  private queued: string | null = null;
  private clock = 0;
  private style: FightingStyle = 'weapon';
  private weapon: WeaponSlotData = SWORD_WEAPON;
  /** Picks the element's own clips for its bending moves. */
  element: Element = 'IGNIS';
  private guarding = false;
  private guardSince = 0;
  /** Counts swings, so each one can strike a given target at most once. */
  swing = 0;
  /** Game time in seconds when the current swing started. */
  swingAt = 0;

  /** `ready` says whether a move is off cooldown; `onStart` records its cooldown immediately. */
  constructor(
    private readonly anim: AnimationPlayer,
    private readonly ready: (move: string) => boolean = () => true,
    private readonly onStart?: (move: string, swingAt: number) => void,
    weapon: WeaponSlotData = SWORD_WEAPON,
    /** Which hand or foot a clip strikes with (the hero reads it from the clip). */
    private readonly limbOf: (clip: string) => StrikeLimb | null = () => null,
  ) {
    this.weapon = weapon;
  }

  /** Held block; raising it starts the parry timer. */
  get blocking(): boolean { return this.guarding; }
  set blocking(on: boolean) {
    if (on && !this.guarding) this.guardSince = this.clock;
    this.guarding = on;
  }
  /** Seconds the guard has been up, or Infinity when it is down. */
  get blockAge(): number { return this.guarding ? this.clock - this.guardSince : Infinity; }

  /** The active fighting style: weapon, bare_hands, or bending. */
  get fightingStyle(): FightingStyle { return this.style; }
  setStyle(style: FightingStyle): void { this.style = style; }

  /** Active weapon slot data and reach. */
  get weaponData(): WeaponSlotData { return this.weapon; }
  get weaponReach(): number { return this.weapon.reach; }
  setWeapon(weapon: WeaponSlotData): void { this.weapon = weapon; }

  /** The limb or projectile responsible for the current move's impact; a hand or foot is read from the clip. */
  get strikingLimb(): StrikingLimb {
    const kind = strikeKind(this.move, this.style);
    if (kind !== 'limb') return kind;
    return (this.clip && this.limbOf(this.clip)) || 'hand_r';
  }

  /** The move playing now, or null while the hero is free to walk. */
  get current(): string | null { return this.move; }

  /** How far through the current move, 0 to 1. */
  get progress(): number { return this.move && this.length > 0 ? this.elapsed / this.length : 0; }

  /** True while the blade or limb can connect. */
  get striking(): boolean {
    if (!this.move || this.move === 'dodge' || this.move === 'hit' || this.move === 'death') return false;
    const [start, end] = tuning.activeWindow as [number, number];
    return this.progress >= start && this.progress <= end;
  }

  /** True during the dodge roll's invulnerable frames. */
  get invulnerable(): boolean {
    const [start, end] = tuning.dodgeInvulnerable as [number, number];
    // AURA's Wind Step is a dash with no opening at all.
    if (this.move === 'dash_strike' && this.element === 'AURA') return true;
    return this.move === 'dodge' && this.progress >= start && this.progress <= end;
  }

  /** Interrupt whatever is playing with a reaction such as `hit` or `death`. */
  react(name: 'hit' | 'death'): void { this.start(name); }

  /** Forward speed in m/s the current move carries the hero, or 0. */
  get lunge(): number {
    if (!this.move) return 0;
    // Lunges only during the first part of a move, so recoveries stay planted.
    return this.elapsed < this.length * tuning.lungeFraction ? moves[this.move]!.lunge : 0;
  }

  press(action: CombatAction): boolean {
    if (this.move === 'death') return false;
    // Dodge always answers at once: it cancels attacks, flinches and the guard.
    if (action === 'dodge') {
      if (this.move === 'dodge') return false;
      this.blocking = false;
      this.start('dodge');
      return true;
    }
    if (this.move === 'hit' || this.blocking) return false;
    if (!this.move) {
      let openerMove: string | undefined = action === 'ultimate' || action === 'spark' || action === 'dash' ? sharedOpeners[action] : undefined;
      if (openerMove) { /* same in every style */ } else if (this.style === 'weapon') {
        if (action === 'light') openerMove = this.weapon.moves.light[0] ?? 'light_1';
        else if (action === 'heavy') openerMove = this.weapon.moves.heavy[0] ?? 'heavy_1';
        else if (action === 'uppercut') openerMove = this.weapon.moves.uppercut ?? 'uppercut';
        else if (action === 'ground_pound') openerMove = this.weapon.moves.ground_pound ?? 'ground_pound';
        else if (action === 'dash') openerMove = this.weapon.moves.dash ?? 'dash_strike';
      } else if (this.style === 'bare_hands') {
        if (action === 'light') openerMove = 'bare_light_1';
        else if (action === 'heavy') openerMove = 'bare_heavy_1';
        else if (action === 'uppercut') openerMove = 'uppercut';
        else if (action === 'ground_pound') openerMove = 'ground_pound';
        else if (action === 'dash') openerMove = 'dash_strike';
      } else if (this.style === 'legs') {
        if (action === 'light') openerMove = 'leg_light_1';
        else if (action === 'heavy') openerMove = 'leg_heavy_1';
        else if (action === 'uppercut') openerMove = 'uppercut';
        else if (action === 'ground_pound') openerMove = 'ground_pound';
        else if (action === 'dash') openerMove = 'dash_strike';
      } else if (this.style === 'bending') {
        if (action === 'light') openerMove = 'bend_palm';
        else if (action === 'heavy') openerMove = 'bend_sweep';
        else if (action === 'uppercut') openerMove = 'uppercut';
        else if (action === 'ground_pound') openerMove = 'ground_pound';
        else if (action === 'dash') openerMove = 'dash_strike';
      }
      if (!openerMove || !this.ready(openerMove)) return false;
      this.start(openerMove);
      return true;
    }
    const spec = moves[this.move]!;
    const inWindow = this.elapsed >= this.length * (1 - tuning.comboWindow);
    if (inWindow) {
      if (this.style === 'weapon') {
        if (action === 'light') {
          const list = this.weapon.moves.light;
          const idx = list.indexOf(this.move);
          if (idx >= 0 && idx + 1 < list.length) {
            this.queued = list[idx + 1]!;
            return true;
          }
        } else if (action === 'heavy') {
          const list = this.weapon.moves.heavy;
          const idx = list.indexOf(this.move);
          if (idx >= 0 && idx + 1 < list.length) {
            this.queued = list[idx + 1]!;
            return true;
          }
        }
      } else if (this.style === 'bare_hands') {
        const bareLight = ['bare_light_1', 'bare_light_2', 'bare_light_3'];
        if (action === 'light') {
          const idx = bareLight.indexOf(this.move);
          if (idx >= 0 && idx + 1 < bareLight.length) {
            this.queued = bareLight[idx + 1]!;
            return true;
          }
        }
      } else if (this.style === 'legs') {
        const legLight = ['leg_light_1', 'leg_light_2'];
        if (action === 'light') {
          const idx = legLight.indexOf(this.move);
          if (idx >= 0 && idx + 1 < legLight.length) {
            this.queued = legLight[idx + 1]!;
            return true;
          } else if (this.move === 'leg_light_2') {
            this.queued = 'leg_heavy_1';
            return true;
          }
        } else if (action === 'heavy') {
          if (this.move === 'leg_light_1' || this.move === 'leg_light_2') {
            this.queued = 'leg_heavy_1';
            return true;
          }
        }
      }
      const chains = (action === 'light' && this.move.includes('light')) ||
        (action === 'heavy' && this.move.includes('heavy'));
      if (chains && spec.next) { this.queued = spec.next; return true; }
    }
    return false;
  }

  /** Advance the current move; returns true on the frame a move starts. */
  update(delta: number): boolean {
    this.clock += delta;
    if (!this.move) return false;
    this.elapsed += delta;
    // Death holds its last pose until the hero respawns.
    if (this.elapsed < this.length || this.move === 'death') return false;
    const next = this.queued;
    this.move = null;
    this.clip = null;
    this.queued = null;
    if (next && this.ready(next)) { this.start(next); return true; }
    return false;
  }

  /** Clear a held death pose. */
  reset(): void { this.move = null; this.clip = null; this.queued = null; }

  private start(name: string): void {
    const spec = moves[name]!;
    // Bending moves play the element's own clips; without a weapon the shared moves use unarmed ones.
    const own = name.startsWith('bend_') || name === 'dash_strike' || name === 'ultimate' || this.style !== 'weapon'
      ? ELEMENT_CLIPS[this.element][name] : undefined;
    const wanted = own ?? (this.style !== 'weapon' ? (bareClips[name] ?? spec.clip) : spec.clip);
    const clip = this.anim.hasClip(wanted) ? wanted : spec.clip;
    this.move = name;
    this.clip = clip;
    this.elapsed = 0;
    this.queued = null;
    this.swing++;
    this.swingAt = this.clock;
    this.length = this.anim.duration(clip) / spec.speed;
    this.anim.playOnce(clip, tuning.fade);
    this.anim.setSpeed(clip, spec.speed);
    this.onStart?.(name, this.swingAt);
  }
}
