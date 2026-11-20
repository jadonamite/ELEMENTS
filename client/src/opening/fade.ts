const fading = new WeakMap<HTMLMediaElement, number>();

/**
 * Moves an audio element's volume to `to` over `ms` milliseconds, eased, and resolves when it gets there.
 * A newer fade on the same element takes over from wherever this one had reached. Runs on timers, not
 * animation frames, so it still finishes in a background tab.
 */
export function fadeVolume(audio: HTMLMediaElement, to: number, ms: number): Promise<void> {
  const id = (fading.get(audio) ?? 0) + 1;
  fading.set(audio, id);
  const from = audio.volume;
  const start = performance.now();
  return new Promise(resolve => {
    const step = (): void => {
      if (fading.get(audio) !== id) { resolve(); return; }
      const k = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms);
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * k * k * (3 - 2 * k)));
      if (k < 1) setTimeout(step, 30);
      else resolve();
    };
    step();
  });
}
