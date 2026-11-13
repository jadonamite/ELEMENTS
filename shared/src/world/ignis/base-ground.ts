import { mix, shapedLand, type BaseGround } from './land-form.js';
import { settlementGround } from './settlements.js';
export * from './land-form.js';

/**
 * Ground before any road or public waterwork shapes it: the shaped land plus the settlement floors.
 * Roads take their heights from this field, so a road and the land beside it always agree.
 */
export function baseGround(x: number, z: number): BaseGround {
  const land = shapedLand(x, z);
  if (!land.inland) return land;
  // Working floors stay dry without filling the lake, river bed or their immediate banks.
  return { height: mix(land.height, settlementGround(x, z, land.height), land.dry), inland: true, river: land.river };
}
