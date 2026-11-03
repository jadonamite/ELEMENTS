// Names players read for item ids. Shard colours follow the nations: IGNIS crimson, AQUES azure,
// TERRA ochre, AURA white.

const SHARD_NAMES: Record<string, string> = {
  shard_ignis: 'Crimson shard',
  shard_aques: 'Azure shard',
  shard_terra: 'Ochre shard',
  shard_aura: 'White shard',
};

const SHELF_NAMES: Record<string, string> = {
  shard: 'Shards',
  material: 'Raw materials',
  potion: 'Potions',
  supplies: 'Supplies',
  item: 'Gear',
  armour: 'Armour',
};

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function itemName(itemId: string, count = 1): string {
  const base =
    SHARD_NAMES[itemId] ??
    SHELF_NAMES[itemId] ??
    (itemId.startsWith('material_') ? capitalise(itemId.slice('material_'.length).replace(/_/g, ' ')) : capitalise(itemId.replace(/_/g, ' ')));
  return count === 1 || base.endsWith('s') ? base : `${base}s`;
}

export function shelfName(stockKey: string): string {
  return SHELF_NAMES[stockKey] ?? capitalise(stockKey);
}

// "20 CHROMA, 1 Crimson shard and 2 Linen"
export function describeLoot(chroma: number, items: Record<string, number>): string {
  const parts: string[] = [];
  if (chroma > 0) parts.push(`${chroma} CHROMA`);
  for (const [id, n] of Object.entries(items)) if (n > 0) parts.push(`${n} ${itemName(id, n)}`);
  if (parts.length <= 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// The satchel item ids inside a pile's contents.
export function lootItems(contents: { shards: Record<string, number>; materials: Record<string, number> }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [colour, n] of Object.entries(contents.shards ?? {})) if (n > 0) out[`shard_${colour.toLowerCase()}`] = n;
  for (const [name, n] of Object.entries(contents.materials ?? {})) {
    if (n > 0) out[name === 'material' || name.startsWith('material_') ? name : `material_${name}`] = n;
  }
  return out;
}
