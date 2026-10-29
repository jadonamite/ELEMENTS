import type RAPIER from '@dimforge/rapier3d-compat';
import { type Object3D, type Scene, Vector3 } from 'three';
import balance from '../../shared/balance.json';
import { createCombatRules, type ActionState, type CombatBalance, type Combatant, type Element, type Health } from '../../shared/src/index.js';
import type { Combat } from './combat.js';
import { Enemy, type EnemyTemplate } from './enemy.js';
import { bladeTouches, inFront } from './hits.js';

const rules = createCombatRules(balance.combat as unknown as CombatBalance);
const tuning = balance.enemy;
const HERO_ELEMENT: Element = 'IGNIS';

/** What the fight reads from the hero each frame. */
export interface HeroView {
  position: Vector3;
  facing: number;
  /** World-space blade ends this frame. */
  bladeBase: Vector3;
  bladeTip: Vector3;
}

export interface FightEvents {
  /** The hero was hit; `blocked` when the guard took most of it. */
  heroHit(blocked: boolean): void;
  heroDied(): void;
  /** A hero swing connected; `killed` on the final blow. */
  enemyHit(enemy: Enemy, killed: boolean): void;
}

/**
 * Runs the arena fight: keeps husks spawned, lets one attack at a time,
 * checks blade contact and applies every hit through the shared rules.
 */
export class Fight {
  readonly enemies: Enemy[] = [];
  heroHealth: Health = rules.createHealth(balance.hero.maxHealth);
  private heroState: ActionState = rules.createActionState();
  private attacker: Enemy | null = null;
  /** Seconds before the next husk may start an attack. */
  private gap = 0;
  private respawnIn: number[] = [];
  private clock = 0;

  constructor(
    private readonly template: EnemyTemplate,
    private readonly world: RAPIER.World,
    private readonly scene: Scene,
    private readonly events: FightEvents,
  ) {
    for (let i = 0; i < tuning.count; i++) this.respawnIn.push(0.6 + i * 0.9);
  }

  get heroAlive(): boolean { return this.heroHealth.current > 0; }

  /** Is the move off cooldown in the rules? The hero's combat asks before starting one. */
  ready(move: string): boolean {
    if (move === 'dodge' || move === 'hit' || move === 'death') return true;
    try {
      return rules.cooldownRemaining(move as Parameters<typeof rules.cooldownRemaining>[0], this.heroState, this.clock) === 0;
    } catch {
      return true;
    }
  }

  /** Nearest living husk in front of the hero within `range`, for aim assist. */
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

  /** Distance to the closest living husk, for the stance. */
  nearestDistance(from: Vector3): number {
    return this.enemies.reduce((d, e) => e.alive ? Math.min(d, e.controller.position.distanceTo(from)) : d, Infinity);
  }

  /** One physics step for every husk. */
  step(hero: HeroView, combat: Combat): void {
    const dt = balance.controller.fixedStep;
    this.clock += dt;
    if (this.attacker && !this.attacker.attacking) this.release();
    this.gap = Math.max(0, this.gap - dt);
    const quarry = { position: hero.position, alive: this.heroAlive };
    for (const enemy of this.enemies) {
      const may = this.attacker === enemy || (this.attacker === null && this.gap === 0);
      if (!enemy.step(quarry, may)) {
        if (enemy.attacking && !this.attacker) this.attacker = enemy;
        continue;
      }
      if (combat.invulnerable) continue;
      const guarded = combat.blocking && inFront(hero.position, hero.facing, enemy.controller.position, balance.hero.blockAngle);
      const damage = rules.calculateDamage(tuning.attackDamage, tuning.element as Element, HERO_ELEMENT) *
        (guarded ? balance.hero.blockDamageScale : 1);
      this.heroHealth = rules.applyDamage(this.heroHealth, damage);
      if (rules.isDead(this.heroHealth)) this.events.heroDied();
      else this.events.heroHit(guarded);
    }
    this.strike(hero, combat);
  }

  /** Test the blade against every husk while the swing is live. */
  private strike(hero: HeroView, combat: Combat): void {
    const move = combat.current;
    if (!move || !combat.striking || !this.heroAlive) return;
    for (const enemy of this.enemies) {
      if (!enemy.hittable || enemy.lastSwing === combat.swing) continue;
      const body = enemy.body;
      if (!bladeTouches(hero.bladeBase, hero.bladeTip, body.feet, body.height, body.radius)) continue;
      enemy.lastSwing = combat.swing;
      const result = rules.checkHit({
        attacker: this.combatant(HERO_ELEMENT, hero.position, this.heroHealth, 0),
        target: this.combatant(tuning.element as Element, enemy.controller.position, enemy.health, tuning.armour),
        moveId: move, now: this.clock, state: this.heroState, swingAt: Math.min(combat.swingAt, this.clock),
      });
      if (!result.accepted) continue;
      this.heroState = result.state;
      const killed = enemy.hurt(result.target.health);
      if (enemy === this.attacker) this.release();
      this.events.enemyHit(enemy, killed);
    }
  }

  /** Per drawn frame: animate husks, clear the fallen, bring in new ones. */
  draw(delta: number, alpha: number, heroPosition: Vector3): void {
    for (const enemy of this.enemies) enemy.draw(delta, alpha);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (!this.enemies[i]!.gone) continue;
      this.enemies[i]!.dispose();
      this.enemies.splice(i, 1);
      this.respawnIn.push(tuning.respawnSeconds);
    }
    this.respawnIn = this.respawnIn.map(t => t - delta);
    while (this.respawnIn.length && this.respawnIn[0]! <= 0 && this.enemies.length < tuning.count) {
      this.respawnIn.shift();
      this.spawn(heroPosition);
    }
  }

  /** Bring the hero back at full health; husks keep their places. */
  reviveHero(): void {
    this.heroHealth = rules.createHealth(balance.hero.maxHealth);
    this.heroState = rules.createActionState();
    this.attacker = null;
  }

  /** The attacking husk is done; the others wait a beat before taking a turn. */
  private release(): void {
    this.attacker = null;
    this.gap = tuning.groupAttackGap;
  }

  dispose(): void {
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies.length = 0;
  }

  private spawn(heroPosition: Vector3): void {
    // A point on the spawn ring, far enough from the hero not to appear on top of them.
    let point = { x: 0, z: tuning.spawnRadius };
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      point = { x: Math.cos(angle) * tuning.spawnRadius, z: Math.sin(angle) * tuning.spawnRadius };
      const clearOfHero = Math.hypot(point.x - heroPosition.x, point.z - heroPosition.z) >= tuning.minSpawnDistance;
      const clearOfRocks = balance.arena.obstacles.every(o => Math.hypot(point.x - o.x, point.z - o.z) > o.radius + 1);
      const clearOfOthers = this.enemies.every(e => Math.hypot(point.x - e.controller.position.x, point.z - e.controller.position.z) > 2);
      if (clearOfHero && clearOfRocks && clearOfOthers) break;
    }
    const enemy = new Enemy(this.template, this.world, point, tuning.maxHealth);
    this.scene.add(enemy.model as Object3D);
    this.enemies.push(enemy);
  }

  private combatant(element: Element, position: Vector3, health: Health, armour: number): Combatant {
    return { element, position: { x: position.x, y: position.y, z: position.z }, health, armour };
  }
}
