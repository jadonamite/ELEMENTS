/** Ink paintings drawn from the cast sheets and the world's places. */
export const LOADER_PICTURES = [
  'hush-ignis', 'hush-aques', 'hush-terra', 'hush-aura',
  'shaper-ignis', 'shaper-aques', 'shaper-terra', 'shaper-aura',
  'master-ignis', 'master-aques', 'master-terra', 'master-aura',
  'robber', 'deserter', 'lord', 'merchant',
  'sindr-streets', 'sindr-canal',
  'nation-ignis', 'nation-aques', 'nation-terra', 'nation-aura',
  'bending-fire', 'bending-water', 'bending-earth', 'bending-air',
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
