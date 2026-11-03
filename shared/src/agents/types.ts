export interface AgentPurse {
  balance: number;
  transactions: Array<{
    amount: number;
    reason: string;
    timestamp: number;
  }>;
}

export interface PlayerCarry {
  accountId: string;
  chroma: number;
  satchelWeight: number;
}

export type ZoneLocationType = 'alley' | 'dead_end' | 'open_street' | 'road_out_of_town' | 'safe_square';

export interface PlayerLocation {
  x: number;
  z: number;
  zoneType: ZoneLocationType;
}

export interface OutlawSenses {
  playerCarry: PlayerCarry;
  playerLocation: PlayerLocation;
  timeOfDay: 'day' | 'dusk' | 'night';
  hour: number;
  sentriesNear: boolean;
  sentryDistance: number;
}

export interface GangMember {
  id: string;
  name: string;
  isLit: boolean;
  element?: string | undefined;
  weapon: 'sword' | 'club';
  health: number;
  maxHealth: number;
  state: 'idle' | 'stalking' | 'approaching' | 'fighting' | 'fleeing' | 'dead';
}

export interface PlayerEncounterMemory {
  playerId: string;
  timesBeaten: number;
  timesPlayerFled: number;
  timesRobbed: number;
  fearScore: number;
  lastEncounter: number;
}

export interface RobberGangState {
  id: string;
  name: string;
  purse: AgentPurse;
  hideout: { x: number; z: number; name: string };
  members: GangMember[];
  memories: Record<string, PlayerEncounterMemory>;
  state: 'idle' | 'shadowing' | 'calling_members' | 'ambushing' | 'fleeing';
  currentTargetId: string | null;
  ambushSpot: { x: number; z: number } | null;
}

export type OutlawAction = 'ignore' | 'shadow' | 'call_members' | 'ambush' | 'flee' | 'fence_loot';

export interface OutlawDecision {
  action: OutlawAction;
  reason: string;
  targetId?: string | undefined;
  ambushSpot?: { x: number; z: number } | undefined;
}

export interface OutlawLimits {
  gangSizeMin: number;
  gangSizeMax: number;
  maxLitFraction: number;
  sentrySafeDistance: number;
  minCarryThreshold: number;
  highCarryThreshold: number;
  dayAmbushOdds: number;
  nightAmbushOdds: number;
  fleeHealthFraction: number;
  reachDistance: number;
  ambushCooldownSeconds?: number | undefined;
}

/**
 * Common decider interface.
 * Implemented by RuleDecider now, with NearAiDecider swappable later.
 */
export interface OutlawDecider {
  decide(gang: RobberGangState, senses: OutlawSenses, limits: OutlawLimits): OutlawDecision;
}

export interface DeserterBandState {
  id: string;
  name: string;
  campLocation: { x: number; z: number };
  members: GangMember[];
  state: 'patrolling' | 'ambushing' | 'fighting' | 'fleeing';
}
