import { parentPort, workerData } from 'node:worker_threads';
import { simulateWeek } from './fastForward.js';

// Keeper ticks log every decision; a simulated week would flood the server log.
console.log = () => {};
console.error = () => {};

simulateWeek(Number(workerData?.seed) || 1)
  .then((week) => parentPort?.postMessage({ ok: true, week }))
  .catch((err: unknown) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }));
