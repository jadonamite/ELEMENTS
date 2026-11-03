import type {
  DeserterBandState,
  GangMember,
  OutlawDecision,
  PlayerCarry,
  PlayerLocation,
} from './types.js';

export interface DeserterTuning {
  bandSizeMin: number;
  bandSizeMax: number;
  litFraction: number;
  roadReachDistance: number;
  baseHealth: number;
  weapons: Array<'sword' | 'club'>;
}

export const DESERTER_DEFAULTS: DeserterTuning = {
  bandSizeMin: 3,
  bandSizeMax: 5,
  litFraction: 0.20,
  roadReachDistance: 30,
  baseHealth: 140,
  weapons: ['sword'],
};

export function createDeserterBand(
  id: string,
  name: string,
  campLocation = { x: 200, z: 5 },
  tuning = DESERTER_DEFAULTS,
  memberCount?: number
): DeserterBandState {
  const count = memberCount ?? tuning.bandSizeMin + Math.floor(Math.random() * (tuning.bandSizeMax - tuning.bandSizeMin + 1));
  const maxLit = Math.max(1, Math.floor(count * tuning.litFraction));
  let litAssigned = 0;

  const members: GangMember[] = [];
  for (let i = 0; i < count; i++) {
    const isLit = litAssigned < maxLit && (i === 0 || Math.random() < tuning.litFraction);
    if (isLit) litAssigned++;

    members.push({
      id: `${id}_d${i + 1}`,
      name: `${name} Deserter ${i + 1}`,
      isLit,
      element: isLit ? 'IGNIS' : undefined,
      weapon: 'sword', // Deserters from the Lord's army are well-armed with swords
      health: tuning.baseHealth,
      maxHealth: tuning.baseHealth,
      state: 'idle',
    });
  }

  return {
    id,
    name,
    campLocation,
    members,
    state: 'patrolling',
  };
}

export function evaluateDeserterAmbush(
  band: DeserterBandState,
  playerCarry: PlayerCarry,
  playerLocation: PlayerLocation,
  reachDistance = DESERTER_DEFAULTS.roadReachDistance
): OutlawDecision {
  // Deserters operate on the road out of Sindr toward the border forts
  const isRoad = playerLocation.zoneType === 'road_out_of_town';
  const dx = playerLocation.x - band.campLocation.x;
  const dz = playerLocation.z - band.campLocation.z;
  const dist = Math.hypot(dx, dz);

  if (!isRoad && dist > reachDistance) {
    return {
      action: 'ignore',
      reason: `Target outside deserter road reach (${dist.toFixed(1)}m from camp)`,
    };
  }

  const alive = band.members.filter((m) => m.state !== 'dead');
  if (alive.length <= 1) {
    return {
      action: 'flee',
      reason: 'Deserter band shattered; retreating into rocky crags',
    };
  }

  return {
    action: 'ambush',
    targetId: playerCarry.accountId,
    ambushSpot: { x: playerLocation.x, z: playerLocation.z },
    reason: `Traveller on road out of Sindr intercepted by deserter patrol (${dist.toFixed(1)}m from road camp)`,
  };
}
