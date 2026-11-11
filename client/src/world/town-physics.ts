import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, Shell } from './builder.js';
import type { Field } from './landscape.js';

/**
 * A last floor under the whole zone, below the deepest built ground (the canal beds), so it never stands in for
 * ground that is meant to be open: the near land's heightfield and the town's solids are what people walk on.
 */
export const SAFETY_FLOOR = -20;

/** Puts the town into a physics world: the safety floor, the near land when it is a fixed field, every built solid and roof. */
export function addTownPhysics(world: RAPIER.World, near: Field | null, colliders: readonly Collider[], shells: readonly Shell[] = []): void {
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.05, 2000).setTranslation(0, SAFETY_FLOOR - 0.05, 0));
  if (near) world.createCollider(RAPIER.ColliderDesc.heightfield(near.nz, near.nx, near.heights, { x: near.width, y: 1, z: near.depth })
    .setTranslation(near.cx, 0, near.cz));
  for (const c of colliders) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z)
      .setRotation(c.q ?? { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }));
  }
  addShells(world, shells);
}

/** Each shell becomes one triangle-mesh solid; returns them so a place that is torn down can remove them. */
export function addShells(world: RAPIER.World, shells: readonly Shell[]): RAPIER.Collider[] {
  return shells.map(shell => world.createCollider(RAPIER.ColliderDesc.trimesh(shell.vertices, shell.indices)));
}
