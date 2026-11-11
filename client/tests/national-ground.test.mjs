import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { MeshBasicMaterial, Scene, Vector3 } from 'three';
import { TerrainStream } from '../src/world/terrain-stream.ts';
import { nationalSurface, surfaceAt } from '../src/world/landscape.ts';
import { Levels, rectArea } from '../src/world/levels.ts';

test('built ground keeps canal beds and releases the national field at the six metre seam', () => {
  const built = new Levels([rectArea('bed', { x0: 0, x1: 4, z0: 0, z1: 4 }, 0, -3)]);
  assert.equal(surfaceAt(2, 2, built), -3);
  assert.equal(surfaceAt(10, 2, built), nationalSurface(10, 2));
  assert.ok(Math.abs(surfaceAt(10 - 1e-4, 2, built) - surfaceAt(10 + 1e-4, 2, built)) < 0.001);
});

test('initialize pins town collision that survives eviction; streaming cells are disposed', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const material = new MeshBasicMaterial(), stream = new TerrainStream(world, nationalSurface, new Scene(), material, false);
  try {
    stream.initialize(225, 0); world.step();
    assert.equal(stream.near.step, 2);
    assert.equal(stream.near.cells.size, 9);
    const initialColliders = world.colliders.len();
    assert.equal(initialColliders, 9);
    // Ray cast confirms ground collision at shared cell edges and the gate.
    for (const x of [35, 37, 39, 225]) {
      const y = nationalSurface(x, 0);
      const hit = world.castRay(new RAPIER.Ray({ x, y: y + 10, z: 0 }, { x: 0, y: -1, z: 0 }), 20, true);
      assert.ok(hit, `ground under ${x}`);
      assert.ok(Math.abs(y + 10 - hit.timeOfImpact - y) < 0.02);
    }
    // Eviction removes cell entries but pinned town colliders survive for the hero's return.
    stream.request(3200, -2300);
    assert.equal(stream.near.cells.size, 0, 'cell entries evicted');
    assert.equal(world.colliders.len(), 9, 'pinned town colliders retained');
    assert.equal(stream.has(3200, -2300), false, 'distant cell not yet streamed');
  } finally { stream.dispose(); material.dispose(); world.free(); }
});

test('guard always returns true; movement is bounded by physical frontier, not by resets', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const material = new MeshBasicMaterial(), stream = new TerrainStream(world, nationalSurface, new Scene(), material, false);
  try {
    stream.initialize(225, 0); world.step();
    const controller = { position: new Vector3(225, 0, 0) };
    // Guard never resets position; it returns true and relies on physical barriers.
    const result = stream.guard(controller);
    assert.equal(result, true, 'guard returns true, no teleport');
    assert.equal(controller.position.x, 225, 'position unchanged by guard');
  } finally { stream.dispose(); material.dispose(); world.free(); }
});

test('worker failure increments status, retries up to the limit, then stops', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const material = new MeshBasicMaterial();
  let workerCount = 0;
  const stream = new TerrainStream(world, nationalSurface, new Scene(), material, false, {
    retryLimit: 1,
    workerFactory: () => {
      workerCount++;
      // Return an object that immediately fires an error when a message is posted.
      const w = { onmessage: null, onerror: null, onmessageerror: null,
        postMessage() { throw new Error('Test worker failure'); },
        terminate() {} };
      return w;
    },
  });
  try {
    stream.initialize(225, 0); world.step();
    // Move far enough to trigger streaming jobs.
    stream.request(3200, -2300);
    // Start the worker; it will fail on postMessage and retry.
    stream.startWorker({ x0: 0, x1: 500, z0: -200, z1: 200 });
    // Tick to trigger the pending job dispatch (which will fail).
    stream.tick(3200, -2300);
    assert.ok(stream.status.failures > 0, 'failure count incremented');
    assert.ok(stream.status.error, 'error message recorded');
    // After retryLimit+1 total failures, no more workers are opened.
    assert.ok(workerCount <= 3, `worker factory called at most retryLimit+1 times, got ${workerCount}`);
  } finally { stream.dispose(); material.dispose(); world.free(); }
});

test('dispose cleans up all colliders, cells, and frontier barriers', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const material = new MeshBasicMaterial(), stream = new TerrainStream(world, nationalSurface, new Scene(), material, false);
  try {
    stream.initialize(225, 0); world.step();
    assert.equal(world.colliders.len(), 9);
    stream.dispose();
    assert.equal(world.colliders.len(), 0, 'all colliders freed on dispose');
    assert.equal(stream.near.cells.size, 0, 'near cells cleared');
    assert.equal(stream.mid.cells.size, 0, 'mid cells cleared');
  } finally { material.dispose(); world.free(); }
});
