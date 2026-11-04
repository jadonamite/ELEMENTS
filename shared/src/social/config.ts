export type Rank = 'leader' | 'officer' | 'member' | 'recruit';

export interface VaultRight { chromaPerDay: number; items: boolean }

export interface SocialConfig {
  placeholder: boolean;
  guild: { maxMembers: number; foundCost: number; nameMin: number; nameMax: number; tagMin: number; tagMax: number; landPerMember: number; landCap: number };
  clan: { maxMembers: number; upgradeCost: number; minMembersToUpgrade: number; landPerMember: number; landCap: number };
  ranks: Rank[];
  vaultDefaults: Record<Rank, VaultRight>;
  war: { acceptSeconds: number; redeclareCooldownSeconds: number; minDurationSeconds: number };
  duel: { acceptSeconds: number; fleeRadius: number; disconnectForfeitSeconds: number; maxStake: number; timeLimitSeconds: number };
  bannedNameWords: string[];
}

export { ok, fail, type Result } from '../raids/config.js';
