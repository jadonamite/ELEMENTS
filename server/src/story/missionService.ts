import type { DatabaseSync } from 'node:sqlite';
import {
  advanceMission, freshMission, normalizeMission, ARRIVAL_GRANT, HOME_MEAL_PRICE, MEAL_ITEM,
  IGNIS_MISSION, TREASURY_ACCOUNT_ID, type MissionEvent, type MissionState,
} from '@elements/shared';
import { getDatabase, getRising } from '../db.js';
import { getAccountBalance, recordTransaction } from '../economy/ledgerService.js';
import { addItems, getSatchel, removeItems, withSavepoint } from '../economy/satchelService.js';

export function migrateMissions(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS character_missions (
    account_id TEXT PRIMARY KEY REFERENCES risings(account_id), state TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mission_operations (
    account_id TEXT NOT NULL, operation_id TEXT NOT NULL, event TEXT NOT NULL,
    PRIMARY KEY(account_id, operation_id)
  )`);
}

export function getMission(accountId: string, db: DatabaseSync = getDatabase()): MissionState {
  const rising = getRising(accountId, db);
  if (!rising) throw new Error('Create your character first');
  const row = db.prepare('SELECT state FROM character_missions WHERE account_id = ?').get(accountId) as { state: string } | undefined;
  if (row) return normalizeMission(JSON.parse(row.state) as MissionState);
  let state = freshMission(rising.element ?? 'IGNIS');
  const paid = db.prepare("SELECT id FROM ledger_entries WHERE receiver = ? AND reason = 'player_starting_grant'").get(accountId);
  if (paid) {
    for (const event of ['training_complete', 'register', 'take_pouch'] as const) state = advanceMission(state, event, rising.role === 'Hush');
  }
  db.prepare('INSERT OR IGNORE INTO character_missions (account_id, state) VALUES (?, ?)').run(accountId, JSON.stringify(state));
  return state;
}

export function missionSnapshot(accountId: string, db: DatabaseSync = getDatabase()) {
  const state = getMission(accountId, db);
  const rising = getRising(accountId, db)!;
  return { accountId, state, balance: getAccountBalance(accountId, db), items: getSatchel(accountId, db),
    tier: state.flags.mission_1_complete ? Math.max(1, rising.tier ?? 1) : 0 };
}

export type MissionSnapshot = ReturnType<typeof missionSnapshot>;
export interface MissionContext { x: number; y: number; z: number; zone: string }

/** Public choices never accept encounter victories or ticket ownership from a browser. */
export function missionChoice(
  accountId: string, event: MissionEvent, operationId: string, context: MissionContext,
  db: DatabaseSync = getDatabase(),
): MissionSnapshot & { applied: boolean } {
  if (typeof operationId !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(operationId)) throw new Error('A valid operation ID is required');
  if (!['training_complete', 'register', 'take_pouch', 'buy_meal', 'eat_meal', 'meet_neri', 'accept_search', 'inspect_invitation', 'kellan_lead', 'hall_briefing', 'identify_invitation'].includes(event)) {
    throw new Error('This event requires the mission encounter');
  }
  return withSavepoint(db, () => {
    const state = getMission(accountId, db);
    const prior = db.prepare('SELECT event FROM mission_operations WHERE account_id = ? AND operation_id = ?').get(accountId, operationId) as { event: string } | undefined;
    if (prior) {
      if (prior.event !== event) throw new Error('Operation ID already used for another choice');
      return { ...missionSnapshot(accountId, db), applied: false };
    }
    if (state.zone !== 'sindr') throw new Error('This mission is not available in Sindr');
    if ((context.zone !== 'sindr' && event !== 'inspect_invitation') || ![context.x, context.y, context.z].every(Number.isFinite)) throw new Error('A town position is required');
    const place = event === 'training_complete' || event === 'inspect_invitation' ? null
      : event === 'register' || event === 'take_pouch' ? IGNIS_MISSION.gate
      : event === 'hall_briefing' ? IGNIS_MISSION.hall
      : event === 'identify_invitation' ? IGNIS_MISSION.kellan
      : event === 'kellan_lead' ? IGNIS_MISSION.cover
      : event === 'meet_neri' || event === 'accept_search' ? IGNIS_MISSION.neri : IGNIS_MISSION.stall;
    if (place && (Math.hypot(context.x - place.x, context.z - place.z) > 5 || Math.abs(context.y - place.y) > 3)) throw new Error('Stand beside the person to continue');
    const rising = getRising(accountId, db)!;
    const next = advanceMission(state, event, rising.role === 'Hush');
    if (event === 'take_pouch' && !state.flags.arrival_grant_paid) {
      // Preserve historical grants at their original amount, including the earlier 100 CHROMA purse.
      const paid = db.prepare("SELECT id FROM ledger_entries WHERE receiver = ? AND reason = 'player_starting_grant'").get(accountId);
      if (!paid) recordTransaction({ id: `arrival:${accountId}`, from: TREASURY_ACCOUNT_ID, to: accountId, amount: ARRIVAL_GRANT, reason: 'player_starting_grant', refId: accountId }, db);
      db.prepare('UPDATE risings SET tier = MAX(1, tier) WHERE account_id = ?').run(accountId);
    }
    if (event === 'buy_meal') {
      recordTransaction({ from: accountId, to: 'merchant_ignis', amount: HOME_MEAL_PRICE, reason: 'merchant_buy', refId: operationId }, db);
      addItems({ accountId, from: 'world', stacks: [{ itemId: MEAL_ITEM, quantity: 1 }], reason: 'grant', refId: operationId }, db);
    }
    if (event === 'eat_meal') removeItems({ accountId, to: 'world', stacks: [{ itemId: MEAL_ITEM, quantity: 1 }], reason: 'item_use', refId: operationId }, db);
    saveMission(accountId, next, db);
    db.prepare('INSERT INTO mission_operations (account_id, operation_id, event) VALUES (?, ?, ?)').run(accountId, operationId, event);
    return { ...missionSnapshot(accountId, db), applied: true };
  });
}

/** Guest training carries no location authority or economic effect. */
export function saveMissionTraining(accountId: string, operationId: string, db: DatabaseSync = getDatabase()) {
  return missionChoice(accountId, 'training_complete', operationId, { ...IGNIS_MISSION.gate, zone: 'sindr' }, db);
}

/** The room chooses this checkpoint; the browser cannot supply its coordinates. */
export function missionGateCheckpoint(accountId: string, db: DatabaseSync = getDatabase()) {
  const state = getMission(accountId, db);
  return state.zone === 'sindr' && state.flags.training_complete && !state.flags.mission_1_complete
    ? { ...IGNIS_MISSION.gate } : null;
}

export function saveMission(accountId: string, state: MissionState, db: DatabaseSync): void {
  db.prepare('UPDATE character_missions SET state = ? WHERE account_id = ?').run(JSON.stringify(state), accountId);
}
