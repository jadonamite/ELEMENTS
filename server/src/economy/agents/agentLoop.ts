import type { DatabaseSync } from 'node:sqlite';
import {
  type AgentAction,
  type AgentObservation,
  type AgentTradeRecord,
  type MerchantStatus,
  AGENT_CONFIG,
  GAME_HOUR_MS,
  MERCHANT_CONFIG,
  SINDR_MERCHANTS,
  TREASURY_ACCOUNT_ID,
  updateMerchantSolvency,
  validateActions,
} from '@elements/shared';
import {
  getDatabase,
  getMerchantMindHistory,
  saveMerchantMindEntry,
  getActiveShopOwnership,
} from '../../db.js';
import { recordTransaction } from '../ledgerService.js';
import {
  getMerchant,
  getMerchantDemandWindow,
  saveMerchant,
} from '../merchantService.js';
import type { AgentDecider } from './types.js';
import { RuleDecider } from './ruleDecider.js';

export interface TickMerchantParams {
  merchantId: string;
  now: number;
  decider?: AgentDecider | undefined;
  db?: DatabaseSync | undefined;
}

export interface AgentTickResult {
  merchantId: string;
  thought: string;
  actionsApplied: AgentAction[];
  actionsDropped: Array<{ action: AgentAction; reason: string }>;
  purse: number;
  status: MerchantStatus;
  open: boolean;
}

export function ensureSindrMerchants(
  db: DatabaseSync = getDatabase(),
  now = 0,
): void {
  for (const config of SINDR_MERCHANTS) {
    const existing = getMerchant(config.id, db);
    if (!existing) {
      // Transfer starting purse from treasury to establish ledger balance and conserve world supply
      try {
        recordTransaction(
          {
            from: TREASURY_ACCOUNT_ID,
            to: config.id,
            amount: config.startingPurse,
            reason: 'merchant_bailout',
            refId: `init:${config.id}`,
            timestamp: now,
          },
          db,
        );
      } catch {
        // If treasury has insufficient balance (e.g. in standalone mock), proceed
      }

      saveMerchant(
        {
          id: config.id,
          nation: config.nation,
          balance: config.startingPurse,
          status: 'open',
          daysBroke: 0,
          inventory: config.inventory,
        },
        db,
      );
    }
  }
}

export function getRecentMerchantTrades(
  merchantId: string,
  now: number,
  db: DatabaseSync = getDatabase(),
): AgentTradeRecord[] {
  const cutoff = now - 24 * GAME_HOUR_MS;
  const rows = (db
    .prepare(
      `SELECT item_type, action, quantity, timestamp
       FROM merchant_demand
       WHERE merchant_id = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp DESC`,
    )
    .all(merchantId, cutoff, now) as unknown) as Array<{
    item_type: string;
    action: 'buy' | 'sell';
    quantity: number;
    timestamp: number;
  }>;

  return rows.map((r) => ({
    itemType: r.item_type,
    action: r.action,
    quantity: r.quantity,
    timestamp: r.timestamp,
  }));
}

export async function tickMerchantAgent(
  params: TickMerchantParams,
): Promise<AgentTickResult> {
  const db = params.db ?? getDatabase();
  const now = params.now;
  const merchantId = params.merchantId;
  const decider = params.decider ?? new RuleDecider();

  ensureSindrMerchants(db, now);

  const merchant = getMerchant(merchantId, db);
  if (!merchant) {
    throw new Error(`Merchant ${merchantId} not found`);
  }

  const timeOfDay = ((now / GAME_HOUR_MS) % 24 + 24) % 24;
  const isNight =
    timeOfDay >= AGENT_CONFIG.nightStartHour ||
    timeOfDay < AGENT_CONFIG.dayStartHour;

  const ownership = getActiveShopOwnership(merchantId, db);
  if (ownership) {
    const thought = 'The shopkeeper tends the counter under the direction of the shop owner.';
    saveMerchantMindEntry(
      {
        merchantId: merchant.id,
        thought,
        actions: [],
        timestamp: now,
      },
      db,
    );
    return {
      merchantId: merchant.id,
      thought,
      actionsApplied: [],
      actionsDropped: [],
      purse: merchant.balance,
      status: merchant.status,
      open: merchant.status === 'open' && !isNight,
    };
  }

  const demandWindows = getMerchantDemandWindow(merchantId, now, db);
  const recentTrades = getRecentMerchantTrades(merchantId, now, db);
  const tributeSchedule = {
    nextTributeTime: now + 24 * GAME_HOUR_MS,
    intervalMs: 24 * GAME_HOUR_MS,
  };
  const config = SINDR_MERCHANTS.find((s) => s.id === merchantId);

  const obs: AgentObservation = {
    merchantId: merchant.id,
    purse: merchant.balance,
    stock: merchant.inventory,
    demandWindows,
    recentTrades,
    tributeSchedule,
    timeOfDay,
    isOpen: merchant.status === 'open' && !isNight,
    status: merchant.status,
    daysBroke: merchant.daysBroke,
    personality: config?.personality ?? 'A merchant in Sindr market square.',
    now,
  };

  const decision = await decider.decide(obs);
  const { validActions, droppedActions } = validateActions(obs, decision.actions);

  for (const act of validActions) {
    if (act.type === 'restock') {
      const invItem = merchant.inventory[act.itemType];
      if (invItem) {
        const cost = act.quantity * invItem.basePrice;
        if (merchant.balance >= cost) {
          recordTransaction(
            {
              from: merchant.id,
              to: TREASURY_ACCOUNT_ID,
              amount: cost,
              reason: 'merchant_restock',
              refId: `${merchant.id}:${act.itemType}:${act.quantity}`,
              timestamp: now,
            },
            db,
          );
          invItem.stock += act.quantity;
          merchant.balance -= cost;
        }
      }
    } else if (act.type === 'tribute') {
      const invItem = merchant.inventory[act.itemType];
      if (invItem && invItem.stock >= act.quantity) {
        const payout = Math.floor(act.quantity * invItem.basePrice * AGENT_CONFIG.tributePriceRatio);
        if (payout > 0) {
          recordTransaction(
            {
              from: TREASURY_ACCOUNT_ID,
              to: merchant.id,
              amount: payout,
              reason: 'merchant_tribute',
              refId: `${merchant.id}:${act.itemType}:${act.quantity}`,
              timestamp: now,
            },
            db,
          );
        }
        invItem.stock -= act.quantity;
        merchant.balance += payout;
      }
    }
  }

  // Solvency check (under 1000 stops buying; closed after 3 days)
  const solvency = updateMerchantSolvency(merchant, false);
  merchant.status = solvency.state.status;
  merchant.daysBroke = solvency.state.daysBroke;

  saveMerchant(merchant, db);

  saveMerchantMindEntry(
    {
      merchantId: merchant.id,
      thought: decision.reasoning,
      actions: validActions,
      timestamp: now,
    },
    db,
  );

  return {
    merchantId: merchant.id,
    thought: decision.reasoning,
    actionsApplied: validActions,
    actionsDropped: droppedActions,
    purse: merchant.balance,
    status: merchant.status,
    open: merchant.status === 'open' && !isNight,
  };
}

export async function tickAllMerchantAgents(params: {
  now: number;
  decider?: AgentDecider | undefined;
  db?: DatabaseSync | undefined;
}): Promise<AgentTickResult[]> {
  const db = params.db ?? getDatabase();
  ensureSindrMerchants(db, params.now);

  const results: AgentTickResult[] = [];
  for (const m of SINDR_MERCHANTS) {
    const res = await tickMerchantAgent({
      merchantId: m.id,
      now: params.now,
      decider: params.decider,
      db,
    });
    results.push(res);
  }
  return results;
}

export function tickMerchantAgentsDay(
  now: number,
  db: DatabaseSync = getDatabase(),
): { closed: string[] } {
  ensureSindrMerchants(db, now);
  const closed: string[] = [];

  for (const config of SINDR_MERCHANTS) {
    const merchant = getMerchant(config.id, db);
    if (!merchant) continue;

    const prevStatus = merchant.status;
    const { state } = updateMerchantSolvency(merchant, true);

    if (state.status === 'closed' && prevStatus !== 'closed') {
      closed.push(merchant.id);
    }
    saveMerchant(state, db);
  }

  return { closed };
}

export function getMerchantMind(
  merchantId: string,
  db: DatabaseSync = getDatabase(),
): {
  merchantId: string;
  latestThought: string;
  actions: Array<{ action: unknown; reasoning?: string; timestamp: number }>;
  purse: number;
  open: boolean;
  status: MerchantStatus;
} | null {
  ensureSindrMerchants(db);
  const merchant = getMerchant(merchantId, db);
  if (!merchant) return null;

  const history = getMerchantMindHistory(merchantId, 10, db);
  const latestThought =
    history?.latestThought ??
    'Shelves are well apportioned and trade is steady across the square.';
  const actions = history?.actions ?? [];

  return {
    merchantId: merchant.id,
    latestThought,
    actions,
    purse: merchant.balance,
    open: merchant.status === 'open',
    status: merchant.status,
  };
}
