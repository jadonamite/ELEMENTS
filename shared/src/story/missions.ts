import type { Element } from '../combat/types.js';
import { SINDR_ANCHORS } from '../world/ignis/sindr.js';

export const ARRIVAL_GRANT = 1000;
export const HOME_MEAL_PRICE = 5;
export const MEAL_ITEM = 'home_meal';
export const ARENA_TICKET = 'arena_ticket';
export const MISSION_FLAGS = [
  'training_complete', 'nation_arrival_registered', 'arrival_grant_paid', 'mission_1_complete',
  'bending_unlocked', 'meal_purchased', 'meal_eaten', 'neri_met', 'neri_search_accepted',
  'ambush_survived', 'arena_ticket_collected', 'invitation_inspected', 'mission_1a_complete',
  'hall_briefed', 'spar_completed', 'invitation_identified',
] as const;
export type MissionFlag = typeof MISSION_FLAGS[number];
export interface MissionState {
  version: 2;
  nation: Element;
  zone: 'sindr';
  flags: Record<MissionFlag, boolean>;
  checkpoint: 'arrival' | 'gate' | 'stall' | 'search' | 'aftermath' | 'hall' | 'yard';
  attempt: number;
  ambushAttempt: number;
  sparAttempt: number;
}
export type MissionEvent = 'training_complete' | 'register' | 'take_pouch' | 'buy_meal' | 'eat_meal'
  | 'meet_neri' | 'accept_search' | 'start_ambush' | 'survive_ambush' | 'collect_ticket' | 'inspect_invitation' | 'kellan_lead' | 'hall_briefing' | 'start_spar' | 'survive_spar' | 'identify_invitation';

export function freshMission(nation: Element): MissionState {
  return { version: 2, nation, zone: 'sindr', flags: Object.fromEntries(MISSION_FLAGS.map(flag => [flag, false])) as MissionState['flags'], checkpoint: 'arrival', attempt: 0, ambushAttempt: 0, sparAttempt: 0 };
}

/** Story prerequisites are independent of rendering, money and network transport. */
export function advanceMission(state: MissionState, event: MissionEvent, hush: boolean): MissionState {
  const next = { ...state, flags: { ...state.flags } };
  const f = next.flags;
  const need = (flag: MissionFlag) => { if (!f[flag]) throw new Error(`Mission requires ${flag}`); };
  switch (event) {
    case 'training_complete': f.training_complete = true; next.checkpoint = 'gate'; break;
    case 'register': need('training_complete'); f.nation_arrival_registered = true; break;
    case 'take_pouch':
      need('nation_arrival_registered'); f.arrival_grant_paid = true; f.mission_1_complete = true;
      f.bending_unlocked = !hush; next.checkpoint = 'stall'; break;
    case 'buy_meal': need('mission_1_complete'); f.meal_purchased = true; break;
    case 'eat_meal': need('meal_purchased'); f.meal_eaten = true; break;
    case 'meet_neri': need('meal_eaten'); f.neri_met = true; break;
    case 'accept_search': need('neri_met'); f.neri_search_accepted = true; next.checkpoint = 'search'; break;
    case 'start_ambush':
      need('neri_search_accepted');
      if (f.ambush_survived) throw new Error('Ambush already survived');
      next.attempt++; next.ambushAttempt++; break;
    case 'survive_ambush':
      need('neri_search_accepted'); if (state.ambushAttempt < 1) throw new Error('No ambush attempt');
      f.ambush_survived = true; next.checkpoint = 'aftermath'; break;
    case 'collect_ticket': need('ambush_survived'); f.arena_ticket_collected = true; break;
    case 'inspect_invitation': need('arena_ticket_collected'); f.invitation_inspected = true; break;
    case 'kellan_lead': need('invitation_inspected'); f.mission_1a_complete = true; next.checkpoint = 'hall'; break;
    case 'hall_briefing': need('mission_1a_complete'); f.hall_briefed = true; next.checkpoint = 'yard'; break;
    case 'start_spar': need('hall_briefed'); if (f.spar_completed) throw new Error('Spar already completed'); next.attempt++; next.sparAttempt++; break;
    case 'survive_spar': need('hall_briefed'); if (state.sparAttempt < 1) throw new Error('No spar attempt'); f.spar_completed = true; break;
    case 'identify_invitation': need('spar_completed'); need('arena_ticket_collected'); f.invitation_identified = true; break;
    default: throw new Error('Unknown mission event');
  }
  return next;
}

/** Normalize older account saves without replaying payments or removing completed progress. */
export function normalizeMission(saved: MissionState): MissionState {
  const old = saved as unknown as { flags: Record<string, boolean>; checkpoint: string };
  const state = { ...freshMission(saved.nation), ...saved, version: 2 as const, zone: 'sindr' as const, flags: { ...freshMission(saved.nation).flags, ...saved.flags } };
  if (saved.ambushAttempt === undefined) state.ambushAttempt = saved.attempt;
  if (saved.sparAttempt === undefined) state.sparAttempt = 0;
  if (old.flags.neri_delivery_accepted) state.flags.neri_search_accepted = true;
  if (old.flags.mission_1a_complete) state.flags.invitation_inspected = true;
  delete (state.flags as unknown as Record<string, boolean>).neri_delivery_accepted;
  if (old.checkpoint === 'delivery') state.checkpoint = 'search';
  if (state.flags.mission_1a_complete && !state.flags.hall_briefed) state.checkpoint = 'hall';
  return state;
}

const FOOD_STALL = SINDR_ANCHORS.find(anchor => anchor.id === 'stall_food');
if (!FOOD_STALL?.seat || !FOOD_STALL.keeper) throw new Error('Sindr food stall needs a stall, keeper and seat in its world manifest');

/** IGNIS locations use the town frame, shared by the visible scene and server checks. */
export const IGNIS_MISSION = {
  hall: { x: 125, y: 11, z: -106 },
  kellan: { x: 129, y: 11, z: -106 },
  yard: { x: 125, y: 11, z: -103 },
  seat: { ...FOOD_STALL.seat },
  gate: { x: 49, y: 0, z: 2 },
  stall: { x: FOOD_STALL.x, y: FOOD_STALL.y, z: FOOD_STALL.z },
  stallKeeper: { ...FOOD_STALL.keeper },
  neri: { x: 119, y: 0, z: 5 },
  route: [{ x: 119, y: 0, z: 3 }, { x: 145, y: 0, z: 0 }, { x: 172, y: 0, z: 0 }, { x: 199, y: 0, z: 0 }],
  ambush: { x: 199, y: 0, z: 0 },
  checkpoint: { x: 185, y: 0, z: 0 },
  cover: { x: 202, y: 0, z: 4 },
};

/** Provisional dialogue and bowl symbol, pending final story approval. */
export const MISSION_COPY = {
  registrar: 'Welcome to Sindr. Sign in or create an account to enter town.',
  pouch: 'Here, your first thousand. Get yourself something to eat.',
  clue: 'Look for a bowl above a stall in the market. They serve a hot meal there.',
  cookGreeting: 'Welcome to Sindr. A home meal is 5 CHROMA. The bench is beside the stall.',
  cookMeal: 'A home meal, made fresh. Sit by the stall and take your time.',
  neriGreeting: 'Mind if I sit here?',
  neriRapport: "I'm Neri. That stall was a good choice. I come here when I need a quiet moment. How are you finding Sindr?",
  neriRequest: "My brother Tarin went out to deliver food and hasn't come back. Would you help me look for him?",
  neriWhere: 'He was taking the road east past the market. We can look along the open road.',
  aftermath: "I don't know what the Arena is. Kellan trains people at the Master's Sparring Yard. He may be able to explain this invitation. The Master is at the Hall beside it.",
  invitation: 'Arena invitation. A folded invitation recovered from the attackers. Its purpose is unclear. There is nothing here that tells you where Tarin is.',
  master: 'Welcome back. What brings you to the Hall?',
  briefing: 'You were attacked while looking for someone? Let Kellan see the invitation. First, practise with his disciples in the court here. He will supervise.',
  spar: 'Face each disciple and watch their approach. Guard a strike, then answer while they recover. We stop when you have bested both.',
  identified: "This is an Arena invitation. It invites its bearer to compete there. I don't know Tarin, and this doesn't tell us whether he ever held it. Keep it while you look for more evidence.",
  allborn: 'Some people believe the Allborn can open a way between worlds. I have no proof. It is only a rumour.',
};
