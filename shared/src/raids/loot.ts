import type { Bag, ItemKindDef, LootEntry, LootRule } from './config.js';
import { rollInt, type Rng } from './rng.js';

export interface LootItem {
  kind: string;
  qty: number;
}

/** Rolls one table: each entry drops on its own chance, between min and max of the kind. */
export function rollLoot(table: readonly LootEntry[], rng: Rng): LootItem[] {
  const out: LootItem[] = [];
  for (const e of table) {
    if (rng() < e.chance) out.push({ kind: e.item, qty: rollInt(rng, e.min, e.max) });
  }
  return out;
}

export function bagAdd(bag: Bag, kind: string, qty: number): Bag {
  const next = { ...bag, [kind]: (bag[kind] ?? 0) + qty };
  if (next[kind]! <= 0) delete next[kind];
  return next;
}

export function bagFrom(items: readonly LootItem[]): Bag {
  return items.reduce<Bag>((b, i) => bagAdd(b, i.kind, i.qty), {});
}

export function bagValue(bag: Bag, kinds: Record<string, ItemKindDef>): number {
  return Object.entries(bag).reduce((v, [k, q]) => v + (kinds[k]?.basePrice ?? 0) * q, 0);
}

/** Single units, most valuable first, ties broken by name so the split is the same everywhere. */
function units(items: readonly LootItem[], kinds: Record<string, ItemKindDef>): string[] {
  const list: string[] = [];
  for (const i of items) for (let n = 0; n < i.qty; n++) list.push(i.kind);
  return list.sort((a, b) => (kinds[b]?.basePrice ?? 0) - (kinds[a]?.basePrice ?? 0) || a.localeCompare(b));
}

export interface SplitOptions {
  leaderId: string;
  needs?: Record<string, string[]>;
  /** For the "leader" rule: who the leader gave each kind to. Anything not given stays with the leader. */
  leaderAssign?: Record<string, string>;
}

/**
 * Splits a haul among the players who finished the raid. Hired fighters are paid wages, not shares.
 * - equal: each unit goes to whoever holds the least value so far, so no two shares differ by more than one unit's value.
 * - need: a unit goes to a member who declared that kind (least value first among them); undeclared units are split equally.
 * - leader: the leader's assignments, the rest to the leader.
 */
export function splitLoot(items: readonly LootItem[], members: readonly string[], rule: LootRule,
  kinds: Record<string, ItemKindDef>, opts: SplitOptions): Record<string, Bag> {
  const shares: Record<string, Bag> = Object.fromEntries(members.map((m) => [m, {}]));
  if (members.length === 0) return shares;
  const value: Record<string, number> = Object.fromEntries(members.map((m) => [m, 0]));
  const give = (m: string, kind: string): void => {
    shares[m] = bagAdd(shares[m]!, kind, 1);
    value[m]! += kinds[kind]?.basePrice ?? 0;
  };
  const poorest = (among: readonly string[]): string =>
    among.reduce((best, m) => (value[m]! < value[best]! ? m : best), among[0]!);

  if (rule === 'leader') {
    const leader = members.includes(opts.leaderId) ? opts.leaderId : members[0]!;
    for (const u of units(items, kinds)) {
      const to = opts.leaderAssign?.[u];
      give(to && members.includes(to) ? to : leader, u);
    }
    return shares;
  }
  for (const u of units(items, kinds)) {
    if (rule === 'need') {
      const needers = members.filter((m) => opts.needs?.[m]?.includes(u));
      if (needers.length) { give(poorest(needers), u); continue; }
    }
    give(poorest(members), u);
  }
  return shares;
}
