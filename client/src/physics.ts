/**
 * Rapier physics world for the arena: fixed colliders for the floor and
 * four walls, plus a test ball that can be dropped to verify collisions.
 *
 * Uses @dimforge/rapier3d-compat (the WebAssembly build that works in the
 * browser without native bindings).
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import { ARENA_SIZE } from './scene.js';

/* ---------- constants ---------- */

const WALL_HEIGHT = 2.5;
const WALL_THICKNESS = 0.6;
const HALF = ARENA_SIZE / 2;

/* ---------- init ---------- */

export interface PhysicsWorld {
  world: RAPIER.World;
  /** Advance one step; call once per frame. */
  step(): void;
  /**
   * Drop a test ball from `height` metres. Returns a handle to query its
   * position, used to verify collisions work.
   */
  dropTestBall(height: number): RAPIER.RigidBody;
}

/**
 * Initialise Rapier and build the arena's static colliders.
 * Must be called once before the render loop starts.
 */
export async function initPhysics(): Promise<PhysicsWorld> {
  const RAPIER = await import('@dimforge/rapier3d-compat');
  await RAPIER.init();

  const gravity = new RAPIER.Vector3(0, -9.81, 0);
  const world = new RAPIER.World(gravity);

  /* --- floor (thin box lying flat at y = 0) --- */
  const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0);
  const floorBody = world.createRigidBody(floorDesc);
  const floorCollider = RAPIER.ColliderDesc.cuboid(HALF, 0.05, HALF);
  world.createCollider(floorCollider, floorBody);

  /* --- walls --- */
  const wallHalf = WALL_HEIGHT / 2;
  const thickHalf = WALL_THICKNESS / 2;
  const outerHalf = HALF + thickHalf;

  // North wall (negative Z)
  addBoxCollider(world, RAPIER, outerHalf, wallHalf, thickHalf, 0, wallHalf, -outerHalf);
  // South wall (positive Z)
  addBoxCollider(world, RAPIER, outerHalf, wallHalf, thickHalf, 0, wallHalf, outerHalf);
  // West wall (negative X)
  addBoxCollider(world, RAPIER, thickHalf, wallHalf, outerHalf, -outerHalf, wallHalf, 0);
  // East wall (positive X)
  addBoxCollider(world, RAPIER, thickHalf, wallHalf, outerHalf, outerHalf, wallHalf, 0);

  function step(): void {
    world.step();
  }

  function dropTestBall(height: number): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, height, 0);
    const body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(0.25).setRestitution(0.3);
    world.createCollider(colliderDesc, body);
    return body;
  }

  return { world, step, dropTestBall };
}

/* ---------- helpers ---------- */

function addBoxCollider(
  world: RAPIER.World,
  RAPIER: typeof import('@dimforge/rapier3d-compat'),
  hx: number,
  hy: number,
  hz: number,
  x: number,
  y: number,
  z: number,
): void {
  const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
  const body = world.createRigidBody(desc);
  const collider = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
  world.createCollider(collider, body);
}
