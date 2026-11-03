import { AGENT_CONFIG } from './constants.js';
import type { DemandWindow, MerchantInventoryItem, MerchantStatus } from './types.js';

export interface AgentTradeRecord {
  action: 'buy' | 'sell';
  itemType: string;
  quantity: number;
  timestamp: number;
  price?: number;
}

export interface AgentTributeSchedule {
  nextTributeTime: number;
  intervalMs: number;
}

export interface AgentObservation {
  merchantId: string;
  purse: number;
  stock: Record<string, MerchantInventoryItem>;
  demandWindows: DemandWindow;
  recentTrades: AgentTradeRecord[];
  tributeSchedule: AgentTributeSchedule;
  timeOfDay: number; // hour in 0..24
  isOpen: boolean;
  status: MerchantStatus;
  daysBroke?: number;
  personality?: string;
  now?: number;
}

export type RestockAction = {
  type: 'restock';
  itemType: string;
  quantity: number;
};

export type TributeAction = {
  type: 'tribute';
  itemType: string;
  quantity: number;
};

export type SetHoursAction = {
  type: 'set_hours';
  openHour: number;
  closeHour: number;
};

export type SayAction = {
  type: 'say';
  line: string;
};

export type AgentAction =
  | RestockAction
  | TributeAction
  | SetHoursAction
  | SayAction;

export function validateAction(
  obs: AgentObservation,
  action: AgentAction,
): { valid: boolean; reason?: string } {
  if (!action || typeof action !== 'object' || !('type' in action)) {
    return { valid: false, reason: 'Invalid action object' };
  }

  // Reject any direct price manipulation attempt
  const untyped = action as Record<string, unknown>;
  if (
    action.type === ('set_price' as any) ||
    untyped.price !== undefined ||
    untyped.unitPrice !== undefined ||
    untyped.basePrice !== undefined ||
    untyped.changePrice !== undefined
  ) {
    return {
      valid: false,
      reason: 'Agents cannot set prices directly; prices are governed strictly by merchant rules',
    };
  }

  if (action.type === 'restock') {
    if (!action.itemType || typeof action.itemType !== 'string') {
      return { valid: false, reason: 'Missing item type for restock' };
    }
    if (!Number.isInteger(action.quantity) || action.quantity <= 0) {
      return { valid: false, reason: 'Restock quantity must be a positive integer' };
    }
    const item = obs.stock[action.itemType];
    if (!item) {
      return { valid: false, reason: `Item ${action.itemType} is not carried by merchant` };
    }
    if (item.stock + action.quantity > item.maxStock) {
      return {
        valid: false,
        reason: `Restock would exceed max stock (${item.stock + action.quantity} > ${item.maxStock})`,
      };
    }
    const cost = action.quantity * item.basePrice;
    if (cost > obs.purse) {
      return {
        valid: false,
        reason: `Insufficient purse for restock (cost ${cost} > purse ${obs.purse})`,
      };
    }
    return { valid: true };
  }

  if (action.type === 'tribute') {
    if (!action.itemType || typeof action.itemType !== 'string') {
      return { valid: false, reason: 'Missing item type for tribute' };
    }
    if (!Number.isInteger(action.quantity) || action.quantity <= 0) {
      return { valid: false, reason: 'Tribute quantity must be a positive integer' };
    }
    const item = obs.stock[action.itemType];
    if (!item) {
      return { valid: false, reason: `Item ${action.itemType} is not carried by merchant` };
    }
    if (action.quantity > item.stock) {
      return {
        valid: false,
        reason: `Cannot ship more tribute than current stock (${action.quantity} > ${item.stock})`,
      };
    }
    return { valid: true };
  }

  if (action.type === 'set_hours') {
    if (typeof action.openHour !== 'number' || typeof action.closeHour !== 'number') {
      return { valid: false, reason: 'Open and close hours must be numeric' };
    }
    if (
      action.openHour < AGENT_CONFIG.minOpenHour ||
      action.closeHour > AGENT_CONFIG.maxCloseHour
    ) {
      return {
        valid: false,
        reason: `Shop hours must be within allowed limits [${AGENT_CONFIG.minOpenHour}, ${AGENT_CONFIG.maxCloseHour}]`,
      };
    }
    if (action.openHour >= action.closeHour) {
      return { valid: false, reason: 'Open hour must be before close hour' };
    }
    return { valid: true };
  }

  if (action.type === 'say') {
    if (typeof action.line !== 'string' || action.line.trim().length === 0) {
      return { valid: false, reason: 'Spoken line must be non-empty' };
    }
    if (action.line.length > 500) {
      return { valid: false, reason: 'Spoken line exceeds maximum length' };
    }
    return { valid: true };
  }

  return { valid: false, reason: `Unknown action type: ${(action as any).type}` };
}

export function validateActions(
  obs: AgentObservation,
  actions: AgentAction[],
): { validActions: AgentAction[]; droppedActions: Array<{ action: AgentAction; reason: string }> } {
  let simulatedPurse = obs.purse;
  const simulatedStock: Record<string, number> = {};
  for (const [k, v] of Object.entries(obs.stock)) {
    simulatedStock[k] = v.stock;
  }

  const validActions: AgentAction[] = [];
  const droppedActions: Array<{ action: AgentAction; reason: string }> = [];

  for (const action of actions) {
    const single = validateAction(
      {
        ...obs,
        purse: simulatedPurse,
        stock: Object.fromEntries(
          Object.entries(obs.stock).map(([k, v]) => [
            k,
            { ...v, stock: simulatedStock[k] ?? v.stock },
          ]),
        ),
      },
      action,
    );

    if (!single.valid) {
      droppedActions.push({ action, reason: single.reason ?? 'Validation failed' });
      continue;
    }

    if (action.type === 'restock') {
      const item = obs.stock[action.itemType];
      if (item) {
        simulatedPurse -= action.quantity * item.basePrice;
        simulatedStock[action.itemType] =
          (simulatedStock[action.itemType] ?? item.stock) + action.quantity;
      }
    } else if (action.type === 'tribute') {
      const item = obs.stock[action.itemType];
      if (item) {
        simulatedPurse += action.quantity * item.basePrice;
        simulatedStock[action.itemType] =
          (simulatedStock[action.itemType] ?? item.stock) - action.quantity;
      }
    }

    validActions.push(action);
  }

  return { validActions, droppedActions };
}
