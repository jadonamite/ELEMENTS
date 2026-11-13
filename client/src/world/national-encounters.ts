import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, type WebGLRenderer } from 'three';
import { LEGACY_SINDR_ORIGIN as ORIGIN } from '../../../shared/src/world/ignis/coordinates.js';
import { groundHeight, waterHeight } from '../../../shared/src/world/ignis/ground.js';
import { NATIONAL_ROUTES, routePointAt } from '../../../shared/src/world/ignis/routes.js';
import { wildPlace } from '../../../shared/src/world/ignis/wild.js';
import { CombatSpace } from '../attacks/space.js';
import type { VillainKind } from '../enemy.js';
import type { Fight } from '../fight.js';
import { loadHoundTemplate, type HoundTemplate } from '../monsters/hound.js';

interface RoadEncounter {
  id: string;
  x: number;
  z: number;
  heading: number;
  kind: 'robber' | 'deserter' | 'hounds';
}

/** Stations are measured along national roads, never along the retired east strip. */
export const NATIONAL_ENCOUNTERS: readonly RoadEncounter[] = NATIONAL_ROUTES.flatMap(road => {
  if (road.id !== 'fort' && road.id !== 'ash' && road.id !== 'barrens') return [];
  const spots: RoadEncounter[] = [];
  for (let station = 420, index = 0; station < road.length - 240; station += 680, index++) {
    const p = routePointAt(road, station), ahead = routePointAt(road, station + 8);
    spots.push({ id: `${road.id}:${index}`, x: p.x, z: p.z,
      heading: Math.atan2(ahead.x - p.x, ahead.z - p.z),
      kind: road.id === 'barrens' ? 'hounds' : index % 2 === 0 ? 'robber' : 'deserter' });
  }
  // The far Barrens road is the approach into the ruined wild land.
  if (road.id === 'barrens') {
    const p = routePointAt(road, road.length - 120), before = routePointAt(road, road.length - 128);
    spots.push({ id: 'barrens:ruin-approach', x: p.x, z: p.z,
      heading: Math.atan2(p.x - before.x, p.z - before.z), kind: 'hounds' });
  }
  return spots;
}).concat((() => {
  const hollow = wildPlace('hollow');
  return [{ id: 'hollow:camp', x: hollow.x + 6, z: hollow.z + 4, heading: 0, kind: 'robber' as const }];
})());

export class NationalEncounterManager {
  private readonly visited = new Map<string, number>();
  private readonly space: CombatSpace;
  private elapsed = 0;
  private disposed = false;
  private template: HoundTemplate | null = null;
  private loading: Promise<void> | null = null;
  private loadFailed = false;

  constructor(private readonly fight: Fight, world: RAPIER.World, private readonly renderer: WebGLRenderer,
    private readonly enabled: boolean, private readonly ambush: string | null,
    private readonly notice: (message: string) => void) {
    this.space = new CombatSpace(world);
  }

  update(delta: number, hero: Vector3, nightness: number): void {
    if (!this.enabled || this.disposed || this.ambush === 'off') return;
    this.elapsed += delta;
    const x = hero.x + ORIGIN.x, z = hero.z + ORIGIN.z;
    for (const spot of NATIONAL_ENCOUNTERS) {
      const last = this.visited.get(spot.id);
      if (last !== undefined && this.elapsed - last > 180 && Math.hypot(x - spot.x, z - spot.z) > 250) {
        this.visited.delete(spot.id);
      }
    }
    if (!this.fight.heroAlive || this.fight.livingCount > 0) return;
    for (const spot of NATIONAL_ENCOUNTERS) {
      if (this.visited.has(spot.id) || Math.hypot(x - spot.x, z - spot.z) > 26) continue;
      if (spot.kind === 'hounds' && !this.template) {
        this.loadTemplate();
        return;
      }
      const spawns: Vector3[] = [];
      for (let i = 0; i < 3; i++) {
        const along = 8 + i * 2, side = i % 2 === 0 ? 3 : -3;
        const sx = spot.x + Math.sin(spot.heading) * along + Math.cos(spot.heading) * side;
        const sz = spot.z + Math.cos(spot.heading) * along - Math.sin(spot.heading) * side;
        if (waterHeight(sx, sz) !== null) continue;
        const y = groundHeight(sx, sz) - ORIGIN.y;
        const floor = this.space.floor(sx - ORIGIN.x, y + 2, sz - ORIGIN.z, 5);
        // Wait for terrain physics residency before attempting this encounter.
        if (floor === null || Math.abs(floor - y) > 1) return;
        spawns.push(new Vector3(sx - ORIGIN.x, floor, sz - ORIGIN.z));
      }
      if (spawns.length !== 3) continue;
      this.visited.set(spot.id, this.elapsed);
      const darkness = Math.max(0, Math.min(1, nightness));
      const chance = spot.kind === 'hounds' ? 0.4 + darkness * 0.45 : 0.3 + darkness * 0.5;
      if (this.ambush !== 'always' && Math.random() > chance) return;
      if (spot.kind === 'hounds') {
        this.fight.spawnHounds(this.template!, spawns[0]!);
        this.notice('Ember hounds are stalking the road.');
      } else {
        const kind: VillainKind = spot.kind;
        for (const point of spawns) this.fight.spawnVillain(point, kind);
        this.notice(kind === 'robber' ? 'Robbers block the road.' : 'Deserters break cover.');
      }
      return;
    }
  }

  private loadTemplate(): void {
    if (this.loading || this.loadFailed) return;
    this.loading = loadHoundTemplate(undefined, this.renderer).then(template => {
      if (this.disposed) this.releaseTemplate(template);
      else this.template = template;
    }).catch(() => {
      this.loadFailed = true;
      if (!this.disposed) this.notice('Ember hounds could not be loaded.');
    }).finally(() => { this.loading = null; });
  }

  private releaseTemplate(template: HoundTemplate): void {
    template.model.traverse(node => {
      if (!('isMesh' in node) || !node.isMesh) return;
      const mesh = node as import('three').Mesh;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(material => material.dispose());
    });
  }

  dispose(): void {
    this.disposed = true;
    this.visited.clear();
    if (this.template) this.releaseTemplate(this.template);
    this.template = null;
  }
}
