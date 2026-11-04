import { Vector3 } from 'three';
import type { CombatSpace } from '../attacks/space.js';
import type { Enemy } from '../enemy.js';

/** Quiet seconds in the streets before the first challenge, and between challenges. */
const FIRST_CHALLENGE = 40;
const BETWEEN_CHALLENGES = 90;
/** A challenger comes from out of sight, this far away. */
const APPROACH_FROM = 16;
/** Walk this far from a challenger and the challenge is refused. */
const REFUSE_DISTANCE = 22;
/** Seconds into an accepted fight before the challenger's gang mates arrive, and how many come. */
const GANG_ARRIVES = 4;
const GANG_MATES = 2;
/** A guard sees a brawl inside this distance with a clear line. */
const GUARD_SIGHT = 25;

export interface StreetChallengeOptions {
  spawnVillain: (at: { x: number; z: number }) => Enemy;
  enemies: () => readonly Enemy[];
  space: CombatSpace;
  /** Where the town watch stands now. */
  guards: () => readonly Vector3[];
  /** True where a brawl breaks the town's law (anywhere in Sindr's streets). */
  inTown: (at: Vector3) => boolean;
  /** Puts the hero into the fight stance and camera. */
  drawForFight: () => void;
  onSeenByGuard: () => void;
  notice: (message: string) => void;
}

type Phase = 'waiting' | 'offered' | 'fighting';

/**
 * One person in the street calls the hero out. Accepting (E, or a blow) starts the brawl and the
 * challenger's gang joins; walking away refuses. A guard who sees the brawl gives one red flag.
 */
export class StreetChallenges {
  private phase: Phase = 'waiting';
  private wait = FIRST_CHALLENGE;
  private challenger: Enemy | null = null;
  private fighters: Enemy[] = [];
  private fightTime = 0;
  private gangCalled = false;
  private seen = false;
  private readonly from = new Vector3();
  private readonly to = new Vector3();

  constructor(private readonly o: StreetChallengeOptions) {}

  /** E while a challenge stands: accept it. */
  accept(): boolean {
    if (this.phase !== 'offered' || !this.challenger) return false;
    this.startFight();
    return true;
  }

  update(dt: number, hero: Vector3, heroAlive: boolean, heroFacing: number): void {
    if (!heroAlive) { this.reset(BETWEEN_CHALLENGES); return; }
    if (this.phase === 'waiting') {
      const busy = this.o.enemies().some(e => e.alive);
      if (busy || !this.o.inTown(hero)) return;
      this.wait -= dt;
      if (this.wait <= 0) this.offer(hero, heroFacing);
      return;
    }
    const challenger = this.challenger;
    if (this.phase === 'offered' && challenger) {
      if (!challenger.alive || !challenger.challenging) { this.startFight(); return; }
      if (challenger.controller.position.distanceTo(hero) > REFUSE_DISTANCE) {
        challenger.flee();
        this.o.notice('You walk away. The challenge goes unanswered.');
        this.reset(BETWEEN_CHALLENGES);
      }
      return;
    }
    if (this.phase === 'fighting') {
      this.fightTime += dt;
      if (!this.gangCalled && this.fightTime >= GANG_ARRIVES) {
        this.gangCalled = true;
        for (let i = 0; i < GANG_MATES; i++) this.fighters.push(this.o.spawnVillain(this.outOfSight(hero, heroFacing, i)));
        this.o.notice('The rest of the gang runs in.');
      }
      if (!this.seen && this.guardSees(hero)) {
        this.seen = true;
        this.o.onSeenByGuard();
      }
      if (this.fighters.every(f => !f.alive)) {
        this.o.notice('The street is yours. Take what they carried.');
        this.reset(BETWEEN_CHALLENGES);
      }
    }
  }

  private offer(hero: Vector3, heroFacing: number): void {
    const challenger = this.o.spawnVillain(this.outOfSight(hero, heroFacing, 0));
    challenger.challenge();
    this.challenger = challenger;
    this.fighters = [challenger];
    this.phase = 'offered';
    this.o.notice('A cutthroat of the Sindr Alley gang calls you out. [E] Accept, or walk away.');
  }

  private startFight(): void {
    this.challenger?.engage();
    this.phase = 'fighting';
    this.fightTime = 0;
    this.gangCalled = false;
    this.seen = false;
    this.o.drawForFight();
    this.o.notice('Brawling in the street breaks the law. Watch for the guard.');
  }

  /** A spot behind the hero that the world lets someone walk out of, as far back as it allows. */
  private outOfSight(hero: Vector3, heroFacing: number, i: number): { x: number; z: number } {
    const behind = heroFacing + Math.PI + (i - 0.5) * 0.9;
    this.from.set(hero.x, hero.y + 1, hero.z);
    this.to.set(hero.x + Math.sin(behind) * APPROACH_FROM, hero.y + 1, hero.z + Math.cos(behind) * APPROACH_FROM);
    const end = this.o.space.reachable(this.from, this.to, 0.4);
    const back = Math.max(0, hero.distanceTo(end) - 0.8);
    return { x: hero.x + Math.sin(behind) * back, z: hero.z + Math.cos(behind) * back };
  }

  private guardSees(hero: Vector3): boolean {
    this.to.set(hero.x, hero.y + 1.2, hero.z);
    return this.o.guards().some((g) => {
      if (g.distanceTo(hero) > GUARD_SIGHT) return false;
      this.from.set(g.x, g.y + 1.6, g.z);
      return this.o.space.clear(this.from, this.to, 0.05);
    });
  }

  private reset(wait: number): void {
    this.phase = 'waiting';
    this.wait = wait;
    this.challenger = null;
    this.fighters = [];
  }
}
