import type { Element } from '../combat/types.js';

export interface NationMasterConfig {
  id: string;
  name: string;
  title: string;
  greetingBark: string;
  voice: string;
  look: string;
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

export const NATION_INTROS: Record<Element, NationIntroConfig> = {
  IGNIS: {
    nation: 'IGNIS',
    zoneName: 'Sindr',
    arrivalLandmark: 'Shrine of Embers',
    master: {
      id: 'master_ignis',
      name: 'Master Brandr',
      title: 'Master of IGNIS',
      greetingBark: 'Easy. On your feet.',
      voice: 'smith_sindr_male',
      look: 'master-ignis',
    },
    starterWeapon: 'sword',
    dialogue: {
      greeting: "Easy. On your feet. You're through the Draw.",
      loreTeaser: "This is Sindr, forge-heart of IGNIS. If you seek a way back to where you came from, keep your head. Tales tell of the Allborn—one who commands all four primal elements and might open a passage between worlds. For now, it is only a whisper. You survive here first.",
      stepFooting: "First, find your balance on this stone. Take three paces forward.",
      stepSprintJump: "Good. Now quicken your stride and spring clear of the ground.",
      weaponHandoff: "Take this. Worn iron from our forge. It will keep you whole until you earn finer steel.",
      stepAttacks: "Feel the balance. Test a swift light cut, then drive your shoulder into a heavy strike.",
      stepDefense: "Striking is simple; surviving is discipline. Raise your guard, then slip aside with a dodge.",
      shaperRole: "The Draw marked you with fire. But raw flame without disciplined bone will consume you before dusk. Keep your blade ready.",
      hushRole: "The Draw named you Hush. No flame runs in your veins. But without your hands to forge iron and shape relics, the Shapers are helpless. You fight with steel alone.",
      missionBrief: "Down this paved road stands the West Gate of Sindr. Walk the road, hold your blade firm, and reach the gate. Reach it, and your true standing here begins.",
    },
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
      name: 'Master Lynne',
      title: 'Master of AQUES',
      greetingBark: 'Breathe. The current has settled.',
      voice: 'trader_sindr_female',
      look: 'master-aques',
    },
    starterWeapon: 'sword',
    dialogue: {
      greeting: "Breathe. The current has settled. You are through the Draw.",
      loreTeaser: "You stand in the waterways of AQUES. Many who arrive search for the threshold back to their realm. The myth of the Allborn speaks of one who joins all four streams of power. Until that legend walks, you must hold your ground in the tides.",
      stepFooting: "Walk across these wet planks. Prove your feet will not betray you.",
      stepSprintJump: "Quicken your pace and leap over the mooring timbers.",
      weaponHandoff: "Take this blade. Cold-forged steel. It cuts true even under heavy mist.",
      stepAttacks: "Give me two strokes: one swift as a crest, one heavy as an undertow.",
      stepDefense: "Brace your guard against the blow, then glide out of its arc.",
      shaperRole: "The waters answer your pulse. But an undisciplined river drowns its own banks. Master your stance first.",
      hushRole: "You are Hush. The waters do not bend to your voice. Yet our fleet depends on your hands to bind hull and temper iron.",
      missionBrief: "Follow the canal path to the Harbor Arch. Reach the archway to prove your readiness to walk the river cities.",
    },
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
      name: 'Master Orik',
      title: 'Master of TERRA',
      greetingBark: 'Firm ground under you now.',
      voice: 'smith_sindr_male',
      look: 'master-terra',
    },
    starterWeapon: 'sword',
    dialogue: {
      greeting: "Firm ground under you now. The Draw has released you.",
      loreTeaser: "These are the stone crags of TERRA. If you wonder how to return beyond the veil, look to the bedrock legend of the Allborn—the singular sovereign of all four powers. A distant hope. The mountains demand patience and iron.",
      stepFooting: "Tread the gravel. Let your weight sink into the earth.",
      stepSprintJump: "Sprint past the stone marker and leap the fissure.",
      weaponHandoff: "Take this heavy iron. Rough edge, but unbreakable spine. Grip it firm.",
      stepAttacks: "Swing with intent: a short cutting strike, followed by a crushing blow.",
      stepDefense: "Lock your shield guard against impact, then roll clear when the hammer falls.",
      shaperRole: "Stone sleeps in your marrow. But rock unhewn breaks under pressure. Learn the discipline of iron before stone.",
      hushRole: "You carry no stonecraft in your blood. You are Hush. It is your craft that cuts the quarry and binds the fortress gates.",
      missionBrief: "Advance up the mountain approach to the High Bastion Gate. Show that your legs can climb these crags.",
    },
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
      name: 'Master Zephyr',
      title: 'Master of AURA',
      greetingBark: 'Stand tall. The gale has passed.',
      voice: 'trader_sindr_male',
      look: 'master-aura',
    },
    starterWeapon: 'staff',
    dialogue: {
      greeting: "Stand tall. The gale has passed. You have crossed the Draw.",
      loreTeaser: "You breathe the high winds of AURA. If you seek the seam leading homeward, ancient songs speak of the Allborn who harmonized all four elements. A myth across centuries. Today, your duty is to keep your balance.",
      stepFooting: "Step lightly across the stone flagstones. Feel the updraft.",
      stepSprintJump: "Run with the wind and take flight over the gap.",
      weaponHandoff: "Take this quarterstaff. Seasoned ash with bound grips. Two hands, wide reach.",
      stepAttacks: "Sweep the air: a quick thrust, then a full two-handed circular strike.",
      stepDefense: "Raise the staff to deflect, then drift backward into open space.",
      shaperRole: "The air heeds your breath. But wind without center is merely storm and folly. Master the staff first.",
      hushRole: "You are Hush; the sky does not lift you. But our spires stand only because your hands weave harness, rope, and glider frames.",
      missionBrief: "Walk the terrace path to the Sky Arch. Cross the span to demonstrate your steady footing.",
    },
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
