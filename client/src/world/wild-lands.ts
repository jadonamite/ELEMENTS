import { LEGACY_SINDR_ORIGIN as O } from '../../../shared/src/world/ignis/coordinates.js';
import { wildPlace } from '../../../shared/src/world/ignis/wild.js';
import { BARRENS, buildBarrens } from './barrens.js';
import type { WorldBuilder } from './builder.js';
import { buildGorge, GORGE } from './gorge.js';

/** The outlaw hollow: a hidden camp in a bowl off the Barrens road, lean-tos round a fire and a lookout on the rim side. */
function buildHollow(b: WorldBuilder): void {
  b.box('ash_cinder_ground', 0, 0.02, 0, 30, 0.05, 30);
  b.fire(0, 0.3, 0, 1.1); b.light(0, 1.6, 0, 0xff6a22, 26, 16, 0.3);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; b.prop('boulder_large', Math.cos(a) * 2.2, Math.sin(a) * 2.2, a, 0.45); }
  for (const [x, z, yaw] of [[-12, -6, 0.5], [10, -10, -0.7], [11, 9, 2.4], [-9, 12, 1.6]] as const) {
    b.inside(x, z, yaw, 0, () => {
      // A lean-to: two posts, a ridge pole and a sloping cloth to the ground, bedding beneath.
      for (const side of [-2, 2]) { b.box('charred_timber_beams', side, 1.2, 1.2, 0.18, 2.4, 0.18); b.solid(side, 1.2, 1.2, 0.2, 2.4, 0.2); }
      b.box('charred_timber_beams', 0, 2.4, 1.2, 4.4, 0.14, 0.14);
      b.box('raw_timber', 0, 1.2, -0.4, 4.2, 0.06, 4, { x: -0.62 });
      b.box('raw_timber', 0, 0.12, 0, 3.4, 0.2, 1.6);
      b.solid(0, 0.6, -1.4, 4.2, 1.2, 1.2);
    });
  }
  for (const [x, z] of [[-4, 8], [-5.2, 9.1], [5, -6], [14, -1]] as const) { b.prop('crate', x, z, x, 0.9); b.solid(x, 0.45, z, 0.9, 0.9, 0.9); }
  b.prop('barrel', 6.2, -7.2, 0, 0.85); b.prop('barrel', -13, 2, 0, 0.85);
  // Lookout platform toward the road.
  for (const sx of [-1.5, 1.5]) for (const sz of [-1.5, 1.5]) { b.box('charred_timber_beams', -24 + sx, 2.5, -20 + sz, 0.25, 5, 0.25); b.solid(-24 + sx, 2.5, -20 + sz, 0.25, 5, 0.25); }
  b.box('raw_timber', -24, 5.1, -20, 4, 0.2, 4); b.solid(-24, 5.1, -20, 4, 0.2, 4);
}

/** The wild lands at their map positions. Each builder keeps its own local plan; the root puts it on its floor. */
export function buildWildLands(b: WorldBuilder): void {
  const barrens = wildPlace('barrens'), gorge = wildPlace('gorge'), hollow = wildPlace('hollow');
  // The Barrens plan runs west to east along its trail; its west end meets the end of the Barrens road.
  b.rooted(barrens.x - (BARRENS.x0 + BARRENS.x1) / 2 - O.x, barrens.z - O.z, 0, barrens.height - O.y, () => buildBarrens(b));
  // The gorge plan runs from the town end to the far end; here the far end is the fort, to the west, so it is turned round.
  b.rooted(gorge.x2 + GORGE.x0 - O.x, gorge.z - O.z, Math.PI, gorge.height - O.y, () => buildGorge(b));
  b.rooted(hollow.x - O.x, hollow.z - O.z, 0, hollow.height - O.y, () => buildHollow(b));
}
