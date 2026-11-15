import type { ArmourCatalogue } from './armour.js';

// Names players read for item and shelf ids, for anything a mind says or is told.

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

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** The name a player reads for an item or shelf id. */
export function itemDisplayName(itemId: string, catalogue?: ArmourCatalogue): string {
  const piece = catalogue?.pieces[itemId];
  if (piece) return piece.name;
  if (SHARD_NAMES[itemId]) return SHARD_NAMES[itemId];
  if (SHELF_NAMES[itemId]) return SHELF_NAMES[itemId];
  const bare = itemId.startsWith('material_') ? itemId.slice('material_'.length) : itemId;
  return capitalise(bare.replace(/_/g, ' '));
}

/** Any snake_case id in spoken text, which no one says aloud. */
const RAW_ID = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/** Text with every raw id in it replaced by the name a player reads. */
export function nameItemIds(text: string, catalogue?: ArmourCatalogue): string {
  return text.replace(RAW_ID, (id) => itemDisplayName(id, catalogue));
}

/** True when the text carries a raw id. */
export function carriesItemId(text: string): boolean {
  return new RegExp(RAW_ID.source).test(text);
}
