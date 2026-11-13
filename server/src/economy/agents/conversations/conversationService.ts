import type { DatabaseSync } from 'node:sqlite';
import {
  type AgentPlan,
  AGENT_CONFIG,
  MERCHANT_CONFIG,
  SINDR_MERCHANTS,
} from '@elements/shared';
import { getDatabase } from '../../../db.js';
import { getLatestAgentPlan } from '../db.js';
import { getNpcMemory, recordNpcInteraction } from '../../npcMemoryService.js';
import { getMerchant } from '../../merchantService.js';
import type { BudgetGovernor } from '../router/budgetGovernor.js';
import type { ModelRouter } from '../router/modelRouter.js';
import { SINDR_TOWNSFOLK } from '../townsfolk/townsfolkRoster.js';

export interface ConversationRequest {
  accountId: string;
  agentId: string;
  message: string;
  intent?: 'ask' | 'haggle' | 'gossip';
  itemType?: string;
  offeredPrice?: number;
}

export interface ConversationResponse {
  agentId: string;
  agentName: string;
  reply: string;
  thinkingBeat: string;
  memoryScore: number;
  haggleOutcome?: {
    success: boolean;
    agreedPrice?: number;
    reason: string;
  };
}

export class ConversationService {
  private readonly router: ModelRouter;
  private readonly governor: BudgetGovernor;
  private readonly maxPlayerLinesPerMinute: number;
  private readonly playerCallHistory = new Map<string, number[]>();

  private readonly thinkingBeats = [
    'glances across the counter thoughtfully',
    'pauses and measures you with a steady eye',
    'scratches chin and considers the offer',
    'nods slowly, weighing the words',
    'adjusts the wares on the counter',
    'humms softly in thought',
  ];

  constructor(options: {
    router: ModelRouter;
    governor?: BudgetGovernor;
    maxPlayerLinesPerMinute?: number;
  }) {
    this.router = options.router;
    this.governor = options.governor ?? options.router.governor;
    this.maxPlayerLinesPerMinute = options.maxPlayerLinesPerMinute ?? 5;
  }

  private isPlayerRateLimited(accountId: string, now: number): boolean {
    const oneMinAgo = now - 60_000;
    const history = (this.playerCallHistory.get(accountId) ?? []).filter((t) => t > oneMinAgo);
    this.playerCallHistory.set(accountId, history);

    if (history.length >= this.maxPlayerLinesPerMinute) {
      return true;
    }
    history.push(now);
    return false;
  }

  private getRandomThinkingBeat(now: number): string {
    const idx = Math.floor((now % 1000) / (1000 / this.thinkingBeats.length));
    return this.thinkingBeats[idx] ?? this.thinkingBeats[0]!;
  }

  async talk(
    req: ConversationRequest,
    db: DatabaseSync = getDatabase(),
    now = Date.now(),
  ): Promise<ConversationResponse> {
    const { accountId, agentId, message, intent = 'ask', itemType, offeredPrice } = req;
    const thinkingBeat = this.getRandomThinkingBeat(now);

    // Look up agent details from merchants or townsfolk
    const merchantDef = SINDR_MERCHANTS.find((m) => m.id === agentId);
    const townsfolkDef = SINDR_TOWNSFOLK.find((t) => t.id === agentId);
    const agentName = merchantDef?.name ?? townsfolkDef?.name ?? 'Local Resident';
    const personality =
      merchantDef?.personality ??
      townsfolkDef?.personality ??
      'A practical citizen of Sindr.';

    // Check player rate limit
    if (this.isPlayerRateLimited(accountId, now)) {
      return {
        agentId,
        agentName,
        reply: 'Hold on a moment, traveler. One matter at a time.',
        thinkingBeat,
        memoryScore: getNpcMemory(agentId, accountId, db).score,
      };
    }

    // Retrieve agent memory of this player
    const memory = getNpcMemory(agentId, accountId, db);
    const plan = getLatestAgentPlan(agentId, db);

    // Handle Haggling
    if (intent === 'haggle' && merchantDef && itemType) {
      return this.handleHaggle({
        accountId,
        agentId,
        agentName,
        personality,
        itemType,
        offeredPrice,
        memoryScore: memory.score,
        plan,
        thinkingBeat,
        db,
        now,
      });
    }

    // Fallback template lines if governor is at Level 3 (template floor)
    if (this.governor.shouldUseTemplateFloor(now)) {
      const fallbackLine =
        plan?.preparedLines?.[0] ??
        `Good day. Trade is steady here in the square.`;
      recordNpcInteraction(agentId, accountId, 1, db);
      return {
        agentId,
        agentName,
        reply: fallbackLine,
        thinkingBeat,
        memoryScore: memory.score + 1,
      };
    }

    // Model prompt for face-to-face conversation
    const systemPrompt = [
      `You are ${agentName}, an NPC in the fantasy town of Sindr.`,
      `Your persona: "${personality}".`,
      plan ? `Your current daily focus: "${plan.focus}". Your mood: "${plan.mood}".` : '',
      `The player's reputation with you: score ${memory.score} (-100 to 100).`,
      'Lore rule: Never use banished elemental words (fire, flame, water, earth, air, wind). Use Crimson, Azure, Ochre, Pale, embers, hearth, or brazier.',
      'Respond with a single concise sentence (maximum 25 words) in your character voice.',
    ]
      .filter(Boolean)
      .join(' ');

    let reply = '';
    try {
      const modelResult = await this.router.route({
        intent: 'conversation',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message.slice(0, 150) },
        ],
        temperature: 0.4,
      });

      if (modelResult?.content) {
        reply = modelResult.content.trim().replace(/^["']|["']$/g, '');
      }
    } catch {
      // Fallback on error
    }

    if (!reply) {
      reply =
        plan?.preparedLines?.[1] ??
        plan?.preparedLines?.[0] ??
        'A fair day in Sindr. Let us know if you seek wares or news.';
    }

    // Reward polite interaction with slight memory boost (+1)
    const updated = recordNpcInteraction(agentId, accountId, 1, db);

    return {
      agentId,
      agentName,
      reply,
      thinkingBeat,
      memoryScore: updated.score,
    };
  }

  private handleHaggle(params: {
    accountId: string;
    agentId: string;
    agentName: string;
    personality: string;
    itemType: string;
    offeredPrice?: number | undefined;
    memoryScore: number;
    plan: AgentPlan | null;
    thinkingBeat: string;
    db: DatabaseSync;
    now: number;
  }): ConversationResponse {
    const {
      accountId,
      agentId,
      agentName,
      itemType,
      offeredPrice,
      memoryScore,
      plan,
      thinkingBeat,
      db,
    } = params;

    const merchant = getMerchant(agentId, db);
    const item = merchant?.inventory[itemType];

    if (!item) {
      return {
        agentId,
        agentName,
        reply: `I don't stock ${itemType} at this counter.`,
        thinkingBeat,
        memoryScore,
        haggleOutcome: {
          success: false,
          reason: 'Item not in inventory',
        },
      };
    }

    const basePrice = item.basePrice;
    const willingness = plan?.bargainWillingness ?? 0.5;

    // Minimum price rule: can never sell below base price, max discount is 15% * willingness
    const maxDiscountPercent = willingness * 0.15;
    const lowestAcceptablePrice = Math.max(
      basePrice,
      Math.floor(basePrice * (1.2 - maxDiscountPercent)),
    );

    if (offeredPrice !== undefined && offeredPrice >= lowestAcceptablePrice) {
      // Haggle succeeds
      recordNpcInteraction(agentId, accountId, 2, db);
      return {
        agentId,
        agentName,
        reply: `You drive a hard bargain, but agreed. Take it for ${offeredPrice} CHROMA.`,
        thinkingBeat,
        memoryScore: memoryScore + 2,
        haggleOutcome: {
          success: true,
          agreedPrice: offeredPrice,
          reason: 'Offer accepted within bargaining range',
        },
      };
    }

    // Offer was too low
    recordNpcInteraction(agentId, accountId, -1, db);
    return {
      agentId,
      agentName,
      reply: `I cannot part with it for that. The guild statutes and Lord's cut leave no margin.`,
      thinkingBeat,
      memoryScore: memoryScore - 1,
      haggleOutcome: {
        success: false,
        reason: 'Offer below minimum acceptable price',
      },
    };
  }
}
