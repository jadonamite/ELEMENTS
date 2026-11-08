import fs from 'node:fs';
import { armourCatalogue, createCombatRules, type CombatBalance } from '@elements/shared';

const balancePath = new URL('../../../shared/balance.json', import.meta.url);

/** The tuning file, read once at start. */
export const balance = JSON.parse(fs.readFileSync(balancePath, 'utf8'));
export const rules = createCombatRules(balance.combat as CombatBalance);
export type CombatRules = typeof rules;

/** The armour pieces a satchel item can put on, from balance.json's economy block. */
export const armour = armourCatalogue(balance.economy?.armour);
