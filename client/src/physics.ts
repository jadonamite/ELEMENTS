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
  const { size, wallHeight, wallThickness, floorThickness } = balance.arena;
  const half = size / 2;
  const outer = half + wallThickness / 2;
  const box = (hx: number, hy: number, hz: number, x: number, y: number, z: number): void => {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
  };
  box(half, floorThickness / 2, half, 0, -floorThickness / 2, 0);
  box(outer, wallHeight / 2, wallThickness / 2, 0, wallHeight / 2, -outer);
  box(outer, wallHeight / 2, wallThickness / 2, 0, wallHeight / 2, outer);
  box(wallThickness / 2, wallHeight / 2, outer, -outer, wallHeight / 2, 0);
  box(wallThickness / 2, wallHeight / 2, outer, outer, wallHeight / 2, 0);
  // Populate the query broad phase before the first controller or camera query.
  world.step();
  return { world, step: () => world.step(), dispose: () => world.free() };
}
