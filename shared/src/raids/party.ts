import { fail, ok, type LootRule, type Result } from './config.js';

export interface PartyInvite {
  accountId: string;
  invitedBy: string;
  expiresAt: number;
}

export interface Party {
  id: string;
  leaderId: string;
  /** Members in join order; the leader is always among them. */
  members: string[];
  invites: PartyInvite[];
  lootRule: LootRule;
  /** Kinds each member has said they need, for the "need" rule. */
  needs: Record<string, string[]>;
  /** Set while the party is inside a raid: nobody joins and the loot rule cannot change. */
  inRaid: string | null;
  disbanded: boolean;
}

export interface PartyRules {
  maxSize: number;
  inviteSeconds: number;
  lootRules: readonly LootRule[];
}

export function createParty(id: string, leaderId: string): Party {
  return { id, leaderId, members: [leaderId], invites: [], lootRule: 'equal', needs: {}, inRaid: null, disbanded: false };
}

const live = (p: Party, now: number): PartyInvite[] => p.invites.filter((i) => i.expiresAt > now);

/** Any member may invite while there is room counting open invites; nobody joins mid-raid. */
export function invite(p: Party, by: string, target: string, now: number, rules: PartyRules): Result<Party> {
  if (p.disbanded) return fail('The party has broken up');
  if (!p.members.includes(by)) return fail('Only a member can invite');
  if (p.members.includes(target)) return fail('Already in the party');
  if (p.inRaid) return fail('Nobody can join while the party is in a raid');
  const invites = live(p, now).filter((i) => i.accountId !== target);
  if (p.members.length + invites.length >= rules.maxSize) return fail(`A party holds ${rules.maxSize} at most`);
  return ok({ ...p, invites: [...invites, { accountId: target, invitedBy: by, expiresAt: now + rules.inviteSeconds * 1000 }] });
}

export function accept(p: Party, target: string, now: number, rules: PartyRules): Result<Party> {
  if (p.disbanded) return fail('The party has broken up');
  const inv = live(p, now).find((i) => i.accountId === target);
  if (!inv) return fail('No open invite');
  if (p.inRaid) return fail('Nobody can join while the party is in a raid');
  if (p.members.length >= rules.maxSize) return fail('The party is full');
  return ok({ ...p, members: [...p.members, target], invites: live(p, now).filter((i) => i.accountId !== target) });
}

export function decline(p: Party, target: string): Party {
  return { ...p, invites: p.invites.filter((i) => i.accountId !== target) };
}

/** Leaving passes the lead to the longest-standing member; the last one out ends the party. */
export function leave(p: Party, member: string): Result<Party> {
  if (!p.members.includes(member)) return fail('Not in the party');
  const members = p.members.filter((m) => m !== member);
  const needs = { ...p.needs };
  delete needs[member];
  if (members.length === 0) return ok({ ...p, members, needs, invites: [], disbanded: true });
  const leaderId = p.leaderId === member ? members[0]! : p.leaderId;
  return ok({ ...p, members, needs, leaderId });
}

export function kick(p: Party, by: string, member: string): Result<Party> {
  if (by !== p.leaderId) return fail('Only the leader can remove someone');
  if (by === member) return fail('The leader leaves instead of kicking themself');
  if (p.inRaid) return fail('Nobody can be removed in the middle of a raid');
  return leave(p, member);
}

export function promote(p: Party, by: string, member: string): Result<Party> {
  if (by !== p.leaderId) return fail('Only the leader can hand over the lead');
  if (!p.members.includes(member)) return fail('Not in the party');
  return ok({ ...p, leaderId: member });
}

/** The split is agreed before entering and fixed for the whole raid. */
export function setLootRule(p: Party, by: string, rule: LootRule, rules: PartyRules): Result<Party> {
  if (by !== p.leaderId) return fail('Only the leader sets the loot split');
  if (!rules.lootRules.includes(rule)) return fail('Unknown loot rule');
  if (p.inRaid) return fail('The split is fixed once the party is inside');
  return ok({ ...p, lootRule: rule });
}

export function setNeeds(p: Party, member: string, kinds: string[]): Result<Party> {
  if (!p.members.includes(member)) return fail('Not in the party');
  if (p.inRaid) return fail('Needs are declared before entering');
  return ok({ ...p, needs: { ...p.needs, [member]: [...new Set(kinds)] } });
}
