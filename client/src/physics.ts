import RAPIER from '@dimforge/rapier3d-compat';
import balance from '../../shared/balance.json';
import type { Element } from '../../shared/src/index.js';
import { getNationGeography } from './env/nations.js';

export interface PhysicsWorld {
  world: RAPIER.World;
  step(): void;
  dispose(): void;
}

export async function initPhysics(nation?: Element): Promise<PhysicsWorld> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -balance.controller.gravity, z: 0 });
  world.timestep = balance.controller.fixedStep;
  const { size, wallHeight, wallThickness, floorThickness, wallSegments, obstacles } = balance.arena;

  if (!nation) {
    const radius = size / 2;
    world.createCollider(RAPIER.ColliderDesc.cylinder(floorThickness / 2, radius + wallThickness)
      .setTranslation(0, -floorThickness / 2, 0));
    // The round wall is a ring of boxes, each a little longer than its arc so no gaps open.
    const centre = radius + wallThickness / 2;
    const halfLength = Math.PI * centre / wallSegments * 1.1;
    for (let i = 0; i < wallSegments; i++) {
      const angle = (i / wallSegments) * Math.PI * 2;
      world.createCollider(RAPIER.ColliderDesc.cuboid(wallThickness / 2, wallHeight / 2, halfLength)
        .setTranslation(Math.cos(angle) * centre, wallHeight / 2, Math.sin(angle) * centre)
        .setRotation({ x: 0, y: Math.sin(-angle / 2), z: 0, w: Math.cos(-angle / 2) }));
    }
    for (const o of obstacles) {
      world.createCollider(RAPIER.ColliderDesc.cylinder(wallHeight / 2, o.radius)
        .setTranslation(o.x, wallHeight / 2, o.z));
    }
  } else {
    // Geographically attuned non-circular perimeter for the designated nation
    const geo = getNationGeography(nation);
    const { boundary, wallHeight: nHeight, wallThickness: nThick, obstacles: nObs } = geo;
    world.createCollider(RAPIER.ColliderDesc.cuboid(60, floorThickness / 2, 60)
      .setTranslation(0, -floorThickness / 2, 0));
    for (let i = 0; i < boundary.length; i++) {
      const p1 = boundary[i]!;
      const p2 = boundary[(i + 1) % boundary.length]!;
      const mx = (p1.x + p2.x) / 2;
      const mz = (p1.z + p2.z) / 2;
      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const segLength = Math.hypot(dx, dz) * 1.1;
      const angle = Math.atan2(dx, dz);
      world.createCollider(RAPIER.ColliderDesc.cuboid(nThick / 2, nHeight / 2, segLength / 2)
        .setTranslation(mx, nHeight / 2, mz)
        .setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }));
    }
    for (const o of nObs) {
      world.createCollider(RAPIER.ColliderDesc.cylinder((o.height ?? nHeight) / 2, o.radius)
        .setTranslation(o.x, (o.height ?? nHeight) / 2, o.z));
    }
  }

  // Populate the query broad phase before the first controller or camera query.
  world.step();
  return { world, step: () => world.step(), dispose: () => world.free() };
}
