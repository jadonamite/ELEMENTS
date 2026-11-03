import type {
  OutlawDecider,
  OutlawDecision,
  OutlawLimits,
  OutlawSenses,
  RobberGangState,
} from './types.js';

export class RuleDecider implements OutlawDecider {
  decide(gang: RobberGangState, senses: OutlawSenses, limits: OutlawLimits): OutlawDecision {
    const { playerCarry, playerLocation, timeOfDay, sentriesNear, sentryDistance } = senses;
    const playerId = playerCarry.accountId;
    const memory = gang.memories[playerId];

    // 1. Sentries or guards nearby: robbers never strike near authority
    if (sentriesNear || sentryDistance < limits.sentrySafeDistance) {
      return {
        action: 'ignore',
        reason: `Sentries near (${sentryDistance.toFixed(1)}m); robbers hold back in shadows`,
      };
    }

    // 2. Flee check: if gang is currently fighting and taking heavy casualties
    const aliveMembers = gang.members.filter((m) => m.state !== 'dead');
    if (aliveMembers.length === 0) {
      return { action: 'ignore', reason: 'All gang members dead' };
    }

    const totalHealth = aliveMembers.reduce((sum, m) => sum + m.health, 0);
    const maxTotalHealth = aliveMembers.reduce((sum, m) => sum + m.maxHealth, 0);
    const healthFraction = maxTotalHealth > 0 ? totalHealth / maxTotalHealth : 0;

    if (gang.state === 'ambushing' || gang.state === 'fleeing') {
      if (aliveMembers.length <= Math.ceil(gang.members.length * 0.5) || healthFraction < limits.fleeHealthFraction) {
        return {
          action: 'flee',
          reason: `Gang losing (health ${Math.round(healthFraction * 100)}%, ${aliveMembers.length} left); breaking off to alleys`,
        };
      }
    }

    // 3. Player memory check: if the player previously beat this gang, fear score makes them avoid
    if (memory && memory.fearScore >= 40) {
      return {
        action: 'ignore',
        reason: `Remembers player ${playerId} who defeated them ${memory.timesBeaten} time(s); avoiding confrontation`,
      };
    }

    // 4. Carry assessment: check if the mark is worth robbing
    // If carrying under minCarryThreshold (e.g. 20 CHROMA): ignore completely!
    if (playerCarry.chroma < limits.minCarryThreshold) {
      return {
        action: 'ignore',
        reason: `Target carry (${playerCarry.chroma} CHROMA) below threshold (${limits.minCarryThreshold}); pockets too light to risk`,
      };
    }

    // 5. High carry (e.g. 500 CHROMA) draw:
    const isNight = timeOfDay === 'night' || senses.hour < 6 || senses.hour >= 20;
    const isAlleyOrDeadEnd = playerLocation.zoneType === 'alley' || playerLocation.zoneType === 'dead_end';
    const isRoadOut = playerLocation.zoneType === 'road_out_of_town';

    // 6. Action progression: Shadow -> Call Members -> Ambush
    if (playerCarry.chroma >= limits.highCarryThreshold) {
      // Bolder at night, in alleys or on the road out of town
      if (isAlleyOrDeadEnd || isRoadOut || isNight) {
        const ambushSpot = {
          x: playerLocation.x + (Math.random() - 0.5) * 4,
          z: playerLocation.z + (Math.random() - 0.5) * 4,
        };

        if (gang.state === 'idle') {
          return {
            action: 'shadow',
            targetId: playerId,
            ambushSpot,
            reason: `Target carrying heavy purse (${playerCarry.chroma} CHROMA) at ${timeOfDay}; shadowing mark`,
          };
        }

        if (gang.state === 'shadowing') {
          return {
            action: 'call_members',
            targetId: playerId,
            ambushSpot,
            reason: `Target in ${playerLocation.zoneType}; signaling gang members to surround target`,
          };
        }

        return {
          action: 'ambush',
          targetId: playerId,
          ambushSpot,
          reason: `Target trapped in ${playerLocation.zoneType} at ${timeOfDay} carrying ${playerCarry.chroma} CHROMA; launching ambush`,
        };
      }
    }

    // Moderate carry: day/night odds
    const odds = isNight ? limits.nightAmbushOdds : limits.dayAmbushOdds;
    if (Math.random() < odds && (isAlleyOrDeadEnd || isRoadOut)) {
      return {
        action: 'ambush',
        targetId: playerId,
        ambushSpot: { x: playerLocation.x, z: playerLocation.z },
        reason: `Opportunistic ambush in ${playerLocation.zoneType} (carry ${playerCarry.chroma} CHROMA, hour ${senses.hour})`,
      };
    }

    return {
      action: 'ignore',
      reason: `Holding in hideout; conditions not favorable (odds ${odds}, zone ${playerLocation.zoneType})`,
    };
  }
}
