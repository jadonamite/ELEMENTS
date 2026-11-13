import {
  MERCHANTS_BY_ZONE,
  TOWNSFOLK_ROLES,
  placesFor,
  townsfolkFor,
  type SindrMerchantConfig,
  type TownsfolkRole,
  type Townsperson,
} from '@elements/shared';
import { ZONES } from '../../net/zones.js';

/**
 * Who thinks, and where, read from the world data: a zone's shops (anchors that name a merchant), its merchants
 * (balance.json) and its people (the shared people list). Nothing here names a person or a place.
 *
 * - keeper: a person who keeps a shop; the mind's id is the merchant's, so trade, plans and the judge share it.
 * - townsfolk: every other named person.
 * - crowd: one mind per trade per zone, worn by every crowd person of that trade.
 */
export type MindKind = 'keeper' | 'townsfolk' | 'crowd';

export interface Mind {
  id: string;
  kind: MindKind;
  place: string;
  name: string;
  role: TownsfolkRole;
  character: string;
  /** The shop's merchant, for keepers. */
  merchant?: SindrMerchantConfig;
  /** The person, for keepers and townsfolk. */
  person?: Townsperson;
}

/** Zones with a town: the server's zones that have shops or people. */
export function mindPlaces(): string[] {
  return Object.keys(ZONES).filter((z) => placesFor(z).stalls.length > 0 || townsfolkFor(z).length > 0);
}

export const merchantsFor = (place: string): readonly SindrMerchantConfig[] => MERCHANTS_BY_ZONE[place] ?? [];

/** Keepers trading in a place: a built counter, a merchant with stock, and a person who keeps it. */
export function keepersIn(place: string): Mind[] {
  const merchants = merchantsFor(place);
  const people = townsfolkFor(place);
  const out: Mind[] = [];
  for (const shop of placesFor(place).stalls) {
    const merchant = merchants.find((m) => m.id === shop.id);
    const person = people.find((p) => p.keeps === shop.id);
    if (!merchant || !person) continue;
    out.push({
      id: merchant.id,
      kind: 'keeper',
      place,
      name: person.name,
      role: person.role,
      character: `${person.character ?? merchant.personality} Keeps ${merchant.name}.`,
      merchant,
      person,
    });
  }
  return out;
}

export function townsfolkIn(place: string): Mind[] {
  return townsfolkFor(place)
    .filter((p) => !p.keeps)
    .map((p) => ({ id: p.id, kind: 'townsfolk' as const, place, name: p.name, role: p.role, character: p.character ?? `A ${p.role} of the town.`, person: p }));
}

const CROWD_CHARACTER: Record<TownsfolkRole, string> = {
  smith: 'A smith of the town, sooty, practical and short with idle talk.',
  trader: 'A small trader of the town who watches prices and gossip with the same eye.',
  innkeeper: 'Works the inn; hears the roads talk over every cup.',
  guard: 'A member of the watch; keeps the Edict and keeps it plainly.',
  worshipper: 'Walks between the shrine and the market, quiet and observant.',
  porter: 'Hauls crates for whoever pays; knows who buys what.',
  child: 'A child of the town who runs everywhere and notices everything.',
};

export const crowdMindId = (place: string, role: TownsfolkRole): string => `crowd:${place}:${role}`;

export function crowdMindsIn(place: string): Mind[] {
  if (townsfolkFor(place).length === 0) return [];
  return TOWNSFOLK_ROLES.map((role) => ({ id: crowdMindId(place, role), kind: 'crowd' as const, place, name: `${role} of ${place}`, role, character: CROWD_CHARACTER[role] }));
}

/** The keeper of a merchant's counter, if one trades there. */
export function keeperOf(merchantId: string): Mind | null {
  for (const place of mindPlaces()) {
    const k = keepersIn(place).find((m) => m.id === merchantId);
    if (k) return k;
  }
  return null;
}

/** A mind by id: a merchant (keeper), a named person (a keeper by person id resolves to their shop), a crowd mind. */
export function findMind(id: string): Mind | null {
  for (const place of mindPlaces()) {
    const keeper = keepersIn(place).find((m) => m.id === id || m.person?.id === id);
    if (keeper) return keeper;
    const person = townsfolkIn(place).find((m) => m.id === id);
    if (person) return person;
    const crowd = crowdMindsIn(place).find((m) => m.id === id);
    if (crowd) return crowd;
  }
  return null;
}

/** Shops in a place within `metres` of a point, nearest first. */
export function shopsNear(place: string, x: number, z: number, metres: number): Array<{ id: string; distance: number }> {
  return placesFor(place).stalls
    .map((s) => ({ id: s.id, distance: Math.hypot(s.x - x, s.z - z) }))
    .filter((s) => s.distance <= metres)
    .sort((a, b) => a.distance - b.distance);
}

/** Stock keys a merchant carries ("shard", "potion"...), for finding rivals. */
export const stockKeys = (m: SindrMerchantConfig): string[] => Object.keys(m.inventory);
