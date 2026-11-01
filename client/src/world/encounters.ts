import type { Vector3 } from 'three';
import type { Fight } from '../fight.js';
import type { VillainKind } from '../enemy.js';

export interface AmbushSpot {
  name: string;
  triggerX: number;
  triggerZ: number;
  triggerRadius: number;
  spawns: Array<{ x: number; z: number; kind: VillainKind }>;
}

export const AMBUSH_SPOTS: AmbushSpot[] = [
  {
    name: 'gorge-entry',
    triggerX: 275,
    triggerZ: 0,
    triggerRadius: 16,
    spawns: [
      { x: 282, z: -5, kind: 'armed' },
      { x: 284, z: 5, kind: 'brawler' },
    ],
  },
  {
    name: 'collapsed-arch',
    triggerX: 305,
    triggerZ: 0,
    triggerRadius: 15,
    spawns: [
      { x: 312, z: -4.5, kind: 'armed' },
      { x: 308, z: 4.5, kind: 'armed' },
      { x: 315, z: 1.0, kind: 'brawler' },
    ],
  },
  {
    name: 'gorge-bend',
    triggerX: 350,
    triggerZ: 0,
    triggerRadius: 16,
    spawns: [
      { x: 356, z: -6, kind: 'brawler' },
      { x: 358, z: 5, kind: 'armed' },
    ],
  },
  {
    name: 'overturned-wagon',
    triggerX: 385,
    triggerZ: 0,
    triggerRadius: 16,
    spawns: [
      { x: 393, z: 3.5, kind: 'armed' },
      { x: 388, z: 4.0, kind: 'brawler' },
      { x: 395, z: -3.0, kind: 'armed' },
    ],
  },
  {
    name: 'barrens-entry',
    triggerX: 460,
    triggerZ: 0,
    triggerRadius: 18,
    spawns: [
      { x: 468, z: -7, kind: 'armed' },
      { x: 470, z: 6, kind: 'armed' },
      { x: 472, z: -2, kind: 'bender' },
    ],
  },
  {
    name: 'barrens-monoliths',
    triggerX: 575,
    triggerZ: 0,
    triggerRadius: 18,
    spawns: [
      { x: 582, z: 8, kind: 'armed' },
      { x: 585, z: -8, kind: 'brawler' },
      { x: 588, z: 2, kind: 'bender' },
    ],
  },
];

export class EncounterManager {
  private readonly triggered = new Set<string>();

  constructor(private readonly fight: Fight) {}

  update(heroPos: Vector3, nightness = 0): void {
    let ambushParam: string | null = null;
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      ambushParam = params.get('ambush');
    }
    if (ambushParam === 'off') return;
    const forceAlways = ambushParam === 'always';

    // Despawn or clear completed encounter tracking when far away
    for (const spot of AMBUSH_SPOTS) {
      const dist = Math.hypot(heroPos.x - spot.triggerX, heroPos.z - spot.triggerZ);
      if (dist > 80 && this.triggered.has(spot.name)) {
        this.triggered.delete(spot.name);
      }
    }

    // Only one ambush group active at a time
    const living = this.fight.enemies.filter(e => e.alive).length;
    if (living > 0) return;

    for (const spot of AMBUSH_SPOTS) {
      if (this.triggered.has(spot.name)) continue;

      const dist = Math.hypot(heroPos.x - spot.triggerX, heroPos.z - spot.triggerZ);
      if (dist <= spot.triggerRadius) {
        this.triggered.add(spot.name);

        // Roll ambush chance (higher at night)
        const chance = forceAlways ? 1.0 : (0.35 + 0.55 * nightness);
        if (Math.random() <= chance) {
          for (const s of spot.spawns) {
            this.fight.spawnVillain({ x: s.x, z: s.z }, s.kind);
          }
        }
        break;
      }
    }
  }

  isTriggered(name: string): boolean {
    return this.triggered.has(name);
  }

  reset(): void {
    this.triggered.clear();
  }
}
