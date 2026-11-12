import { SpeechMemory, SpeechRules, type Criterion, type Facts, type SpeechRule, type SpeechTier } from './speech.js';

export interface PlayerDialogueContext {
  name: string;
  isLit: boolean;
  role: 'Shaper' | 'Dim' | 'Hush';
  element: string;
  carriedItemsCount?: number;
  redFlags?: number;
  hasBounty?: boolean;
  feelingScore?: number; // 0 to 100, neutral is 50 (LORE 15)
}

export interface SpeakerDialogueContext {
  id: string;
  role: string; // e.g. 'smith_sindr', 'trader_sindr', 'innkeeper_sindr', 'guard_sindr', 'worshipper_sindr', 'porter_sindr', 'child_sindr'
  nation?: string;
  mood?: 'neutral' | 'friendly' | 'wary' | 'hostile';
  timeOfDay?: 'day' | 'dusk' | 'night' | 'dawn';
}

export type DialogueEventType = 'greeting' | 'talk' | 'lead_inquiry' | 'rumour_allborn' | 'heavy_pack' | 'dusk' | 'night';

export interface DialogueMemory {
  feelingScores: Map<string, number>; // npcId -> score (0..100)
  speech: SpeechMemory;
}

export function createDialogueMemory(): DialogueMemory {
  return {
    feelingScores: new Map(),
    speech: new SpeechMemory(),
  };
}

/** dialogue.json: speaker group -> situation -> lines. Lines are spoken as written by recorded voices, so they hold no blanks. */
type DialogueTable = Record<string, Record<string, unknown>>;

/** What the player asked about in a conversation. */
export type TalkTopic = 'greeting' | 'lead' | 'allborn';

const TOPIC: Record<DialogueEventType, TalkTopic> = {
  greeting: 'greeting', talk: 'greeting', heavy_pack: 'greeting', dusk: 'greeting', night: 'greeting',
  lead_inquiry: 'lead', rumour_allborn: 'allborn',
};

/**
 * Situations in dialogue.json read as conditions of the "talk" concept. Weights set which situation wins
 * when several hold: a bounty over a red flag over the topic asked over a bare shelf over the hour over
 * moving prices over a heavy pack over who the player is. Stall facts come from stall-talk.ts when a stall
 * opens. Situations not listed are concepts of their own (sale_made, fee_rising, ...).
 */
const TALK_SITUATIONS: Record<string, readonly Criterion[]> = {
  bounty: [{ fact: 'player.bounty', value: true, weight: 12 }],
  red_flag: [{ fact: 'player.redFlags', op: '>=', value: 1, weight: 10 }],
  sell_lead: [{ fact: 'topic', value: 'lead', weight: 8 }],
  rumour_allborn: [{ fact: 'topic', value: 'allborn', weight: 8 }],
  allborn_hint: [{ fact: 'topic', value: 'allborn', weight: 8 }],
  out_of_stock: [{ fact: 'stall.emptyShelf', value: true, weight: 7 }],
  prices_rising: [{ fact: 'stall.prices', value: 'rising', weight: 5 }],
  prices_falling: [{ fact: 'stall.prices', value: 'falling', weight: 5 }],
  night: [{ fact: 'time', value: 'night', weight: 6 }],
  dusk: [{ fact: 'time', value: 'dusk', weight: 6 }],
  heavy_pack: [{ fact: 'player.carried', op: '>=', value: 4, weight: 4 }],
  greeting_lit_ignis: [{ fact: 'player.lit', value: true }, { fact: 'player.element', value: 'IGNIS' }],
  greeting_outsider_lit: [{ fact: 'player.lit', value: true }, { fact: 'player.element', op: '!=', value: 'IGNIS' }],
  greeting_outsider: [{ fact: 'player.lit', value: true }, { fact: 'player.element', op: '!=', value: 'IGNIS' }],
  greeting_dim: [{ fact: 'player.lit', value: false, weight: 2 }],
  greeting_local: [],
};

/**
 * Things a townsperson sees happen, each a concept of its own heard by everyone near it. Guards answer a
 * fight, a theft or a red flag as alerts (they may cut a reaction); everyone else reacts. A speaker
 * reacts to the same kind of event at most once per WITNESS_COOLDOWN_SECONDS, and once anyone has
 * called out an event, nobody else repeats that kind for WITNESS_ECHO_SECONDS.
 */
const WITNESS: Record<string, SpeechTier> = {
  fight_started: 'reaction', theft_seen: 'reaction', red_flag_raised: 'reaction', loot_dropped: 'reaction', flee: 'reaction',
};
const ALERT_ROLES = new Set(['guard_sindr', 'sentry']);
const ALERT_SITUATIONS = new Set(['fight_started', 'theft_seen', 'red_flag_raised', 'flee']);
export const WITNESS_COOLDOWN_SECONDS = 20;
export const WITNESS_ECHO_SECONDS = 6;

/** Lines a villain says to the hero's face: calling them out, the answer, the gang running in. Never cut by chatter. */
const CALLOUTS = new Set(['challenge_issued', 'challenge_accepted', 'challenge_refused', 'gang_arrives']);
/** Lines said across a counter to the player dealing with the speaker: part of that exchange, like a conversation. */
const COUNTER = new Set(['sale_made']);

/** Every situation in the dialogue table as a speech rule, conditioned on the speaker group. */
export function rulesFromDialogue(table: DialogueTable): SpeechRule[] {
  const rules: SpeechRule[] = [];
  for (const [role, block] of Object.entries(table)) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const [situation, lines] of Object.entries(block)) {
      if (!Array.isArray(lines)) continue;
      const talk = TALK_SITUATIONS[situation];
      const witness = WITNESS[situation];
      if (witness) {
        const said = `said.${situation}`;
        const heard = `heard.${situation}`;
        rules.push({
          id: `${role}/${situation}`,
          concept: situation,
          criteria: [{ fact: 'who', value: role }, { fact: `self.${said}`, op: '!=', value: true }, { fact: `world.${heard}`, op: '!=', value: true }],
          lines: lines as string[],
          tier: ALERT_ROLES.has(role) && ALERT_SITUATIONS.has(situation) ? 'alert' : witness,
          remember: [{ fact: said, seconds: WITNESS_COOLDOWN_SECONDS }, { fact: heard, seconds: WITNESS_ECHO_SECONDS, scope: 'world' }],
        });
        continue;
      }
      rules.push({
        id: `${role}/${situation}`,
        concept: talk ? 'talk' : situation,
        criteria: [{ fact: 'who', value: role }, ...(talk ?? [])],
        lines: lines as string[],
        tier: talk || COUNTER.has(situation) ? 'conversation' : CALLOUTS.has(situation) ? 'alert' : 'ambient',
      });
    }
  }
  return rules;
}

/** Facts for a conversation with one speaker. */
export function talkFacts(speaker: SpeakerDialogueContext, player: PlayerDialogueContext, topic: TalkTopic = 'greeting'): Facts {
  const redFlags = player.redFlags ?? 0;
  return {
    who: speaker.role,
    topic,
    time: speaker.timeOfDay ?? 'day',
    feeling: player.feelingScore ?? 50,
    'player.lit': player.isLit && player.role === 'Shaper',
    'player.role': player.role,
    'player.element': player.element,
    'player.redFlags': redFlags,
    'player.bounty': Boolean(player.hasBounty) || redFlags >= 3,
    'player.carried': player.carriedItemsCount ?? 0,
  };
}

const rulesByTable = new WeakMap<object, SpeechRules>();

/** The speech rules built over a dialogue table, built once per table. */
export function dialogueRules(table: DialogueTable): SpeechRules {
  let rules = rulesByTable.get(table);
  if (!rules) rulesByTable.set(table, (rules = new SpeechRules(rulesFromDialogue(table))));
  return rules;
}

/**
 * The line a speaker says when the player talks to them, from the speech rules built over dialogue.json.
 * Never the same line twice in a row for one speaker when memory is given.
 */
export function pickDialogueLine(
  dialogueTable: DialogueTable,
  speaker: SpeakerDialogueContext,
  player: PlayerDialogueContext,
  event: DialogueEventType = 'greeting',
  memory?: DialogueMemory,
): { text: string; category: string; line: string } {
  const rules = dialogueRules(dialogueTable);
  const at = event === 'dusk' || event === 'night' ? { ...speaker, timeOfDay: event } : speaker;
  const facts = { ...talkFacts(at, player, TOPIC[event]), feeling: player.feelingScore ?? memory?.feelingScores.get(speaker.id) ?? 50 };
  const said = rules.speak({ concept: 'talk', speakerId: speaker.id, facts }, memory?.speech);
  if (!said) return { text: 'Greetings, traveler.', category: 'fallback', line: 'Greetings, traveler.' };
  return { text: said.line, category: said.rule.id.slice(said.rule.id.indexOf('/') + 1), line: said.line };
}
