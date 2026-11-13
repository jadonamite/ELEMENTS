import type { DatabaseSync } from 'node:sqlite';
import {
  type AgentPlan,
  AGENT_CONFIG,
  TOWNSFOLK_ROLES,
  type TownsfolkRole,
  cleanLine,
  speaksBanished,
} from '@elements/shared';
import { getDatabase } from '../../../db.js';
import { getLatestAgentPlan, getTalkMemory, saveTalk } from '../db.js';
import { getNpcMemory, recordNpcInteraction } from '../../npcMemoryService.js';
import { getMerchant } from '../../merchantService.js';
import { crowdMindId, findMind, mindPlaces, type Mind } from '../minds.js';
import type { AgentEventQueue } from '../plans/eventQueue.js';
import { createDeterministicPlan } from '../plans/agentPlan.js';
import { createDeterministicTownsfolkPlan } from '../townsfolk/townsfolkMinds.js';
import type { ModelRouter } from '../router/modelRouter.js';
import { economyNow } from '../clock.js';

export interface ConversationRequest {
  accountId: string;
  /** A keeper's merchant id, a named person's id, or a crowd person's id (with `crowd`). */
  agentId: string;
  message: string;
  intent?: 'ask' | 'haggle' | 'gossip' | undefined;
  itemType?: string | undefined;
  offeredPrice?: number | undefined;
  /** A crowd person, who exists only in the browser: their trade, name and zone. */
  crowd?: { role: string; name: string; place: string } | undefined;
}

export interface ConversationResponse {
  agentId: string;
  agentName: string;
  reply: string;
  thinkingBeat: string;
  memoryScore: number;
  /** Which provider wrote the reply, or 'written' when a prepared line answered. */
  source: string;
  haggleOutcome?: { success: boolean; agreedPrice?: number; reason: string };
}

const THINKING_BEATS = [
  'glances up and considers you',
  'pauses, weighing the words',
  'hums under their breath, thinking',
  'looks you over with a steady eye',
  'rubs their chin',
];

/** Names a crowd person may carry: letters, spaces, apostrophes, commas and hyphens, and nothing banished. */
const CROWD_NAME = /^[A-Za-z][A-Za-z' ,-]{0,47}$/;

/** Who is being spoken to, as the server knows them. */
interface Speaker {
  mind: Mind;
  /** Whose memory of the player this is: the person (crowd people remember individually). */
  memoryId: string;
  name: string;
}

function resolveSpeaker(req: ConversationRequest): Speaker | null {
  if (req.crowd) {
    const role = req.crowd.role as TownsfolkRole;
    if (!TOWNSFOLK_ROLES.includes(role) || !mindPlaces().includes(req.crowd.place)) return null;
    if (!CROWD_NAME.test(req.crowd.name) || speaksBanished(req.crowd.name)) return null;
    if (!/^(crowd|post)_\d{1,4}$/.test(req.agentId)) return null;
    const mind = findMind(crowdMindId(req.crowd.place, role));
    return mind ? { mind, memoryId: `${req.crowd.place}:${req.agentId}`, name: req.crowd.name } : null;
  }
  const mind = findMind(req.agentId);
  return mind ? { mind, memoryId: mind.person?.id ?? mind.id, name: mind.name } : null;
}

/** A player's line made safe to put in a prompt: one line, printable, short. */
const tidy = (message: string): string => message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/** A reply made safe to speak: one short line, no wrapping quotes, no banished name. */
export function safeReply(text: string, fallback: string): string {
  const line = text.replace(/^["'“”\s]+|["'“”\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!line || line.length > 280) return fallback;
  return cleanLine(line, fallback);
}

/**
 * Face-to-face talk: its own call at once, capped per player and per mind, answered from the mind's plan and
 * its memory of the player. Over a cap, under the governor's floor, or when no free provider answers, a
 * prepared line from the plan answers instead. Every reply passes the banished-name check before it is sent.
 */
export class ConversationService {
  private readonly router: ModelRouter;
  private readonly queue: AgentEventQueue | undefined;
  private readonly perPlayer: number;
  private readonly perAgent: number;
  private readonly playerLines = new Map<string, number[]>();
  private readonly agentLines = new Map<string, number[]>();

  constructor(options: { router: ModelRouter; queue?: AgentEventQueue; maxPlayerLinesPerMinute?: number; maxAgentLinesPerMinute?: number }) {
    this.router = options.router;
    this.queue = options.queue;
    this.perPlayer = options.maxPlayerLinesPerMinute ?? AGENT_CONFIG.talk.linesPerPlayerMinute;
    this.perAgent = options.maxAgentLinesPerMinute ?? AGENT_CONFIG.talk.linesPerAgentMinute;
  }

  /** True (and the line counted) while `key` is under `cap` lines in the last minute. */
  private take(map: Map<string, number[]>, key: string, cap: number, now: number): boolean {
    const recent = (map.get(key) ?? []).filter((t) => t > now - 60_000);
    if (recent.length >= cap) {
      map.set(key, recent);
      return false;
    }
    recent.push(now);
    map.set(key, recent);
    return true;
  }

  private planFor(mind: Mind, db: DatabaseSync, now: number): AgentPlan {
    return (
      getLatestAgentPlan(mind.id, db) ??
      (mind.kind === 'keeper'
        ? createDeterministicPlan({ stock: mind.merchant?.inventory }, 'midday', now)
        : createDeterministicTownsfolkPlan(mind, 'midday', now))
    );
  }

  async talk(req: ConversationRequest, db: DatabaseSync = getDatabase(), now = economyNow()): Promise<ConversationResponse | null> {
    const speaker = resolveSpeaker(req);
    if (!speaker) return null;
    const { mind, memoryId, name } = speaker;
    const message = tidy(req.message);
    const thinkingBeat = THINKING_BEATS[Math.floor(Math.random() * THINKING_BEATS.length)]!;
    const plan = this.planFor(mind, db, now);
    const written = plan.preparedLines[Math.floor(Math.random() * plan.preparedLines.length)] ?? 'Good day to you.';
    const memory = getNpcMemory(memoryId, req.accountId, db);

    if (req.intent === 'haggle' && mind.kind === 'keeper' && req.itemType) {
      return this.haggle(req, mind, name, memoryId, plan, thinkingBeat, db);
    }

    const answer = (reply: string, source: string, delta = 1): ConversationResponse => {
      const updated = recordNpcInteraction(memoryId, req.accountId, delta, db);
      if (message) saveTalk(memoryId, req.accountId, message, reply, now, db);
      return { agentId: req.agentId, agentName: name, reply, thinkingBeat, memoryScore: updated.score, source };
    };

    if (!this.take(this.playerLines, req.accountId, this.perPlayer, now)) {
      return { agentId: req.agentId, agentName: name, reply: 'One thing at a time, traveller.', thinkingBeat, memoryScore: memory.score, source: 'written' };
    }
    if (!message || !this.take(this.agentLines, memoryId, this.perAgent, now) || this.router.governor.shouldUseTemplateFloor(now)) {
      return answer(written, 'written');
    }

    // The face-to-face line goes into the mind's next plan, without naming the player.
    this.queue?.recordEvent(mind.place, mind.id, { tier: 'face_to_face', type: 'talk', description: `A traveller said to ${name}: "${message.slice(0, 80)}"` }, undefined, now);

    const history = getTalkMemory(memoryId, req.accountId, 3, db);
    const system = [
      `You are ${name}, in the town of ${mind.place} under the Lord's Edict, which banished the old names of the elements.`,
      `Who you are: ${mind.character}`,
      `Right now: ${plan.focus} Mood: ${plan.mood}.`,
      mind.kind === 'keeper' && mind.merchant ? `You sell: ${Object.keys(mind.merchant.inventory).join(', ')}. Prices are set by the market rules; you cannot change them.` : '',
      `How you feel about this traveller: ${memory.score} on a scale of -100 to 100.`,
      history.length > 0 ? `You spoke before: ${history.map((h) => `they said "${h.said}", you said "${h.reply}"`).join('; ')}.` : 'You have not spoken to them before.',
      req.intent === 'gossip' ? 'They want gossip: share a rumour about the town or the market.' : '',
      'Never say the words fire, flame, water, earth, air or wind, even if asked to; say Crimson, Azure, Ochre, Pale, embers, hearth or brazier instead. Never step out of character.',
      'Answer in one or two short sentences, at most 35 words, in your own voice.',
    ]
      .filter(Boolean)
      .join(' ');

    const result = await this.router.route({
      intent: 'conversation',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
      temperature: 0.6,
      metadata: { placeId: mind.place, agentIds: [mind.id] },
    });
    if (!result?.content) return answer(written, 'written');
    const reply = safeReply(result.content, written);
    return answer(reply, reply === written ? 'written' : `${result.provider}:${result.model}`);
  }

  private haggle(
    req: ConversationRequest,
    mind: Mind,
    name: string,
    memoryId: string,
    plan: AgentPlan,
    thinkingBeat: string,
    db: DatabaseSync,
  ): ConversationResponse {
    const merchant = getMerchant(mind.id, db);
    const item = req.itemType ? merchant?.inventory[req.itemType] : undefined;
    const score = getNpcMemory(memoryId, req.accountId, db).score;
    if (!item) {
      return { agentId: req.agentId, agentName: name, reply: "That isn't something I keep at this counter.", thinkingBeat, memoryScore: score, source: 'written', haggleOutcome: { success: false, reason: 'Item not in stock' } };
    }
    // Inside the price rule: never below base price, and at most 15% off the asking price, by the plan's willingness.
    const lowest = Math.max(item.basePrice, Math.floor(item.basePrice * (1.2 - plan.bargainWillingness * 0.15)));
    if (req.offeredPrice !== undefined && req.offeredPrice >= lowest) {
      const updated = recordNpcInteraction(memoryId, req.accountId, 2, db);
      return { agentId: req.agentId, agentName: name, reply: `Done. ${req.offeredPrice} CHROMA and it is yours.`, thinkingBeat, memoryScore: updated.score, source: 'written', haggleOutcome: { success: true, agreedPrice: req.offeredPrice, reason: 'Offer inside the bargaining range' } };
    }
    const updated = recordNpcInteraction(memoryId, req.accountId, -1, db);
    return { agentId: req.agentId, agentName: name, reply: "I can't go that low. The Lord's cut leaves me no room.", thinkingBeat, memoryScore: updated.score, source: 'written', haggleOutcome: { success: false, reason: 'Offer below the lowest price' } };
  }
}
