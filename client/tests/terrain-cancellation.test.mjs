import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { MeshBasicMaterial, Scene } from 'three';
import { TerrainStream, tileGeometry } from '../src/world/terrain-stream.ts';
import { sampleField } from '../src/world/landscape.ts';
import { IGNIS, LEGACY_SINDR_ORIGIN as O } from '../../shared/src/world/ignis/coordinates.ts';

const home = { x: 225, z: 0 }, away = { x: 3200, z: -2300 };
const height = () => 0;

function result(job) {
  const size = IGNIS.cellSize;
  const field = sampleField((job.ix + 0.5) * size - O.x, (job.iz + 0.5) * size - O.z, size, size, job.step, height);
  const geometry = tileGeometry(field, 16, height);
  try {
    return { heights: field.heights, positions: geometry.getAttribute('position').array.slice(),
      normals: geometry.getAttribute('normal').array.slice(), uv: geometry.getAttribute('uv').array.slice(),
      indices: geometry.index.array.slice(), cpuMs: 1 };
  } finally { geometry.dispose(); }
}

for (const phase of ['queued', 'in flight', 'completed before upload']) {
  test(`moving away cancels a cell ${phase} without scene or physics additions`, async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const scene = new Scene(), material = new MeshBasicMaterial(), sent = [];
    const worker = { onmessage: null, onerror: null, onmessageerror: null,
      postMessage(message) { if (!message.patch) sent.push(message); }, terminate() {} };
    const stream = new TerrainStream(world, height, scene, material, false, { workerFactory: () => worker });
    try {
      stream.startWorker({ x0: 0, x1: 2, z0: 0, z1: 2 });
      stream.request(home.x, home.z);
      let stale;
      if (phase !== 'queued') {
        stream.tick(home.x, home.z);
        assert.equal(sent.length, 1, 'old cell dispatched');
        stale = sent[0];
        if (phase === 'completed before upload') worker.onmessage({ data: result(stale) });
      }
      stream.request(away.x, away.z);
      if (phase === 'in flight') worker.onmessage({ data: result(stale) });
      stream.tick(away.x, away.z);
      assert.equal(stream.near.cells.size + stream.mid.cells.size, 0, 'cancelled result never becomes a resident cell');
      assert.equal(world.colliders.len(), 0, 'cancelled result never creates collision');
      for (const tier of [stream.near, stream.mid]) for (const slot of tier.slots) {
        assert.equal(tier.batch.getVisibleAt(slot.instance), false, 'cancelled result never becomes visible');
      }
      assert.equal(scene.children.length, 3, 'no extra scene object added');
      // Complete the replacement queue to prove cancellation does not stop useful work.
      let consumed = phase === 'queued' ? 0 : 1;
      while (consumed < sent.length) {
        const job = sent[consumed++];
        const x = (job.ix + 0.5) * IGNIS.cellSize - O.x;
        const z = (job.iz + 0.5) * IGNIS.cellSize - O.z;
        assert.ok(Math.hypot(x - away.x, z - away.z) < 1600, 'only replacement cells dispatched');
        worker.onmessage({ data: result(job) });
        stream.tick(away.x, away.z);
      }
      const midJobs = sent.slice(phase === 'queued' ? 0 : 1).filter(job => job.step === stream.mid.step).length;
      assert.ok(stream.idle, 'no work left after the replacement ring');
      assert.equal(stream.near.cells.size, 9, 'replacement near ring finishes');
      assert.ok(midJobs > 0 && stream.mid.cells.size === midJobs, 'every replacement mid cell dispatched becomes resident');
      assert.equal(world.colliders.len(), 9, 'only replacement near cells add physics');
      assert.equal(stream.has(home.x, home.z), false, 'old cell remains absent after all completions');
      assert.equal(stream.has(away.x, away.z), true);
    } finally { stream.dispose(); material.dispose(); world.free(); }
  });
}
