import {
  FIRST_SHRINE,
  LEGACY_SINDR_ORIGIN,
  shrineById,
  shrineToLight,
  wakeShrine,
  type Shrine,
} from '../../shared/src/index.js';
import { getServerUrl, getStoredAuthToken, hasGameServer } from './auth/server-api.js';

/** A guest's lit shrines, kept in this browser only. Signed-in players keep theirs on the server. */
const GUEST_SHRINES_KEY = 'elements_lit_shrines';

export interface ShrineStateEvents {
  /** The lit set grew: from loading, the online room, or reaching a shrine. */
  onChange?: (lit: ReadonlySet<string>) => void;
  onNotice?: (text: string) => void;
}

/**
 * The shrines this player has lit. Online the room is the source; offline a signed-in player's come from the
 * server and a guest's from this browser. Positions passed in are scene metres (nation-global minus the origin).
 */
export class ShrineState {
  private readonly litIds = new Set<string>([FIRST_SHRINE]);
  private readonly signedIn = Boolean(getStoredAuthToken()) && hasGameServer();
  private checkCooldown = 0;

  constructor(private readonly events: ShrineStateEvents = {}) {
    void this.load();
  }

  get lit(): ReadonlySet<string> {
    return this.litIds;
  }

  isLit(shrineId: string): boolean {
    return this.litIds.has(shrineId);
  }

  /** The room's list when joining online. */
  setOnlineLit(ids: readonly string[]): void {
    this.add(ids);
  }

  /** The room lit one for this player online. */
  onOnlineShrineLit(shrineId: string): void {
    const shrine = shrineById(shrineId);
    if (shrine && this.add([shrineId])) this.events.onNotice?.(`${shrine.name} lit`);
  }

  private async load(): Promise<void> {
    if (!this.signedIn) {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(GUEST_SHRINES_KEY) ?? '[]');
        if (Array.isArray(parsed)) this.add(parsed.filter((id): id is string => typeof id === 'string'));
      } catch {
        // Storage may be unavailable.
      }
      return;
    }
    try {
      const res = await fetch(`${getServerUrl()}/api/shrines`, { headers: { Authorization: `Bearer ${getStoredAuthToken()}` } });
      if (!res.ok) return;
      const body = (await res.json()) as { lit?: unknown };
      if (Array.isArray(body.lit)) this.add(body.lit.filter((id): id is string => typeof id === 'string'));
    } catch {
      // Network unavailable: the first shrine stands.
    }
  }

  /** Adds known shrines; true when any was new. */
  private add(ids: readonly string[]): boolean {
    let grew = false;
    for (const id of ids) {
      if (!shrineById(id) || this.litIds.has(id)) continue;
      this.litIds.add(id);
      grew = true;
    }
    if (!grew) return false;
    if (!this.signedIn) {
      try { localStorage.setItem(GUEST_SHRINES_KEY, JSON.stringify([...this.litIds])); } catch { /* Storage may be unavailable. */ }
    }
    this.events.onChange?.(this.litIds);
    return true;
  }

  /** Lights the unlit shrine a player outside a fight has reached, offline. */
  private checkReach(scenePos: { x: number; z: number }): Shrine | null {
    const x = scenePos.x + LEGACY_SINDR_ORIGIN.x;
    const z = scenePos.z + LEGACY_SINDR_ORIGIN.z;
    const shrine = shrineToLight(this.litIds, x, z);
    if (!shrine) return null;
    this.add([shrine.id]);
    this.events.onNotice?.(`${shrine.name} lit`);
    if (this.signedIn) {
      fetch(`${getServerUrl()}/api/shrines/reach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getStoredAuthToken()}` },
        body: JSON.stringify({ x, z, inFight: false }),
      }).catch(() => {
        // Lit for this session; the server records it the next time the shrine is reached.
      });
    }
    return shrine;
  }

  /** Offline, checks for a shrine to light twice a second, outside a fight. Online the room does this. */
  update(dt: number, scenePos: { x: number; z: number }, inFight: boolean, playingOnline: boolean): void {
    if (playingOnline) return;
    this.checkCooldown -= dt;
    if (this.checkCooldown > 0) return;
    this.checkCooldown = 0.5;
    if (!inFight) this.checkReach(scenePos);
  }

  /** Where a body that fell at a scene position wakes: the lit shrine nearest the fall, in scene metres. */
  wakeSpot(fallScenePos: { x: number; z: number }): { x: number; y: number; z: number; facing: number; shrine: Shrine } {
    const shrine = wakeShrine(this.litIds, fallScenePos.x + LEGACY_SINDR_ORIGIN.x, fallScenePos.z + LEGACY_SINDR_ORIGIN.z);
    return {
      x: shrine.wake.x - LEGACY_SINDR_ORIGIN.x,
      y: shrine.y - LEGACY_SINDR_ORIGIN.y,
      z: shrine.wake.z - LEGACY_SINDR_ORIGIN.z,
      facing: shrine.wake.facing,
      shrine,
    };
  }
}
