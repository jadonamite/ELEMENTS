export type TownsfolkRole =
  | 'smith'
  | 'trader'
  | 'innkeeper'
  | 'guard'
  | 'worshipper'
  | 'porter'
  | 'child';

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
  role: TownsfolkRole;
  dialogueRole: string;
  isLit: boolean;
  element: 'IGNIS' | 'DIM';
  sex: 'male' | 'female';
  /** The look this person wears; people without one have a look of their own. */
  look?: string;
  /** Wanders the open streets instead of keeping a schedule. */
  wander?: boolean;
  schedule: {
    work: LocationWaypoint;
    market: LocationWaypoint;
    inn: LocationWaypoint;
    home: LocationWaypoint;
  };
}

/**
 * 30 Authentic Sindr townsfolk.
 * Exactly 24 Dim (80%) and 6 Lit (20%) per LORE rules (Jadon, 1 Nov).
 */
export const SINDR_TOWNSFOLK: Townsperson[] = [
  // Smiths at Great Forge (x: 74..90, z: 32..40)
  {
    id: 'smith_brokk',
    name: 'Brokk the Anvil',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 78, y: 0.4, z: 34.5, facing: Math.PI },
      market: { x: 114, y: 0, z: -2, facing: 0 },
      inn: { x: 108, y: 0, z: -18, facing: -Math.PI * 0.4 },
      home: { x: 72, y: 0, z: 12, facing: Math.PI },
    },
  },
  {
    id: 'smith_torvald',
    name: 'Torvald Coal-Biter',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 86, y: 0.4, z: 34.5, facing: 0 },
      market: { x: 120, y: 0, z: 4, facing: Math.PI * 0.2 },
      inn: { x: 110, y: 0, z: -19, facing: 0 },
      home: { x: 74, y: 0, z: 12, facing: Math.PI },
    },
  },
  {
    id: 'smith_vala',
    name: 'Vala Cinder-Hand',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 82, y: 0.4, z: 33.5, facing: 0 },
      market: { x: 116, y: 0, z: -4, facing: Math.PI },
      inn: { x: 107, y: 0, z: -17, facing: Math.PI * 0.5 },
      home: { x: 70, y: 0, z: 14, facing: Math.PI * 0.5 },
    },
  },
  {
    id: 'smith_ignis_master',
    name: 'Vulkan Hearth-Shaper',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: true, // 1/6 Lit
    element: 'IGNIS',
    sex: 'male',
    schedule: {
      work: { x: 90, y: 0.4, z: 34.5, facing: 0 },
      market: { x: 122, y: 0, z: -6, facing: Math.PI * 0.5 },
      inn: { x: 112, y: 0, z: -20, facing: -Math.PI * 0.8 },
      home: { x: 98, y: 0, z: 16, facing: 0 },
    },
  },

  // Traders in the Square (x: 104..146, z: -16..16)
  {
    id: 'trader_surna',
    name: 'Surna Shard-Seller',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 113, y: 0, z: -7, facing: 0 },
      market: { x: 125, y: 0, z: -2, facing: 0 },
      inn: { x: 106, y: 0, z: -18, facing: Math.PI * 0.3 },
      home: { x: 138, y: 0, z: -22, facing: 0 },
    },
  },
  {
    id: 'trader_brand',
    name: 'Brand of the Basin',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 137, y: 0, z: -7, facing: Math.PI },
      market: { x: 128, y: 0, z: 2, facing: -Math.PI * 0.5 },
      inn: { x: 109, y: 0, z: -17, facing: Math.PI * 0.8 },
      home: { x: 142, y: 0, z: -22, facing: 0 },
    },
  },
  {
    id: 'trader_kael',
    name: 'Kael Provisions',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 113, y: 0, z: 7, facing: 0 },
      market: { x: 122, y: 0, z: 0, facing: Math.PI * 0.5 },
      inn: { x: 108, y: 0, z: -20, facing: -Math.PI * 0.2 },
      home: { x: 112, y: 0, z: 22, facing: Math.PI },
    },
  },
  {
    id: 'trader_fen',
    name: 'Fen Whetstone',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 137, y: 0, z: 7, facing: 0 },
      market: { x: 126, y: 0, z: -3, facing: -Math.PI * 0.3 },
      inn: { x: 111, y: 0, z: -18, facing: Math.PI * 0.5 },
      home: { x: 138, y: 0, z: 22, facing: Math.PI },
    },
  },
  {
    id: 'trader_lit_veteran',
    name: 'Ignan Red-Cloak',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: true, // 2/6 Lit
    element: 'IGNIS',
    sex: 'male',
    schedule: {
      work: { x: 124, y: 0, z: 1, facing: -Math.PI * 0.5 },
      market: { x: 124, y: 0, z: 1, facing: -Math.PI * 0.5 },
      inn: { x: 107, y: 0, z: -19, facing: Math.PI * 0.1 },
      home: { x: 104, y: 0, z: -22, facing: 0 },
    },
  },

  // Innkeeper at Hearth & Anvil (x: 109, z: -18)
  {
    id: 'innkeeper_greta',
    name: 'Greta Warm-Hearth',
    role: 'innkeeper',
    dialogueRole: 'innkeeper_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 109, y: 0, z: -18, facing: Math.PI * 0.5 },
      market: { x: 118, y: 0, z: -10, facing: 0 },
      inn: { x: 109, y: 0, z: -18, facing: Math.PI * 0.5 },
      home: { x: 109, y: 0, z: -22, facing: 0 },
    },
  },
  {
    id: 'inn_cellarman_oscar',
    name: 'Oscar Tapman',
    role: 'innkeeper',
    dialogueRole: 'innkeeper_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 106, y: 0, z: -19, facing: 0 },
      market: { x: 115, y: 0, z: -12, facing: Math.PI },
      inn: { x: 106, y: 0, z: -19, facing: 0 },
      home: { x: 106, y: 0, z: -22, facing: 0 },
    },
  },

  // Guards on Keep Lane (x: 190, z: -34..-64) and West/East Gates
  {
    id: 'guard_garrick',
    name: 'Guard Garrick',
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
    role: 'guard',
    dialogueRole: 'guard_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 54, y: 0, z: -3, facing: -Math.PI * 0.5 },
      market: { x: 58, y: 0, z: 0, facing: Math.PI * 0.5 },
      inn: { x: 105, y: 0, z: -17, facing: Math.PI * 0.3 },
      home: { x: 56, y: 0, z: 8, facing: Math.PI },
    },
  },
  {
    id: 'guard_east_gate',
    name: 'Watchman Toren',
    role: 'guard',
    dialogueRole: 'guard_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 220, y: 0, z: 3, facing: Math.PI * 0.5 },
      market: { x: 215, y: 0, z: 0, facing: -Math.PI * 0.5 },
      inn: { x: 112, y: 0, z: -17, facing: -Math.PI * 0.6 },
      home: { x: 216, y: 0, z: 8, facing: Math.PI },
    },
  },

  // Worshippers at Shrine of Embers (x: 0..6, z: -4..4)
  {
    id: 'worshipper_alena',
    name: 'Sister Alena',
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
    role: 'porter',
    dialogueRole: 'porter_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 115, y: 0, z: 4.5, facing: Math.PI * 0.3 },
      market: { x: 115, y: 0, z: 4.5, facing: Math.PI * 0.3 },
      inn: { x: 105, y: 0, z: -19, facing: 0 },
      home: { x: 62, y: 0, z: -10, facing: 0 },
    },
  },
  {
    id: 'porter_burl',
    name: 'Burl Ox-Shoulder',
    role: 'porter',
    dialogueRole: 'porter_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 120, y: 0, z: 2.5, facing: -Math.PI * 0.5 },
      market: { x: 120, y: 0, z: 2.5, facing: -Math.PI * 0.5 },
      inn: { x: 113, y: 0, z: -18, facing: -Math.PI * 0.4 },
      home: { x: 160, y: 0, z: -12, facing: 0 },
    },
  },
  {
    id: 'porter_davo',
    name: 'Davo Crates',
    role: 'porter',
    dialogueRole: 'porter_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 122, y: 0, z: 5.0, facing: Math.PI * 0.2 },
      market: { x: 122, y: 0, z: 5.0, facing: Math.PI * 0.2 },
      inn: { x: 108, y: 0, z: -16, facing: Math.PI * 0.7 },
      home: { x: 92, y: 0, z: -12, facing: 0 },
    },
  },
  {
    id: 'porter_sela',
    name: 'Sela Sacks',
    role: 'porter',
    dialogueRole: 'porter_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 117, y: 0, z: 1.5, facing: Math.PI * 0.8 },
      market: { x: 117, y: 0, z: 1.5, facing: Math.PI * 0.8 },
      inn: { x: 104, y: 0, z: -18, facing: Math.PI * 0.2 },
      home: { x: 170, y: 0, z: -12, facing: 0 },
    },
  },

  // Children in Square / Alleys
  {
    id: 'child_pip',
    name: 'Pip',
    role: 'child',
    dialogueRole: 'child_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 114, y: 0, z: 3.5, facing: Math.PI * 0.6 },
      market: { x: 114, y: 0, z: 3.5, facing: Math.PI * 0.6 },
      inn: { x: 111, y: 0, z: -16, facing: 0 },
      home: { x: 116, y: 0, z: 22, facing: Math.PI },
    },
  },
  {
    id: 'child_rin',
    name: 'Rin',
    role: 'child',
    dialogueRole: 'child_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 116, y: 0, z: 5.5, facing: -Math.PI * 0.3 },
      market: { x: 116, y: 0, z: 5.5, facing: -Math.PI * 0.3 },
      inn: { x: 112, y: 0, z: -16, facing: -Math.PI * 0.5 },
      home: { x: 118, y: 0, z: 22, facing: Math.PI },
    },
  },
  {
    id: 'child_milo',
    name: 'Milo Runner',
    role: 'child',
    dialogueRole: 'child_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 119, y: 0, z: 4.0, facing: 0 },
      market: { x: 119, y: 0, z: 4.0, facing: 0 },
      inn: { x: 109, y: 0, z: -16, facing: Math.PI },
      home: { x: 136, y: 0, z: -22, facing: 0 },
    },
  },

  // Additional Townsfolk / Artisans browsing in Square
  {
    id: 'citizen_elena',
    name: 'Elena Loom-Keeper',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 113, y: 0, z: 2.0, facing: 0 },
      market: { x: 113, y: 0, z: 2.0, facing: 0 },
      inn: { x: 107, y: 0, z: -17, facing: Math.PI * 0.4 },
      home: { x: 144, y: 0, z: -22, facing: 0 },
    },
  },
  {
    id: 'citizen_dari',
    name: 'Dari Basket-Maker',
    role: 'trader',
    dialogueRole: 'trader_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 121, y: 0, z: 6.0, facing: Math.PI },
      market: { x: 121, y: 0, z: 6.0, facing: Math.PI },
      inn: { x: 110, y: 0, z: -17, facing: -Math.PI * 0.5 },
      home: { x: 108, y: 0, z: -22, facing: 0 },
    },
  },
  {
    id: 'citizen_rowan',
    name: 'Rowan of the Ash',
    role: 'worshipper',
    dialogueRole: 'worshipper_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'male',
    schedule: {
      work: { x: 123, y: 0, z: 3.0, facing: Math.PI * 0.4 },
      market: { x: 123, y: 0, z: 3.0, facing: Math.PI * 0.4 },
      inn: { x: 106, y: 0, z: -16, facing: Math.PI * 0.6 },
      home: { x: 64, y: 0, z: -10, facing: 0 },
    },
  },
  {
    id: 'citizen_mira',
    name: 'Mira the Potter',
    role: 'smith',
    dialogueRole: 'smith_sindr',
    isLit: false,
    element: 'DIM',
    sex: 'female',
    schedule: {
      work: { x: 118, y: 0, z: 6.5, facing: -Math.PI * 0.5 },
      market: { x: 118, y: 0, z: 6.5, facing: -Math.PI * 0.5 },
      inn: { x: 108, y: 0, z: -19, facing: 0 },
      home: { x: 68, y: 0, z: 12, facing: Math.PI },
    },
  },
  {
    id: 'traveler_ignis_scout',
    name: 'Ignis Scout Kova',
    role: 'guard',
    dialogueRole: 'guard_sindr',
    isLit: true, // 6/6 Lit
    element: 'IGNIS',
    sex: 'female',
    schedule: {
      work: { x: 121, y: 0, z: 1.5, facing: -Math.PI * 0.5 },
      market: { x: 121, y: 0, z: 1.5, facing: -Math.PI * 0.5 },
      inn: { x: 113, y: 0, z: -19, facing: -Math.PI * 0.7 },
      home: { x: 180, y: 0, z: 10, facing: 0 },
    },
  },
];

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
