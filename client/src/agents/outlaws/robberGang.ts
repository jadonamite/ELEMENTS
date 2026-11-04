import type RAPIER from '@dimforge/rapier3d-compat';
import { Group, Scene, Vector3 } from 'three';
import {
  type GangMember,
  type OutlawDecision,
  type OutlawLimits,
  type OutlawSenses,
  type PlayerCarry,
  type PlayerLocation,
  type RobberGangState,
  RuleDecider,
  createRobberGang,
  recordPlayerDefeat,
  recordPlayerFled,
  sellToFence,
} from '../../../../shared/src/agents/index.js';
import balance from '../../../../shared/balance.json';
import { Enemy, type EnemyTemplate, type Quarry } from '../../enemy.js';

const outlawTuning = (balance.monsters as Record<string, unknown>)?.outlaws as {
  robberGangs?: OutlawLimits;
} | undefined;

export const DEFAULT_ROBBER_LIMITS: OutlawLimits = outlawTuning?.robberGangs ?? {
  gangSizeMin: 2,
  gangSizeMax: 4,
  maxLitFraction: 0.20,
  sentrySafeDistance: 25,
  minCarryThreshold: 50,
  highCarryThreshold: 300,
  dayAmbushOdds: 0.15,
  nightAmbushOdds: 0.85,
  fleeHealthFraction: 0.30,
  reachDistance: 20,
  ambushCooldownSeconds: 45,
};

export interface RobberGangOptions {
  id?: string;
  name?: string;
  hideout?: { x: number; z: number; name: string };
  limits?: OutlawLimits;
  onKill?: ((kind: string, position: { x: number; y: number; z: number }) => void) | undefined;
  onAlert?: ((message: string) => void) | undefined;
  onSpawnEnemy?: ((enemy: Enemy) => void) | undefined;
  onDespawnEnemy?: ((enemy: Enemy) => void) | undefined;
}

export class ClientRobberGang {
  readonly state: RobberGangState;
  readonly decider = new RuleDecider();
  readonly limits: OutlawLimits;
  readonly activeEnemies: Map<string, Enemy> = new Map();
  private scene: Scene | null = null;
  private world: RAPIER.World | null = null;
  private template: EnemyTemplate | null = null;
  private evaluateTimer = 0;
  private ambushCooldown = 0;
  private lastDecision: OutlawDecision | null = null;
  onKill?: ((kind: string, position: { x: number; y: number; z: number }) => void) | undefined;
  onAlert?: ((message: string) => void) | undefined;
  onSpawnEnemy?: ((enemy: Enemy) => void) | undefined;
  onDespawnEnemy?: ((enemy: Enemy) => void) | undefined;

  constructor(options: RobberGangOptions = {}) {
    this.limits = options.limits ?? DEFAULT_ROBBER_LIMITS;
    this.state = createRobberGang(
      options.id ?? 'sindr_alleys_gang',
      options.name ?? 'Sindr Alley Cutthroats',
      options.hideout ?? { x: 110, z: -15, name: 'Sindr Alley Hideout' },
      this.limits
    );
    this.onKill = options.onKill;
    this.onAlert = options.onAlert;
    this.onSpawnEnemy = options.onSpawnEnemy;
    this.onDespawnEnemy = options.onDespawnEnemy;
  }

  get decision(): OutlawDecision | null {
    return this.lastDecision;
  }

  bindWorld(scene: Scene, world: RAPIER.World, template: EnemyTemplate): void {
    this.scene = scene;
    this.world = world;
    this.template = template;
  }

  evaluate(senses: OutlawSenses): OutlawDecision {
    const decision = this.decider.decide(this.state, senses, this.limits);
    this.lastDecision = decision;

    if (decision.action === 'ambush' && this.ambushCooldown <= 0 && this.state.state !== 'ambushing') {
      this.state.state = 'ambushing';
      this.state.currentTargetId = senses.playerCarry.accountId;
      this.spawnAmbush(senses.playerLocation);
      this.onAlert?.(`Robbers strike from the alley shadows! (${decision.reason})`);
    } else if (decision.action === 'flee' && this.state.state !== 'fleeing') {
      this.state.state = 'fleeing';
      for (const enemy of this.activeEnemies.values()) {
        enemy.flee();
      }
      this.onAlert?.(`Robbers are losing and fleeing back to their hideout!`);
      // Record defeat in memory
      recordPlayerDefeat(this.state, senses.playerCarry.accountId);
    } else if (decision.action === 'shadow') {
      this.state.state = 'shadowing';
      this.state.currentTargetId = senses.playerCarry.accountId;
    } else if (decision.action === 'call_members') {
      this.state.state = 'calling_members';
      this.state.currentTargetId = senses.playerCarry.accountId;
    } else if (decision.action === 'ignore' && this.state.state !== 'ambushing') {
      this.state.state = 'idle';
      this.state.currentTargetId = null;
    }

    return decision;
  }

  spawnAmbush(playerLoc: PlayerLocation): void {
    if (!this.scene || !this.world || !this.template) return;

    // Despawn any existing enemies
    this.despawn();

    // Members close in from all sides, evenly spread, the outer ones a step further back.
    const count = this.state.members.length;
    for (let i = 0; i < count; i++) {
      const member = this.state.members[i]!;
      const angle = (i / count) * Math.PI * 2 + 0.4;
      const spawnDist = 4.5 + (i % 2) * 2;
      const sx = playerLoc.x + Math.sin(angle) * spawnDist;
      const sz = playerLoc.z + Math.cos(angle) * spawnDist;

      const kind = member.isLit ? 'bender' : 'robber';
      const enemy = new Enemy(
        this.template,
        this.world,
        { x: sx, z: sz },
        member.maxHealth,
        kind,
        false
      );

      enemy.onKill = (k, pos) => {
        member.state = 'dead';
        member.health = 0;
        this.onKill?.(k, pos);
      };

      this.scene.add(enemy.model);
      this.activeEnemies.set(member.id, enemy);
      this.onSpawnEnemy?.(enemy);
    }
  }

  update(dt: number, quarry: Quarry, senses?: OutlawSenses): void {
    this.evaluateTimer += dt;
    this.ambushCooldown = Math.max(0, this.ambushCooldown - dt);

    if (senses && this.evaluateTimer >= 1.0) {
      this.evaluateTimer = 0;
      this.evaluate(senses);
    }

    // Step active enemies
    let anyAlive = false;
    let anyStruggling = false;

    for (const [id, enemy] of this.activeEnemies.entries()) {
      if (enemy.alive) {
        anyAlive = true;
        if (!this.onSpawnEnemy) {
          enemy.step(quarry, true);
        }
        if (enemy.health.current < enemy.health.maximum * this.limits.fleeHealthFraction) {
          anyStruggling = true;
        }
      }
    }

    // If gang was ambushing and all are dead or struggling, trigger flee
    if (this.state.state === 'ambushing' && (!anyAlive || anyStruggling)) {
      if (anyStruggling && anyAlive) {
        for (const enemy of this.activeEnemies.values()) {
          enemy.flee();
        }
        this.state.state = 'fleeing';
        this.ambushCooldown = this.limits.ambushCooldownSeconds ?? 45;
        if (senses) {
          recordPlayerDefeat(this.state, senses.playerCarry.accountId);
        }
      }
    }
  }

  draw(delta: number, alpha: number): void {
    for (const enemy of this.activeEnemies.values()) {
      enemy.draw(delta, alpha);
    }
  }

  despawn(): void {
    for (const enemy of this.activeEnemies.values()) {
      this.onDespawnEnemy?.(enemy);
      enemy.dispose();
    }
    this.activeEnemies.clear();
  }

  dispose(): void {
    this.despawn();
  }
}
