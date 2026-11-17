import {
  FIRST_SHRINE,
  LEGACY_SINDR_ORIGIN,
  shrineById,
  shrineToLight,
  wakeShrine,
  type Shrine,
} from '../../shared/src/index.js';
import { getServerUrl, getStoredAuthToken, hasGameServer } from './auth/server-api.js';

const STORAGE_SHRINES_KEY = 'elements_lit_shrines';

export interface ShrineStateEvents {
  onLit?: (shrine: Shrine) => void;
  onNotice?: (text: string) => void;
}

export class ShrineState {
  private readonly litIds = new Set<string>([FIRST_SHRINE]);
  private checkCooldown = 0;

  constructor(private readonly events: ShrineStateEvents = {}) {
    void this.load();
  }

  get lit(): ReadonlySet<string> {
    return this.litIds;
  }

  isLit(shrineId: string): boolean {
    return shrineId === FIRST_SHRINE || this.litIds.has(shrineId);
  }

  /** Populated online from OnlineSession onShrines. */
  setOnlineLit(ids: string[]): void {
    for (const id of ids) {
      if (shrineById(id)) this.litIds.add(id);
    }
    this.saveGuest();
  }

  /** Populated online from OnlineSession onShrineLit. */
  onOnlineShrineLit(shrineId: string): void {
    const shrine = shrineById(shrineId);
    if (!shrine) return;
    if (!this.litIds.has(shrineId)) {
      this.litIds.add(shrineId);
      this.events.onLit?.(shrine);
      this.events.onNotice?.(`${shrine.name} lit`);
      this.saveGuest();
    }
  }

  /** Load lit shrines on startup: from server if signed in, from localStorage for guests. */
  async load(): Promise<void> {
    try {
      const raw = localStorage.getItem(STORAGE_SHRINES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string' && shrineById(id)) this.litIds.add(id);
          }
        }
      }
    } catch {
      // Storage may be unavailable.
    }

    const token = getStoredAuthToken();
    if (token && hasGameServer()) {
      try {
        const res = await fetch(`${getServerUrl()}/api/shrines`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const body = (await res.json()) as { lit?: string[] };
          if (Array.isArray(body.lit)) {
            for (const id of body.lit) {
              if (shrineById(id)) this.litIds.add(id);
            }
          }
        }
      } catch {
        // Network unavailable: local state stands.
      }
    }
  }

  private saveGuest(): void {
    try {
      localStorage.setItem(STORAGE_SHRINES_KEY, JSON.stringify([...this.litIds]));
    } catch {
      // Storage may be unavailable.
    }
  }

  /**
   * Check if player standing at local scene position reached an unlit shrine.
   * Coordinates are nation-global minus LEGACY_SINDR_ORIGIN.
   */
  checkReach(scenePos: { x: number; z: number }, inFight: boolean): Shrine | null {
    if (inFight) return null;
    const globalX = scenePos.x + LEGACY_SINDR_ORIGIN.x;
    const globalZ = scenePos.z + LEGACY_SINDR_ORIGIN.z;
    const shrine = shrineToLight(this.litIds, globalX, globalZ);
    if (!shrine) return null;

    this.litIds.add(shrine.id);
    this.events.onLit?.(shrine);
    this.events.onNotice?.(`${shrine.name} lit`);

    const token = getStoredAuthToken();
    if (token && hasGameServer()) {
      fetch(`${getServerUrl()}/api/shrines/reach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ x: globalX, z: globalZ, inFight: false }),
      }).catch(() => {
        // Retry or offline.
      });
    } else {
      this.saveGuest();
    }

    return shrine;
  }

  /**
   * Periodic update: throttles offline shrine check to once every half second outside a fight.
   */
  update(dt: number, scenePos: { x: number; z: number }, inFight: boolean, playingOnline: boolean): void {
    if (playingOnline) return;
    this.checkCooldown -= dt;
    if (this.checkCooldown <= 0) {
      this.checkCooldown = 0.5;
      if (!inFight) {
        this.checkReach(scenePos, false);
      }
    }
  }

  /**
   * Where a fallen player wakes: the lit shrine nearest where they fell.
   * Coordinates in local scene space.
   */
  wakeSpot(fallScenePos: { x: number; z: number }): { x: number; y: number; z: number; facing: number; shrine: Shrine } {
    const globalFallX = fallScenePos.x + LEGACY_SINDR_ORIGIN.x;
    const globalFallZ = fallScenePos.z + LEGACY_SINDR_ORIGIN.z;
    const shrine = wakeShrine(this.litIds, globalFallX, globalFallZ);
    return {
      x: shrine.wake.x - LEGACY_SINDR_ORIGIN.x,
      y: shrine.y - LEGACY_SINDR_ORIGIN.y,
      z: shrine.wake.z - LEGACY_SINDR_ORIGIN.z,
      facing: shrine.wake.facing,
      shrine,
    };
  }
}
