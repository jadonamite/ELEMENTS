import type RAPIER from '@dimforge/rapier3d-compat';
import { type Object3D, type Scene, Vector3 } from 'three';

const dodgeFrom = new Vector3(), dodgeTo = new Vector3();
import balance from '../../shared/balance.json';
import { createCombatRules, isBendMove, type ActionState, type CombatBalance, type Combatant, type Element, type Health, type Kit, type MoveId } from '../../shared/src/index.js';
import type { Combat } from './combat.js';
import { Enemy, type EnemyTemplate, type VillainCast, type VillainKind } from './enemy.js';
import { bladeTouches, inFront, limbTouchesCapsule } from './hits.js';
import { CombatSpace, chest } from './attacks/space.js';
import { advance, launch, type Projectile } from './attacks/projectile.js';
import { afflictionFor, bendArc } from './element-moves.js';
import type { WeaponSlotData } from './weapon.js';
import { EmberHound, HoundPack, type HoundTemplate } from './monsters/hound.js';
import { SlagBull } from './monsters/slag-bull.js';

type Monster = EmberHound | SlagBull;
function isMonster(target: Enemy | Monster): target is Monster { return !(target instanceof Enemy); }

const rules = createCombatRules(balance.combat as unknown as CombatBalance);
const tuning = balance.enemy;

/** Round sequence: 1-3-5-7 up till 15 and then stop. */
export const VILLAIN_ROUNDS = [1, 3, 5, 7, 9, 11, 13, 15] as const;

/** Height at which burning ground asks the world what stands in its way. */
const PATCH_PROBE_Y = 0.5;

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

export type FightKiller = { id?: string; kind: string };

export interface FightEvents {
  /** The hero was hit; `blocked` when the guard took most of it. */
  heroHit(blocked: boolean, by?: FightKiller): void;
  heroDied(killer?: FightKiller): void;
  /** Life changed on a hit nothing stopped. */
  onHurt?(hp: number, max: number, damage: number, by?: FightKiller): void;
  /** A projectile left a hand; the scene draws it following `p.position` until `p.done`. */
  projectileLaunched?(p: Projectile): void;
  /** A projectile ended against the world, a body, or ran out of range. */
  projectileEnded?(p: Projectile): void;
  /** A hero attack connected; `killed` on the final blow, `elemental` when bending did it and not steel or a bare limb. */
  enemyHit(enemy: Enemy, killed: boolean, damage?: number, hitPos?: Vector3, isCrit?: boolean, elemental?: boolean): void;
  monsterHit?(monster: Monster, killed: boolean, damage: number, at: Vector3, weakSpot: boolean, elemental: boolean): void;
  /** The hero blocked just as a hit landed: the attacker staggers. */
  heroParried?(enemy: Enemy): void;
  /** Triggered when a new round begins. */
  roundStarted?(roundNumber: number, villainCount: number): void;
  /** Triggered when all villains in a round are defeated. */
  roundCleared?(roundNumber: number, nextRoundVillainCount: number): void;
  /** Triggered when the final round (15 villains) is completed. */
  victory?(): void;
  /** A strike met a wall, pillar or TERRA wall on its way; `pos` is where. */
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
  /** The hero's elemental defence: true when an attack of this element is countered. */
  isAttackCountered?: (element: Element) => boolean;
  /** Every projectile in flight, hero's and villains'. */
  readonly projectiles: Projectile[] = [];
  private readonly space: CombatSpace;
  /** Limb positions on the previous step, so a fast limb is tested along the path it swept. */
  private readonly lastLimb = new Map<string, Vector3>();
  private launchedSwing = -1;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  heroHealth: Health = rules.createHealth(balance.hero.maxHealth);
  heroArmour = 0;
  /** The hero's element and weapon; moves take their numbers from it. */
  kit: Kit = { element: 'IGNIS', weapon: 'sword' };
  /** A blow on the raised guard: the hero's stamina soaks it, or the guard breaks and the blow lands. */
  guardSoak: ((damage: number) => 'held' | 'broken') | null = null;
  /** The hero's fighting tier: moves above it are not ready, ever. Online the room sets it. */
  tier = 5;

  setHeroArmour(armour: number): void {
    this.heroArmour = Math.max(0, armour);
  }
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
  private readonly packs: Array<{ pack: HoundPack; deadFor: number }> = [];
  private readonly houndSwings = new WeakMap<Monster, number>();
  private readonly houndBurns = new WeakMap<Monster, number>();

  private readonly bulls: Array<{ bull: SlagBull; deadFor: number }> = [];

  get monsters(): Monster[] { return [...this.hounds, ...this.bulls.map(entry => entry.bull)]; }

  spawnSlagBull(point: { x: number; y: number; z: number }): SlagBull {
    const bull = new SlagBull(this.world, point);
    this.scene.add(bull.model);
    this.bulls.push({ bull, deadFor: 0 });
    return bull;
  }

  get hounds(): EmberHound[] { return this.packs.flatMap(entry => entry.pack.hounds); }

  spawnHounds(template: HoundTemplate, point: { x: number; y: number; z: number }): void {
    const pack = new HoundPack(template, this.world, point, false);
    for (const hound of pack.hounds) {
      const p = hound.controller.position;
      const floor = this.space.floor(p.x, point.y + 4, p.z, 10) ?? point.y;
      hound.controller.place(p.x, floor, p.z);
      hound.model.position.copy(hound.controller.position);
      this.scene.add(hound.model);
    }
    this.packs.push({ pack, deadFor: 0 });
  }

  private disposePack(pack: HoundPack): void {
    for (const hound of pack.hounds) {
      hound.anim.dispose();
      hound.controller.dispose();
      hound.materials.forEach(material => material.dispose());
      hound.model.removeFromParent();
    }
  }

  private clearPacks(): void {
    this.packs.forEach(entry => this.disposePack(entry.pack));
    this.packs.length = 0;
    this.bulls.forEach(entry => entry.bull.dispose());
    this.bulls.length = 0;
  }

  private targetBody(target: Enemy | Monster): { feet: Vector3; height: number; radius: number } {
    if (target instanceof SlagBull) return { feet: target.position, height: target.height, radius: target.radius };
    return target instanceof EmberHound
      ? { feet: target.position, height: 1.05, radius: 0.6 }
      : target.body;
  }

  /** The villain bodies; in town they arrive after play starts, so a fight starts only once they are here. */
  private template: EnemyTemplate | null;
  private lastStriker: FightKiller | null = null;

  constructor(
    template: EnemyTemplate | null,
    private readonly world: RAPIER.World,
    private readonly scene: Scene,
    private readonly events: FightEvents,
    private readonly createEnemy: (template: EnemyTemplate, world: RAPIER.World, point: { x: number; z: number; y?: number }, maxHealth: number, kind: VillainKind) => Enemy =
      (t, w, p, m, k) => new Enemy(t, w, p, m, k),
    waves = true,
  ) {
    this.template = template;
    this.waves = waves;
    this.space = new CombatSpace(world);
    if (waves) {
      // Initial spawn for Round 1 (1 villain)
      this.respawnIn.push(0.6);
      this.events.roundStarted?.(1, VILLAIN_ROUNDS[0]!);
    }

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
  get livingCount(): number { return this.enemies.filter(e => e.alive).length + this.monsters.filter(h => h.alive).length; }

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

  /**
   * Spawns a burning patch of ground that damages villains walking into it. `from` is where the
   * fire came from: a patch lands no further than the fire could reach from there.
   */
  spawnBurnPatch(pos: Vector3, from: Vector3, radius?: number, duration?: number, element: Element = 'IGNIS'): BurnPatch {
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
    this.space.reachable(this.a.copy(from).setY(PATCH_PROBE_Y), this.b.copy(pos).setY(PATCH_PROBE_Y), 0.3, patch.position).setY(0.02);
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
    if (!rules.tierAllows(move as MoveId, this.tier)) return false;
    try {
      return rules.cooldownRemaining(move as MoveId, this.heroState, this.clock, isLit, this.kit) === 0;
    } catch {
      return true;
    }
  }

  stopWaves(): void { this.waves = false; this.respawnIn = []; this.roundIntermission = 0; }

  /** True once villain bodies have loaded; every place that starts a fight asks this first. */
  get villainsReady(): boolean { return this.template !== null; }

  /** Hands over the villain bodies once they have loaded and been readied for drawing. */
  setTemplate(template: EnemyTemplate): void { this.template = template; }

  private villains(): EnemyTemplate {
    if (!this.template) throw new Error('Villains have not loaded yet; check villainsReady before starting a fight.');
    return this.template;
  }

  /** Spawns a specific villain at a world coordinate (used for road ambushes and world encounters). */
  spawnVillain(point: { x: number; z: number; y?: number }, kind: VillainKind = 'armed', maxHealth?: number): Enemy {
    const health = maxHealth ?? balance.enemy.maxHealth ?? 100;
    return this.add(this.createEnemy(this.villains(), this.world, point, health, kind));
  }

  /** The one way a foe joins the fight: drawn in the scene and counted among the enemies. */
  add(enemy: Enemy): Enemy {
    this.scene.add(enemy.model as Object3D);
    if (!this.enemies.includes(enemy)) this.enemies.push(enemy);
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

  /**
   * Which way a dodge goes, and whether it finds room. The way the player asks for (`wish`, an angle) if it is
   * open; otherwise out of the line of the blow that is coming: away from the foe attacking (or the nearest),
   * to whichever side has more room. A way is open when a body gets `dodgeReach` along it without meeting a wall
   * or a foe. With every way shut the hero is cornered, and the dodge only half works.
   */
  dodgeWay(feet: Vector3, wish: number | null): { angle: number; open: boolean } {
    const reach = balance.combat.dodgeReach;
    let threat: Enemy | null = null, threatD = 8;
    for (const e of this.enemies) {
      if (!e.hittable) continue;
      const d = e.controller.position.distanceTo(feet) - (e.attacking ? 4 : 0);
      if (d < threatD) { threatD = d; threat = e; }
    }
    const tries: number[] = [];
    if (wish !== null) tries.push(wish, wish + 0.5, wish - 0.5);
    if (threat) {
      const away = Math.atan2(feet.x - threat.controller.position.x, feet.z - threat.controller.position.z);
      tries.push(away + 1.1, away - 1.1, away + 0.6, away - 0.6, away, away + 1.6, away - 1.6);
    }
    // Then the whole circle, nearest first to what was asked (or to straight back from the hero's facing).
    const base = wish ?? tries[0] ?? 0;
    for (let k = 1; k <= 4; k++) tries.push(base + k * Math.PI / 4, base - k * Math.PI / 4);
    let best = tries[0]!, bestRun = -1;
    for (const angle of tries) {
      const run = this.dodgeRun(feet, angle, reach);
      if (run >= reach - 0.05) return { angle, open: true };
      if (run > bestRun) { bestRun = run; best = angle; }
    }
    return { angle: best, open: false };
  }

  /** How far a body gets along `angle` from `feet`, up to `reach`, before a wall or a foe's body. */
  private dodgeRun(feet: Vector3, angle: number, reach: number): number {
    const sx = Math.sin(angle), sz = Math.cos(angle);
    dodgeFrom.set(feet.x, feet.y + 1, feet.z);
    dodgeTo.set(feet.x + sx * reach, feet.y + 1, feet.z + sz * reach);
    const wall = this.space.obstruction(dodgeFrom, dodgeTo, balance.controller.radius + 0.1);
    let run = wall ?? reach;
    const clearance = balance.controller.radius * 2 + 0.3;
    for (const e of this.enemies) {
      if (!e.hittable) continue;
      const ex = e.controller.position.x - feet.x, ez = e.controller.position.z - feet.z;
      const along = ex * sx + ez * sz;
      if (along <= 0 || along - clearance > run) continue;
      if (Math.abs(ex * sz - ez * sx) < clearance) run = Math.min(run, Math.max(0, along - clearance));
    }
    return run;
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
    this.clearPacks();
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
    if (this.waves) {
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
    return [...this.enemies, ...this.monsters].reduce((d, e) => e.alive ? Math.min(d, e.controller.position.distanceTo(from)) : d, Infinity);
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
    return this.enemies.length + this.monsters.length > 0 && this.livingCount === 0;
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
      const cast = enemy.takeCast();
      if (cast) {
        const origin = chest(cast.origin).addScaledVector(new Vector3(Math.sin(cast.facing), 0, Math.cos(cast.facing)), 0.8);
        this.throw(launch({ side: 'villain', element: (cast.element as Element), move: 'cast', damage: cast.damage,
          origin, direction: chest(hero.position, this.a).sub(origin), speed: cast.speed, radius: 0.3, range: cast.range,
          shooter: { id: enemy.id, kind: enemy.kind } }));
      }
      if (!landed) {
        if (enemy.attacking && !this.attacker) this.attacker = enemy;
        continue;
      }
      // A swing reaches only if nothing fixed stands between the two bodies.
      const from = chest(enemy.controller.position, this.a);
      const to = chest(hero.position, this.b);
      const blockedAt = this.space.obstruction(from, to, 0.15);
      if (blockedAt !== null) {
        this.events.wallBlocked?.(from.clone().addScaledVector(to.sub(from).normalize(), blockedAt));
        continue;
      }
      this.strikeHero(enemy.controller.position, enemy.attackDamage || tuning.attackDamage, enemy.element as Element | undefined, combat, hero, enemy, { id: enemy.id, kind: enemy.kind });
    }
    for (const entry of this.packs) {
      entry.pack.update(dt, {
        position: hero.position, alive: this.heroAlive,
        takeHit: (damage, source) => {
          if (this.space.clear(chest(source), chest(hero.position), 0.15)) {
            this.strikeHero(source, damage, undefined, combat, hero, null, { kind: 'hound' });
          }
        },
      });
      const far = entry.pack.hounds.every(hound => hound.position.distanceTo(hero.position) > 180);
      if (!entry.pack.alive || far) entry.deadFor += dt;
    }
    for (let i = this.packs.length - 1; i >= 0; i--) {
      if (this.packs[i]!.deadFor < 8) continue;
      this.disposePack(this.packs[i]!.pack);
      this.packs.splice(i, 1);
    }
    for (let i = this.bulls.length - 1; i >= 0; i--) {
      const entry = this.bulls[i]!;
      entry.bull.update(dt, {
        position: hero.position, alive: this.heroAlive,
        takeHit: (damage, source) => {
          if (this.space.clear(chest(source), chest(hero.position), 0.15)) {
            this.strikeHero(source, damage, undefined, combat, hero, null, { kind: 'bull' });
          }
        },
      });
      if (!entry.bull.alive || entry.bull.position.distanceTo(hero.position) > 180) entry.deadFor += dt;
      else entry.deadFor = 0;
      if (entry.deadFor >= 8) { entry.bull.dispose(); this.bulls.splice(i, 1); }
    }
    this.flyProjectiles(dt, hero, combat, isLit);

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
        if ((dx * dx + dz * dz) > maxDist * maxDist) return false;
        // Fire on the far side of a wall, pillar or TERRA wall does not reach.
        return this.space.clear(this.a.copy(p.position).setY(PATCH_PROBE_Y), this.b.copy(enemy.controller.position).setY(enemy.controller.position.y + PATCH_PROBE_Y), 0.05);
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

    for (const hound of this.monsters) {
      if (!hound.alive) continue;
      const fire = this.burnPatches.find(p => p.active
        && Math.hypot(p.position.x - hound.position.x, p.position.z - hound.position.z) <= p.radius + this.targetBody(hound).radius
        && this.space.clear(p.position.clone().setY(p.position.y + PATCH_PROBE_Y),
          hound.position.clone().setY(hound.position.y + PATCH_PROBE_Y), 0.05));
      if (!fire) { this.houndBurns.delete(hound); continue; }
      const accumulated = (this.houndBurns.get(hound) ?? 0) + dt;
      if (accumulated < burnConfig.tickSeconds) { this.houndBurns.set(hound, accumulated); continue; }
      this.houndBurns.set(hound, accumulated - burnConfig.tickSeconds);
      this.hitMonster(hound, burnConfig.damagePerSecond * burnConfig.tickSeconds,
        hound.position.clone().setY(hound.position.y + 0.4), fire.position, fire.element);
    }
    this.strike(hero, combat, isLit);
    // Catch deaths from any source that skipped the bookkeeping above.
    for (const enemy of this.enemies) if (!enemy.alive) this.handleEnemyDefeated(enemy);
  }

  /**
   * The one judge for anything that reaches the hero: dodge, parry (melee only), guard, elemental counter, then damage.
   * A guard takes the whole hit; life drops only on a hit nothing stopped.
   */
  private strikeHero(source: Vector3, rawDamage: number, element: Element | undefined, combat: Combat, hero: HeroView, melee: Enemy | null, striker?: FightKiller): void {
    if (!this.heroAlive || combat.invulnerable) return;
    const guarded = combat.blocking && inFront(hero.position, hero.facing, source, balance.hero.blockAngle);
    if (melee && guarded && combat.blockAge <= rules.parryWindow(this.kit.hush)) {
      melee.afflict({ parried: true, stunSeconds: rules.parryStagger(this.kit.hush) });
      this.events.heroParried?.(melee);
      return;
    }
    const damage = rules.calculateDamage(rawDamage, this.heroArmour);
    const resolvedStriker = striker ?? (melee ? { id: melee.id, kind: melee.kind } : undefined);
    if (guarded && (this.guardSoak?.(damage) ?? 'held') === 'held') { this.events.heroHit(true, resolvedStriker); return; }
    if (!guarded && element && this.isAttackCountered?.(element)) { this.events.elementBlocked?.(source); return; }
    this.lastStriker = resolvedStriker ?? null;
    this.heroHealth = rules.applyDamage(this.heroHealth, damage);
    if (damage >= 14) {
      // Heavy unblocked trauma leaves scars that water healing cannot close.
      this.heroHealth = rules.inflictScars(this.heroHealth, Math.max(1, Math.round(damage * 0.18)));
    }
    if (rules.isDead(this.heroHealth)) {
      this.events.heroDied(this.lastStriker ?? undefined);
    } else {
      this.events.heroHit(false, this.lastStriker ?? undefined);
      this.events.onHurt?.(this.heroHealth.current, this.heroHealth.maximum, damage, this.lastStriker ?? undefined);
    }
  }

  private throw(p: Projectile): void {
    this.projectiles.push(p);
    this.events.projectileLaunched?.(p);
  }

  /** Moves every projectile through the world; a body it reaches first takes the hit. */
  private flyProjectiles(dt: number, hero: HeroView, combat: Combat, isLit: boolean): void {
    const heroTarget = [{ key: 'hero' as Enemy | Monster | 'hero', body: { feet: hero.position, height: balance.controller.height, radius: balance.controller.radius } }];
    const enemyTargets = [...this.enemies.filter(e => e.hittable), ...this.monsters.filter(h => h.alive)]
      .map(e => ({ key: e as Enemy | Monster | 'hero', body: this.targetBody(e) }));
    for (const p of this.projectiles) {
      const targets = p.side === 'villain' ? heroTarget : enemyTargets;
      const before = p.done;
      const hit = advance(p, dt, this.space, targets);
      if (p.side === 'villain' && p.end?.reason === 'body' && !before) {
        this.strikeHero(p.origin, p.damage, p.element, combat, hero, null, p.shooter);
      } else if (hit && hit.key !== 'hero') {
        this.landHeroMove(hit.key, p.move, p.origin, p.lit, p.swingAt, p.scale, p.chained, p.end?.at);
      }
      if (p.done && !before) this.events.projectileEnded?.(p);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i]!.done) this.projectiles.splice(i, 1);
  }

  /** A limb's path this step: from where it was to where it is now. */
  private sweep(name: string, now: Vector3 | undefined): [Vector3, Vector3] | null {
    if (!now) return null;
    const last = this.lastLimb.get(name);
    const from = last ? last.clone() : now.clone();
    if (last) last.copy(now); else this.lastLimb.set(name, now.clone());
    return [from, now];
  }

  /** Test the blade, limb, or projectile against every villain while the swing is live. */
  private strike(hero: HeroView, combat: Combat, isLit = false): void {
    const move = combat.current;
    const sweeps = {
      hand_r: this.sweep('hand_r', hero.handR), hand_l: this.sweep('hand_l', hero.handL),
      foot_r: this.sweep('foot_r', hero.footR), foot_l: this.sweep('foot_l', hero.footL),
    };
    if (!move || !combat.striking || !this.heroAlive) return;
    const limb = combat.strikingLimb;
    if (limb === 'blade' && (combat.fightingStyle === 'bare_hands' || combat.fightingStyle === 'legs')) return;

    // A thrown move leaves the hand once per swing, as a real projectile.
    if (limb === 'projectile') {
      if (this.launchedSwing === combat.swing) return;
      this.launchedSwing = combat.swing;
      let reach = 8;
      try { reach = rules.moveFor(move as MoveId, this.kit).reach; } catch { /* not a rules move */ }
      const forward = new Vector3(Math.sin(hero.facing), 0, Math.cos(hero.facing));
      // Bending leaves from the throwing hand; without a hand to read, from in front of the chest.
      const hand = combat.castingHand === 'hand_l' ? hero.handL : hero.handR;
      const origin = hand ? hand.clone().addScaledVector(forward, 0.15) : chest(hero.position).addScaledVector(forward, 0.7);
      this.throw(launch({ side: 'hero', element: this.kit.element, move, damage: 0, origin, direction: forward,
        speed: 16, radius: 0.35, range: reach, swingAt: Math.min(combat.swingAt, this.clock),
        scale: this.bend.scale, chained: this.bend.chained, lit: isLit }));
      return;
    }

    const heroChest = chest(hero.position, this.a);
    for (const enemy of [...this.enemies, ...this.monsters]) {
      const hound = isMonster(enemy);
      if (hound ? !enemy.alive || this.houndSwings.get(enemy) === combat.swing
        : !enemy.hittable || enemy.lastSwing === combat.swing) continue;
      const body = this.targetBody(enemy);
      let connects = false;
      if (limb === 'hand_r' || limb === 'hand_l' || limb === 'foot_r' || limb === 'foot_l') {
        const path = sweeps[limb];
        const foot = limb === 'foot_r' || limb === 'foot_l';
        const knee = limb === 'foot_r' ? hero.kneeR : limb === 'foot_l' ? hero.kneeL : undefined;
        const size = foot ? (move === 'leg_heavy_1' ? 0.35 : 0.28) : 0.26;
        connects = !!path && (limbTouchesCapsule(path[0], size, body.feet, body.height, body.radius, path[1])
          || (!!knee && limbTouchesCapsule(knee, size, body.feet, body.height, body.radius, path[1])));
      } else if (limb === 'blade') {
        connects = bladeTouches(hero.bladeBase, hero.bladeTip, body.feet, body.height, body.radius);
      } else if (limb === 'area') {
        let reach = 2.8;
        try { reach = rules.moveFor(move as MoveId, this.kit).reach; } catch { /* not a rules move */ }
        connects = hero.position.distanceTo(enemy.controller.position) <= reach + body.radius
          && inFront(hero.position, hero.facing, enemy.controller.position, bendArc(move));
      }
      if (!connects) continue;
      // Nothing reaches through a wall, pillar or TERRA wall.
      if (!this.space.clear(heroChest, chest(enemy.controller.position, this.b), 0.12)) continue;
      if (isMonster(enemy)) this.houndSwings.set(enemy, combat.swing);
      else enemy.lastSwing = combat.swing;
      const contact = limb === 'blade' ? hero.bladeTip : limb === 'hand_r' ? hero.handR : limb === 'hand_l' ? hero.handL
        : limb === 'foot_r' ? hero.footR : limb === 'foot_l' ? hero.footL : undefined;
      this.landHeroMove(enemy, move, hero.position, isLit, Math.min(combat.swingAt, this.clock), this.bend.scale, this.bend.chained,
        contact instanceof Vector3 ? contact : undefined);
    }
  }

  /** The rules judge a hero move that reached a villain, then the villain takes it. */
  private landHeroMove(enemy: Enemy | Monster, move: string, from: Vector3, isLit: boolean, swingAt: number,
    bendScale: number, chained: boolean, hitPos?: Vector3): void {
    const result = rules.checkHit({
      attacker: { ...this.combatant(this.kit.element, from, this.heroHealth, 0), weapon: this.kit.weapon },
      target: this.combatant(tuning.element as Element, enemy.controller.position,
        isMonster(enemy) ? { current: enemy.health, maximum: enemy.maxHealth } : enemy.health,
        isMonster(enemy) ? 0 : tuning.armour),
      moveId: move, now: this.clock, state: this.heroState, swingAt,
      isLit, bendScale, chained, situation: { isFullMoon: this.isFullMoon },
    });
    if (!result.accepted) return;
    this.heroState = result.state;
    const elemental = isBendMove(move) || (isLit && (move.startsWith('leg_') || move.startsWith('bare_')));
    if (isMonster(enemy)) {
      this.hitMonster(enemy, Math.max(0, enemy.health - result.target.health.current),
        hitPos ?? enemy.position.clone().setY(enemy.position.y + 0.5), from, elemental ? this.kit.element : undefined);
      return;
    }
    const effect = elemental
      ? afflictionFor(this.kit.element, move, from, enemy.controller.position, Math.min(1, bendScale))
      : null;
    if (effect && result.target.health.current > 0) enemy.afflict(effect);
    const prevHp = enemy.health.current;
    const killed = enemy.hurt(result.target.health, move, from, isLit);
    const damageDealt = Math.max(1, Math.round(prevHp - result.target.health.current));
    const isCrit = isLit || move.startsWith('heavy') || move === 'uppercut' || move === 'ground_pound' || move === 'ultimate';
    if (killed) {
      this.handleEnemyDefeated(enemy);
      this.events.enemyHit(enemy, true, damageDealt, hitPos ?? enemy.controller.position, isCrit, elemental);
    } else {
      if (enemy === this.attacker) this.release();
      this.events.enemyHit(enemy, false, damageDealt, hitPos ?? enemy.controller.position, isCrit, elemental);
    }
  }

  private hitMonster(hound: Monster, damage: number, at: Vector3, from: Vector3, element?: Element): void {
    const result = hound.hit(damage, at, from, element);
    this.events.monsterHit?.(hound, !hound.alive, result.damage, at, result.isWeakSpot, element !== undefined);
  }

  /**
   * A straight bolt (lightning): it runs until the world stops it and hits every villain on the way.
   * Returns where it ended, for the picture.
   */
  beam(origin: Vector3, facing: number, reach: number, damage: number, stunSeconds: number): Vector3 {
    const forward = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    const from = chest(origin);
    const to = from.clone().addScaledVector(forward, reach);
    const stop = this.space.obstruction(from, to, 0.1) ?? reach;
    const end = from.clone().addScaledVector(forward, stop);
    for (const enemy of this.enemies) {
      if (!enemy.hittable) continue;
      const at = chest(enemy.controller.position);
      const along = at.clone().sub(from).dot(forward);
      if (along < 0 || along > stop + enemy.body.radius) continue;
      const off = at.clone().sub(from).addScaledVector(forward, -along).setY(0).length();
      if (off > enemy.body.radius + 0.6) continue;
      const killed = enemy.hurt({ current: Math.max(0, enemy.health.current - damage), maximum: enemy.health.maximum }, 'lightning', origin, true);
      enemy.afflict({ stunSeconds });
      if (killed) this.handleEnemyDefeated(enemy);
      this.events.enemyHit(enemy, killed, damage, at, true, true);
    }
    for (const hound of this.monsters) {
      if (!hound.alive) continue;
      const body = this.targetBody(hound);
      const at = hound.position.clone().setY(hound.position.y + body.height * 0.5);
      const along = at.clone().sub(from).dot(forward);
      if (along < 0 || along > stop + body.radius) continue;
      if (at.clone().sub(from).addScaledVector(forward, -along).setY(0).length() > body.radius + 0.6) continue;
      this.hitMonster(hound, damage, at, origin, this.kit.element);
    }
    return end;
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
    this.lastStriker = null;
    // In town the world carries on: whoever killed you, and anything he holds of yours, is still out there.
    if (!this.waves) return;

    // In the arena a fall restarts the current round attempt.
    this.clearPacks();
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies.length = 0;
    this.villainBurns.clear();
    for (const p of this.burnPatches) p.active = false;
    this.spawnedInRound = 0;
    this.killedInRound = 0;
    this.roundIntermission = 0;
    if (this.waves) {
      this.respawnIn = [0.8];
      this.events.roundStarted?.(this.currentRoundNumber, this.roundVillainTarget);
    }
  }

  /** The attacking villain is done; the others wait a beat before taking a turn. */
  private release(): void {
    this.attacker = null;
    this.gap = tuning.groupAttackGap;
  }

  dispose(): void {
    this.clearPacks();
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
    this.add(this.createEnemy(this.villains(), this.world, point, tuning.maxHealth, this.pickKind()));
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
