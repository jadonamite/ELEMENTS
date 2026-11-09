import { SpeechMemory, SpeechRules, type Criterion, type Facts, type SpeechRule } from './speech.js';

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

/** Formats template string with player/speaker variables. */
export function formatDialogueText(
  template: string,
  player: PlayerDialogueContext,
  speaker?: SpeakerDialogueContext,
): string {
  let result = template;
  result = result.replaceAll('{player}', player.name || 'traveler');
  result = result.replaceAll('{nation}', player.element || 'IGNIS');
  result = result.replaceAll('{coin}', 'CHROMA');
  return result;
}

type DialogueTable = Record<string, Record<string, string[] | string>>;

/** What the player asked about in a conversation. */
export type TalkTopic = 'greeting' | 'lead' | 'allborn';

const TOPIC: Record<DialogueEventType, TalkTopic> = {
  greeting: 'greeting', talk: 'greeting', heavy_pack: 'greeting', dusk: 'greeting', night: 'greeting',
  lead_inquiry: 'lead', rumour_allborn: 'allborn',
};

/**
 * Situations in dialogue.json read as conditions of the "talk" concept. Weights set which situation wins
 * when several hold: a bounty over a red flag over the topic asked over the hour over a heavy pack over
 * who the player is. Situations not listed are concepts of their own (sale_made, fee_rising, ...).
 */
const TALK_SITUATIONS: Record<string, readonly Criterion[]> = {
  bounty: [{ fact: 'player.bounty', value: true, weight: 12 }],
  red_flag: [{ fact: 'player.redFlags', op: '>=', value: 1, weight: 10 }],
  sell_lead: [{ fact: 'topic', value: 'lead', weight: 8 }],
  rumour_allborn: [{ fact: 'topic', value: 'allborn', weight: 8 }],
  allborn_hint: [{ fact: 'topic', value: 'allborn', weight: 8 }],
  night: [{ fact: 'time', value: 'night', weight: 6 }],
  dusk: [{ fact: 'time', value: 'dusk', weight: 6 }],
  heavy_pack: [{ fact: 'player.carried', op: '>=', value: 4, weight: 4 }],
  greeting_lit_ignis: [{ fact: 'player.lit', value: true }, { fact: 'player.element', value: 'IGNIS' }],
  greeting_outsider_lit: [{ fact: 'player.lit', value: true }, { fact: 'player.element', op: '!=', value: 'IGNIS' }],
  greeting_outsider: [{ fact: 'player.lit', value: true }, { fact: 'player.element', op: '!=', value: 'IGNIS' }],
  greeting_dim: [{ fact: 'player.lit', value: false, weight: 2 }],
  greeting_local: [],
};

/** Every situation in the dialogue table as a speech rule, conditioned on the speaker group. */
export function rulesFromDialogue(table: DialogueTable): SpeechRule[] {
  const rules: SpeechRule[] = [];
  for (const [role, block] of Object.entries(table)) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const [situation, lines] of Object.entries(block)) {
      if (!Array.isArray(lines)) continue;
      const talk = TALK_SITUATIONS[situation];
      rules.push({
        id: `${role}/${situation}`,
        concept: talk ? 'talk' : situation,
        criteria: [{ fact: 'who', value: role }, ...(talk ?? [])],
        lines,
        tier: talk ? 'conversation' : 'ambient',
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
  let rules = rulesByTable.get(dialogueTable);
  if (!rules) rulesByTable.set(dialogueTable, (rules = new SpeechRules(rulesFromDialogue(dialogueTable))));
  const at = event === 'dusk' || event === 'night' ? { ...speaker, timeOfDay: event } : speaker;
  const facts = { ...talkFacts(at, player, TOPIC[event]), feeling: player.feelingScore ?? memory?.feelingScores.get(speaker.id) ?? 50 };
  const said = rules.speak({ concept: 'talk', speakerId: speaker.id, facts }, memory?.speech);
  if (!said) {
    const text = `Greetings, ${player.name || 'traveler'}.`;
    return { text, category: 'fallback', line: text };
  }
  const text = formatDialogueText(said.line, player, speaker);
  return { text, category: said.rule.id.slice(said.rule.id.indexOf('/') + 1), line: said.line };
}
