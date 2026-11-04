import type RAPIER from '@dimforge/rapier3d-compat';
import { Scene } from 'three';
import {
  type DeserterBandState,
  type OutlawDecision,
  type PlayerCarry,
  type PlayerLocation,
  createDeserterBand,
  evaluateDeserterAmbush,
} from '../../../../shared/src/agents/index.js';
import { Enemy, type EnemyTemplate, type Quarry } from '../../enemy.js';

export interface DeserterBandOptions {
  id?: string;
  name?: string;
  campLocation?: { x: number; z: number };
  onKill?: ((kind: string, position: { x: number; y: number; z: number }) => void) | undefined;
  onAlert?: ((message: string) => void) | undefined;
  onSpawnEnemy?: ((enemy: Enemy) => void) | undefined;
  onDespawnEnemy?: ((enemy: Enemy) => void) | undefined;
}

export class ClientDeserterBand {
  readonly state: DeserterBandState;
  readonly activeEnemies: Map<string, Enemy> = new Map();
  private scene: Scene | null = null;
  private world: RAPIER.World | null = null;
  private template: EnemyTemplate | null = null;
  private evaluateTimer = 0;
  onKill?: ((kind: string, position: { x: number; y: number; z: number }) => void) | undefined;
  onAlert?: ((message: string) => void) | undefined;
  onSpawnEnemy?: ((enemy: Enemy) => void) | undefined;
  onDespawnEnemy?: ((enemy: Enemy) => void) | undefined;

  constructor(options: DeserterBandOptions = {}) {
    this.state = createDeserterBand(
      options.id ?? 'sindr_road_deserters',
      options.name ?? 'Slag Road Deserters',
      options.campLocation ?? { x: 200, z: 5 }
    );
    this.onKill = options.onKill;
    this.onAlert = options.onAlert;
    this.onSpawnEnemy = options.onSpawnEnemy;
    this.onDespawnEnemy = options.onDespawnEnemy;
  }

  bindWorld(scene: Scene, world: RAPIER.World, template: EnemyTemplate): void {
    this.scene = scene;
    this.world = world;
    this.template = template;
  }

  evaluate(playerCarry: PlayerCarry, playerLocation: PlayerLocation): OutlawDecision {
    const decision = evaluateDeserterAmbush(this.state, playerCarry, playerLocation);

    if (decision.action === 'ambush' && this.state.state !== 'ambushing') {
      this.state.state = 'ambushing';
      this.spawnAmbush(playerLocation);
      this.onAlert?.(`Deserter band attacks on the road out of Sindr! (${decision.reason})`);
    } else if (decision.action === 'flee' && this.state.state !== 'fleeing') {
      this.state.state = 'fleeing';
      for (const enemy of this.activeEnemies.values()) {
        enemy.flee();
      }
      this.onAlert?.(`Deserters broke rank and are fleeing into the rocks!`);
    }

    return decision;
  }

  spawnAmbush(playerLoc: PlayerLocation): void {
    if (!this.scene || !this.world || !this.template) return;
    this.despawn();

    const spawnDist = 5.0;
    for (let i = 0; i < this.state.members.length; i++) {
      const member = this.state.members[i]!;
      const angle = (i / this.state.members.length) * Math.PI * 2;
      const sx = playerLoc.x + Math.sin(angle) * spawnDist;
      const sz = playerLoc.z + Math.cos(angle) * spawnDist;

      const kind = member.isLit ? 'bender' : 'deserter';
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

  update(dt: number, quarry: Quarry, playerCarry?: PlayerCarry, playerLocation?: PlayerLocation): void {
    this.evaluateTimer += dt;
    if (playerCarry && playerLocation && this.evaluateTimer >= 1.0) {
      this.evaluateTimer = 0;
      this.evaluate(playerCarry, playerLocation);
    }

    for (const enemy of this.activeEnemies.values()) {
      if (enemy.alive) {
        enemy.step(quarry, true);
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
