import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { BOOT_ASSETS } from '../src/cover-assets.ts';

const publicFile = path => new URL(`../public${path}`, import.meta.url);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('every file the cover warms exists, once', () => {
  assert.ok(BOOT_ASSETS.length > 0);
  assert.equal(new Set(BOOT_ASSETS).size, BOOT_ASSETS.length);
  for (const path of BOOT_ASSETS) assert.ok(existsSync(publicFile(path)), `${path} is missing from public/`);
});

test('the cover posters exist and stay light enough to paint first', () => {
  const posters = [...html.matchAll(/(?:src|srcset)="(\/assets\/cover\/[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(posters.sort(), ['/assets/cover/poster-tall-r5.webp', '/assets/cover/poster-wide-r5.webp']);
  for (const path of posters) assert.ok(statSync(publicFile(path)).size < 400 * 1024, `${path} is over 400 KB`);
});

test('the page boots through the cover, with one Play Now and the legal links', () => {
  assert.match(html, /<script type="module" src="\/src\/cover\.ts"><\/script>/);
  assert.doesNotMatch(html, /src\/main\.ts/);
  assert.equal(html.match(/id="cover-play"/g)?.length, 1);
  for (const page of ['terms', 'privacy', 'cookies']) {
    assert.match(html, new RegExp(`href="/legal/${page}\\.html"`));
    assert.ok(existsSync(publicFile(`/legal/${page}.html`)));
  }
});

test('main exports the start instead of running on import', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /export function startGame\(\): void/);
  assert.doesNotMatch(main, /^main\(\)/m);
});
