/** Ink paintings drawn from the cast sheets and the world's places. */
export const LOADER_PICTURES = [
  'hush-ignis', 'hush-aques', 'hush-terra', 'hush-aura',
  'shaper-ignis', 'shaper-aques', 'shaper-terra', 'shaper-aura',
  'master-ignis', 'master-aques', 'master-terra', 'master-aura',
  'robber', 'deserter', 'lord', 'merchant',
  'sindr-streets', 'sindr-canal',
  'nation-ignis', 'nation-aques', 'nation-terra', 'nation-aura',
  'bending-fire', 'bending-water', 'bending-earth', 'bending-air',
  'allborn-statue', 'world-boss', 'chromara-sentries', 'border-fort',
] as const;

const PICTURE_KEY = 'elements_loader_pictures_v2';
let memorySeen: string[] = [];

/** A shuffled cycle, including no adjacent repeat at the cycle boundary. */
export function nextLoaderPicture(): string {
  let seen = memorySeen;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PICTURE_KEY) ?? 'null');
    if (Array.isArray(saved)) seen = saved.filter((id): id is string =>
      typeof id === 'string' && (LOADER_PICTURES as readonly string[]).includes(id));
  } catch { /* Storage can be disabled. Keep the session cycle in memory. */ }
  let pool = LOADER_PICTURES.filter(id => !seen.includes(id));
  if (pool.length === 0) {
    const last = seen.at(-1);
    seen = [];
    pool = LOADER_PICTURES.filter(id => id !== last);
  }
  const id = pool[Math.floor(Math.random() * pool.length)]!;
  memorySeen = [...seen, id];
  try { localStorage.setItem(PICTURE_KEY, JSON.stringify(memorySeen)); } catch { /* Private mode. */ }
  return `/assets/ui/loader/pictures/${id}.jpg`;
}

const CAPTIONS: Record<string, string> = {
  'hush-ignis': 'Hush of IGNIS', 'hush-aques': 'Hush of AQUES', 'hush-terra': 'Hush of TERRA', 'hush-aura': 'Hush of AURA',
  'shaper-ignis': 'Shaper of IGNIS', 'shaper-aques': 'Shaper of AQUES', 'shaper-terra': 'Shaper of TERRA', 'shaper-aura': 'Shaper of AURA',
  'master-ignis': 'Master of IGNIS', 'master-aques': 'Master of AQUES', 'master-terra': 'Master of TERRA', 'master-aura': 'Master of AURA',
  robber: 'The robber', deserter: 'The deserter', lord: 'The empty seat', merchant: 'The merchant',
  'sindr-streets': 'Streets of Sindr', 'sindr-canal': 'The canal',
  'nation-ignis': 'The forge city', 'nation-aques': 'The river delta', 'nation-terra': 'The canyon fortress', 'nation-aura': 'The wind towers',
  'bending-fire': 'Bending fire', 'bending-water': 'Bending water', 'bending-earth': 'Bending earth', 'bending-air': 'Bending air',
  'allborn-statue': 'The sealed statue', 'world-boss': 'The nameless one', 'chromara-sentries': 'The Lord’s Sentries', 'border-fort': 'The border fort',
};

export interface LoaderPlate {
  caption: string;
  nation: string;
  number: string;
  element: 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA';
  head: readonly [number, number];
  ground: readonly [number, number];
}

/** Normalized coordinates in each portrait, independent of viewport size. */
const ANCHORS: Record<typeof LOADER_PICTURES[number], { head: readonly [number, number]; ground: readonly [number, number] }> = {
  'hush-ignis': { head: [.50, .14], ground: [.51, .92] },
  'hush-aques': { head: [.50, .15], ground: [.49, .88] },
  'hush-terra': { head: [.49, .15], ground: [.50, .88] },
  'hush-aura': { head: [.48, .15], ground: [.51, .88] },
  'shaper-ignis': { head: [.47, .16], ground: [.50, .87] },
  'shaper-aques': { head: [.49, .17], ground: [.50, .87] },
  'shaper-terra': { head: [.51, .17], ground: [.50, .87] },
  'shaper-aura': { head: [.49, .16], ground: [.50, .87] },
  'master-ignis': { head: [.48, .15], ground: [.50, .88] },
  'master-aques': { head: [.49, .16], ground: [.51, .87] },
  'master-terra': { head: [.42, .17], ground: [.49, .87] },
  'master-aura': { head: [.49, .16], ground: [.50, .86] },
  robber: { head: [.49, .18], ground: [.50, .88] },
  deserter: { head: [.48, .16], ground: [.50, .88] },
  lord: { head: [.50, .22], ground: [.50, .83] },
  merchant: { head: [.40, .19], ground: [.48, .88] },
  'sindr-streets': { head: [.49, .22], ground: [.52, .86] },
  'sindr-canal': { head: [.50, .30], ground: [.50, .83] },
  'nation-ignis': { head: [.49, .20], ground: [.50, .87] },
  'nation-aques': { head: [.51, .23], ground: [.50, .85] },
  'nation-terra': { head: [.50, .20], ground: [.50, .86] },
  'nation-aura': { head: [.52, .20], ground: [.50, .86] },
  'bending-fire': { head: [.48, .21], ground: [.50, .88] },
  'bending-water': { head: [.45, .25], ground: [.50, .88] },
  'bending-earth': { head: [.40, .32], ground: [.50, .87] },
  'bending-air': { head: [.49, .20], ground: [.50, .88] },
  'allborn-statue': { head: [.50, .18], ground: [.50, .86] },
  'world-boss': { head: [.52, .22], ground: [.50, .87] },
  'chromara-sentries': { head: [.50, .23], ground: [.50, .85] },
  'border-fort': { head: [.50, .23], ground: [.50, .86] },
};

export function loaderPictureDetails(path: string): LoaderPlate {
  const id = path.split('/').at(-1)?.replace(/\.jpg$/, '') ?? '';
  const index = (LOADER_PICTURES as readonly string[]).indexOf(id);
  const nation = ['ignis', 'aques', 'terra', 'aura'].find(n => id.endsWith(n));
  const bending: Record<string, string> = { fire: 'IGNIS', water: 'AQUES', earth: 'TERRA', air: 'AURA' };
  const element = nation?.toUpperCase() ?? bending[id.replace('bending-', '')] ?? (id.startsWith('sindr-') ? 'IGNIS' : 'TERRA');
  return {
    caption: CAPTIONS[id] ?? 'Ink study',
    nation: nation?.toUpperCase() ?? (id.startsWith('sindr-') ? 'IGNIS' : bending[id.replace('bending-', '')] ?? (['lord', 'allborn-statue', 'world-boss', 'chromara-sentries'].includes(id) ? 'CHROMARA' : 'FOUR NATIONS')),
    number: String(index + 1).padStart(3, '0'),
    element: element as LoaderPlate['element'],
    ...(ANCHORS[id as keyof typeof ANCHORS] ?? { head: [.5, .16], ground: [.5, .87] }),
  };
}
