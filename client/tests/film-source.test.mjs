import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { innerWidth: 1280, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
globalThis.navigator ??= {};
const { filmSource } = await import('../src/opening.ts');

test('a phone takes the smallest film whatever its pixel density', () => {
  assert.equal(filmSource({ cssWidth: 390, pixelRatio: 3 }, undefined), '/assets/film/opening-960.mp4');
});

test('larger screens take the size their pixels show', () => {
  assert.equal(filmSource({ cssWidth: 1440, pixelRatio: 1 }, undefined), '/assets/film/opening-1080p.mp4');
  assert.equal(filmSource({ cssWidth: 1440, pixelRatio: 2 }, undefined), '/assets/film/opening-1440p.mp4');
});

test('a slow or data-saving connection steps down until the film fits', () => {
  const retina = { cssWidth: 1440, pixelRatio: 2 };
  assert.equal(filmSource(retina, { downlink: 20 }), '/assets/film/opening-1440p.mp4');
  assert.equal(filmSource(retina, { downlink: 6 }), '/assets/film/opening-1080p.mp4');
  assert.equal(filmSource(retina, { downlink: 3 }), '/assets/film/opening-960.mp4');
  assert.equal(filmSource(retina, { saveData: true }), '/assets/film/opening-960.mp4');
});
