/**
 * Where a kill goes once the server has judged it. The economy listens here to drop
 * loot; nothing a browser sends can call it, because only ZoneWorld.hit reaches it.
 */
export interface KillReport {
  zone: string;
  /** The ZoneWorld the kill happened in; two rooms can run the same zone. */
  worldId: string;
  enemyId: string;
  /** 'hound' is a monster; 'brawler' and 'armed' are villains. */
  kind: string;
  x: number;
  z: number;
  /** Account that landed the killing blow. */
  killerAccountId: string;
  /** Damage dealt per account since the enemy last stood up, for shared kills. */
  damageBy: Record<string, number>;
  /** Server time of the kill, seconds since the room opened. */
  at: number;
}

export type KillHook = (kill: KillReport) => void;

const hooks = new Set<KillHook>();

/** Adds a listener; returns a function that removes it. */
export function onKill(hook: KillHook): () => void {
  hooks.add(hook);
  return () => { hooks.delete(hook); };
}

export function reportKill(kill: KillReport): void {
  for (const hook of hooks) {
    try {
      hook(kill);
    } catch (error) {
      console.error('Kill hook failed:', error);
    }
  }
}
