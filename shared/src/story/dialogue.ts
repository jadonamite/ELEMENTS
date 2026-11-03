export interface PlayerDialogueContext {
  name: string;
  isLit: boolean;
  role: 'Shaper' | 'Dim';
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
  lastSpokenByNpc: Map<string, string>; // npcId -> lastLineText
  feelingScores: Map<string, number>; // npcId -> score (0..100)
}

export function createDialogueMemory(): DialogueMemory {
  return {
    lastSpokenByNpc: new Map(),
    feelingScores: new Map(),
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

/**
 * Line picker reading dialogue.json that picks by who speaks, who you are,
 * what you visibly carry, red flags, bounty, and time of day.
 * Guaranteed never to return the same line twice in a row for the speaker.
 */
export function pickDialogueLine(
  dialogueTable: Record<string, Record<string, string[] | string>>,
  speaker: SpeakerDialogueContext,
  player: PlayerDialogueContext,
  event: DialogueEventType = 'greeting',
  memory?: DialogueMemory,
): { text: string; category: string } {
  const block = dialogueTable[speaker.role];
  if (!block) {
    return { text: `Greetings, ${player.name || 'traveler'}.`, category: 'fallback' };
  }

  // Determine category priority based on player state and context:
  let targetCategory = 'greeting_lit_ignis';
  const redFlags = player.redFlags ?? 0;
  const hasBounty = player.hasBounty || redFlags >= 3;
  const carriedCount = player.carriedItemsCount ?? 0;
  const time = speaker.timeOfDay ?? 'day';

  // 1. Bounty: highest priority alert
  if (hasBounty && block.bounty && Array.isArray(block.bounty)) {
    targetCategory = 'bounty';
  }
  // 2. Red flag: active warning
  else if (redFlags > 0 && block.red_flag && Array.isArray(block.red_flag)) {
    targetCategory = 'red_flag';
  }
  // 3. Event specific requests (lead sale, rumour)
  else if (event === 'lead_inquiry' && block.sell_lead && Array.isArray(block.sell_lead)) {
    targetCategory = 'sell_lead';
  } else if (event === 'rumour_allborn' && (block.rumour_allborn || block.allborn_hint)) {
    targetCategory = block.rumour_allborn ? 'rumour_allborn' : 'allborn_hint';
  }
  // 4. Night / Dusk time-of-day reaction if nighttime or dusk event
  else if (event === 'night' || time === 'night') {
    if (block.night && Array.isArray(block.night)) {
      targetCategory = 'night';
    } else if (player.role === 'Dim' && block.greeting_dim) {
      targetCategory = 'greeting_dim';
    }
  } else if (event === 'dusk' || time === 'dusk') {
    if (block.dusk && Array.isArray(block.dusk)) {
      targetCategory = 'dusk';
    } else if (player.role === 'Dim' && block.greeting_dim) {
      targetCategory = 'greeting_dim';
    }
  }
  // 5. Heavy satchel warning
  else if (carriedCount >= 4 && block.heavy_pack && Array.isArray(block.heavy_pack)) {
    targetCategory = 'heavy_pack';
  }
  // 6. Identity greeting: Dim vs Lit (Shaper)
  else if (player.role === 'Dim' || !player.isLit) {
    if (block.greeting_dim && Array.isArray(block.greeting_dim)) {
      targetCategory = 'greeting_dim';
    } else if (block.greeting_local && Array.isArray(block.greeting_local)) {
      targetCategory = 'greeting_local';
    }
  }
  // 7. Identity greeting: Lit IGNIS (local) vs Lit outsider
  else if (player.element === 'IGNIS') {
    if (block.greeting_lit_ignis && Array.isArray(block.greeting_lit_ignis)) {
      targetCategory = 'greeting_lit_ignis';
    } else if (block.greeting_local && Array.isArray(block.greeting_local)) {
      targetCategory = 'greeting_local';
    }
  } else {
    // Lit outsider
    if (block.greeting_outsider_lit && Array.isArray(block.greeting_outsider_lit)) {
      targetCategory = 'greeting_outsider_lit';
    } else if (block.greeting_outsider && Array.isArray(block.greeting_outsider)) {
      targetCategory = 'greeting_outsider';
    }
  }

  const lines = block[targetCategory];
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    // Fallback to any available list
    const fallbackKey = Object.keys(block).find(k => Array.isArray(block[k]) && (block[k] as string[]).length > 0);
    if (!fallbackKey) {
      return { text: `Greetings, ${player.name || 'traveler'}.`, category: 'fallback' };
    }
    const candidates = block[fallbackKey] as string[];
    const chosen = candidates[0] ?? 'Greetings.';
    return { text: formatDialogueText(chosen, player, speaker), category: fallbackKey };
  }

  const lastLine = memory?.lastSpokenByNpc.get(speaker.id);
  const availableCandidates = lines.filter(l => formatDialogueText(l, player, speaker) !== lastLine);
  const pool = availableCandidates.length > 0 ? availableCandidates : lines;

  // Feeling score influence on candidate selection:
  // If feeling score is very high (> 75), prefer latter indices if available, otherwise pick evenly
  const feelingScore = player.feelingScore ?? memory?.feelingScores.get(speaker.id) ?? 50;
  let index = Math.floor(Math.random() * pool.length);
  if (feelingScore >= 75 && pool.length > 1) {
    index = pool.length - 1; // Friendly selection
  } else if (feelingScore <= 25 && pool.length > 1) {
    index = 0; // Wary selection
  }

  const rawChosen = pool[index] ?? pool[0]!;
  const formatted = formatDialogueText(rawChosen, player, speaker);

  if (memory) {
    memory.lastSpokenByNpc.set(speaker.id, formatted);
  }

  return { text: formatted, category: targetCategory };
}
