import { Vector3 } from 'three';
import type { Element } from '../../../shared/src/index.js';

export interface NationObstacle {
  x: number;
  z: number;
  radius: number;
  height?: number;
  type: string;
}

export interface MeteorologyConfig {
  particleType: 'ash' | 'snow' | 'wind' | 'dust';
  fogColor: number;
  fogDensity: number;
  skyTint: number;
  ambientLight: number;
  sunColor: number;
  sunIntensity: number;
  hasAmbientWater: boolean;
  name: string;
  description: string;
}

export interface NationGeography {
  element: Element;
  name: string;
  locationName: string;
  boundary: Array<{ x: number; z: number }>;
  obstacles: NationObstacle[];
  waterSources: Vector3[];
  spiritWaterSources: Vector3[];
  wallHeight: number;
  wallThickness: number;
  floorTexture: string;
  wallTexture: string;
  meteorology: MeteorologyConfig;
}

/**
 * Procedural generation of organic, non-circular perimeter polygons.
 * Creates natural geological formations rather than a uniform circle.
 */
function createCalderaPerimeter(): Array<{ x: number; z: number }> {
  // Volcanic caldera: jagged, asymmetrical caldera rim
  const points: Array<{ x: number; z: number }> = [];
  const segments = 24;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const radius = 15.0 + Math.sin(angle * 3) * 2.8 + Math.cos(angle * 5 + 0.8) * 1.6 + (i % 2 === 0 ? 0.9 : -0.7);
    points.push({
      x: Math.cos(angle) * (radius * 1.15),
      z: Math.sin(angle) * (radius * 0.9),
    });
  }
  return points;
}

function createFjordPerimeter(): Array<{ x: number; z: number }> {
  // Glacial fjord: winding coastal inlet between sheer ice cliffs opening to frozen sea
  const points: Array<{ x: number; z: number }> = [];
  const segments = 24;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const bayMod = Math.sin(angle * 2) * 3.5 + Math.cos(angle * 4) * 1.8;
    const rx = 13.5 + Math.cos(angle * 3) * 2.0;
    const rz = 18.0 + bayMod;
    points.push({
      x: Math.cos(angle) * rx,
      z: Math.sin(angle) * rz,
    });
  }
  return points;
}

function createSpirePerimeter(): Array<{ x: number; z: number }> {
  // Mountain spire sanctuary: stepped polygonal platform with cantilevered clifftops
  const points: Array<{ x: number; z: number }> = [];
  const segments = 20;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const facet = Math.cos(angle * 6) * 1.4;
    const terrace = (i % 5 === 0) ? 3.8 : 0;
    const r = 14.5 + facet + terrace;
    points.push({
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
    });
  }
  return points;
}

function createCanyonPerimeter(): Array<{ x: number; z: number }> {
  // Bedrock canyon: deep stratified angular gorge with rock chokepoints
  const points: Array<{ x: number; z: number }> = [];
  const segments = 22;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const xDistort = Math.sign(Math.cos(angle)) * Math.pow(Math.abs(Math.cos(angle)), 0.6) * 16.5;
    const zDistort = Math.sign(Math.sin(angle)) * Math.pow(Math.abs(Math.sin(angle)), 0.6) * 14.0;
    const rugged = Math.sin(angle * 7) * 1.5;
    points.push({
      x: xDistort + rugged,
      z: zDistort + rugged * 0.7,
    });
  }
  return points;
}

export const NATIONS: Record<Element, NationGeography> = {
  IGNIS: {
    element: 'IGNIS',
    name: 'Fire Nation',
    locationName: 'Caldera of Sindr',
    boundary: createCalderaPerimeter(),
    obstacles: [
      { x: 0, z: -11, radius: 1.8, height: 3.2, type: 'basalt_monolith' },
      { x: 8.5, z: 5.5, radius: 1.6, height: 2.2, type: 'volcanic_crag' },
      { x: -9, z: -3.5, radius: 1.4, height: 2.0, type: 'volcanic_crag' },
      { x: -5, z: 8, radius: 1.2, height: 1.8, type: 'lava_vent' },
    ],
    waterSources: [],
    spiritWaterSources: [],
    wallHeight: 3.4,
    wallThickness: 1.2,
    floorTexture: 'monastery_stone_floor',
    wallTexture: 'rock_wall_08',
    meteorology: {
      particleType: 'ash',
      fogColor: 0x56505c,
      fogDensity: 0.0035,
      skyTint: 0xff8844,
      ambientLight: 0.88,
      sunColor: 0xffaa55,
      sunIntensity: 3.5,
      hasAmbientWater: false,
      name: 'Volcanic Ashfall & Ember Storms',
      description: 'Warm atmospheric haze drifts over ancient caldera cliffs.',
    },
  },
  AQUES: {
    element: 'AQUES',
    name: 'Water Tribe',
    locationName: 'Glacial Fjord & Polar Sanctuary',
    boundary: createFjordPerimeter(),
    obstacles: [
      { x: -7, z: -8, radius: 1.9, height: 4.5, type: 'glacial_ice_pillar' },
      { x: 9, z: -6, radius: 1.7, height: 3.8, type: 'glacial_ice_pillar' },
      { x: -8, z: 6, radius: 1.5, height: 2.8, type: 'frozen_pack_ice' },
      { x: 0, z: 12, radius: 2.4, height: 0.4, type: 'spirit_oasis_altar' },
    ],
    waterSources: [
      new Vector3(0, 0, 11),
      new Vector3(-6, 0, -4),
      new Vector3(7, 0, 3),
      new Vector3(0, 0, -10),
    ],
    spiritWaterSources: [
      new Vector3(0, 0, 11), // The Sacred Spirit Oasis pool
    ],
    wallHeight: 4.2,
    wallThickness: 1.4,
    floorTexture: 'forest_ground_04',
    wallTexture: 'rock_wall_08',
    meteorology: {
      particleType: 'snow',
      fogColor: 0x24354c,
      fogDensity: 0.0032,
      skyTint: 0x88bbff,
      ambientLight: 0.90,
      sunColor: 0x88beff,
      sunIntensity: 3.2,
      hasAmbientWater: true, // In polar fjord, ice/water is everywhere!
      name: 'Polar Blizzard & Sacred Lunar Glow',
      description: 'Crystalline snowfall sweeps under the radiant Full Moon.',
    },
  },
  AURA: {
    element: 'AURA',
    name: 'Air Nomads',
    locationName: 'Spire Sanctuary of the High Peaks',
    boundary: createSpirePerimeter(),
    obstacles: [
      { x: 0, z: -12, radius: 1.6, height: 5.2, type: 'temple_spire_column' },
      { x: 7.5, z: 6.5, radius: 1.4, height: 3.6, type: 'prayer_stupa' },
      { x: -8, z: 5.5, radius: 1.4, height: 3.6, type: 'prayer_stupa' },
      { x: 0, z: 9, radius: 1.8, height: 1.2, type: 'wind_altar_dais' },
    ],
    waterSources: [
      new Vector3(-5, 0, 4),
      new Vector3(5, 0, -4),
    ],
    spiritWaterSources: [],
    wallHeight: 2.2,
    wallThickness: 0.9,
    floorTexture: 'monastery_stone_floor',
    wallTexture: 'rock_wall_08',
    meteorology: {
      particleType: 'wind',
      fogColor: 0x526b88,
      fogDensity: 0.0028,
      skyTint: 0xccddff,
      ambientLight: 0.95,
      sunColor: 0xfff6e5,
      sunIntensity: 3.6,
      hasAmbientWater: false,
      name: 'High-Altitude Gales & Cloud Banks',
      description: 'Howling mountain winds surge across precipitous spires.',
    },
  },
  TERRA: {
    element: 'TERRA',
    name: 'Earth Kingdom',
    locationName: 'The Canyon Monoliths & Bedrock Quarry',
    boundary: createCanyonPerimeter(),
    obstacles: [
      { x: 0, z: -10, radius: 2.2, height: 4.8, type: 'bedrock_monolith' },
      { x: 8, z: 4, radius: 1.9, height: 3.2, type: 'stratified_boulder' },
      { x: -9, z: -2, radius: 2.0, height: 3.0, type: 'quarry_block' },
      { x: 5, z: -7, radius: 1.5, height: 2.4, type: 'rock_pillar' },
      { x: -6, z: 7, radius: 1.6, height: 2.0, type: 'rock_pillar' },
    ],
    waterSources: [
      new Vector3(-4, 0, -8),
    ],
    spiritWaterSources: [],
    wallHeight: 4.6,
    wallThickness: 1.6,
    floorTexture: 'forest_ground_04',
    wallTexture: 'rock_wall_08',
    meteorology: {
      particleType: 'dust',
      fogColor: 0x584c3e,
      fogDensity: 0.0032,
      skyTint: 0xe8b878,
      ambientLight: 0.88,
      sunColor: 0xffd088,
      sunIntensity: 3.5,
      hasAmbientWater: false,
      name: 'Arid Sandstorm & Bedrock Resonance',
      description: 'Warm sandstone haze rises between monolithic bedrock cliffs.',
    },
  },
};

export function getNationGeography(nation: Element = 'IGNIS'): NationGeography {
  return (NATIONS[nation] ?? NATIONS.IGNIS)!;
}
