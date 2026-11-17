// Every shipped character, weapon and effect file is the output of `npm run assets:pack` from its original in art/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST, PACKED_FOLDERS } from '../scripts/packed-assets.mjs';

const ROOT = join(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST), 'utf8'));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
const list = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name) : []);
const FIX = 'run `npm run assets:pack` and commit the result';

/** The JSON chunk of a GLB. */
function gltfJson(path) {
  const bytes = readFileSync(path);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

for (const folder of PACKED_FOLDERS) {
  const publicDir = join(ROOT, 'client/public/assets', folder.dir);
  const artDir = join(ROOT, 'art', folder.from ?? folder.dir);
  const isGlb = folder.glb;

  test(`${folder.dir}: no unpacked ${isGlb ? 'GLB' : 'image'} ships`, () => {
    for (const name of list(publicDir).filter(n => folder.source.test(n))) {
      const key = `client/public/assets/${folder.dir}/${name}`;
      if (folder.out(name) !== name) assert.fail(`${key} is an original in public/: ${FIX}`);
      const entry = manifest[key];
      assert.ok(entry, `${key} was not written by the pack script: ${FIX}`);
      assert.equal(sha(join(publicDir, name)), entry.output, `${key} changed after packing: ${FIX}`);
    }
  });

  test(`${folder.dir}: every original in art/ is packed and current`, () => {
    for (const name of list(artDir).filter(n => folder.source.test(n))) {
      const out = folder.out(name);
      const key = `client/public/assets/${folder.dir}/${out}`;
      const entry = manifest[key];
      assert.ok(entry && existsSync(join(publicDir, out)), `${key} is missing: ${FIX}`);
      assert.equal(sha(join(artDir, name)), entry.source, `art/${folder.dir}/${name} changed since packing: ${FIX}`);
      assert.equal(sha(join(publicDir, out)), entry.output, `${key} changed after packing: ${FIX}`);
      if (!isGlb) continue;
      const json = gltfJson(join(publicDir, out));
      assert.ok(json.extensionsUsed?.includes('EXT_meshopt_compression'), `${key} has no meshopt geometry`);
      if (folder.kind === 'far') continue;
      const loose = (json.images ?? []).filter(image => image.mimeType !== 'image/ktx2');
      assert.equal(loose.length, 0, `${key} has ${loose.length} images that are not KTX2`);
    }
  });
}
