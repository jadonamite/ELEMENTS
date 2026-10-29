import RAPIER from '@dimforge/rapier3d-compat';
import balance from '../../shared/balance.json';

export interface PhysicsWorld {
  world: RAPIER.World;
  step(): void;
  dispose(): void;
}

export async function initPhysics(): Promise<PhysicsWorld> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -balance.controller.gravity, z: 0 });
  world.timestep = balance.controller.fixedStep;
  const { size, wallHeight, wallThickness, floorThickness, wallSegments, obstacles } = balance.arena;
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
  // Populate the query broad phase before the first controller or camera query.
  world.step();
  return { world, step: () => world.step(), dispose: () => world.free() };
}
