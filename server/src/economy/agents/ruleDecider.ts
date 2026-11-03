import {
  type AgentAction,
  type AgentObservation,
  AGENT_CONFIG,
  formatItemDisplay,
} from '@elements/shared';
import type { AgentDecider, AgentDeciderResult } from './types.js';

export class RuleDecider implements AgentDecider {
  async decide(obs: AgentObservation): Promise<AgentDeciderResult> {
    const actions: AgentAction[] = [];
    const isNight =
      obs.timeOfDay >= AGENT_CONFIG.nightStartHour ||
      obs.timeOfDay < AGENT_CONFIG.dayStartHour;

    // Rule 1: Shut at night
    if (isNight) {
      actions.push({
        type: 'set_hours',
        openHour: AGENT_CONFIG.dayStartHour,
        closeHour: AGENT_CONFIG.nightStartHour,
      });

      return {
        actions,
        reasoning: 'The sun has set over Sindr; shutters are barred until dawn.',
      };
    }

    let availablePurse = obs.purse;
    const restockedItems: Array<{ item: string; quantity: number }> = [];
    const tributeItems: Array<{ item: string; quantity: number }> = [];

    // Rule 2: Restock items under 30% of max when purse allows
    for (const [itemType, item] of Object.entries(obs.stock)) {
      if (item.maxStock <= 0) continue;
      const ratio = item.stock / item.maxStock;
      if (ratio < AGENT_CONFIG.restockStockRatio) {
        const needed = item.maxStock - item.stock;
        const affordable = Math.floor(availablePurse / item.basePrice);
        const qty = Math.min(needed, affordable);
        if (qty > 0) {
          actions.push({
            type: 'restock',
            itemType,
            quantity: qty,
          });
          availablePurse -= qty * item.basePrice;
          restockedItems.push({ item: itemType, quantity: qty });
        }
      }
    }

    // Rule 3: Ship tribute of items over 90% of max
    for (const [itemType, item] of Object.entries(obs.stock)) {
      if (item.maxStock <= 0) continue;
      const ratio = item.stock / item.maxStock;
      if (ratio > AGENT_CONFIG.tributeStockRatio) {
        const targetStock = Math.round(item.maxStock * AGENT_CONFIG.tributeStockRatio);
        const excess = item.stock - targetStock;
        if (excess > 0) {
          actions.push({
            type: 'tribute',
            itemType,
            quantity: excess,
          });
          tributeItems.push({ item: itemType, quantity: excess });
        }
      }
    }

    // Reasoning sentence in the merchant's voice
    let reasoning = 'Shelves are well apportioned and trade is steady across the square.';
    if (obs.status === 'broke_buying_paused' || obs.purse < 1000) {
      reasoning = 'Purse is running thin; conserving coin until travelers buy our wares.';
    } else if (restockedItems.length > 0 && tributeItems.length > 0) {
      const restockDesc = restockedItems
        .map((r) => `${r.quantity} ${formatItemDisplay(r.item, 'IGNIS')}`)
        .join(', ');
      const tributeDesc = tributeItems
        .map((t) => `${t.quantity} ${formatItemDisplay(t.item, 'IGNIS')}`)
        .join(', ');
      reasoning = `I replenished ${restockDesc} from the stores and sent ${tributeDesc} tribute to the Lord.`;
    } else if (restockedItems.length > 0) {
      const desc = restockedItems
        .map((r) => `${r.quantity} ${formatItemDisplay(r.item, 'IGNIS')}`)
        .join(', ');
      reasoning = `I bought ${desc} from the Lord's supply to replenish empty racks.`;
    } else if (tributeItems.length > 0) {
      const desc = tributeItems
        .map((t) => `${t.quantity} ${formatItemDisplay(t.item, 'IGNIS')}`)
        .join(', ');
      reasoning = `I shipped ${desc} to the Lord's treasury to relieve crowded shelves.`;
    }

    return { actions, reasoning };
  }
}
