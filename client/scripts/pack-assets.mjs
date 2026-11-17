#!/usr/bin/env node
/**
 * Packs shipped character, weapon and effect assets from their originals in art/ into what the game
 * loads from client/public/assets: GLBs get meshopt geometry and KTX2 textures, images become KTX2.
 *
 * A GLB or image found in a packed folder that this script did not write (a new or rebuilt body dropped
 * into public/) is taken as the new original: it is copied into art/ and packed. art/packed.json records,
 * per output, the hash of its original, of the recipe and of the output; the asset-pack test checks it.
 *
 *   npm run assets:pack            pack what changed
 *   npm run assets:pack -- --force pack everything again
 *   npm run assets:pack -- --size 2048 --normal-size 512 --out <dir>   trial sizes written to <dir> (no manifest)
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, reorder, textureCompress } from '@gltf-transform/functions';
import { Mode, toktx } from '@gltf-transform/cli';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { CHARACTER_TEXTURE_SIZE, CLOSE_UP_NORMAL_SIZE, CLOSE_UP_TEXTURE_SIZE, MANIFEST, NORMAL_TEXTURE_SIZE, PACKED_FOLDERS } from './packed-assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = join(ROOT, 'client/public/assets');
const ART = join(ROOT, 'art');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const force = args.includes('--force');
const size = Number(flag('--size') ?? CHARACTER_TEXTURE_SIZE);
const normalSize = Number(flag('--normal-size') ?? NORMAL_TEXTURE_SIZE);
const outDir = flag('--out');
const only = flag('--only');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const toktxVersion = execFileSync('toktx', ['--version']).toString().trim();

/** Everything that changes an output; a change re-packs it. */
const RECIPES = {
  body: { v: 1, size, normalSize, color: 'etc1s q255 c2', normal: 'uastc 2 rdo 1.5 zstd 18', positions: 'scene volume' },
  far: { v: 1, textures: 'kept', positions: 'float' },
  closeup: { v: 1, size: CLOSE_UP_TEXTURE_SIZE, normalSize: CLOSE_UP_NORMAL_SIZE, color: 'etc1s q255 c2', normal: 'uastc 2 rdo 1.5 zstd 18', positions: 'scene volume' },
  weapon: { v: 1, normalSize, color: 'etc1s q255 c2', normal: 'uastc 2 rdo 1.5 zstd 18', positions: 'float' },
  image: { v: 1, mode: 'etc1s q255 c2 mipmaps srgb' },
  atlas: { v: 1, mode: 'uastc 2 rdo 1.5 zstd 18 srgb flip no-mipmaps' },
};
const recipeHash = (kind) => sha(JSON.stringify({ ...RECIPES[kind], toktxVersion }));

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const GENERIC = /^(TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/;
const WITH_POSITION = /^(POSITION|TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/;

async function packGlb(source, output, kind) {
  await MeshoptEncoder.ready;
  const doc = await io.read(source);
  const steps = [];
  if (kind !== 'far') {
    const [colourMax, normalMax] = kind === 'closeup' ? [CLOSE_UP_TEXTURE_SIZE, CLOSE_UP_NORMAL_SIZE] : [size, normalSize];
    steps.push(
      // WebP is decoded to PNG first (toktx reads PNG, not WebP); weapons keep their own colour size.
      textureCompress({ encoder: sharp, targetFormat: 'png', slots: /^normalTexture$/, resize: [normalMax, normalMax] }),
      textureCompress({ encoder: sharp, targetFormat: 'png', slots: /^(?!normalTexture$).*/, ...(kind === 'weapon' ? {} : { resize: [colourMax, colourMax] }) }),
      toktx({ mode: Mode.ETC1S, slots: /^(?!normalTexture$).*/, quality: 255, compression: 2 }),
      toktx({ mode: Mode.UASTC, slots: /^normalTexture$/, level: 2, rdo: true, rdoLambda: 1.5, zstd: 18 }),
    );
  }
  // One quantisation volume for the whole file keeps every part on one skin, so an outfit's parts still
  // join into one draw; far bodies and weapons keep float positions (see packed-assets.mjs).
  const pattern = kind === 'body' || kind === 'closeup' ? WITH_POSITION : GENERIC;
  steps.push(
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern, patternTargets: pattern, quantizationVolume: 'scene', quantizeNormal: 8 }),
  );
  await doc.transform(...steps);
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, await io.writeBinary(doc));
}

function runToktx(argv) {
  execFileSync('toktx', argv, { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function packImage(source, output, kind) {
  const work = join(tmpdir(), `pack-${process.pid}-${basename(source)}.png`);
  await sharp(source).png().toFile(work);
  await mkdir(dirname(output), { recursive: true });
  if (kind === 'atlas') {
    // Flipped so the KTX2 atlas lands on the same UVs the PNG had with three's default flipY.
    runToktx(['--t2', '--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '1.5', '--zcmp', '18',
      '--assign_oetf', 'srgb', '--lower_left_maps_to_s0t0', output, work]);
  } else {
    runToktx(['--t2', '--encode', 'etc1s', '--qlevel', '255', '--clevel', '2', '--genmipmap',
      '--assign_oetf', 'srgb', output, work]);
  }
  await rm(work, { force: true });
}

async function listFiles(dir, match) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && match.test(e.name)).map(e => e.name);
}

async function hashFile(path) {
  return existsSync(path) ? sha(await readFile(path)) : null;
}

const manifestPath = join(ROOT, MANIFEST);
const manifest = outDir ? {} : JSON.parse(existsSync(manifestPath) ? await readFile(manifestPath, 'utf8') : '{}');
const report = [];

for (const folder of PACKED_FOLDERS) {
  if (outDir && !folder.source.test('.glb')) continue;
  const publicDir = join(PUBLIC, folder.dir);
  const artDir = join(ART, folder.from ?? folder.dir);
  // Adopt: a source-format file in public/ that this script did not write is the new original.
  if (!outDir && !folder.from) for (const name of await listFiles(publicDir, folder.source)) {
    const at = join(publicDir, name);
    const outName = folder.out(name);
    const key = relative(ROOT, join(publicDir, outName));
    if (outName === name && manifest[key]?.output === await hashFile(at)) continue;
    await mkdir(artDir, { recursive: true });
    await copyFile(at, join(artDir, name));
    if (outName !== name) await rm(at);
    report.push(`adopted ${relative(ROOT, at)} -> ${relative(ROOT, join(artDir, name))}`);
  }
  // A trial size (--out) reads the originals where they are, before or after adoption.
  const sourceDir = outDir && !existsSync(artDir) ? join(PUBLIC, folder.from ?? folder.dir) : artDir;
  for (const name of await listFiles(sourceDir, folder.source)) {
    if (only && !name.includes(only)) continue;
    const source = join(sourceDir, name);
    const outName = folder.out(name);
    const output = outDir ? join(outDir, folder.dir, outName) : join(publicDir, outName);
    const key = relative(ROOT, join(publicDir, outName));
    const entry = { source: await hashFile(source), recipe: recipeHash(folder.kind) };
    const known = manifest[key];
    if (!force && !outDir && known && known.source === entry.source && known.recipe === entry.recipe
      && known.output === await hashFile(output)) continue;
    const before = (await stat(source)).size;
    if (folder.source.test('.glb')) await packGlb(source, output, folder.kind);
    else await packImage(source, output, folder.kind);
    const after = (await stat(output)).size;
    if (!outDir) manifest[key] = { ...entry, output: await hashFile(output) };
    report.push(`packed ${key}  ${(before / 1e6).toFixed(2)} -> ${(after / 1e6).toFixed(2)} MB`);
  }
}

if (!outDir) {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
}
console.log(report.length ? report.join('\n') : 'All packed assets are up to date.');
