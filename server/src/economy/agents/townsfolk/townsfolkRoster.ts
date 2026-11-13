import type { PlanPhase } from '@elements/shared';

export interface TownsfolkDefinition {
  id: string;
  name: string;
  role: 'guard' | 'smith' | 'innkeeper' | 'porter' | 'worshipper' | 'master';
  placeId: string;
  personality: string;
  defaultRoutines: Record<PlanPhase, string>;
  allowedActions: string[];
}

export const SINDR_TOWNSFOLK: TownsfolkDefinition[] = [
  {
    id: 'guard_sindr',
    name: 'Garrison Sentry Boris',
    role: 'guard',
    placeId: 'sindr_market',
    personality: 'Vigilant guard loyal to the Lord. Suspicious of weapons drawn in the square.',
    defaultRoutines: {
      morning: 'Inspect watch posts and verify market stalls have opened peacefully.',
      midday: 'Patrol perimeter of counting house and watch for pickpockets.',
      evening: 'Ensure merchants pack wares safely as dusk settles.',
      night: 'Bar market gates and challenge anyone lurking after dark.',
    },
    allowedActions: ['patrol', 'challenge', 'fine', 'call_reinforcements'],
  },
  {
    id: 'smith_sindr',
    name: 'Master Dim Smith Orin',
    role: 'smith',
    placeId: 'sindr_market',
    personality: 'Blunt, master craftsman of the forge. Values durable steel over empty talk.',
    defaultRoutines: {
      morning: 'Stoke the forge hearth and inspect incoming ingots from the carts.',
      midday: 'Hammer blade blanks and fit leather grips for city guards.',
      evening: 'Quench tools, temper weapon edges, and bank the forge fire.',
      night: 'Lock forge racks and tally daily coal and shard consumption.',
    },
    allowedActions: ['forge', 'repair', 'inspect_ore'],
  },
  {
    id: 'innkeeper_sindr',
    name: 'Innkeeper Martha',
    role: 'innkeeper',
    placeId: 'sindr_inn',
    personality: 'Warm but shrewd tavern keeper. Hears every rumour before the bells chime noon.',
    defaultRoutines: {
      morning: 'Air out common room and take bread deliveries from the bakery.',
      midday: 'Serve stew to merchants and caravan hands resting from the road.',
      evening: 'Stoke taproom hearth, pour spiced ale, and share news of the roads.',
      night: 'Bolt tavern doors and settle ledger accounts by candle.',
    },
    allowedActions: ['serve', 'share_gossip', 'sell_lodging'],
  },
  {
    id: 'porter_sindr',
    name: 'Darius the Porter',
    role: 'porter',
    placeId: 'sindr_market',
    personality: 'Strong, quiet hauler who moves crates between cart bays and market stalls.',
    defaultRoutines: {
      morning: 'Unload morning tribute carts and stack crates by the shard counter.',
      midday: 'Haul grain and water barrels to the garrison stables.',
      evening: 'Stack empty crates under the awning and grease cart axles.',
      night: 'Rest aching shoulders by the brazier at the western gate.',
    },
    allowedActions: ['haul', 'restack', 'report_arrival'],
  },
  {
    id: 'worshipper_sindr',
    name: 'Elder Althea',
    role: 'worshipper',
    placeId: 'sindr_market',
    personality: 'Devout attendant of the central shrine. Speaks softly of balance and quiet embers.',
    defaultRoutines: {
      morning: 'Light morning embers in the brazier and sweep stone sanctuary steps.',
      midday: 'Chant litanies of endurance and offer quiet blessings to passing travelers.',
      evening: 'Tend twilight incense and gather oil lamps across the plaza.',
      night: 'Maintain eternal flame and offer shelter to weary souls.',
    },
    allowedActions: ['bless', 'meditate', 'tend_flame'],
  },
  {
    id: 'master_ignis',
    name: 'Battlemaster Theresa',
    role: 'master',
    placeId: 'sindr_arena',
    personality: 'Stern fighting master of the Crimson order. Demands discipline and precise footwork.',
    defaultRoutines: {
      morning: 'Drill morning recruits in stance transitions and parry timing.',
      midday: 'Inspect sparring arena sand and test practice blades for balance.',
      evening: 'Evaluate trial contenders and give stern advice to hopefuls.',
      night: 'Review combat scrolls and meditate on martial technique.',
    },
    allowedActions: ['train', 'evaluate_trial', 'critique_form'],
  },
];
