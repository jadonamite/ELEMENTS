export type EnemyKind = 'hound' | 'brawler' | 'armed';

export interface EnemySpawn {
  id: string;
  kind: EnemyKind;
  x: number;
  z: number;
}

export interface ZoneLayout {
  /** Where a player wakes after falling. */
  respawn: { x: number; z: number };
  enemies: EnemySpawn[];
}

/** Server-owned enemies per zone. Positions are metres in the zone's own frame. */
export const ZONES: Record<string, ZoneLayout> = {
  sindr: {
    respawn: { x: 2, z: 0 },
    enemies: [
      { id: 'hound_1', kind: 'hound', x: 128, z: 6 },
      { id: 'villain_1', kind: 'brawler', x: 140, z: -8 },
      { id: 'villain_2', kind: 'armed', x: 140, z: 9 },
    ],
  },
  arena: {
    respawn: { x: 0, z: 0 },
    enemies: [
      { id: 'hound_1', kind: 'hound', x: 0, z: 8 },
    ],
  },
};

export const layoutFor = (zone: string): ZoneLayout => ZONES[zone] ?? ZONES.arena!;
