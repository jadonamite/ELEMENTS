import { IGNIS } from './coordinates.js';
import { groundHeight } from './ground.js';

export type RockGroupId = 'cinderpit' | 'mine-hamlet';

export interface RockHouseSite {
  id: string;            // 'ignis:rockhouse:cinderpit:0' ... 'ignis:rockhouse:mine-hamlet:7'
  group: RockGroupId;
  x: number; z: number;  // nation-global metres: centre of the ground-floor footprint
  yaw: number;           // WorldBuilder/Three rotation.y; the front (door side) faces local +z
  w: number; d: number;  // footprint: frontage (local x) and depth (local z), metres
  variant: 0 | 1 | 2 | 3 | 4 | 5;
  door: number;          // door offset along local x
  sill: number;          // door sill height, metres above sea level (ground floor level)
  landing: number;       // height of the lane/road where the steps or ramp land, metres ASL
  access: 'steps' | 'ramp';
}

export interface RockHouseGroup {
  id: RockGroupId;
  name: string;
  x: number; z: number;  // nation-global centre, used for the detail switch and cell ownership
  reach: number;         // metres from the centre that cover every house, lane and bank
  lane: readonly { x: number; z: number }[]; // nation-global centre line of the foot lane the doors land on (empty for the hamlet: the doors land on the mine road)
}

export const ROCK_HOUSE_RULES = {
  maxFoundation: 8,
  maxBuried: 3.4,
  stepRise: 0.16,
  maxSteps: 6,
  maxRampGrade: 0.25,
} as const;

/** Local (lx, lz) of a site to nation-global (x, z), with the WorldBuilder convention above. The only place that turns a site. */
export function siteToWorld(site: Pick<RockHouseSite, 'x' | 'z' | 'yaw'>, lx: number, lz: number): { x: number; z: number } {
  const cos = Math.cos(site.yaw);
  const sin = Math.sin(site.yaw);
  return {
    x: site.x + lx * cos + lz * sin,
    z: site.z - lx * sin + lz * cos,
  };
}

/** 256 m cell keys ('ix:iz') a group covers; same form as settlementCells. */
export function rockGroupCells(group: RockHouseGroup): readonly string[] {
  const keys: string[] = [];
  const reach = group.reach;
  for (let x = Math.floor((group.x - reach) / IGNIS.cellSize); x <= Math.floor((group.x + reach) / IGNIS.cellSize); x++) {
    for (let z = Math.floor((group.z - reach) / IGNIS.cellSize); z <= Math.floor((group.z + reach) / IGNIS.cellSize); z++) {
      keys.push(`${x}:${z}`);
    }
  }
  return keys;
}

/** Every check below; returns the first failure. Every input and every sampled height must be finite. */
export function checkRockHouseSite(site: RockHouseSite, groundAt: (x: number, z: number) => number = groundHeight): { ok: true } | { ok: false; reason: string } {
  for (const [k, v] of Object.entries(site)) {
    if (typeof v === 'number' && !Number.isFinite(v)) return { ok: false, reason: `non-finite ${k}` };
  }
  const halfW = site.w / 2;
  const halfD = site.d / 2;
  const samples: number[] = [];
  for (let lx = -halfW; lx <= halfW; lx += 1) {
    for (let lz = -halfD; lz <= halfD; lz += 1) {
      const p = siteToWorld(site, lx, lz);
      const h = groundAt(p.x, p.z);
      if (!Number.isFinite(h)) return { ok: false, reason: `non-finite ground sample at (${p.x}, ${p.z})` };
      samples.push(h);
    }
  }
  for (const lx of [-halfW, halfW]) {
    for (const lz of [-halfD, halfD]) {
      const p = siteToWorld(site, lx, lz);
      const h = groundAt(p.x, p.z);
      if (!Number.isFinite(h)) return { ok: false, reason: 'non-finite ground sample at corner' };
      samples.push(h);
    }
  }

  const minGround = Math.min(...samples);
  const maxGround = Math.max(...samples);

  if (site.sill - minGround > ROCK_HOUSE_RULES.maxFoundation) {
    return { ok: false, reason: `foundation too tall: ${site.sill - minGround} > ${ROCK_HOUSE_RULES.maxFoundation}` };
  }
  if (maxGround - site.sill > ROCK_HOUSE_RULES.maxBuried) {
    return { ok: false, reason: `buried too deep: ${maxGround - site.sill} > ${ROCK_HOUSE_RULES.maxBuried}` };
  }

  const thresh = siteToWorld(site, site.door, halfD);
  const threshGround = groundAt(thresh.x, thresh.z);
  if (!Number.isFinite(threshGround)) return { ok: false, reason: 'non-finite threshold ground' };
  if (threshGround > site.sill) {
    return { ok: false, reason: `door threshold ground (${threshGround}) > sill (${site.sill})` };
  }

  const drop = site.sill - site.landing;
  let run = 0;
  if (site.access === 'steps') {
    const numSteps = Math.round(drop / ROCK_HOUSE_RULES.stepRise);
    if (numSteps > ROCK_HOUSE_RULES.maxSteps) {
      return { ok: false, reason: `too many steps: ${numSteps} > ${ROCK_HOUSE_RULES.maxSteps}` };
    }
    run = numSteps * 0.3;
  } else {
    run = drop / ROCK_HOUSE_RULES.maxRampGrade;
  }

  const foot = siteToWorld(site, site.door, halfD + run);
  const footGround = groundAt(foot.x, foot.z);
  if (!Number.isFinite(footGround)) return { ok: false, reason: 'non-finite access foot ground' };
  if (Math.abs(footGround - site.landing) > 0.15) {
    return { ok: false, reason: `access foot ground (${footGround}) does not match landing (${site.landing}) within 0.15m` };
  }

  return { ok: true };
}

export const ROCK_HOUSE_GROUPS: readonly RockHouseGroup[] = [
  {
    id: 'cinderpit',
    name: 'Cinderpit Rim',
    x: 10500,
    z: 7000,
    reach: 240,
    lane: [
      { x: 10300, z: 7000 },
      { x: 10320, z: 6900 },
      { x: 10400, z: 6820 },
      { x: 10500, z: 6800 },
    ],
  },
  {
    id: 'mine-hamlet',
    name: 'Mine Road Hamlet',
    x: 7600,
    z: 8613,
    reach: 140,
    lane: [],
  },
];

export const ROCK_HOUSE_SITES: readonly RockHouseSite[] = [
  {
    id: 'ignis:rockhouse:cinderpit:0',
    group: 'cinderpit',
    x: 10285,
    z: 7000,
    yaw: Math.PI / 2,
    w: 7.2,
    d: 7.0,
    variant: 0,
    door: 0,
    sill: 740,
    landing: 739.52,
    access: 'steps',
  },
  {
    id: 'ignis:rockhouse:cinderpit:1',
    group: 'cinderpit',
    x: 10348,
    z: 6848,
    yaw: 2.356,
    w: 8.6,
    d: 8.0,
    variant: 1,
    door: 0,
    sill: 740,
    landing: 739.4,
    access: 'ramp',
  },
  {
    id: 'ignis:rockhouse:mine-hamlet:0',
    group: 'mine-hamlet',
    x: 7565,
    z: 8635,
    yaw: -0.5,
    w: 7.2,
    d: 7.0,
    variant: 0,
    door: 0,
    sill: 413,
    landing: 412.52,
    access: 'steps',
  },
  {
    id: 'ignis:rockhouse:mine-hamlet:1',
    group: 'mine-hamlet',
    x: 7610,
    z: 8605,
    yaw: -0.5,
    w: 8.6,
    d: 8.0,
    variant: 1,
    door: 0,
    sill: 416,
    landing: 415.5,
    access: 'ramp',
  },
];
