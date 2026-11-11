import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider } from './builder.js';
import type { Field } from './landscape.js';

/**
 * A last floor under the whole zone, below the deepest built ground (the canal beds), so it never stands in for
 * ground that is meant to be open: the near land's heightfield and the town's solids are what people walk on.
 */
export const SAFETY_FLOOR = -20;

/** Puts the town into a physics world: optional fixture land and every built solid. */
export function addTownPhysics(world: RAPIER.World, near: Field | null, colliders: readonly Collider[]): void {
  if (near) world.createCollider(RAPIER.ColliderDesc.heightfield(near.nz, near.nx, near.heights, { x: near.width, y: 1, z: near.depth })
    .setTranslation(near.cx, 0, near.cz));
  for (const c of colliders) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z)
      .setRotation(c.q ?? { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }));
  }
}
