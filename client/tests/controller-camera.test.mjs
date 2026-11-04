import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import RAPIER from '@dimforge/rapier3d-compat';
import { PerspectiveCamera, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import balance from '../../shared/balance.json' with { type: 'json' };
import { initPhysics } from '../src/physics.ts';
import { HeroController, FixedStepper, movementVelocity, locomotionForSpeed, turnToward } from '../src/controller.ts';
import { ShoulderCamera, cameraCollisionRadius } from '../src/camera.ts';

const close = (a, b, tolerance = 1e-4) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const move = (forward = 0, right = 0, running = false) => ({ forward, right, running });

test('movement follows camera yaw, normalizes diagonals and uses Shift speed', () => {
  close(movementVelocity(move(1), 0).z, -balance.controller.walkSpeed);
  close(movementVelocity(move(1), Math.PI / 2).x, -balance.controller.walkSpeed);
  close(movementVelocity(move(0, 1), Math.PI / 2).z, -balance.controller.walkSpeed);
  close(movementVelocity(move(1, 1, true), 0).length(), balance.controller.runSpeed);
  close(movementVelocity(move(), 2).length(), 0);
  assert.equal(locomotionForSpeed(0), 'idle');
  assert.equal(locomotionForSpeed(balance.controller.walkSpeed), 'walk');
  assert.equal(locomotionForSpeed(balance.controller.runSpeed), 'run');
  assert.ok(turnToward(Math.PI - 0.1, -Math.PI + 0.1, 1 / 60) > Math.PI - 0.1);
});

test('fixed timestep gives equal travel at 30, 60 and 144 fps; stalls are capped and reset', async () => {
  const distances = [];
  for (const rate of [30, 60, 144]) {
    const physics = await initPhysics();
    const hero = new HeroController(physics.world);
    const clock = new FixedStepper();
    try {
      for (let frame = 0; frame < rate; frame++) clock.advance(1 / rate, () => { hero.step(move(1, 0, true), 0); physics.step(); });
      distances.push(hero.position.z);
      assert.equal(locomotionForSpeed(hero.speed), 'run');
      hero.step(move(), 0); physics.step();
      assert.equal(locomotionForSpeed(hero.speed), 'idle');
    } finally { hero.dispose(); physics.dispose(); }
  }
  distances.forEach(distance => {
    close(distance, distances[0]);
    close(distance, -balance.controller.runSpeed, balance.controller.skin);
  });
  const clock = new FixedStepper();
  let count = 0;
  clock.advance(20, () => count++);
  assert.equal(count, 6);
  clock.advance(1 / 120, () => count++);
  clock.reset();
  clock.advance(1 / 120, () => count++);
  assert.equal(count, 6);
});

test('capsule stays on the floor and inside every wall and corner, sliding along walls', async () => {
  const physics = await initPhysics();
  const hero = new HeroController(physics.world);
  const half = balance.arena.size / 2;
  try {
    for (const [forward, right] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
      hero.body.setTranslation({ x: 0, y: balance.controller.height / 2 + balance.controller.skin, z: 0 }, true);
      physics.step();
      for (let step = 0; step < 500; step++) { hero.step(move(forward, right, true), 0); physics.step(); }
      assert.ok(Math.abs(hero.position.x) < half - balance.controller.radius);
      assert.ok(Math.abs(hero.position.z) < half - balance.controller.radius);
      assert.ok(Math.abs(hero.position.y) < 0.01);
      assert.equal(locomotionForSpeed(hero.speed), 'idle');
    }
    hero.body.setTranslation({ x: half - balance.controller.radius - balance.controller.skin, y: 0.92, z: 0 }, true);
    physics.step();
    for (let step = 0; step < 60; step++) { hero.step(move(1, 1, true), 0); physics.step(); }
    assert.ok(hero.position.z < -3);
    assert.ok(hero.position.x < half - balance.controller.radius);
  } finally { hero.dispose(); physics.dispose(); }
});

test('camera sphere and near-plane corners stay clear at all walls, corners and floor', async () => {
  const physics = await initPhysics();
  const { fov, near, far } = balance.camera;
  const camera = new PerspectiveCamera(fov, 1, near, far);
  const rig = new ShoulderCamera(camera, physics.world);
  const half = balance.arena.size / 2;
  let cases = 0;
  try {
    for (const aspect of [0.5, 16 / 9, 4]) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const radius = cameraCollisionRadius(camera);
      for (const x of [-14.68, 0, 14.68]) for (const z of [-14.68, 0, 14.68]) {
        for (const pitch of [balance.camera.minPitch, 0.15, balance.camera.maxPitch]) {
          for (let angle = 0; angle < 32; angle++) {
            rig.yaw = angle * Math.PI / 16;
            rig.pitch = pitch;
            rig.update(new Vector3(x, 0, z), 1 / 60);
            camera.updateMatrixWorld(true);
            assert.equal(physics.world.intersectionWithShape(camera.position, {x:0,y:0,z:0,w:1},
              new RAPIER.Ball(radius), RAPIER.QueryFilterFlags.ONLY_FIXED), null,
              `sphere collision: ${aspect},${x},${z},${pitch},${angle}`);
            const h = near * Math.tan(fov * Math.PI / 360);
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
              const corner = new Vector3(sx * h * aspect, sy * h, -near).applyMatrix4(camera.matrixWorld);
              assert.ok(corner.y > 0);
              if (corner.y <= balance.arena.wallHeight) {
                assert.ok(Math.abs(corner.x) < half && Math.abs(corner.z) < half);
              }
            }
            cases++;
          }
        }
      }
    }
    assert.equal(cases, 2592);
    rig.yaw = 0;
    rig.pitch = 0;
    // Recovery is checked in the fight view, whose distance the assertions use.
    rig.fight = 1;
    rig.update(new Vector3(0, 0, 14.68), 1 / 60, true);
    const closeDistance = camera.position.distanceTo(new Vector3(0, 1.35, 14.68));
    rig.update(new Vector3(), 1 / 60);
    assert.ok(camera.position.length() < balance.camera.distance);
    rig.update(new Vector3(), 1, true);
    assert.ok(camera.position.distanceTo(new Vector3(0, 1.35, 0)) > closeDistance);
  } finally { physics.dispose(); }
});

test('orbit clamps pitch and the hero feet point toward model +Z', async () => {
  const physics = await initPhysics();
  try {
    const rig = new ShoulderCamera(new PerspectiveCamera(), physics.world);
    rig.orbit(1e5, 1e5);
    close(rig.pitch, balance.camera.maxPitch);
    rig.orbit(0, -1e5);
    close(rig.pitch, balance.camera.minPitch);
    const buffer = await readFile(new URL('../public/assets/characters/hero.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    gltf.scene.updateMatrixWorld(true);
    const foot = gltf.scene.getObjectByName('foot_l');
    const toe = gltf.scene.getObjectByName('ball_l');
    assert.ok(foot && toe);
    assert.ok(toe.getWorldPosition(new Vector3()).z > foot.getWorldPosition(new Vector3()).z);
  } finally { physics.dispose(); }
});

test('in an open zone, shift and place keep the hero standing on the ground; shift stops at walls', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 3, 5).setTranslation(3, 3, 0));
  world.step();
  const hero = new HeroController(world, { x: 0, z: 0 }, undefined, false);
  try {
    for (let i = 0; i < 30; i++) { hero.step(move(), 0); world.step(); }
    const standing = hero.body.translation().y;
    close(hero.position.y, 0, 0.05);
    hero.shift(0.7, 0);
    close(hero.body.translation().y, standing, 0.02);
    close(hero.position.x, 0.7, 0.02);
    hero.shift(5, 0);
    assert.ok(hero.position.x < 2.5 - balance.controller.radius + 0.05, `wall stops the shift at ${hero.position.x}`);
    hero.place(-4, 0, 2);
    close(hero.body.translation().y, standing, 0.02);
    for (let i = 0; i < 30; i++) { hero.step(move(), 0); world.step(); }
    close(hero.position.y, 0, 0.05);
  } finally { hero.dispose(); world.free(); }
});

test('many bodies move in one tick with one world step, and they do not walk through each other', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  world.step();
  const a = new HeroController(world, { x: 0, z: 0 }, undefined, false);
  const b = new HeroController(world, { x: 0, z: -4 }, undefined, false);
  const crowd = Array.from({ length: 20 }, (_, i) => new HeroController(world, { x: 10 + i * 2, z: 0 }, undefined, false));
  let steps = 0;
  const step = world.step.bind(world);
  world.step = () => { steps++; step(); };
  try {
    for (let i = 0; i < 120; i++) {
      a.step(move(1, 0, false), 0);
      b.step(move(-1, 0, false), 0);
      for (const c of crowd) c.step(move(1, 0, false), 0);
      world.step();
    }
    assert.equal(steps, 120, 'one world step per tick, whatever the number of bodies');
    assert.ok(a.position.z < -0.5 && b.position.z > -3.5, 'both walked toward each other');
    assert.ok(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) >= 2 * balance.controller.radius - 0.05,
      `bodies stop at touching, not inside each other: ${a.position.distanceTo(b.position)}`);
    for (const c of crowd) close(c.position.y, 0, 0.05);
    close(a.body.translation().z, a.position.z, 1e-4);
  } finally { for (const c of [a, b, ...crowd]) c.dispose(); world.free(); }
});

test('standOff places a body short of a wall, on the level of the feet it starts from', async () => {
  const { CombatSpace } = await import('../src/attacks/space.ts');
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(6, 10, 0.5).setTranslation(0, 0, 4.5)); // a cliff 4 m to the south
  world.step();
  const space = new CombatSpace(world);
  const feet = new Vector3(0, 3, 0);
  const south = space.standOff(feet, 0, 6);
  assert.ok(south.z <= 4 - 0.8 + 1e-3 && south.z > 2, `stops short of the cliff at ${south.z}`);
  assert.equal(south.y, 3);
  const north = space.standOff(feet, Math.PI, 6);
  close(north.z, -6, 1e-3);
  world.free();
});
