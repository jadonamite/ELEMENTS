// Builds Sindr into a physics world the way the game does, with its walk map, for tests that walk the town.
import RAPIER from '@dimforge/rapier3d-compat';
import { CombatSpace } from '../src/attacks/space.ts';
import { SINDR_WALK } from '../src/life/town-manager.ts';
import { WalkMap } from '../src/life/walk-map.ts';
import { WorldBuilder } from '../src/world/builder.ts';
import { surfaceAt, sampleField } from '../src/world/landscape.ts';
import { WALKABLE, buildSindr } from '../src/world/sindr.ts';
import { addTownPhysics } from '../src/world/town-physics.ts';

/** The built town, its physics world and walk map. `extra` colliders (boxes) are added to block routes. */
export async function townWorld(extra = []) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const builder = new WorldBuilder();
  const areas = buildSindr(builder);
  const walkable = WALKABLE.with(areas);
  const near = sampleField(340, -10, 1020, 500, 3, (x, z) => surfaceAt(x, z, walkable));
  addTownPhysics(world, near, [...builder.colliders, ...extra]);
  world.step();
  const space = new CombatSpace(world);
  const map = WalkMap.now(space, SINDR_WALK.seeds, SINDR_WALK.bounds, SINDR_WALK.water);
  return { world, builder, space, map, near, walkable };
}
