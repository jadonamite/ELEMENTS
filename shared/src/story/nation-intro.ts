import type { Element } from '../combat/types.js';
import dialogue from '../../dialogue.json' with { type: 'json' };

export interface NationMasterConfig {
  id: string;
  name: string;
  title: string;
  greetingBark: string;
  look: string;
  /** The sex the master's body is built as, which is also the voice they speak in. */
  sex: 'male' | 'female';
  /** Where the master keeps their post in the nation's town after the intro, town metres; none where the town is not built. */
  post?: { x: number; z: number; facing: number };
}

export interface NationFirstMission {
  id: string;
  title: string;
  description: string;
  objective: string;
  target: {
    x: number;
    y: number;
    z: number;
    radius: number;
    name: string;
    locationName: string;
  };
  rewardChroma: number;
}

export interface NationIntroDialogue {
  greeting: string;
  loreTeaser: string;
  stepFooting: string;
  stepSprintJump: string;
  weaponHandoff: string;
  stepAttacks: string;
  stepDefense: string;
  shaperRole: string;
  hushRole: string;
  missionBrief: string;
}

export interface NationIntroConfig {
  nation: Element;
  zoneName: string;
  arrivalLandmark: string;
  master: NationMasterConfig;
  starterWeapon: 'sword' | 'staff';
  dialogue: NationIntroDialogue;
  firstMission: NationFirstMission;
}

/** Where each intro line sits in the master's block of dialogue.json, which holds every spoken line and its recording. */
const INTRO_SITUATION: Record<keyof NationIntroDialogue, string> = {
  greeting: 'intro_greeting', loreTeaser: 'intro_lore', stepFooting: 'intro_footing', stepSprintJump: 'intro_sprint_jump',
  weaponHandoff: 'intro_weapon', stepAttacks: 'intro_attacks', stepDefense: 'intro_defense', shaperRole: 'intro_shaper',
  hushRole: 'intro_hush', missionBrief: 'intro_mission',
};

/** A master's intro lines from their block of dialogue.json; the master id is their dialogue group. */
function introLines(masterId: string): NationIntroDialogue {
  const block = (dialogue as unknown as Record<string, Record<string, unknown>>)[masterId];
  const out = {} as NationIntroDialogue;
  for (const [key, situation] of Object.entries(INTRO_SITUATION) as [keyof NationIntroDialogue, string][]) {
    const lines = block?.[situation];
    if (!Array.isArray(lines) || typeof lines[0] !== 'string') throw new Error(`dialogue.json has no ${masterId}.${situation}`);
    out[key] = lines[0];
  }
  return out;
}

export const NATION_INTROS: Record<Element, NationIntroConfig> = {
  IGNIS: {
    nation: 'IGNIS',
    zoneName: 'Sindr',
    arrivalLandmark: 'Shrine of Embers',
    master: {
      id: 'master_ignis',
      sex: 'male',
      name: 'Master Brandr',
      title: 'Master of IGNIS',
      greetingBark: 'Easy. On your feet.',
      look: 'master-ignis',
      post: { x: 11, z: 3.5, facing: Math.PI },
    },
    starterWeapon: 'sword',
    dialogue: introLines('master_ignis'),
    firstMission: {
      id: 'first_mission_ignis_gate',
      title: 'First Steps to Sindr',
      description: 'Journey down the paved road from the Shrine of Embers to the West Gate of Sindr.',
      objective: 'Reach the West Gate of Sindr',
      target: {
        x: 52,
        y: 0,
        z: 0,
        radius: 6,
        name: 'West Gate',
        locationName: 'West Gate of Sindr',
      },
      rewardChroma: 25,
    },
  },

  AQUES: {
    nation: 'AQUES',
    zoneName: 'Varda Basin',
    arrivalLandmark: 'Tidal Pier',
    master: {
      id: 'master_aques',
      sex: 'male',
      name: 'Master Lynne',
      title: 'Master of AQUES',
      greetingBark: 'Breathe. The current has settled.',
      look: 'master-aques',
    },
    starterWeapon: 'sword',
    dialogue: introLines('master_aques'),
    firstMission: {
      id: 'first_mission_aques_arch',
      title: 'First Steps in Varda',
      description: 'Follow the canal path to the Harbor Arch of Varda.',
      objective: 'Reach the Harbor Arch',
      target: {
        x: 60,
        y: 0,
        z: 10,
        radius: 6,
        name: 'Harbor Arch',
        locationName: 'Varda Harbor',
      },
      rewardChroma: 25,
    },
  },

  TERRA: {
    nation: 'TERRA',
    zoneName: 'Halda Crag',
    arrivalLandmark: 'Basalt Altar',
    master: {
      id: 'master_terra',
      sex: 'male',
      name: 'Master Orik',
      title: 'Master of TERRA',
      greetingBark: 'Firm ground under you now.',
      look: 'master-terra',
    },
    starterWeapon: 'sword',
    dialogue: introLines('master_terra'),
    firstMission: {
      id: 'first_mission_terra_bastion',
      title: 'Ascent to the Bastion',
      description: 'Climb the approach to the High Bastion Gate.',
      objective: 'Reach the High Bastion Gate',
      target: {
        x: 50,
        y: 4,
        z: 0,
        radius: 6,
        name: 'High Bastion Gate',
        locationName: 'Halda Crags',
      },
      rewardChroma: 25,
    },
  },

  AURA: {
    nation: 'AURA',
    zoneName: 'Naust Spires',
    arrivalLandmark: 'Wind Terrace',
    master: {
      id: 'master_aura',
      sex: 'male',
      name: 'Master Zephyr',
      title: 'Master of AURA',
      greetingBark: 'Stand tall. The gale has passed.',
      look: 'master-aura',
    },
    starterWeapon: 'staff',
    dialogue: introLines('master_aura'),
    firstMission: {
      id: 'first_mission_aura_arch',
      title: 'Span of the Spires',
      description: 'Cross the high terrace path to the Sky Arch.',
      objective: 'Reach the Sky Arch',
      target: {
        x: 48,
        y: 0,
        z: -8,
        radius: 6,
        name: 'Sky Arch',
        locationName: 'Naust Spires',
      },
      rewardChroma: 25,
    },
  },
};

export function getNationIntroConfig(nation: Element | string): NationIntroConfig {
  const key = (nation.toUpperCase() in NATION_INTROS) ? (nation.toUpperCase() as Element) : 'IGNIS';
  return NATION_INTROS[key];
}
