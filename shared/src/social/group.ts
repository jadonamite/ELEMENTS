import { fail, ok, type Rank, type Result, type SocialConfig, type VaultRight } from './config.js';

export type GroupKind = 'guild' | 'clan';

export interface Member { accountId: string; rank: Rank; joinedAt: number }

export interface Banner { field: string; device: string }

export interface Group {
  id: string;
  name: string;
  tag: string;
  kind: GroupKind;
  leaderId: string;
  members: Member[];
  invites: string[];
  vault: { chroma: number; items: Record<string, number> };
  vaultRights: Record<Rank, VaultRight>;
  /** Today's withdrawals per member, reset each game day. */
  withdrawnToday: Record<string, number>;
  /** Plot id to who paid for it. Land stays with the group whoever paid. */
  land: Record<string, string>;
  banner: Banner;
  foundedAt: number;
  disbanded: boolean;
}

const rankOrder: Rank[] = ['leader', 'officer', 'member', 'recruit'];
const outranks = (a: Rank, b: Rank): boolean => rankOrder.indexOf(a) < rankOrder.indexOf(b);

export function maxMembers(g: Pick<Group, 'kind'>, cfg: SocialConfig): number {
  return g.kind === 'clan' ? cfg.clan.maxMembers : cfg.guild.maxMembers;
}

/** The pooled land limit: so many plots per member, up to the size's cap. */
export function landLimit(g: Pick<Group, 'kind' | 'members'>, cfg: SocialConfig): number {
  const c = g.kind === 'clan' ? cfg.clan : cfg.guild;
  return Math.min(c.landCap, g.members.length * c.landPerMember);
}

export function rankOf(g: Group, id: string): Rank | null {
  return g.members.find((m) => m.accountId === id)?.rank ?? null;
}

/** Names and tags: length limits, letters, digits, spaces and apostrophes only, unique ignoring case, no banished words. */
export function checkName(name: string, tag: string, taken: { names: readonly string[]; tags: readonly string[] }, cfg: SocialConfig): string | null {
  const n = name.trim(), t = tag.trim();
  if (n.length < cfg.guild.nameMin || n.length > cfg.guild.nameMax) return `A name is ${cfg.guild.nameMin} to ${cfg.guild.nameMax} letters`;
  if (t.length < cfg.guild.tagMin || t.length > cfg.guild.tagMax) return `A tag is ${cfg.guild.tagMin} to ${cfg.guild.tagMax} letters`;
  if (!/^[A-Za-z0-9' ]+$/.test(n) || !/^[A-Za-z0-9]+$/.test(t)) return 'Letters and numbers only';
  if (taken.names.some((x) => x.toLowerCase() === n.toLowerCase())) return 'That name is taken';
  if (taken.tags.some((x) => x.toLowerCase() === t.toLowerCase())) return 'That tag is taken';
  const lower = n.toLowerCase();
  if (cfg.bannedNameWords.some((w) => lower.includes(w.toLowerCase()))) return 'The Edict forbids that name';
  return null;
}

/** Founding costs a great deal of CHROMA (LORE 13). The cost leaves the founder's purse; the caller moves the coin. */
export function foundGuild(p: { id: string; name: string; tag: string; founder: string; founderChroma: number; founderGroup: string | null; banner: Banner; now: number; taken: { names: readonly string[]; tags: readonly string[] } }, cfg: SocialConfig): Result<{ group: Group; cost: number }> {
  if (p.founderGroup) return fail('Leave your current group first');
  const bad = checkName(p.name, p.tag, p.taken, cfg);
  if (bad) return fail(bad);
  if (p.founderChroma < cfg.guild.foundCost) return fail(`Founding a guild costs ${cfg.guild.foundCost} CHROMA`);
  return ok({
    cost: cfg.guild.foundCost,
    group: {
      id: p.id, name: p.name.trim(), tag: p.tag.trim().toUpperCase(), kind: 'guild', leaderId: p.founder,
      members: [{ accountId: p.founder, rank: 'leader', joinedAt: p.now }], invites: [],
      vault: { chroma: 0, items: {} }, vaultRights: structuredClone(cfg.vaultDefaults), withdrawnToday: {},
      land: {}, banner: p.banner, foundedAt: p.now, disbanded: false,
    },
  });
}

/** Leader and officers invite. Anyone may join: any nation, Lit or Dim. */
export function inviteToGroup(g: Group, by: string, target: string, targetGroup: string | null, cfg: SocialConfig): Result<Group> {
  const r = rankOf(g, by);
  if (r !== 'leader' && r !== 'officer') return fail('Only the leader and officers invite');
  if (targetGroup) return fail('They already belong to a group');
  if (g.members.length + g.invites.length >= maxMembers(g, cfg)) return fail(`A ${g.kind} holds ${maxMembers(g, cfg)} at most`);
  if (g.invites.includes(target)) return ok(g);
  return ok({ ...g, invites: [...g.invites, target] });
}

export function joinGroup(g: Group, target: string, now: number, cfg: SocialConfig): Result<Group> {
  if (g.disbanded) return fail('That group is gone');
  if (!g.invites.includes(target)) return fail('No invite');
  if (g.members.length >= maxMembers(g, cfg)) return fail('Full');
  return ok({ ...g, invites: g.invites.filter((i) => i !== target), members: [...g.members, { accountId: target, rank: 'recruit', joinedAt: now }] });
}

/**
 * A member who leaves or is thrown out takes nothing from the vault, and land they paid for stays with the group (LORE 13).
 * The leader must hand over the lead first, unless they are the last one, which ends the group.
 */
export function leaveGroup(g: Group, member: string): Result<Group> {
  if (!rankOf(g, member)) return fail('Not a member');
  if (g.leaderId === member && g.members.length > 1) return fail('Hand over the lead before leaving');
  const members = g.members.filter((m) => m.accountId !== member);
  const withdrawnToday = { ...g.withdrawnToday };
  delete withdrawnToday[member];
  return ok({ ...g, members, withdrawnToday, disbanded: members.length === 0 });
}

export function expel(g: Group, by: string, member: string): Result<Group> {
  const a = rankOf(g, by), b = rankOf(g, member);
  if (!a || !b) return fail('Not a member');
  if (by === member) return fail('Leave instead');
  if (!(a === 'leader' || a === 'officer') || !outranks(a, b)) return fail('You can only throw out someone below you');
  return leaveGroup(g, member);
}

export function setRank(g: Group, by: string, member: string, rank: Rank): Result<Group> {
  if (by !== g.leaderId) return fail('Only the leader sets ranks');
  if (!rankOf(g, member)) return fail('Not a member');
  if (rank === 'leader') {
    return ok({ ...g, leaderId: member, members: g.members.map((m) => m.accountId === member ? { ...m, rank: 'leader' } : m.accountId === by ? { ...m, rank: 'officer' } : m) });
  }
  if (member === by) return fail('Hand the lead to someone else first');
  return ok({ ...g, members: g.members.map((m) => (m.accountId === member ? { ...m, rank } : m)) });
}

/** The leader decides who can take what (LORE 13). */
export function setVaultRight(g: Group, by: string, rank: Rank, right: VaultRight): Result<Group> {
  if (by !== g.leaderId) return fail('Only the leader sets vault rights');
  if (rank === 'leader') return fail('The leader always has the whole vault');
  return ok({ ...g, vaultRights: { ...g.vaultRights, [rank]: right } });
}

export function deposit(g: Group, by: string, chroma: number, items: Record<string, number> = {}): Result<Group> {
  if (!rankOf(g, by)) return fail('Not a member');
  if (!Number.isInteger(chroma) || chroma < 0) return fail('Bad amount');
  const next = { ...g.vault.items };
  for (const [k, q] of Object.entries(items)) {
    if (!Number.isInteger(q) || q <= 0) return fail('Bad item count');
    next[k] = (next[k] ?? 0) + q;
  }
  return ok({ ...g, vault: { chroma: g.vault.chroma + chroma, items: next } });
}

/** Withdrawals follow the member's rank: a daily CHROMA allowance (-1 is unlimited) and whether they may take items. */
export function withdraw(g: Group, by: string, chroma: number, items: Record<string, number> = {}): Result<Group> {
  const r = rankOf(g, by);
  if (!r) return fail('Not a member');
  const right = r === 'leader' ? { chromaPerDay: -1, items: true } : g.vaultRights[r];
  if (!Number.isInteger(chroma) || chroma < 0) return fail('Bad amount');
  if (chroma > g.vault.chroma) return fail('The vault does not hold that much');
  const used = g.withdrawnToday[by] ?? 0;
  if (right.chromaPerDay >= 0 && used + chroma > right.chromaPerDay) return fail(`Your rank may take ${right.chromaPerDay} a day`);
  const next = { ...g.vault.items };
  for (const [k, q] of Object.entries(items)) {
    if (!right.items) return fail('Your rank may not take items');
    if (!Number.isInteger(q) || q <= 0 || (next[k] ?? 0) < q) return fail('The vault does not hold that');
    next[k] = next[k]! - q;
    if (next[k] === 0) delete next[k];
  }
  return ok({ ...g, vault: { chroma: g.vault.chroma - chroma, items: next }, withdrawnToday: { ...g.withdrawnToday, [by]: used + chroma } });
}

export function newDay(g: Group): Group { return { ...g, withdrawnToday: {} }; }

/** A guild becomes a clan by upgrading, which costs more again (LORE 13). Paid from the vault. */
export function upgradeToClan(g: Group, by: string, cfg: SocialConfig): Result<{ group: Group; cost: number }> {
  if (by !== g.leaderId) return fail('Only the leader can upgrade');
  if (g.kind === 'clan') return fail('Already a clan');
  if (g.members.length < cfg.clan.minMembersToUpgrade) return fail(`A clan needs ${cfg.clan.minMembersToUpgrade} members first`);
  if (g.vault.chroma < cfg.clan.upgradeCost) return fail(`The vault needs ${cfg.clan.upgradeCost} CHROMA`);
  return ok({ cost: cfg.clan.upgradeCost, group: { ...g, kind: 'clan', vault: { ...g.vault, chroma: g.vault.chroma - cfg.clan.upgradeCost } } });
}

/** A plot joins the group's land if the pooled limit has room; who paid is kept on record only. */
export function addLand(g: Group, by: string, plotId: string, cfg: SocialConfig): Result<Group> {
  const r = rankOf(g, by);
  if (r !== 'leader' && r !== 'officer') return fail('Only the leader and officers add land');
  if (g.land[plotId]) return fail('Already the group\'s');
  if (Object.keys(g.land).length >= landLimit(g, cfg)) return fail('The group holds all the land it may');
  return ok({ ...g, land: { ...g.land, [plotId]: by } });
}

/** The banner shown above a member's head, or none. */
export function bannerFor(groups: readonly Group[], accountId: string): { tag: string; banner: Banner } | null {
  const g = groups.find((x) => !x.disbanded && x.members.some((m) => m.accountId === accountId));
  return g ? { tag: g.tag, banner: g.banner } : null;
}
