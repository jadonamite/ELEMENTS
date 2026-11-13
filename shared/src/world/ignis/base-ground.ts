import { mix, shapedLand, type BaseGround } from './land-form.js';
import { canalDistrict } from './canals.js';
import { settlementGround } from './settlements.js';
import { wildGround } from './wild.js';
export * from './land-form.js';

/**
 * Ground before any road or public waterwork shapes it: the shaped land plus the settlement floors.
 * Roads take their heights from this field, so a road and the land beside it always agree.
 */
export function baseGround(x: number, z: number): BaseGround {
  const land = shapedLand(x, z);
  if (!land.inland) return land;
  // Working floors stay dry without filling the lake, river bed or their immediate banks.
  const floor = mix(land.height, wildGround(x, z, settlementGround(x, z, land.height)), land.dry);
  // The river keeps its own bed and banks where a channel meets it.
  return { height: mix(floor, canalDistrict(x, z, floor), land.dry), inland: true, river: land.river };
}
