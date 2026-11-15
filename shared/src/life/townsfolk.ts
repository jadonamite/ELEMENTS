import { SINDR_ANCHORS } from '../world/ignis/sindr.js';

/**
 * Sindr's people: one list read by the browser (who stands where, how they look) and by the server (who thinks,
 * who keeps which shop). A keeper's `keeps` names the merchant whose counter they stand at; the counter itself
 * is an anchor in the town data, so a new shop is a new anchor, a merchant entry in balance.json and a keeper here.
 */

export type TownsfolkRole =
  | 'smith'
  | 'trader'
  | 'innkeeper'
  | 'guard'
  | 'worshipper'
  | 'porter'
  | 'child';

export const TOWNSFOLK_ROLES: readonly TownsfolkRole[] = ['smith', 'trader', 'innkeeper', 'guard', 'worshipper', 'porter', 'child'];

export type RoutineActivity = 'work' | 'market' | 'inn' | 'home';

export interface LocationWaypoint {
  x: number;
  y: number;
  z: number;
  facing: number;
}

export interface Townsperson {
  id: string;
  name: string;
  /** Who they are, in one line: what their mind is told about itself. */
  character?: string;
  /** The merchant whose counter this person keeps (an anchor's `merchant` in the town data). */
  keeps?: string;
  role: TownsfolkRole;
  dialogueRole: string;
  isLit: boolean;
  element: 'IGNIS' | 'DIM';
  sex: 'male' | 'female';
  /** The look this person wears; people without one have a look of their own. */
  look?: string;
  /** Wanders the open streets instead of keeping a schedule. */
  wander?: boolean;
  /** Keeps a post built into a place: by day (a shop, an anvil), or always (a home's door). */
  post?: 'day' | 'always';
  schedule: {
    work: LocationWaypoint;
    market: LocationWaypoint;
    inn: LocationWaypoint;
    home: LocationWaypoint;
  };
}

/**
 * Where a keeper stands to serve: behind a stall (see style-kit marketStall) or at the counter post the town
 * builds, from the anchor that names the merchant.
 */
function atCounter(merchant: string): LocationWaypoint {
  const a = SINDR_ANCHORS.find((k) => k.merchant === merchant);
  if (!a) throw new Error(`Sindr has no counter for ${merchant}`);
  if (a.kind === 'stall') return { x: a.x + Math.sin(a.yaw) * 0.2, y: a.y, z: a.z + Math.cos(a.yaw) * 0.2, facing: a.yaw };
  return { x: a.x, y: a.y, z: a.z, facing: a.yaw };
}

/**
 * Sindr's named townsfolk: 35 people, 28 Dim (80%) and 7 Lit (20%) per LORE rules.
 * Fifteen keep a shop.
 */
export const SINDR_TOWNSFOLK: Townsperson[] = [
  // Smiths at Great Forge (x: 74..90, z: 32..40)
  {
    id: 'smith_brokk',
    name: 'Brokk the Anvil',
    character: 'Blunt and proud; trusts a hammer stroke he can hear more than any word he is told.',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 78, y: 0.4, z: 34.5, facing: Math.PI },
      market: { x: 114, y: 0, z: -2, facing: 0 },
      inn: { x: 133.5, y: 4.5, z: -53, facing: -Math.PI * 0.4 },
      home: { x: 72, y: 0, z: 12, facing: Math.PI },
    },
  },
  {
    id: 'smith_torvald',
    name: 'Torvald Coal-Biter',
    character: 'Chews coal-dust jokes all day; quick to haggle, slow to forgive a bad debt.',
    keeps: 'sindr_coal',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: atCounter('sindr_coal'),
      market: { x: 120, y: 0, z: 4, facing: Math.PI * 0.2 },
      inn: { x: 131.9, y: 4.5, z: -53, facing: 0 },
      home: { x: 74, y: 0, z: 12, facing: Math.PI },
    },
  },
  {
    id: 'smith_vala',
    name: 'Vala Cinder-Hand',
    character: 'Precise and quiet; judges a person by their hands before their face.',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 82, y: 0.4, z: 33.5, facing: 0 },
      market: { x: 116, y: 0, z: -4, facing: Math.PI },
      inn: { x: 130.3, y: 4.5, z: -53, facing: Math.PI * 0.5 },
      home: { x: 70, y: 0, z: 14, facing: Math.PI * 0.5 },
    },
  },
  {
    id: 'smith_ignis_master',
    name: 'Vulkan Hearth-Shaper',
    character: 'A Lit master smith who says little and lets a Crimson blade do his talking.',
    keeps: 'sindr_anvil',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: true, // 1/6 Lit
    element: 'IGNIS',
    sex: 'male',
    schedule: {
      work: atCounter('sindr_anvil'),
      market: { x: 122, y: 0, z: -6, facing: Math.PI * 0.5 },
      inn: { x: 128.7, y: 4.5, z: -53, facing: -Math.PI * 0.8 },
      home: { x: 98, y: 0, z: 13.2, facing: 0 },
    },
  },

  // Traders at the market stalls and the service counter
  {
    id: 'trader_surna',
    name: 'Surna Shard-Seller',
    character: 'Weighs every shard twice and every customer once; never forgets a cheat.',
    keeps: 'sindr_shards',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: atCounter('sindr_shards'),
      market: { x: 125, y: 0, z: -2, facing: 0 },
      inn: { x: 127.1, y: 4.5, z: -53, facing: Math.PI * 0.3 },
      home: { x: 138, y: 3, z: -21.5, facing: 0 },
    },
  },
  {
    id: 'trader_brand',
    name: 'Brand of the Basin',
    character: 'A calm apothecary from the basin road who measures tinctures by the drop and words the same way.',
    keeps: 'sindr_supplies',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: atCounter('sindr_supplies'),
      market: { x: 128, y: 0, z: 2, facing: -Math.PI * 0.5 },
      inn: { x: 133.5, y: 4.5, z: -54.8, facing: Math.PI * 0.8 },
      home: { x: 142, y: 3, z: -21.5, facing: 0 },
    },
  },
  {
    id: 'trader_kael',
    name: 'Kael Provisions',
    character: 'A weathered veteran who judges folk by the balance of their blade and the weight of their purse.',
    keeps: 'sindr_arms',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: atCounter('sindr_arms'),
      market: { x: 122, y: 0, z: 0, facing: Math.PI * 0.5 },
      inn: { x: 131.9, y: 4.5, z: -54.8, facing: -Math.PI * 0.2 },
      home: { x: 112, y: 0, z: 13.2, facing: Math.PI },
    },
  },
  {
    id: 'trader_fen',
    name: 'Fen Whetstone',
    character: 'Hones blades at the service counter; patient and dry, fond of anyone who listens to steel.',
    keeps: 'sindr_whetstone',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: atCounter('sindr_whetstone'),
      market: { x: 126, y: 0, z: -3, facing: -Math.PI * 0.3 },
      inn: { x: 130.3, y: 4.5, z: -54.8, facing: Math.PI * 0.5 },
      home: { x: 138, y: 0, z: 13.2, facing: Math.PI },
    },
  },
  {
    id: 'trader_lit_veteran',
    name: 'Ignan Red-Cloak',
    character: 'A Lit veteran in a red cloak who sells rare Crimson shards and old war stories, both dear.',
    keeps: 'sindr_crimson',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: true, // 2/6 Lit
    element: 'IGNIS',
    sex: 'male',
    schedule: {
      work: atCounter('sindr_crimson'),
      market: { x: 124, y: 0, z: 1, facing: -Math.PI * 0.5 },
      inn: { x: 128.7, y: 4.5, z: -54.8, facing: Math.PI * 0.1 },
      home: { x: 104, y: 3, z: -21.5, facing: 0 },
    },
  },

  // Innkeepers at the Banked Hearth, the inn on the well yard
  {
    id: 'innkeeper_greta',
    name: 'Greta Warm-Hearth',
    character: 'Warm but shrewd; hears every rumour on the Rise before the noon bell.',
    role: 'innkeeper',
    dialogueRole: 'innkeeper_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 134, y: 4.5, z: -55, facing: Math.PI * 0.5 },
      market: { x: 118, y: 0, z: -4.5, facing: 0 },
      inn: { x: 127.1, y: 4.5, z: -54.8, facing: Math.PI * 0.5 },
      home: { x: 109, y: 3, z: -21.5, facing: 0 },
    },
  },
  {
    id: 'inn_cellarman_oscar',
    name: 'Oscar Tapman',
    character: 'A slow-spoken cellarman who counts barrels in his sleep and hates spilled ale.',
    role: 'innkeeper',
    dialogueRole: 'innkeeper_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 134, y: 4.5, z: -57.5, facing: Math.PI * 0.5 },
      market: { x: 115, y: 0, z: -4.5, facing: Math.PI },
      inn: { x: 133.5, y: 4.5, z: -56.6, facing: 0 },
      home: { x: 106, y: 3, z: -21.5, facing: 0 },
    },
  },

  // Guards on Keep Lane (x: 190, z: -34..-64) and West/East Gates
  {
    id: 'guard_garrick',
    name: 'Guard Garrick',
    character: 'A Lit sentry loyal to the Edict; stern with brawlers, gentle with children.',
    role: 'guard',
    dialogueRole: 'guard_sindr',
    isLit: true, // 3/6 Lit
    element: 'IGNIS',
    sex: 'male',
    schedule: {
      work: { x: 192, y: 0, z: -25, facing: 0 },
      market: { x: 190, y: 0, z: -34, facing: Math.PI * 0.5 },
      inn: { x: 190, y: 0, z: -55, facing: -Math.PI * 0.5 },
      home: { x: 190, y: 0, z: -62, facing: Math.PI },
    },
  },
  {
    id: 'guard_vane',
    name: 'Guard Vane',
    character: 'A Lit guard who reads every face for trouble and fines a banished word without blinking.',
    role: 'guard',
    dialogueRole: 'guard_sindr',
    isLit: true, // 4/6 Lit
    element: 'IGNIS',
    sex: 'male',
    schedule: {
      work: { x: 190, y: 0, z: -60, facing: Math.PI * 0.5 },
      market: { x: 190, y: 0, z: -40, facing: -Math.PI * 0.5 },
      inn: { x: 190, y: 0, z: -64, facing: 0 },
      home: { x: 184, y: 0, z: -62, facing: 0 },
    },
  },
  {
    id: 'guard_west_gate',
    name: 'Watchman Jon',
    character: 'Has seen every caravan through the west gate and remembers the bad ones.',
    role: 'guard',
    dialogueRole: 'guard_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 54, y: 0, z: -3, facing: -Math.PI * 0.5 },
      market: { x: 58, y: 0, z: 0, facing: Math.PI * 0.5 },
      inn: { x: 131.9, y: 4.5, z: -56.6, facing: Math.PI * 0.3 },
      home: { x: 56, y: 0, z: 8, facing: Math.PI },
    },
  },
  {
    id: 'guard_east_gate',
    name: 'Watchman Toren',
    character: 'Bored at the Gorge Road gate and glad of any talk that is not a complaint.',
    role: 'guard',
    dialogueRole: 'guard_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 220, y: 0, z: 3, facing: Math.PI * 0.5 },
      market: { x: 215, y: 0, z: 0, facing: -Math.PI * 0.5 },
      inn: { x: 130.3, y: 4.5, z: -56.6, facing: -Math.PI * 0.6 },
      home: { x: 216, y: 0, z: 8, facing: Math.PI },
    },
  },

  // Worshippers at Shrine of Embers (x: 0..6, z: -4..4)
  {
    id: 'worshipper_alena',
    name: 'Sister Alena',
    character: 'Soft-voiced keeper of the Shrine of Embers who speaks of balance and of what the Edict took.',
    role: 'worshipper',
    dialogueRole: 'worshipper_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: -3, y: 0.1, z: 2, facing: Math.PI * 0.2 },
      market: { x: 0, y: 0.1, z: 4, facing: -Math.PI * 0.5 },
      inn: { x: 2, y: 0.1, z: -3, facing: Math.PI * 0.5 },
      home: { x: -4, y: 0.1, z: -2, facing: 0 },
    },
  },
  {
    id: 'worshipper_corin',
    name: 'Brother Corin',
    character: 'An earnest brother of the shrine, quick to bless and slow to judge.',
    role: 'worshipper',
    dialogueRole: 'worshipper_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 3, y: 0.1, z: -2, facing: -Math.PI * 0.8 },
      market: { x: 4, y: 0.1, z: 0, facing: Math.PI },
      inn: { x: -2, y: 0.1, z: 3, facing: -Math.PI * 0.2 },
      home: { x: 2, y: 0.1, z: -4, facing: Math.PI * 0.5 },
    },
  },
  {
    id: 'worshipper_flame_keeper',
    name: 'Pyra Ember-Tender',
    character: 'A Lit ember-tender who never lets the shrine brazier dim and frowns at careless talk.',
    role: 'worshipper',
    dialogueRole: 'worshipper_sindr',
    isLit: true, // 5/6 Lit
    element: 'IGNIS',
    sex: 'female',
    schedule: {
      work: { x: 0, y: 0.1, z: 3.2, facing: -Math.PI * 0.5 },
      market: { x: -2, y: 0.1, z: 0, facing: 0 },
      inn: { x: 1, y: 0.1, z: 2, facing: -Math.PI * 0.5 },
      home: { x: -3, y: 0.1, z: 3, facing: 0 },
    },
  },

  // Porters along main street and market square
  {
    id: 'porter_joran',
    name: 'Joran Heavy-Step',
    character: 'A heavy-stepping porter who knows every crate on the row by its weight.',
    role: 'porter',
    dialogueRole: 'porter_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 115, y: 0, z: 4.5, facing: Math.PI * 0.3 },
      market: { x: 115, y: 0, z: 4.5, facing: Math.PI * 0.3 },
      inn: { x: 128.7, y: 4.5, z: -56.6, facing: 0 },
      home: { x: 62, y: 0, z: -10, facing: 0 },
    },
  },
  {
    id: 'porter_burl',
    name: 'Burl Ox-Shoulder',
    character: 'A broad, cheerful porter who owes the inn more than he admits.',
    role: 'porter',
    dialogueRole: 'porter_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 120, y: 0, z: 2.5, facing: -Math.PI * 0.5 },
      market: { x: 120, y: 0, z: 2.5, facing: -Math.PI * 0.5 },
      inn: { x: 127.1, y: 4.5, z: -56.6, facing: -Math.PI * 0.4 },
      home: { x: 160, y: 0, z: -12, facing: 0 },
    },
  },
  {
    id: 'porter_davo',
    name: 'Davo Crates',
    character: 'Counts crates aloud and loses count whenever anyone speaks to him.',
    role: 'porter',
    dialogueRole: 'porter_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 122, y: 0, z: 5.0, facing: Math.PI * 0.2 },
      market: { x: 122, y: 0, z: 5.0, facing: Math.PI * 0.2 },
      inn: { x: 133.5, y: 4.5, z: -58.4, facing: Math.PI * 0.7 },
      home: { x: 92, y: 3, z: -21.5, facing: 0 },
    },
  },
  {
    id: 'porter_sela',
    name: 'Sela Sacks',
    character: 'Quick with sacks and quicker with gossip about who buys what.',
    role: 'porter',
    dialogueRole: 'porter_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 117, y: 0, z: 1.5, facing: Math.PI * 0.8 },
      market: { x: 117, y: 0, z: 1.5, facing: Math.PI * 0.8 },
      inn: { x: 131.9, y: 4.5, z: -58.4, facing: Math.PI * 0.2 },
      home: { x: 170, y: 0, z: -12, facing: 0 },
    },
  },

  // Children in Square / Alleys
  {
    id: 'child_pip',
    name: 'Pip',
    character: 'A small, bold child who asks every traveller where they come from.',
    role: 'child',
    dialogueRole: 'child_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 114, y: 0, z: 3.5, facing: Math.PI * 0.6 },
      market: { x: 114, y: 0, z: 3.5, facing: Math.PI * 0.6 },
      inn: { x: 130.3, y: 4.5, z: -58.4, facing: 0 },
      home: { x: 116, y: 0, z: 13.2, facing: Math.PI },
    },
  },
  {
    id: 'child_rin',
    name: 'Rin',
    character: 'A curious girl who collects bright shard chips from the gutters.',
    role: 'child',
    dialogueRole: 'child_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 116, y: 0, z: 5.5, facing: -Math.PI * 0.3 },
      market: { x: 116, y: 0, z: 5.5, facing: -Math.PI * 0.3 },
      inn: { x: 128.7, y: 4.5, z: -58.4, facing: -Math.PI * 0.5 },
      home: { x: 118, y: 0, z: 13.2, facing: Math.PI },
    },
  },
  {
    id: 'child_milo',
    name: 'Milo Runner',
    character: 'Runs errands across the market for a coin and knows every shortcut.',
    role: 'child',
    dialogueRole: 'child_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 119, y: 0, z: 4.0, facing: 0 },
      market: { x: 119, y: 0, z: 4.0, facing: 0 },
      inn: { x: 127.1, y: 4.5, z: -58.4, facing: Math.PI },
      home: { x: 136, y: 3, z: -21.5, facing: 0 },
    },
  },

  // Additional Townsfolk / Artisans browsing in Square
  {
    id: 'citizen_elena',
    name: 'Elena Loom-Keeper',
    character: 'A loom-keeper who sells cloth and thread from the yard stall; patient and exact.',
    keeps: 'sindr_loom',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: atCounter('sindr_loom'),
      market: { x: 113, y: 0, z: 2.0, facing: 0 },
      inn: { x: 133.5, y: 4.5, z: -60.2, facing: Math.PI * 0.4 },
      home: { x: 144, y: 3, z: -21.5, facing: 0 },
    },
  },
  {
    id: 'citizen_dari',
    name: 'Dari Basket-Maker',
    character: 'A basket-maker who sells packs and road supplies, talking while she weaves.',
    keeps: 'sindr_packs',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: atCounter('sindr_packs'),
      market: { x: 121, y: 0, z: 6.0, facing: Math.PI },
      inn: { x: 131.9, y: 4.5, z: -60.2, facing: -Math.PI * 0.5 },
      home: { x: 108, y: 3, z: -21.5, facing: 0 },
    },
  },
  {
    id: 'citizen_rowan',
    name: 'Rowan of the Ash',
    character: 'A quiet worshipper who walks the market murmuring prayers.',
    role: 'worshipper',
    dialogueRole: 'worshipper_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 123, y: 0, z: 3.0, facing: Math.PI * 0.4 },
      market: { x: 123, y: 0, z: 3.0, facing: Math.PI * 0.4 },
      inn: { x: 130.3, y: 4.5, z: -60.2, facing: Math.PI * 0.6 },
      home: { x: 64, y: 0, z: -10, facing: 0 },
    },
  },
  {
    id: 'citizen_mira',
    name: 'Mira the Potter',
    character: 'A potter who fills her own flasks with tonics; plain-spoken and proud of a good glaze.',
    keeps: 'sindr_potter',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: atCounter('sindr_potter'),
      market: { x: 118, y: 0, z: 6.5, facing: -Math.PI * 0.5 },
      inn: { x: 128.7, y: 4.5, z: -60.2, facing: 0 },
      home: { x: 68, y: 0, z: 12, facing: Math.PI },
    },
  },
  {
    id: 'traveler_ignis_scout',
    name: 'Ignis Scout Kova',
    character: 'A Lit scout back from the Gorge Road, watchful, with news of the roads for anyone who asks.',
    role: 'guard',
    dialogueRole: 'guard_sindr',
    isLit: true, // 6/6 Lit
    element: 'IGNIS',
    sex: 'female',
    schedule: {
      work: { x: 121, y: 0, z: 1.5, facing: -Math.PI * 0.5 },
      market: { x: 121, y: 0, z: 1.5, facing: -Math.PI * 0.5 },
      inn: { x: 127.1, y: 4.5, z: -60.2, facing: -Math.PI * 0.7 },
      home: { x: 180, y: 0, z: 10, facing: 0 },
    },
  },
  // Keepers of the terrace, Cinder Row and guild-house counters
  {
    id: 'keeper_hild',
    name: 'Hild Salt-Scale',
    character: 'Weighs shards on a brass scale she swears is honest; it mostly is.',
    keeps: 'sindr_scales',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: atCounter('sindr_scales'),
      market: { x: 96, y: 3, z: -20, facing: 0 },
      inn: { x: 129.5, y: 4.5, z: -61.5, facing: Math.PI * 0.6 },
      home: { x: 100, y: 3, z: -21.5, facing: 0 },
    },
  },
  {
    id: 'keeper_ketil',
    name: 'Ketil Cork-Tooth',
    character: 'Opens tonic flasks with his teeth; loud, generous and a little careless with change.',
    keeps: 'sindr_cork',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: atCounter('sindr_cork'),
      market: { x: 138, y: 3, z: -20, facing: 0 },
      inn: { x: 131.2, y: 4.5, z: -61.5, facing: -Math.PI * 0.6 },
      home: { x: 146, y: 3, z: -21.5, facing: 0 },
    },
  },
  {
    id: 'keeper_orm',
    name: 'Orm Tallyman',
    character: 'Buys what fighters drag back through the west gate; counts slowly and pays fairly.',
    keeps: 'sindr_tally',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: atCounter('sindr_tally'),
      market: { x: 70, y: 0, z: 2, facing: 0 },
      inn: { x: 126, y: 4.5, z: -62, facing: Math.PI },
      home: { x: 62, y: 0, z: 12, facing: Math.PI },
    },
  },
  {
    id: 'keeper_signy',
    name: 'Signy Wick',
    character: 'Sells wicks and road supplies to the guild houses; neat, quiet, misses nothing.',
    keeps: 'sindr_wick',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: atCounter('sindr_wick'),
      market: { x: 127, y: 7.5, z: -78, facing: 0 },
      inn: { x: 124.5, y: 4.5, z: -61, facing: Math.PI * 0.8 },
      home: { x: 134, y: 7.5, z: -84, facing: -Math.PI * 0.5 },
    },
  },
  {
    id: 'keeper_sigrid',
    name: 'Sigrid Brightcoin',
    character: 'A Lit trader to the guild houses who deals in rare shards and fine armour and looks down the lane at everyone.',
    keeps: 'sindr_bright',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: true, // 7/7 Lit
    element: 'IGNIS',
    sex: 'female',
    schedule: {
      work: atCounter('sindr_bright'),
      market: { x: 126, y: 7.5, z: -71, facing: Math.PI },
      inn: { x: 128, y: 4.5, z: -62.5, facing: -Math.PI },
      home: { x: 136, y: 11, z: -96, facing: 0 },
    },
  },
];

/** The named people of a zone, the way placesFor gives its places; zones without a town have nobody yet. */
export const townsfolkFor = (zone: string): readonly Townsperson[] => (zone === 'sindr' ? SINDR_TOWNSFOLK : []);

/**
 * Returns current routine activity given world clock minute.
 * 24-minute cycle:
 * - Day (min 0 to 12): work & market activities
 * - Dusk (min 12 to 14): packing up and heading to inn / home (streets emptying)
 * - Night (min 14 to 22): inn filled, or at home resting
 * - Dawn (min 22 to 24): heading back to workstations
 */
export function getTownspersonActivity(minute: number, townsperson: Townsperson): RoutineActivity {
  const m = ((minute % 24) + 24) % 24;
  if (townsperson.post === 'always') return 'work';
  if (townsperson.post === 'day') return m < 12 || m >= 22 ? 'work' : 'home';

  if (m < 12) {
    // Daytime: at work/market
    return 'work';
  } else if (m < 14) {
    // Dusk: streets emptying, inn filling up or people heading home
    return townsperson.id.charCodeAt(1) % 3 === 0 ? 'home' : 'inn';
  } else if (m < 22) {
    // Night: inn filled, or at home asleep
    return townsperson.id.charCodeAt(2) % 2 === 0 ? 'inn' : 'home';
  } else {
    // Dawn: rising, heading to work
    return 'work';
  }
}

/** Interpolates target waypoint position based on activity. */
export function getTownspersonPosition(minute: number, townsperson: Townsperson): LocationWaypoint {
  const activity = getTownspersonActivity(minute, townsperson);
  return townsperson.schedule[activity];
}
