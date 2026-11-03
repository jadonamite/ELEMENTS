import type RAPIER from '@dimforge/rapier3d-compat';
import { type Object3D, type Scene, Vector3 } from 'three';
import balance from '../../shared/balance.json';
import { createCombatRules, isBendMove, type ActionState, type CombatBalance, type Combatant, type Element, type Health, type Kit, type MoveId } from '../../shared/src/index.js';
import type { Combat } from './combat.js';
import { Enemy, type EnemyTemplate, type VillainCast, type VillainKind } from './enemy.js';
import { bladeTouches, inFront, limbTouchesCapsule } from './hits.js';
import { afflictionFor, bendArc } from './element-moves.js';
import type { WeaponSlotData } from './weapon.js';

const rules = createCombatRules(balance.combat as unknown as CombatBalance);
const tuning = balance.enemy;

/** Round sequence: 1-3-5-7 up till 15 and then stop. */
export const VILLAIN_ROUNDS = [1, 3, 5, 7, 9, 11, 13, 15] as const;

/** A patch of burning ground on the arena stone floor. */
export interface BurnPatch {
  readonly id: number;
  position: Vector3;
  radius: number;
  duration: number;
  elapsed: number;
  active: boolean;
  element: Element;
}

/** What the fight reads from the hero each frame. */
export interface HeroView {
  position: Vector3;
  facing: number;
  /** World-space blade ends this frame. */
  bladeBase: Vector3;
  bladeTip: Vector3;
  handR?: Vector3;
  handL?: Vector3;
  footR?: Vector3;
  footL?: Vector3;
  kneeR?: Vector3;
  kneeL?: Vector3;
  weaponReach?: number;
  weaponSlot?: WeaponSlotData;
}

export interface FightEvents {
  /** The hero was hit; `blocked` when the guard took most of it. */
  heroHit(blocked: boolean): void;
  heroDied(): void;
  /** A bender threw fire; the scene draws it. */
  villainCast?(cast: VillainCast): void;
  /** A hero swing connected; `killed` on the final blow. */
  enemyHit(enemy: Enemy, killed: boolean, damage?: number, hitPos?: Vector3, isCrit?: boolean): void;
  /** The hero blocked just as a hit landed: the attacker staggers. */
  heroParried?(enemy: Enemy): void;
  /** Triggered when a new round begins. */
  roundStarted?(roundNumber: number, villainCount: number): void;
  /** Triggered when all villains in a round are defeated. */
  roundCleared?(roundNumber: number, nextRoundVillainCount: number): void;
  /** Triggered when the final round (15 villains) is completed. */
  victory?(): void;
  /** An attack struck a Terra stone wall instead of the hero. */
  wallBlocked?(pos: Vector3): void;
  /** An enemy attack was countered or extinguished by an elemental defense. */
  elementBlocked?(pos: Vector3): void;
}

/**
 * Runs the arena fight: spawns villains in rounds of 1, 3, 5, 7 up till 15,
 * enforces group attack discipline, checks blade contact, and applies combat perks.
 */
export class Fight {
  readonly enemies: Enemy[] = [];
  readonly burnPatches: BurnPatch[] = [];
  private readonly villainBurns = new Map<Enemy, { burnRemaining: number; tickAccumulator: number }>();
  /** Full Moon lunar phase state empowering AQUES */
  isFullMoon = false;
  /** Optional wall intercept predicate checking if a Terra stone wall is between two points. */
  isBlockedByWall?: (from: Vector3, to: Vector3) => boolean;
  /** Optional elemental defense predicate checking if an attack is countered by hero bending. */
  isAttackCountered?: (enemy: Enemy, hero: HeroView) => boolean;
  heroHealth: Health = rules.createHealth(balance.hero.maxHealth);
  /** The hero's element and weapon; moves take their numbers from it. */
  kit: Kit = { element: 'IGNIS', weapon: 'sword' };
  /** Strength of the bending move about to start, and whether the meter chained it. */
  private bend = { scale: 1, chained: false };
  private heroState: ActionState = rules.createActionState();
  private attacker: Enemy | null = null;
  /** Seconds before the next villain may start an attack. */
  private gap = 0;
  private respawnIn: number[] = [];
  private clock = 0;

  // Round tracking
  private currentRoundIndex = 0;
  private spawnedInRound = 0;
  private killedInRound = 0;
  private readonly counted = new WeakSet<Enemy>();
  private roundIntermission = 0;
  isVictory = false;
  /** False in open zones: no rounds; enemies come from encounters instead. */
  waves = true;

  constructor(
    private readonly template: EnemyTemplate,
    private readonly world: RAPIER.World,
    private readonly scene: Scene,
    private readonly events: FightEvents,
    private readonly createEnemy: (template: EnemyTemplate, world: RAPIER.World, point: { x: number; z: number }, maxHealth: number, kind: VillainKind) => Enemy =
      (t, w, p, m, k) => new Enemy(t, w, p, m, k),
  ) {
    // Initial spawn for Round 1 (1 villain)
    this.respawnIn.push(0.6);
    this.events.roundStarted?.(1, VILLAIN_ROUNDS[0]!);

    // Pre-allocate 16 pooled burn patches for living fire
    for (let i = 0; i < 16; i++) {
      this.burnPatches.push({
        id: i,
        position: new Vector3(),
        radius: balance.combat.burn?.patchRadius ?? 1.25,
        duration: 3.0,
        elapsed: 0,
        active: false,
        element: 'IGNIS',
      });
    }
  }

  get heroAlive(): boolean { return this.heroHealth.current > 0; }

  get currentRoundNumber(): number { return this.currentRoundIndex + 1; }
  get totalRounds(): number { return VILLAIN_ROUNDS.length; }
  get roundVillainTarget(): number { return VILLAIN_ROUNDS[this.currentRoundIndex] ?? 15; }
  get nextRoundVillainTarget(): number { return VILLAIN_ROUNDS[this.currentRoundIndex + 1] ?? 15; }
  get villainsRemaining(): number { return Math.max(0, this.roundVillainTarget - this.killedInRound); }
  get villainsKilledInRound(): number { return this.killedInRound; }
  get intermissionRemaining(): number { return this.roundIntermission; }
  get livingCount(): number { return this.enemies.filter(e => e.alive).length; }

  get activeBurnPatches(): readonly BurnPatch[] {
    return this.burnPatches.filter(p => p.active);
  }

  get burningVillains(): Array<{ position: Vector3; alive: boolean }> {
    const list: Array<{ position: Vector3; alive: boolean }> = [];
    for (const [enemy, burn] of this.villainBurns) {
      if (enemy.alive && burn.burnRemaining > 0) {
        list.push({ position: enemy.controller.position, alive: true });
      }
    }
    return list;
  }

  /** Spawns a burning patch of ground that damages villains walking into it. */
  spawnBurnPatch(pos: Vector3, radius?: number, duration?: number, element: Element = 'IGNIS'): BurnPatch {
    let target = this.burnPatches.find(p => !p.active);
    if (!target) {
      let maxElapsed = -1;
      for (const p of this.burnPatches) {
        if (p.elapsed > maxElapsed) {
          maxElapsed = p.elapsed;
          target = p;
        }
      }
    }
    const patch = target ?? this.burnPatches[0]!;
    patch.position.copy(pos).setY(0.02);
    patch.radius = radius ?? balance.combat.burn?.patchRadius ?? 1.25;
    patch.duration = duration ?? (2.4 + Math.random() * 1.2);
    patch.elapsed = 0;
    patch.active = true;
    patch.element = element;
    return patch;
  }

  /** Is the move off cooldown in the rules? The hero's combat asks before starting one. */
  ready(move: string, isLit = false): boolean {
    if (move === 'hit' || move === 'death') return true;
    try {
      return rules.cooldownRemaining(move as MoveId, this.heroState, this.clock, isLit, this.kit) === 0;
    } catch {
      return true;
    }
  }

  stopWaves(): void { this.waves = false; this.respawnIn = []; }

  /** Spawns a specific villain at a world coordinate (used for road ambushes and world encounters). */
  spawnVillain(point: { x: number; z: number }, kind: VillainKind = 'armed', maxHealth?: number): Enemy {
    const health = maxHealth ?? balance.enemy.maxHealth ?? 100;
    const enemy = this.createEnemy(this.template, this.world, point, health, kind);
    this.enemies.push(enemy);
    return enemy;
  }

  /** Set before pressing a bending move: its strength from the meter and tier, and whether it is a chain link. */
  setBend(scale: number, chained: boolean): void { this.bend = { scale, chained }; }

  /** Restores hero health, never above the maximum. */
  healHero(amount: number): void { if (this.heroAlive) this.heroHealth = rules.heal(this.heroHealth, amount); }

  /** Starts a move and begins its cooldown immediately when accepted. */
  startMove(move: string, swingAt: number = this.clock, isLit = false): boolean {
    if (move === 'hit' || move === 'death') return true;
    try {
      const res = rules.startMove(this.heroState, move as MoveId, swingAt, isLit, this.kit, isBendMove(move) && this.bend.chained);
      if (!res.accepted) return false;
      this.heroState = res.state;
      return true;
    } catch {
      return false;
    }
  }

  /** Record a dodge roll, consuming its cooldown in shared rules. */
  recordDodge(isLit = false): boolean {
    return this.startMove('dodge', this.clock, isLit);
  }

  /** Seconds remaining on cooldown for a given move. */
  cooldownRemaining(move: string, isLit = false): number {
    try {
      return rules.cooldownRemaining(move as MoveId, this.heroState, this.clock, isLit, this.kit);
    } catch {
      return 0;
    }
  }

  /** Total configured cooldown in seconds for a move. */
  cooldownTotal(move: string, isLit = false): number {
    let total = 1;
    try { total = rules.moveFor(move as MoveId, this.kit).cooldownSeconds; } catch { /* hit, death */ }
    return isLit ? total * rules.litCooldownMultiplier : total;
  }

  /** Jump directly to a round for testing or debug. */
  setRound(roundNumber: number): void {
    this.currentRoundIndex = Math.max(0, Math.min(VILLAIN_ROUNDS.length - 1, roundNumber - 1));
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies.length = 0;
    this.villainBurns.clear();
    for (const p of this.burnPatches) p.active = false;
    this.spawnedInRound = 0;
    this.killedInRound = 0;
    this.roundIntermission = 0;
    this.isVictory = false;
    this.respawnIn = [0.5];
    this.events.roundStarted?.(this.currentRoundNumber, this.roundVillainTarget);
  }

  /** Records an enemy's defeat, updates round kill counts, queues respawns and checks victory / intermission. */
  private handleEnemyDefeated(enemy: Enemy): void {
    // Each death counts once, whatever killed it.
    if (this.counted.has(enemy)) return;
    this.counted.add(enemy);
    this.villainBurns.delete(enemy);
    this.killedInRound++;
    if (this.spawnedInRound < this.roundVillainTarget && this.respawnIn.length === 0) {
      this.respawnIn.push(0.7);
    }
    if (this.killedInRound >= this.roundVillainTarget) {
      if (this.currentRoundIndex >= VILLAIN_ROUNDS.length - 1) {
        // Victory after completing round 15!
        this.isVictory = true;
        this.events.victory?.();
      } else {
        // Intermission before next round
        this.roundIntermission = 3.0;
        const nextTarget = VILLAIN_ROUNDS[this.currentRoundIndex + 1]!;
        this.events.roundCleared?.(this.currentRoundNumber, nextTarget);
      }
    }
    if (enemy === this.attacker) this.release();
    this.events.enemyHit(enemy, true);
  }

  /** Defeats an enemy directly (e.g. fatal damage or test execution). */
  defeatEnemy(enemy: Enemy): void {
    if (!enemy.alive && enemy.health.current <= 0) {
      this.handleEnemyDefeated(enemy);
      return;
    }
    if (!enemy.alive) return;
    const killed = enemy.hurt({ current: 0, maximum: enemy.health.maximum });
    if (killed) {
      this.handleEnemyDefeated(enemy);
    }
  }

  /** Nearest living villain in front of the hero within `range`, for aim assist. */
  nearestInFront(from: Vector3, facing: number, range: number, angle: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDistance = range;
    for (const enemy of this.enemies) {
      if (!enemy.hittable) continue;
      const distance = enemy.controller.position.distanceTo(from);
      if (distance < bestDistance && inFront(from, facing, enemy.controller.position, angle)) {
        best = enemy;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Distance to the closest living villain, for the stance. */
  nearestDistance(from: Vector3): number {
    return this.enemies.reduce((d, e) => e.alive ? Math.min(d, e.controller.position.distanceTo(from)) : d, Infinity);
  }

  /** Find the next or nearest living lock target. Cycles through targets and toggles off when done. */
  findLockTarget(from: Vector3, current?: Enemy | null): Enemy | null {
    const alive = this.enemies.filter(e => e.alive);
    if (alive.length === 0) return null;
    if (current && alive.includes(current)) {
      if (alive.length === 1) return null;
      const nextIdx = alive.indexOf(current) + 1;
      if (nextIdx >= alive.length) return null;
      return alive[nextIdx]!;
    }
    let closest: Enemy | null = null;
    let minDistance = 18;
    for (const enemy of alive) {
      const dist = enemy.controller.position.distanceTo(from);
      if (dist < minDistance) {
        minDistance = dist;
        closest = enemy;
      }
    }
    return closest;
  }

  /** True when all spawned enemies are defeated. */
  get allDead(): boolean {
    return this.enemies.length > 0 && this.enemies.every(e => !e.alive);
  }

  /** One physics step for every villain. Cooldowns advance at normal speed; perks come from rules. */
  step(hero: HeroView, combat: Combat, isLit = false): void {
    const dt = balance.controller.fixedStep;
    this.clock += dt;

    if (this.attacker && !this.attacker.attacking) this.release();
    this.gap = Math.max(0, this.gap - dt);
    const quarry = { position: hero.position, alive: this.heroAlive };
    for (const enemy of this.enemies) {
      const may = this.attacker === enemy || (this.attacker === null && this.gap === 0);
      const landed = enemy.step(quarry, may);
      const cast = enemy.takeCast?.();
      if (cast) this.events.villainCast?.(cast);
      if (!landed) {
        if (enemy.attacking && !this.attacker) this.attacker = enemy;
        continue;
      }
      if (combat.invulnerable) continue;
      const guarded = combat.blocking && inFront(hero.position, hero.facing, enemy.controller.position, balance.hero.blockAngle);
      // A guard raised just before the hit is a parry: no damage, and the attacker staggers open.
      if (guarded && combat.blockAge <= rules.parryWindow(this.kit.hush)) {
        enemy.afflict({ parried: true, stunSeconds: rules.parryStagger(this.kit.hush) });
        this.events.heroParried?.(enemy);
        continue;
      }
      // Block confirmed: player completely blocked the strike. Hero takes ZERO damage.
      // Life should ONLY reduce on successful unblocked hit confirmation.
      if (guarded) {
        this.events.heroHit(true);
        continue;
      }
      // Check if an active Terra stone wall intercepts the attack between enemy and hero
      if (this.isBlockedByWall?.(enemy.controller.position, hero.position)) {
        this.events.wallBlocked?.(enemy.controller.position);
        continue;
      }
      // Check if the attack is countered by the hero's elemental bending defense
      if (this.isAttackCountered?.(enemy, hero)) {
        this.events.elementBlocked?.(enemy.controller.position);
        continue;
      }
      // Confirmed, unblocked, unobstructed hit confirmation: only now does life reduce!
      const damage = rules.calculateDamage(enemy.attackDamage || tuning.attackDamage);
      this.heroHealth = rules.applyDamage(this.heroHealth, damage);
      if (damage >= 14) {
        // Heavy unblocked trauma inflicts deep scars / internal wounds (cannot be cured by water healing)
        const trauma = Math.max(1, Math.round(damage * 0.18));
        this.heroHealth = rules.inflictScars(this.heroHealth, trauma);
      }
      if (rules.isDead(this.heroHealth)) this.events.heroDied();
      else this.events.heroHit(false);
    }

    // Advance fire patches
    for (const patch of this.burnPatches) {
      if (!patch.active) continue;
      patch.elapsed += dt;
      if (patch.elapsed >= patch.duration) patch.active = false;
    }

    // Apply burning ground and burn damage ticks to villains
    const burnConfig = balance.combat.burn ?? {
      damagePerSecond: 16,
      tickSeconds: 0.25,
      villainBurnDuration: 2.5,
    };

    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        this.villainBurns.delete(enemy);
        continue;
      }
      const inFire = this.burnPatches.some(p => {
        if (!p.active) return false;
        const dx = p.position.x - enemy.controller.position.x;
        const dz = p.position.z - enemy.controller.position.z;
        const maxDist = p.radius + enemy.body.radius;
        return (dx * dx + dz * dz) <= maxDist * maxDist;
      });

      let burn = this.villainBurns.get(enemy);
      if (inFire) {
        if (!burn) {
          burn = { burnRemaining: burnConfig.villainBurnDuration, tickAccumulator: 0 };
          this.villainBurns.set(enemy, burn);
        } else {
          burn.burnRemaining = Math.max(burn.burnRemaining, 1.8);
        }
      }

      if (burn && burn.burnRemaining > 0) {
        if (!inFire) burn.burnRemaining -= dt;
        burn.tickAccumulator += dt;
        if (burn.tickAccumulator >= burnConfig.tickSeconds) {
          burn.tickAccumulator -= burnConfig.tickSeconds;
          const res = rules.applyBurnTick(enemy.health, burnConfig.tickSeconds, tuning.armour);
          const killed = enemy.hurt(res.health);
          if (killed) {
            this.handleEnemyDefeated(enemy);
          }
        }
        if (burn.burnRemaining <= 0) {
          this.villainBurns.delete(enemy);
        }
      }
    }

    this.strike(hero, combat, isLit);
    // Catch deaths from any source that skipped the bookkeeping above.
    for (const enemy of this.enemies) if (!enemy.alive) this.handleEnemyDefeated(enemy);
  }

  /** Test the blade, limb, or projectile against every villain while the swing is live. */
  private strike(hero: HeroView, combat: Combat, isLit = false): void {
    const move = combat.current;
    if (!move || !combat.striking || !this.heroAlive) return;
    const limb = combat.strikingLimb;
    const weaponReach = hero.weaponReach ?? hero.weaponSlot?.reach ?? combat.weaponReach ?? 2.5;

    for (const enemy of this.enemies) {
      if (!enemy.hittable || enemy.lastSwing === combat.swing) continue;
      const body = enemy.body;
      let connects = false;

      // In bare hands style, the weapon is sheathed. All strikes MUST use fists or feet, never the blade.
      if (combat.fightingStyle === 'bare_hands' || combat.fightingStyle === 'legs') {
        if (limb === 'blade') {
          continue;
        }
        // A punch lands with whichever fist reaches; a kick strikes along the active kicking shin while in the air.
        const fists = [hero.handR, hero.handL];
        const dist = hero.position.distanceTo(enemy.controller.position);
        if (limb === 'hand_r' || limb === 'hand_l') {
          connects = fists.some(p => p && limbTouchesCapsule(p, 0.26, body.feet, body.height, body.radius))
            || (dist <= 2.2 && inFront(hero.position, hero.facing, enemy.controller.position, 1.4));
        } else if (limb === 'foot_r' || limb === 'foot_l') {
          const isRight = limb === 'foot_r';
          const knee = isRight ? hero.kneeR : hero.kneeL;
          const foot = isRight ? hero.footR : hero.footL;
          const elevated = (foot?.y ?? 0.5) > 0.18;
          const isHeavyKick = move === 'leg_heavy_1';
          const kickReach = isHeavyKick ? 2.85 : 2.5;
          const kickAngle = isHeavyKick ? 1.5 : 1.4;
          connects = (elevated && !!knee && !!foot && limbTouchesCapsule(knee, isHeavyKick ? 0.35 : 0.28, body.feet, body.height, body.radius, foot))
            || (dist <= kickReach + body.radius && inFront(hero.position, hero.facing, enemy.controller.position, kickAngle));
        } else if (limb === 'area') {
          connects = dist <= 2.8 && inFront(hero.position, hero.facing, enemy.controller.position, 1.6);
        }
      } else if (limb === 'blade') {
        const dist = hero.position.distanceTo(enemy.controller.position);
        connects = dist <= weaponReach + body.radius && (bladeTouches(hero.bladeBase, hero.bladeTip, body.feet, body.height, body.radius)
          || inFront(hero.position, hero.facing, enemy.controller.position, 1.4));
      } else if (limb === 'hand_r' || limb === 'hand_l') {
        const handPos = (limb === 'hand_r' ? hero.handR : hero.handL) ?? hero.position;
        connects = limbTouchesCapsule(handPos, 0.26, body.feet, body.height, body.radius)
          || (hero.position.distanceTo(enemy.controller.position) <= 2.2 && inFront(hero.position, hero.facing, enemy.controller.position, 1.4));
      } else if (limb === 'foot_r' || limb === 'foot_l') {
        const footPos = (limb === 'foot_r' ? hero.footR : hero.footL) ?? hero.position;
        const isHeavyKick = move === 'leg_heavy_1';
        const kickReach = isHeavyKick ? 2.85 : 2.4;
        const kickAngle = isHeavyKick ? 1.5 : 1.4;
        connects = limbTouchesCapsule(footPos, isHeavyKick ? 0.35 : 0.26, body.feet, body.height, body.radius)
          || (hero.position.distanceTo(enemy.controller.position) <= kickReach + body.radius && inFront(hero.position, hero.facing, enemy.controller.position, kickAngle));
      } else if (limb === 'projectile' || limb === 'area') {
        const distance = hero.position.distanceTo(enemy.controller.position);
        let maxReach = 5.0;
        try { maxReach = rules.moveFor(move as MoveId, this.kit).reach; } catch { /* not a rules move */ }
        connects = distance <= maxReach + body.radius && inFront(hero.position, hero.facing, enemy.controller.position, bendArc(move));
      }
      if (!connects) continue;
      enemy.lastSwing = combat.swing;
      const result = rules.checkHit({
        attacker: { ...this.combatant(this.kit.element, hero.position, this.heroHealth, 0), weapon: this.kit.weapon },
        target: this.combatant(tuning.element as Element, enemy.controller.position, enemy.health, tuning.armour),
        moveId: move, now: this.clock, state: this.heroState, swingAt: Math.min(combat.swingAt, this.clock),
        isLit, bendScale: this.bend.scale, chained: this.bend.chained,
        situation: { isFullMoon: this.isFullMoon },
      });
      if (!result.accepted) continue;
      this.heroState = result.state;
      const effect = (isBendMove(move) || (isLit && (move.startsWith('leg_') || move.startsWith('bare_'))))
        ? afflictionFor(this.kit.element, move, hero.position, enemy.controller.position, Math.min(1, this.bend.scale))
        : null;
      if (effect && result.target.health.current > 0) enemy.afflict(effect);

      const prevHp = enemy.health.current;
      const killed = enemy.hurt(result.target.health, move, hero.position, isLit);
      const damageDealt = Math.max(1, Math.round(prevHp - result.target.health.current));
      const isCrit = isLit || move.startsWith('heavy') || move === 'uppercut' || move === 'ground_pound' || move === 'ultimate';
      if (killed) {
        this.handleEnemyDefeated(enemy);
        this.events.enemyHit(enemy, true, damageDealt, enemy.controller.position, isCrit);
      } else {
        if (enemy === this.attacker) this.release();
        this.events.enemyHit(enemy, false, damageDealt, enemy.controller.position, isCrit);
      }
    }
  }

  /** Per drawn frame: animate villains, clear the fallen, advance rounds and spawn waves. */
  draw(delta: number, alpha: number, heroPosition: Vector3): void {
    for (const enemy of this.enemies) enemy.draw(delta, alpha);

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (!this.enemies[i]!.gone) continue;
      this.enemies[i]!.dispose();
      this.enemies.splice(i, 1);
    }

    if (this.isVictory || !this.waves) return;

    // Handle round intermission countdown
    if (this.roundIntermission > 0) {
      this.roundIntermission -= delta;
      if (this.roundIntermission <= 0) {
        this.currentRoundIndex++;
        this.spawnedInRound = 0;
        this.killedInRound = 0;
        this.respawnIn = [0.8];
        this.events.roundStarted?.(this.currentRoundNumber, this.roundVillainTarget);
      }
      return;
    }

    // Active wave spawning: keep up to 6 alive villains concurrently on the field
    this.respawnIn = this.respawnIn.map(t => t - delta);
    const maxActive = Math.min(this.roundVillainTarget, 6);

    while (
      this.spawnedInRound < this.roundVillainTarget &&
      this.livingCount < maxActive &&
      this.respawnIn.length &&
      this.respawnIn[0]! <= 0
    ) {
      this.respawnIn.shift();
      this.spawn(heroPosition);
      this.spawnedInRound++;
    }

    if (
      this.spawnedInRound < this.roundVillainTarget &&
      this.livingCount < maxActive &&
      this.respawnIn.length === 0
    ) {
      this.respawnIn.push(0.7);
    }
  }

  /** Bring the hero back at full health and restart the current round cleanly. */
  reviveHero(): void {
    this.heroHealth = rules.createHealth(balance.hero.maxHealth);
    this.heroState = rules.createActionState();
    this.attacker = null;

    // Restart the current round attempt
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies.length = 0;
    this.villainBurns.clear();
    for (const p of this.burnPatches) p.active = false;
    this.spawnedInRound = 0;
    this.killedInRound = 0;
    this.roundIntermission = 0;
    this.respawnIn = [0.8];
    this.events.roundStarted?.(this.currentRoundNumber, this.roundVillainTarget);
  }

  /** The attacking villain is done; the others wait a beat before taking a turn. */
  private release(): void {
    this.attacker = null;
    this.gap = tuning.groupAttackGap;
  }

  dispose(): void {
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies.length = 0;
    this.villainBurns.clear();
    for (const p of this.burnPatches) p.active = false;
  }

  private spawn(heroPosition: Vector3): void {
    let point = { x: 0, z: tuning.spawnRadius };
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      point = { x: Math.cos(angle) * tuning.spawnRadius, z: Math.sin(angle) * tuning.spawnRadius };
      const clearOfHero = Math.hypot(point.x - heroPosition.x, point.z - heroPosition.z) >= tuning.minSpawnDistance;
      const clearOfRocks = balance.arena.obstacles.every(o => Math.hypot(point.x - o.x, point.z - o.z) > o.radius + 1);
      const clearOfOthers = this.enemies.every(e => Math.hypot(point.x - e.controller.position.x, point.z - e.controller.position.z) > 2);
      if (clearOfHero && clearOfRocks && clearOfOthers) break;
    }
    const enemy = this.createEnemy(this.template, this.world, point, tuning.maxHealth, this.pickKind());
    this.scene.add(enemy.model as Object3D);
    this.enemies.push(enemy);
  }

  /** Rolls the next villain's kind from the current round's mix in balance.json. */
  private pickKind(): VillainKind {
    const round = this.currentRoundNumber;
    const wave = [...tuning.waves].reverse().find(w => round >= w.fromRound) ?? tuning.waves[0]!;
    const mix = Object.entries(wave.mix) as Array<[VillainKind, number]>;
    let roll = Math.random() * mix.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [kind, weight] of mix) {
      roll -= weight;
      if (roll <= 0) return kind;
    }
    return mix[0]![0];
  }

  private combatant(element: Element, position: Vector3, health: Health, armour: number): Combatant {
    return { element, position: { x: position.x, y: position.y, z: position.z }, health, armour };
  }
}
