import type { LootContents } from './types.js';

// Pure rules for the items a player carries. Item ids:
//   shard_ignis, shard_aques, shard_terra, shard_aura   one per shard colour
//   material_<name>                                       a named material, e.g. material_linen
//   any merchant stock key (potion, armour, ...)          goods bought from a shop

export type Satchel = Record<string, number>;

export interface ItemStack {
  itemId: string;
  quantity: number;
}

const SHARD_PREFIX = 'shard_';
const MATERIAL_PREFIX = 'material_';

export function shardItemId(colour: string): string {
  return `${SHARD_PREFIX}${colour.toLowerCase()}`;
}

export function materialItemId(name: string): string {
  return name === 'material' || name.startsWith(MATERIAL_PREFIX) ? name : `${MATERIAL_PREFIX}${name}`;
}

// The item stacks inside a loot pile, coin excluded.
export function itemsFromLoot(contents: LootContents): ItemStack[] {
  const stacks: ItemStack[] = [];
  for (const [colour, count] of Object.entries(contents.shards ?? {})) {
    if (count > 0) stacks.push({ itemId: shardItemId(colour), quantity: count });
  }
  for (const [name, count] of Object.entries(contents.materials ?? {})) {
    if (count > 0) stacks.push({ itemId: materialItemId(name), quantity: count });
  }
  return stacks;
}

// Splits a satchel back into the shape the loot rules use (shards by colour, materials by name).
export function satchelAsCarried(satchel: Satchel): {
  shards: Record<string, number>;
  materials: Record<string, number>;
} {
  const shards: Record<string, number> = {};
  const materials: Record<string, number> = {};
  for (const [itemId, count] of Object.entries(satchel)) {
    if (count <= 0) continue;
    if (itemId.startsWith(SHARD_PREFIX)) {
      shards[itemId.slice(SHARD_PREFIX.length).toUpperCase()] = count;
    } else if (itemId.startsWith(MATERIAL_PREFIX) || itemId === 'material') {
      materials[itemId === 'material' ? 'material' : itemId.slice(MATERIAL_PREFIX.length)] = count;
    }
  }
  return { shards, materials };
}

// Which shelf of a merchant an item goes on: an exact stock key, else the word before the first underscore.
export function stockKeyForItem(itemId: string, inventory: Record<string, unknown>): string | null {
  if (itemId in inventory) return itemId;
  const head = itemId.split('_')[0] ?? itemId;
  return head in inventory ? head : null;
}

// Checks a satchel holds every stack asked for. Returns the first missing item, or null.
export function findShortfall(satchel: Satchel, stacks: ItemStack[]): ItemStack | null {
  const need: Record<string, number> = {};
  for (const s of stacks) need[s.itemId] = (need[s.itemId] ?? 0) + s.quantity;
  for (const [itemId, quantity] of Object.entries(need)) {
    if ((satchel[itemId] ?? 0) < quantity) return { itemId, quantity };
  }
  return null;
}

export function isValidQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity > 0;
}
