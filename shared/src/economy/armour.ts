// Armour is acquired, never given: every fighter starts in rags and puts on a piece they own.
// A piece is one satchel item that names the outfit it draws and the value it adds in a fight.
// The numbers live in balance.json next to the rest of the economy; this module only reads them.

export interface ArmourPiece {
  /** Satchel item id and the smith's shelf key, e.g. armour_shaper_ignis. */
  readonly id: string;
  /** The name a player reads. */
  readonly name: string;
  /** Body outfit worn while it is on; the client falls back to rags for an outfit it has no model for. */
  readonly outfit: string;
  /** Added to the wearer's armour in the combat rules' scale: damage / (1 + armour / armourScale). */
  readonly armour: number;
  readonly nation: string;
  /** Which rank of set it belongs to, e.g. shaper or master. Free for now; upgrades are not designed. */
  readonly set: string;
  /** Chance an armed foe of that nation carries the piece, 0..1. */
  readonly dropChance: number;
}

export interface ArmourCatalogue {
  /** The outfit every fighter starts in, before any armour is worn. */
  readonly defaultOutfit: string;
  readonly pieces: Readonly<Record<string, ArmourPiece>>;
}

/** The empty catalogue: no armour exists, everyone stays in the default outfit. */
export const NO_ARMOUR: ArmourCatalogue = { defaultOutfit: 'rags', pieces: {} };

const ID = /^armour_[a-z0-9_]+$/;
const OUTFIT = /^[a-z][a-z0-9_]*$/;
const NATIONS = new Set(['IGNIS', 'AQUES', 'TERRA', 'AURA']);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Data errors in an armour block; empty when it can be used. */
export function validateArmour(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return ['armour: not an object'];
  if (!nonempty(raw.defaultOutfit) || !OUTFIT.test(raw.defaultOutfit)) {
    errors.push('armour: defaultOutfit is not an outfit id');
  }
  if (!isRecord(raw.pieces)) {
    errors.push('armour: pieces is not an object');
    return errors;
  }
  for (const [id, value] of Object.entries(raw.pieces)) {
    if (!ID.test(id)) errors.push(`armour: bad piece id ${id}`);
    if (!isRecord(value)) {
      errors.push(`armour: piece ${id} is not an object`);
      continue;
    }
    if (!nonempty(value.name)) errors.push(`armour: piece ${id} has no name`);
    if (!nonempty(value.outfit) || !OUTFIT.test(value.outfit)) errors.push(`armour: piece ${id} has no outfit`);
    if (typeof value.armour !== 'number' || !Number.isFinite(value.armour) || value.armour < 0) {
      errors.push(`armour: piece ${id} armour is not a number from zero up`);
    }
    if (typeof value.nation !== 'string' || !NATIONS.has(value.nation.toUpperCase())) {
      errors.push(`armour: piece ${id} has no nation`);
    }
    if (!nonempty(value.set)) errors.push(`armour: piece ${id} has no set`);
    if (typeof value.dropChance !== 'number' || !Number.isFinite(value.dropChance) ||
        value.dropChance < 0 || value.dropChance > 1) {
      errors.push(`armour: piece ${id} dropChance is not a share from 0 to 1`);
    }
  }
  return errors;
}

/** The catalogue in a shape the game reads. Throws when the data is broken, like the combat rules. */
export function armourCatalogue(raw: unknown): ArmourCatalogue {
  const errors = validateArmour(raw);
  if (errors.length > 0) throw new RangeError(errors.join('; '));
  const data = raw as { defaultOutfit: string; pieces: Record<string, Omit<ArmourPiece, 'id'>> };
  const pieces: Record<string, ArmourPiece> = {};
  for (const [id, piece] of Object.entries(data.pieces)) {
    pieces[id] = {
      id,
      name: piece.name,
      outfit: piece.outfit,
      armour: piece.armour,
      nation: piece.nation.toUpperCase(),
      set: piece.set,
      dropChance: piece.dropChance,
    };
  }
  return { defaultOutfit: data.defaultOutfit, pieces };
}

/** The piece a satchel item buys, or null for anything that is not armour. */
export function armourPiece(catalogue: ArmourCatalogue, itemId: string | null | undefined): ArmourPiece | null {
  return itemId ? catalogue.pieces[itemId] ?? null : null;
}

/** The outfit worn with `itemId` on (or stripped): the default when nothing or unknown is worn. */
export function outfitOf(catalogue: ArmourCatalogue, itemId: string | null | undefined): string {
  return armourPiece(catalogue, itemId)?.outfit ?? catalogue.defaultOutfit;
}

/** The armour value worn with `itemId` on (or stripped): zero when nothing or unknown is worn. */
export function armourOf(catalogue: ArmourCatalogue, itemId: string | null | undefined): number {
  return armourPiece(catalogue, itemId)?.armour ?? 0;
}

/**
 * What an armed foe carries, as satchel stacks: a piece rolls against its dropChance, and a foe
 * carries at most one. Pieces are rolled in id order so the same draw gives the same piece.
 */
export function rollArmourDrop(
  catalogue: ArmourCatalogue,
  nation: string,
  rng: () => number = Math.random,
): Record<string, number> {
  // Only a foe of the piece's own nation carries it.
  for (const piece of Object.values(catalogue.pieces).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (piece.nation !== nation.toUpperCase()) continue;
    if (piece.dropChance > 0 && rng() < piece.dropChance) return { [piece.id]: 1 };
  }
  return {};
}
