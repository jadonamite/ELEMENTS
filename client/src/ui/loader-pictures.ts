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

export function loaderPictureDetails(path: string): { caption: string; nation: string; number: string } {
  const id = path.split('/').at(-1)?.replace(/\.jpg$/, '') ?? '';
  const index = (LOADER_PICTURES as readonly string[]).indexOf(id);
  const nation = ['ignis', 'aques', 'terra', 'aura'].find(n => id.endsWith(n));
  const bending: Record<string, string> = { fire: 'IGNIS', water: 'AQUES', earth: 'TERRA', air: 'AURA' };
  return {
    caption: CAPTIONS[id] ?? 'Ink study',
    nation: nation?.toUpperCase() ?? (id.startsWith('sindr-') ? 'IGNIS' : bending[id.replace('bending-', '')] ?? (['lord', 'allborn-statue', 'world-boss', 'chromara-sentries'].includes(id) ? 'CHROMARA' : 'FOUR NATIONS')),
    number: String(index + 1).padStart(3, '0'),
  };
}
