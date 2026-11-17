/** What `npm run assets:pack` packs, shared with the test that checks every shipped file was packed. */

/** Per output: hashes of its original, the recipe and the output itself. */
export const MANIFEST = 'art/packed.json';

/** Longest side of character colour and packed textures, in pixels. */
export const CHARACTER_TEXTURE_SIZE = 1024;

/** Longest side of character and weapon normal maps, in pixels. */
export const NORMAL_TEXTURE_SIZE = 512;

/** The close-up set (the player's hero, the masters, the creator preview): colour and packed maps, then normals. */
export const CLOSE_UP_TEXTURE_SIZE = 2048;
export const CLOSE_UP_NORMAL_SIZE = 1024;

const glb = (kind) => ({ source: /\.glb$/, out: (name) => name, kind, glb: true });
const ktx2 = (name) => name.replace(/\.\w+$/, '.ktx2');

/**
 * Folders under client/public/assets (`glb` marks the folders of models); originals live under art/ at the same path. Kinds:
 * - body: KTX2 textures at CHARACTER_TEXTURE_SIZE (normals at NORMAL_TEXTURE_SIZE), meshopt geometry, positions quantised over the whole file.
 * - far: meshopt geometry only. Far bodies merge parts of different files into one mesh and bake colour from
 *   their textures on the CPU, so positions stay float and textures stay images the browser can draw.
 * - weapon: KTX2 textures at their own size (normals at most NORMAL_TEXTURE_SIZE), meshopt geometry, positions float (grips are measured from them).
 * - closeup: a body packed again at the CLOSE_UP sizes into an hd/ folder, from the
 *   same original (`from` names the folder whose originals it reads).
 * - image: one ETC1S KTX2 texture with mipmaps. atlas: one UASTC KTX2 effect atlas, no mipmaps.
 * - normal: one UASTC KTX2 town normal map with mipmaps, RDO for size, linear.
 */
export const PACKED_FOLDERS = [
  { dir: 'characters/creator', ...glb('body') },
  { dir: 'characters/creator/far', ...glb('far') },
  { dir: 'characters/people', ...glb('body') },
  { dir: 'characters/people/far', ...glb('far') },
  { dir: 'characters/outfits', ...glb('body') },
  { dir: 'characters/creator/hd', from: 'characters/creator', ...glb('closeup') },
  { dir: 'characters/people/hd', from: 'characters/people', ...glb('closeup'), source: /^hush_.*\.glb$/ },
  { dir: 'characters/outfits/hd', from: 'characters/outfits', ...glb('closeup') },
  { dir: 'weapons', ...glb('weapon') },
  { dir: 'characters/creator', source: /^peasant_worn\.webp$/, out: ktx2, kind: 'image' },
  { dir: 'fx', source: /^fire-[a-z-]+\.png$/, out: ktx2, kind: 'atlas' },
  { dir: 'env/ignis/materials', source: /_nor_uastc_1k\.png$/, out: ktx2, kind: 'normal' },
];
