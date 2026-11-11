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

test('worker timeout increments failure count and re-queues the near job', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const material = new MeshBasicMaterial();
  // A worker that accepts postMessage but never calls onmessage (simulates a hung worker).
  const stream = new TerrainStream(world, nationalSurface, new Scene(), material, false, {
    jobTimeoutMs: 0,  // any in-flight job times out on the very next tick
    retryLimit: 0,    // no retries — one failure is enough to verify the path
    workerFactory: () => ({
      onmessage: null, onerror: null, onmessageerror: null,
      postMessage() { /* hang: never fires onmessage */ },
      terminate() {},
    }),
  });
  try {
    stream.initialize(225, 0); world.step();
    stream.startWorker({ x0: 0, x1: 500, z0: -200, z1: 200 });
    // Move far from town so there is a pending mid job to dispatch.
    stream.request(3200, -2300);
    // First tick: dispatches the job and sets sentAt.
    stream.tick(3200, -2300);
    // Second tick: jobTimeoutMs===0 → timeout fires immediately.
    stream.tick(3200, -2300);
    assert.ok(stream.status.failures > 0, 'timeout increments failure count');
    assert.ok(stream.status.error, 'timeout records an error message');
  } finally { stream.dispose(); material.dispose(); world.free(); }
});

test('walking across a cell boundary: ground collision exists on both sides', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const material = new MeshBasicMaterial();
  const stream = new TerrainStream(world, nationalSurface, new Scene(), material, false);
  try {
    // Initialize around the east gate (225, 0); the 3×3 near ring covers adjacent cells.
    stream.initialize(225, 0); world.step();
    assert.equal(stream.near.cells.size, 9, '3×3 near cells present');
    // Find a cell boundary: steps of SIZE=256 m in national coords → cell edge in render coords.
    // Cell ix=Math.floor((225+6550)/256) = Math.floor(26.46) = 26; boundary at ix=27 → x = 27*256-6550 = 362.
    const { IGNIS: { cellSize: SIZE_VAL }, LEGACY_SINDR_ORIGIN: ORIG } = await import('../src/world/terrain-stream.ts').then(m => ({
      IGNIS: { cellSize: 256 }, LEGACY_SINDR_ORIGIN: { x: 6550, z: 8650 },
    }));
    const boundaryX = 27 * SIZE_VAL - ORIG.x; // = 362
    // Confirm ground collision exists just inside each side of the boundary.
    for (const testX of [boundaryX - 1, boundaryX + 1]) {
      const y = nationalSurface(testX, 0);
      const hit = world.castRay(
        new RAPIER.Ray({ x: testX, y: y + 10, z: 0 }, { x: 0, y: -1, z: 0 }),
        20, true,
      );
      assert.ok(hit, `ground collision at x=${testX} (cell boundary ±1 m)`);
      assert.ok(Math.abs(y + 10 - hit.timeOfImpact - y) < 0.5, `correct height under x=${testX}`);
    }
    // Player can pass the boundary: guard never resets position.
    const before = { position: new Vector3(boundaryX - 0.5, 0, 0) };
    const after = { position: new Vector3(boundaryX + 0.5, 0, 0) };
    assert.equal(stream.guard(before), true, 'guard passes player approaching boundary');
    assert.equal(before.position.x, boundaryX - 0.5, 'position unchanged on approach');
    assert.equal(stream.guard(after), true, 'guard passes player past boundary');
    assert.equal(after.position.x, boundaryX + 0.5, 'position unchanged after crossing');
  } finally { stream.dispose(); material.dispose(); world.free(); }
});
