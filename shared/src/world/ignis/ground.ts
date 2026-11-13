import { baseGround, LAKE, landDistance, mix, oceanBoundary, riverAt, smooth } from './base-ground.js';
export * from './base-ground.js';
export { SETTLEMENTS } from './settlements.js';
import { mineAt } from './mine-road.js';
import { nationalRoadAt, nationalRoadGround } from './routes.js';
import { nationalWaterAt, nationalWaterworksGround } from './waterworks.js';
export { MINE_ROAD, MINE_LENGTH, MINE_MAX_GRADE, mineAt, minePointAt } from './mine-road.js';

export function waterHeight(x: number, z: number): number | null {
  const river = riverAt(x, z);
  const publicWater = river.distance > 9 ? nationalWaterAt(x, z) : null;
  if (publicWater) return publicWater.surface;
  if (((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2 <= 1) return LAKE.height;
  if (river.distance <= 9) return river.water;
  return landDistance(x, z) <= 0 && oceanBoundary(x, z) ? 0 : null;
}
export function groundHeight(x: number, z: number): number {
  const base = baseGround(x, z);
  if (!base.inland) return base.height;
  let h = base.height;
  h = nationalRoadGround(x, z, h, waterHeight(x, z));
  // Cart corridors take priority on dry land. They do not cross this river.
  const road = mineAt(x, z);
  const mineWeight = smooth(6, 14, road.distance);
  if (road.distance < 14) h = mix(road.height, h, mineWeight);
  const cart = nationalRoadAt(x, z);
  const roadWeight = cart ? smooth(cart.route.width / 2, cart.route.width / 2 + cart.route.shoulder, cart.distance) : 1;
  // Under a road's deck the channel keeps its bed; elsewhere a road keeps its own surface.
  const bridged = cart !== null && base.river > 9 && nationalWaterAt(x, z) !== null;
  h = nationalWaterworksGround(x, z, h, base.river <= 9, bridged ? 1 : mineWeight * roadWeight);
  return h;
}
export type Biome = 'ash' | 'grass' | 'pine' | 'rock' | 'snow';
export interface GroundSample { height: number; water: number | null; biome: Biome; mask: readonly number[] }
export function groundAt(x: number, z: number): GroundSample {
  const height = groundHeight(x, z), water = waterHeight(x, z);
  const slope = Math.hypot(groundHeight(x + 2, z) - groundHeight(x - 2, z), groundHeight(x, z + 2) - groundHeight(x, z - 2)) / 4;
  const snow = smooth(1450, 1750, height), rock = smooth(0.45, 1.1, slope) * (1 - snow);
  const pine = (1 - smooth(6500, 9000, x)) * smooth(400, 600, height) * (1 - smooth(1000, 1250, height)) * (1 - snow - rock);
  const grass = (1 - snow - rock - pine) * (1 - smooth(9000, 11500, x)) * 0.7;
  const mask = [Math.max(0, 1 - snow - rock - pine - grass), grass, pine, rock, snow];
  const names: Biome[] = ['ash', 'grass', 'pine', 'rock', 'snow'];
  return { height, water, biome: names[mask.indexOf(Math.max(...mask))]!, mask };
}
