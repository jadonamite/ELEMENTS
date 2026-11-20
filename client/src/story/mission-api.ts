import type { MissionEvent, MissionState } from '../../../shared/src/story/missions.js';
import { getServerUrl, getStoredAccountId, getStoredAuthToken, hasGameServer, isOfflineMode } from '../auth/server-api.js';
import type { RoomChannel } from '../economy/door.js';
export interface MissionSnapshot {
  accountId: string; state: MissionState; balance: number; items: Record<string, number>; tier: number; applied?: boolean;
}

export class MissionApi {
  snapshot: MissionSnapshot | null = null;
  private room: RoomChannel | null = null;
  private roomIdentity: { accountId: string | null; token: string | null } | null = null;
  private readonly pending = new Map<string, { resolve: (s: MissionSnapshot) => void; reject: (e: Error) => void }>();
  private disposed = false;
  onChange: ((snapshot: MissionSnapshot) => void) | null = null;
  get online(): boolean { return this.room !== null; }

  get needsReconnect(): boolean {
    return this.room !== null && (this.roomIdentity?.accountId !== getStoredAccountId() || this.roomIdentity?.token !== getStoredAuthToken());
  }

  bind(room: RoomChannel, identity = { accountId: getStoredAccountId(), token: getStoredAuthToken() }): void {
    this.room = room; this.roomIdentity = identity;
    room.on('mission_reply', raw => {
      const m = raw as { operationId: string; error?: string; result?: MissionSnapshot };
      const pending = this.pending.get(m.operationId);
      this.pending.delete(m.operationId);
      if (m.error) pending?.reject(new Error(m.error));
      else if (m.result) pending?.resolve(m.result);
    });
  }

  async load(): Promise<MissionSnapshot | null> {
    if (!hasGameServer() || !getStoredAuthToken() || isOfflineMode()) return null;
    const account = getStoredAccountId();
    const response = await fetch(`${getServerUrl()}/api/story/mission`, {
      headers: { Authorization: `Bearer ${getStoredAuthToken()}` }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Your mission could not load. Retry when the game server is available.');
    const snapshot = await response.json() as MissionSnapshot;
    if (getStoredAccountId() !== account || this.disposed) return null;
    this.accept(snapshot);
    return snapshot;
  }

  async choose(event: MissionEvent): Promise<MissionSnapshot> {
    if (!hasGameServer() || !getStoredAuthToken() || isOfflineMode()) throw new Error('Sign in at the gate to continue.');
    if (this.needsReconnect && event !== 'training_complete') throw new Error('Reconnect after signing in to continue this mission.');
    if (!this.room && event !== 'training_complete') throw new Error('Connect to the shared world to continue this mission.');
    const account = getStoredAccountId();
    const key = `elements_mission_pending:${account}:${event}`;
    const operationId = localStorage.getItem(key) ?? crypto.randomUUID();
    localStorage.setItem(key, operationId);
    let result: MissionSnapshot;
    if (this.room && !this.needsReconnect) {
      result = await new Promise<MissionSnapshot>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(operationId); reject(new Error('The world did not answer. Try again.')); }, 8000);
        this.pending.set(operationId, {
          resolve: s => { clearTimeout(timer); resolve(s); }, reject: e => { clearTimeout(timer); reject(e); },
        });
        this.room!.send('mission', { operationId, event });
      });
    } else {
      const response = await fetch(`${getServerUrl()}/api/story/mission`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getStoredAuthToken()}` },
        body: JSON.stringify({ event, operationId }), signal: AbortSignal.timeout(8000),
      });
      const body = await response.json() as MissionSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'The mission could not continue. Try again.');
      result = body;
    }
    if (getStoredAccountId() !== account) throw new Error('Your account changed. Speak with the registrar again.');
    localStorage.removeItem(key);
    this.accept(result);
    return result;
  }

  private accept(snapshot: MissionSnapshot): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    this.onChange?.(snapshot);
  }
  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.values()) pending.reject(new Error('Mission closed'));
    this.pending.clear();
  }
}
