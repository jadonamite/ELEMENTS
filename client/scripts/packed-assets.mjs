/** What `npm run assets:pack` packs, shared with the test that checks every shipped file was packed. */

/** Per output: hashes of its original, the recipe and the output itself. */
export const MANIFEST = 'art/packed.json';

/** Longest side of character colour and packed textures, in pixels. */
export const CHARACTER_TEXTURE_SIZE = 1024;

/** Longest side of character and weapon normal maps, in pixels. */
export const NORMAL_TEXTURE_SIZE = 1024;

const glb = (kind) => ({ source: /\.glb$/, out: (name) => name, kind });
const ktx2 = (name) => name.replace(/\.\w+$/, '.ktx2');

/**
 * Folders under client/public/assets; originals live under art/ at the same path. Kinds:
 * - body: KTX2 textures at CHARACTER_TEXTURE_SIZE (normals at NORMAL_TEXTURE_SIZE), meshopt geometry, positions quantised over the whole file.
 * - far: meshopt geometry only. Far bodies merge parts of different files into one mesh and bake colour from
 *   their textures on the CPU, so positions stay float and textures stay images the browser can draw.
 * - weapon: KTX2 textures at their own size (normals at most NORMAL_TEXTURE_SIZE), meshopt geometry, positions float (grips are measured from them).
 * - image: one ETC1S KTX2 texture with mipmaps. atlas: one UASTC KTX2 effect atlas, no mipmaps.
 */
export const PACKED_FOLDERS = [
  { dir: 'characters/creator', ...glb('body') },
  { dir: 'characters/creator/far', ...glb('far') },
  { dir: 'characters/people', ...glb('body') },
  { dir: 'characters/people/far', ...glb('far') },
  { dir: 'characters/outfits', ...glb('body') },
  { dir: 'weapons', ...glb('weapon') },
  { dir: 'characters/creator', source: /^peasant_worn\.webp$/, out: ktx2, kind: 'image' },
  { dir: 'fx', source: /^fire-[a-z-]+\.png$/, out: ktx2, kind: 'atlas' },
];
