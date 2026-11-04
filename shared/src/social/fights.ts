import type { Duel } from './duel.js';
import { atWar, type War } from './war.js';

export type ZoneLaw = 'town' | 'road' | 'chromara' | 'lawless';

export type LootTaken = 'stake' | 'materials' | 'full';

export interface FightContext {
  attacker: string;
  defender: string;
  attackerGroup: string | null;
  defenderGroup: string | null;
  zone: ZoneLaw;
  wars: readonly War[];
  duels: readonly Duel[];
  /** True when the defender struck first (self-defence carries no flag). */
  defenderStarted?: boolean;
}

/**
 * What a fight between two players costs.
 * - An accepted duel: no flag, only the stake changes hands.
 * - Groups at war: no flag (LORE 13); the loser drops the materials they carry, as in any world fight.
 * - Marked lawless zones: no flag, full looting (LORE 11); players enter knowing it.
 * - Anywhere else: attacking first is an evil deed and earns a red flag (LORE 10); the loser drops materials.
 */
export function fightConsequence(c: FightContext): { redFlag: boolean; loot: LootTaken; why: string } {
  const duel = c.duels.some((d) => d.state === 'accepted' && ((d.challenger === c.attacker && d.target === c.defender) || (d.challenger === c.defender && d.target === c.attacker)));
  if (duel) return { redFlag: false, loot: 'stake', why: 'An accepted duel' };
  if (c.zone === 'lawless') return { redFlag: false, loot: 'full', why: 'A lawless zone' };
  if (atWar(c.wars, c.attackerGroup, c.defenderGroup)) return { redFlag: false, loot: 'materials', why: 'A declared war' };
  if (c.defenderStarted) return { redFlag: false, loot: 'materials', why: 'Self-defence' };
  return { redFlag: true, loot: 'materials', why: 'An unprovoked attack' };
}
