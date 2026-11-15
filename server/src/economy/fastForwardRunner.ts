import { Worker } from 'node:worker_threads';
import type { FastForwardWeek } from './fastForward.js';

// Runs a simulated week in its own thread, one at a time, and keeps recent weeks by seed.
const cache = new Map<number, FastForwardWeek>();
let running: Promise<FastForwardWeek> | null = null;

function runWorker(seed: number): Promise<FastForwardWeek> {
  const fromSource = import.meta.url.endsWith('.ts');
  const file = new URL(fromSource ? './fastForwardWorker.ts' : './fastForwardWorker.js', import.meta.url);
  const worker = new Worker(file, { workerData: { seed }, execArgv: fromSource ? ['--import', 'tsx'] : [] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Simulation took too long')); }, 60_000);
    worker.once('message', (msg: { ok: boolean; week?: FastForwardWeek; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (msg.ok && msg.week) resolve(msg.week);
      else reject(new Error(msg.error ?? 'Simulation failed'));
    });
    worker.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

export async function fastForwardWeek(seed: number): Promise<FastForwardWeek> {
  const hit = cache.get(seed);
  if (hit) return hit;
  while (running) await running.catch(() => undefined);
  const again = cache.get(seed);
  if (again) return again;
  running = runWorker(seed);
  try {
    const week = await running;
    cache.set(seed, week);
    if (cache.size > 8) cache.delete(cache.keys().next().value as number);
    return week;
  } finally {
    running = null;
  }
}
