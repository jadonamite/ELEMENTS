import {
  type DayNightConfig,
  nightnessAt,
  NIGHT_FROM,
  sindrStreet,
  sindrSentryDistance,
  standOff,
  type RobberGangState,
  type OutlawSenses,
  type OutlawLimits,
  type OutlawDecision,
  RuleDecider,
  createRobberGang,
  recordPlayerDefeat,
  recordPlayerFled,
  GANG_DEFAULTS,
} from '@elements/shared';
import { balance } from './balance.js';
import { ServerEnemy } from './enemies.js';
import type { EnemyKind } from './zones.js';
import type { ServerPlayer, ZoneWorld } from './world.js';
import type { ZoneEconomy } from './zone-economy.js';

const outlawTuning = (balance.monsters as Record<string, unknown>)?.outlaws as {
  robberGangs?: OutlawLimits;
} | undefined;

export const DEFAULT_ROBBER_LIMITS: OutlawLimits = outlawTuning?.robberGangs ?? GANG_DEFAULTS;

/** A robber gang run by the server in online zones, visible and identical for all players. */
export class ServerRobberGang {
  readonly state: RobberGangState;
  readonly decider = new RuleDecider();
  readonly limits: OutlawLimits;
  readonly activeEnemyIds = new Set<string>();
  private evaluateTimer = 0;
  private ambushCooldown = 0;
  private fleeTimer = 0;
  private lastDecision: OutlawDecision | null = null;
  private readonly deadTimers = new Map<string, number>();

  constructor(
    id = 'sindr_alleys_gang',
    name = 'Sindr Alley Cutthroats',
    hideout = { x: 110, z: -15, name: 'Sindr Alley Hideout' },
    limits: OutlawLimits = DEFAULT_ROBBER_LIMITS,
  ) {
    this.limits = limits;
    this.state = createRobberGang(id, name, hideout, this.limits);
  }

  get decision(): OutlawDecision | null {
    return this.lastDecision;
  }

  evaluate(senses: OutlawSenses): OutlawDecision {
    const decision = this.decider.decide(this.state, senses, this.limits);
    this.lastDecision = decision;
    return decision;
  }

  spawnAmbush(player: ServerPlayer, world: ZoneWorld): void {
    this.despawn(world);
    this.state.state = 'ambushing';
    this.state.currentTargetId = player.accountId;

    const count = this.state.members.length;
    for (let i = 0; i < count; i++) {
      const member = this.state.members[i]!;
      const angle = (i / count) * Math.PI * 2 + 0.4;
      const spawnDist = 4.5 + (i % 2) * 2;
      const pos = standOff({ x: player.x, z: player.z }, angle, spawnDist, 0.5);

      const kind: EnemyKind = member.isLit ? 'armed' : 'robber';
      const enemy = new ServerEnemy({
        id: member.id,
        kind,
        x: pos.x,
        z: pos.z,
      });

      enemy.target = player.id;
      member.maxHealth = enemy.tune.maxHealth;
      enemy.hp = enemy.tune.maxHealth;
      member.health = enemy.hp;
      member.state = 'fighting';

      world.enemies.set(member.id, enemy);
      this.activeEnemyIds.add(member.id);
    }
  }

  update(
    dt: number,
    _now: number,
    world: ZoneWorld,
    economy: ZoneEconomy,
    clockMinute: number,
    dayNight: DayNightConfig = balance.world.dayNight,
  ): string[] {
    const notices: string[] = [];
    this.ambushCooldown = Math.max(0, this.ambushCooldown - dt);
    this.evaluateTimer += dt;

    // Clean up dead members after 6 seconds so clients finish the death animation
    for (const [id, timer] of this.deadTimers.entries()) {
      const remaining = timer - dt;
      if (remaining <= 0) {
        this.deadTimers.delete(id);
        world.enemies.delete(id);
        this.activeEnemyIds.delete(id);
      } else {
        this.deadTimers.set(id, remaining);
      }
    }

    if (this.state.state === 'ambushing') {
      let aliveCount = 0;
      let totalHealth = 0;
      let maxTotalHealth = 0;

      for (const member of this.state.members) {
        const enemy = world.enemies.get(member.id);
        if (enemy && enemy.alive) {
          aliveCount++;
          member.state = 'fighting';
          member.health = enemy.hp;
          totalHealth += enemy.hp;
          maxTotalHealth += enemy.tune.maxHealth;
        } else {
          if (member.state !== 'dead') {
            member.state = 'dead';
            member.health = 0;
            this.deadTimers.set(member.id, 6);
          }
        }
      }

      const healthFraction = maxTotalHealth > 0 ? totalHealth / maxTotalHealth : 0;

      const target = this.state.currentTargetId
        ? [...world.players.values()].find((p) => p.accountId === this.state.currentTargetId && p.alive)
        : null;

      if (!target && this.state.currentTargetId) {
        recordPlayerFled(this.state, this.state.currentTargetId, Date.now());
        this.state.state = 'fleeing';
        this.fleeTimer = 0;
        for (const id of this.activeEnemyIds) {
          world.enemies.get(id)?.flee();
        }
      } else if (aliveCount === 0) {
        if (this.state.currentTargetId) {
          recordPlayerDefeat(this.state, this.state.currentTargetId, Date.now());
        }
        this.state.state = 'idle';
        this.state.currentTargetId = null;
        this.ambushCooldown = this.limits.ambushCooldownSeconds ?? 45;
        this.activeEnemyIds.clear();
      } else if (aliveCount <= Math.ceil(this.state.members.length * 0.5) || healthFraction < this.limits.fleeHealthFraction) {
        this.state.state = 'fleeing';
        this.fleeTimer = 0;
        this.ambushCooldown = this.limits.ambushCooldownSeconds ?? 45;
        for (const id of this.activeEnemyIds) {
          world.enemies.get(id)?.flee();
        }
        if (this.state.currentTargetId) {
          recordPlayerDefeat(this.state, this.state.currentTargetId, Date.now());
        }
        notices.push('Robbers are losing and fleeing back to their hideout!');
      }

      return notices;
    }

    if (this.state.state === 'fleeing') {
      this.fleeTimer += dt;
      let allFarOrDead = true;

      for (const id of this.activeEnemyIds) {
        const enemy = world.enemies.get(id);
        if (enemy && enemy.alive) {
          const distToHideout = Math.hypot(enemy.x - this.state.hideout.x, enemy.z - this.state.hideout.z);
          if (distToHideout > 2) {
            allFarOrDead = false;
          }
        }
      }

      if (this.fleeTimer >= 15 || allFarOrDead) {
        for (const id of this.activeEnemyIds) {
          world.enemies.delete(id);
        }
        this.activeEnemyIds.clear();
        this.state.state = 'idle';
        this.state.currentTargetId = null;
      }

      return notices;
    }

    if (this.evaluateTimer >= 1.0) {
      this.evaluateTimer = 0;

      const nightness = nightnessAt(clockMinute, dayNight);
      const isNight = nightness >= NIGHT_FROM;
      const hour = isNight ? 23 : 14;
      const timeOfDay: 'day' | 'night' = isNight ? 'night' : 'day';

      let targetPlayer: ServerPlayer | null = null;
      let bestCarry = -1;

      for (const player of world.players.values()) {
        if (!player.alive) continue;
        const carry = economy.carried(player);
        if (carry.chroma > bestCarry) {
          bestCarry = carry.chroma;
          targetPlayer = player;
        }
      }

      if (!targetPlayer) {
        this.state.state = 'idle';
        this.state.currentTargetId = null;
        return notices;
      }

      const carry = economy.carried(targetPlayer);
      const zoneType = sindrStreet(targetPlayer.x, targetPlayer.z);
      const sentryDistance = sindrSentryDistance(targetPlayer.x);
      const sentriesNear = sentryDistance < this.limits.sentrySafeDistance;

      const senses: OutlawSenses = {
        playerCarry: {
          accountId: targetPlayer.accountId,
          chroma: carry.chroma,
          satchelWeight: carry.weight,
        },
        playerLocation: {
          x: targetPlayer.x,
          z: targetPlayer.z,
          zoneType,
        },
        timeOfDay,
        hour,
        sentriesNear,
        sentryDistance,
      };

      const decision = this.evaluate(senses);

      if (decision.action === 'ambush' && this.ambushCooldown <= 0) {
        this.spawnAmbush(targetPlayer, world);
        notices.push(`Robbers strike from the alley shadows! (${decision.reason})`);
      } else if (decision.action === 'shadow') {
        this.state.state = 'shadowing';
        this.state.currentTargetId = targetPlayer.accountId;
      } else if (decision.action === 'call_members') {
        this.state.state = 'calling_members';
        this.state.currentTargetId = targetPlayer.accountId;
      } else if (decision.action === 'ignore') {
        this.state.state = 'idle';
        this.state.currentTargetId = null;
      }
    }

    return notices;
  }

  despawn(world: ZoneWorld): void {
    for (const id of this.activeEnemyIds) {
      world.enemies.delete(id);
    }
    this.activeEnemyIds.clear();
    this.deadTimers.clear();
  }
}
