import { MARKET_SLICE, waterAt, type SlicePost } from '../../../shared/src/world/ignis/market-slice.js';
import { SINDR_ANCHORS } from '../../../shared/src/world/ignis/sindr.js';
import type { PostKind, WorldBuilder } from './builder.js';
import { rectArea, type Area, type Rect } from './levels.js';
import { stairRun, stairs } from './stairs.js';
import { clutter, lampPost, lanternString, paveStreet, parkedCart } from './street.js';
import { marketStall, noticeBoard, townHouse, type FrontRoom } from './style-kit.js';
import { dressTerrace, retainingWall, terraceTop } from './walls.js';
import { archBridge, balustrade, canal } from './water-works.js';

/**
 * Sindr's market street on the canal: the street itself (Cinder Row's middle 60 m), the fresh-water race along its
 * north edge with bridge B1, the terrace above the race with its stair and rock houses, and the shops, stalls,
 * smithy and service room along the south side. Every place, post and exit comes from the shared slice layout.
 * Ranks rise from the street to the terrace: commoners and merchants on the street, guild houses in red lacquer
 * and gold up toward the Rise and the Master's Hall.
 */

const M = MARKET_SLICE;
const UP_FACE = Math.PI;
const surface = (x: number): number => waterAt(x, (M.canal.z0 + M.canal.z1) / 2)!.surface;
const bed = (x: number): number => waterAt(x, (M.canal.z0 + M.canal.z1) / 2)!.bed;

/** Builds the market and returns the ground it adds: terrace, landing, stairs, the canal cut. */
export function buildMarket(b: WorldBuilder, rand: () => number): Area[] {
  const areas: Area[] = [];
  const street = M.street.y, high = M.terrace.y;
  const { canal: c, bridge: br, landing: ld, stair: st } = M;
  // The terrace in three blocks round the notch the bridge lands in.
  const blocks: Array<[string, Rect]> = [
    ['market-terrace', { x0: M.terrace.x0, x1: M.terrace.x1, z0: M.terrace.z0, z1: ld.z0 }],
    ['market-terrace-w', { x0: M.terrace.x0, x1: st.x0, z0: ld.z0, z1: M.terrace.z1 }],
    ['market-terrace-e', { x0: ld.x1, x1: M.terrace.x1, z0: ld.z0, z1: M.terrace.z1 }],
  ];
  for (const [name, r] of blocks) {
    terraceTop(b, r, high, street, 'basalt_cobblestone');
    areas.push(rectArea(name, r, high, street));
  }
  areas.push(...canal(b, {
    x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1, surface, bed, south: street,
    north: [{ x0: c.x0, x1: st.x0, top: high }, { x0: st.x0, x1: ld.x1, top: street }, { x0: ld.x1, x1: c.x1, top: high }],
    crossings: [[br.x0 - 0.5, br.x1 + 0.5]],
  }, rand));
  archBridge(b, { x: (br.x0 + br.x1) / 2, z0: c.z0 - 0.5, z1: c.z1 + 0.5, clear: br.x1 - br.x0, deck: br.deck, span: [c.z0, c.z1],
    bed: bed((br.x0 + br.x1) / 2), spring: surface((br.x0 + br.x1) / 2) + 0.3 }, rand);
  // The landing at the bridge's north end, walled in by the terrace, and the stair from it up to the upper walk.
  b.at(0, 0, 0);
  b.box('worn_flagstones', (ld.x0 + ld.x1) / 2, street - 0.05, (ld.z0 + ld.z1) / 2, ld.x1 - ld.x0, 0.1, ld.z1 - ld.z0);
  b.solid((ld.x0 + ld.x1) / 2, street - 0.5, (ld.z0 + ld.z1) / 2, ld.x1 - ld.x0, 1, ld.z1 - ld.z0);
  areas.push(rectArea('b1-landing', ld, street));
  const stairZ = (st.z0 + st.z1) / 2 - 0.25;
  areas.push(stairs(b, { from: { x: st.x1, z: stairZ, y: street }, to: { x: st.x0, z: stairZ, y: high }, width: st.z1 - st.z0 - 0.5,
    surface: 'ashlar_stone_blocks', cheeks: 'left' }, rand));
  const stairFloor = (x: number): number => street + (high - street) * Math.min(1, Math.max(0, (st.x1 - x) / (st.x1 - st.x0)));
  retainingWall(b, { path: [{ x: ld.x1, z: ld.z0 }, { x: st.x0, z: ld.z0 }], bottom: stairFloor, top: high, batter: 0.03, parapet: 0, thickness: 0.8 }, rand);
  retainingWall(b, { path: [{ x: ld.x1, z: ld.z1 }, { x: ld.x1, z: ld.z0 }], bottom: street, top: high, batter: 0.03, parapet: 0, thickness: 0.8 }, rand);
  balustrade(b, { x: st.x0 + 1.2, z: ld.z0 - 0.35 }, { x: ld.x1 + 0.35, z: ld.z0 - 0.35 }, high, [], rand);
  balustrade(b, { x: ld.x1 + 0.35, z: ld.z0 - 0.2 }, { x: ld.x1 + 0.35, z: ld.z1 - 0.3 }, high, [], rand);
  terraceEdges(b, areas, rand);
  street_(b, rand);
  shells(b, rand);
  stallsAndPosts(b, rand);
  b.at(0, 0, 0);
  return areas;
}

/** The terrace's outer faces, with the E3 stair down the west face to the back lane behind Cinder Row. */
function terraceEdges(b: WorldBuilder, areas: Area[], rand: () => number): void {
  const t = M.terrace, street = M.street.y, high = t.y, walk = M.upperWalk;
  const e3 = M.exits.find((e) => e.id === 'E3')!, run = stairRun(high - street), sw = walk.z1 - walk.z0;
  const gap0 = walk.z0 + 0.05, gap1 = walk.z1 - 0.05;
  retainingWall(b, { path: [{ x: t.x0, z: t.z1 }, { x: t.x0, z: gap1 }], bottom: street, top: high, batter: 0.05, parapet: 0 }, rand);
  retainingWall(b, { path: [{ x: t.x0, z: gap0 }, { x: t.x0, z: t.z0 }], bottom: street, top: high, batter: 0.05, parapet: 0 }, rand);
  areas.push(stairs(b, { from: { x: t.x0 - run, z: e3.z, y: street }, to: { x: t.x0, z: e3.z, y: high }, width: sw - 1, surface: 'ashlar_stone_blocks', cheeks: true }, rand));
  areas.push(rectArea('back-lane', { x0: t.x0 - run - 14, x1: t.x0 - run, z0: walk.z0 - 1, z1: walk.z1 + 1.5 }, street));
  retainingWall(b, { path: [{ x: t.x1, z: t.z0 }, { x: t.x1, z: t.z1 }], bottom: street, top: high, batter: 0.05, parapet: 0 }, rand);
  retainingWall(b, { path: [{ x: t.x1, z: t.z1 }, { x: M.canal.x1, z: t.z1 }], bottom: street, top: high, batter: 0.05, parapet: 0 }, rand);
  balustrade(b, { x: t.x0 + 0.35, z: t.z1 - 0.3 }, { x: t.x0 + 0.35, z: t.z0 + 6 }, high, [[t.z1 - 0.3 - walk.z1, t.z1 - 0.3 - walk.z0]], rand);
  balustrade(b, { x: M.canal.x1, z: t.z1 - 0.35 }, { x: t.x1 - 0.35, z: t.z1 - 0.35 }, high, [], rand);
  balustrade(b, { x: t.x1 - 0.35, z: t.z1 - 0.35 }, { x: t.x1 - 0.35, z: t.z0 + 4 }, high, [], rand);
  // The upper walk along the house fronts, flagged down the middle.
  paveStreet(b, { x0: t.x0, z0: (walk.z0 + walk.z1) / 2, x1: t.x1, z1: (walk.z0 + walk.z1) / 2, y: high + 0.004, wet: 0.6,
    strips: [{ w: 0.7, surface: 'river_cobbles' }, { w: sw - 1.4, surface: 'worn_flagstones' }, { w: 0.7, surface: 'river_cobbles' }] }, rand);
  // Back gardens behind the rock houses, either side of the Rise lane, with a tree in each.
  const lane = { x0: 119, x1: 131 };
  for (const r of [{ x0: t.x0 + 1, x1: lane.x0 - 0.5, z0: t.z0 + 0.6, z1: M.shells[0]!.z0 - 0.6 },
    { x0: lane.x1 + 0.5, x1: t.x1 - 1, z0: t.z0 + 0.6, z1: M.shells[0]!.z0 - 0.6 }]) {
    dressTerrace(b, r, high, rand, { density: 0.6 });
    b.plant(rand() < 0.5 ? 'maple' : 'ginkgo', (r.x0 + r.x1) / 2 + (rand() - 0.5) * 6, (r.z0 + r.z1) / 2, 0.85 + rand() * 0.25, high, rand() * 6);
  }
  b.plant('ginkgo', lane.x0 - 1.4, walk.z0 - 1.2, 1.0, high, 0.7);
  b.at(0, 0, 0);
}

/** Paving from the canal rail to the shop fronts, the towpath under it, lamps on the shop side, trees on the canal side. */
function street_(b: WorldBuilder, rand: () => number): void {
  const s = M.street, c = M.canal, front = M.shells.find((k) => k.face === 'north')!.z0;
  const br = M.bridge;
  paveStreet(b, {
    x0: s.x0, z0: (c.z1 + front) / 2, x1: s.x1, z1: (c.z1 + front) / 2, y: s.y, verge: [0, 1.2], crossEvery: 9, wet: 1.0,
    keepClear: [[br.x0 - 1 - s.x0, br.x1 + 1 - s.x0]],
    strips: [
      { w: s.fight.z0 - c.z1, surface: 'basalt_cobblestone' }, { w: 1.2, surface: 'river_cobbles' },
      { w: s.fight.z1 - s.fight.z0 - 2.4, surface: 'worn_flagstones' }, { w: 1.2, surface: 'river_cobbles' },
      { w: front - s.fight.z1, surface: 'basalt_cobblestone' },
    ],
  }, rand);
  // The towpath stands on the canal wall's back and this footing, not on the land the canal was cut through.
  b.at(0, 0, 0);
  b.solid((s.x0 + s.x1) / 2, s.y - 0.5, c.z1 + 1.3, s.x1 - s.x0, 1, 2.6);
  for (const x of [s.x0 + 16.5, 120, s.x0 + 46.5, s.x1 - 1.5]) lampPost(b, x, s.stalls.z0 - 0.4, s.y, UP_FACE);
  for (const [x, kind] of [[s.x0 + 15, 'maple'], [s.x0 + 49, 'ginkgo']] as const) {
    const z = c.z1 + 1.5;
    b.plant(kind, x, z, 0.95 + rand() * 0.2, s.y, rand() * 6);
    b.cylinder('ashlar_stone_blocks', x, s.y + 0.2, z, 0.75, 0.8, 0.4, 14);
    b.solid(x, s.y + 0.25, z, 1.5, 0.5, 1.5);
  }
  // Weeds where the paving meets the canal rail.
  for (let x = s.x0 + 1; x < s.x1 - 1; x += 1.6 + rand() * 2.4) {
    if (x > br.x0 - 1 && x < br.x1 + 1) continue;
    b.plant(rand() < 0.6 ? 'weed' : 'fern', x, c.z1 + 0.65, 0.5 + rand() * 0.5, s.y, rand() * 6);
  }
}

/** The houses along both sides: each shell's frontage split into houses round its counters, rooms and doors. */
function shells(b: WorldBuilder, rand: () => number): void {
  for (const shell of M.shells) {
    const yaw = shell.face === 'south' ? 0 : UP_FACE;
    const d = shell.z1 - shell.z0, cz = (shell.z0 + shell.z1) / 2;
    // Along the front, in the house's own frame (+x to the right looking out of the front).
    const along = (x: number): number => (shell.face === 'south' ? x : -x);
    const posts = M.posts.filter((p) => p.x >= shell.x0 && p.x <= shell.x1 && Math.abs(p.y - shell.y) < 0.5
      && (shell.face === 'south' ? p.z <= shell.z1 + 1 && p.z >= shell.z0 - 1 : p.z >= shell.z0 - 1 && p.z <= shell.z1 + 1));
    const door = posts.find((p) => p.role === 'household');
    const counter = posts.find((p) => p.role === 'keeper' && !shell.service);
    // Houses anchored to a room or a counter first, then plain houses fill the frontage left over.
    const fixed: Array<{ x0: number; x1: number; room?: FrontRoom; shop?: boolean }> = [];
    const roomX = shell.service?.x ?? shell.forge?.x;
    if (roomX !== undefined) {
      const x0 = Math.max(shell.x0 + 0.1, roomX - 5), x1 = Math.min(shell.x1 - 0.1, roomX + 5);
      fixed.push({ x0, x1, room: { x: 0, w: shell.forge ? 4 : 3.4, d: 4, kind: shell.forge ? 'forge' : 'service' } });
      fixed[0]!.room!.x = along(roomX - (x0 + x1) / 2);
    } else if (counter) {
      // The shop stops short of the shell's front door, which belongs to the house beside it.
      const x0 = Math.max(shell.x0 + 0.1, counter.x - 3, door && door.x < counter.x ? door.x + 0.6 : -Infinity);
      const x1 = Math.min(shell.x1 - 0.1, counter.x + 3, door && door.x > counter.x ? door.x - 0.6 : Infinity);
      fixed.push({ x0, x1, shop: true });
    }
    const spans: Array<{ x0: number; x1: number; room?: FrontRoom; shop?: boolean }> = [...fixed];
    let x = shell.x0 + 0.1;
    for (const f of [...fixed, { x0: shell.x1 - 0.1, x1: shell.x1 - 0.1 }].sort((p, q) => p.x0 - q.x0)) {
      // A long frontage is several houses of about 7 m; no party wall falls on the door.
      const gap = f.x0 - 0.2 - x, n = Math.ceil(gap / 8.5);
      if (gap >= 4.2) {
        let a = x;
        for (let k = 1; k <= n; k++) {
          let cut = k === n ? f.x0 - 0.2 : x + (gap * k) / n;
          if (door && k < n && Math.abs(cut - door.x) < 1.6) cut = door.x + 1.8;
          spans.push({ x0: a, x1: cut });
          a = cut + 0.2;
        }
      }
      x = Math.max(x, f.x1 + 0.2);
    }
    for (const span of spans) {
      const w = span.x1 - span.x0, cx = (span.x0 + span.x1) / 2;
      const hasDoor = !span.shop && door && door.x > span.x0 && door.x < span.x1;
      const doorAt = hasDoor ? Math.max(-w / 2 + 1, Math.min(w / 2 - 1, along(door!.x - cx))) : undefined;
      // On the street every house without the shell's door keeps a shop; up on the terrace they are homes.
      const shop = span.shop ?? (shell.face === 'north' && !span.room && !hasDoor && rand() < 0.8);
      townHouse(b, {
        x: cx, z: cz, y: shell.y, yaw, w, d, floors: 2, rank: shell.rank, ...(span.room ? { room: span.room } : {}),
        shop, ...(doorAt !== undefined ? { door: doorAt } : {}),
        balcony: shell.rank !== 'common' || rand() < 0.4, sign: shop || span.room ? 3 : rand() < 0.5 ? 2 : 0,
        awning: shop, lantern: shell.rank !== 'common' || span.room !== undefined || rand() < 0.4, footing: shell.face === 'south' ? 1.6 : 0.8,
      }, rand);
    }
    // Red lanterns strung along the shop fronts, under the eaves.
    if (shell.face === 'north') {
      const z = shell.z0 - 1.05;
      lanternString(b, [shell.x0 + 0.4, shell.y + 4.3, z], [shell.x1 - 0.4, shell.y + 4.3, z], Math.max(3, Math.round((shell.x1 - shell.x0) / 2.6)));
    }
  }
  b.at(0, 0, 0);
}

const POST_KIND: Partial<Record<SlicePost['role'], PostKind>> = { crew: 'crew', guard: 'guard', porter: 'porter', sentry: 'sentry' };

/** The merchants' stalls, the notice board, the cart bay, and the watch, porter and sluice crew at their posts. */
function stallsAndPosts(b: WorldBuilder, rand: () => number): void {
  for (const a of SINDR_ANCHORS.filter((k) => k.kind === 'stall' && k.y === 0)) marketStall(b, a.x, a.z, a.y, a.yaw, rand);
  const nb = SINDR_ANCHORS.find((k) => k.kind === 'notice_board')!;
  noticeBoard(b, nb.x, nb.z, nb.y, nb.yaw, rand);
  const porter = M.posts.find((p) => p.role === 'porter')!;
  parkedCart(b, porter.x - 2.4, M.street.stalls.z0, M.street.y, Math.PI / 2 + 0.06, rand);
  b.at(0, 0, 0);
  for (const p of M.posts) {
    const kind = POST_KIND[p.role];
    if (!kind) continue;
    // Watchers face the open street; the crew faces its sluice; the porter faces the cart.
    const facing = p.role === 'crew' ? -Math.PI / 2 : p.role === 'porter' ? -Math.PI / 2 : p.z < 0 ? 0 : Math.PI;
    b.post(kind, p.x, p.z, facing, p.y, kind === 'guard' || kind === 'sentry' ? 'always' : 'day');
  }
  // Life against the shop fronts, clear of doors, counters and the alley.
  const front = M.shells.find((k) => k.face === 'north')!.z0;
  for (let x = M.street.x0 + 3; x < M.street.x1 - 3; x += 4.5 + rand() * 3) {
    const z = front - 0.6;
    const mouths = M.shells.flatMap((k) => [k.service?.x, k.forge?.x]).filter((m): m is number => m !== undefined);
    if (b.posts.some((p) => Math.hypot(p.x - x, p.z - z) < 2.6) || M.exits.some((e) => Math.abs(e.x - x) < 4.5 && e.z > front)
      || mouths.some((m) => Math.abs(m - x) < 2 + 2)) continue;
    if (rand() < 0.55) clutter(b, x, z, M.street.y, UP_FACE, rand);
  }
  const hide = SINDR_ANCHORS.find((k) => k.kind === 'hideout')!;
  b.prop('crate', hide.x - 1, hide.z + 1.5, 0.4, 0.9); b.prop('barrel', hide.x + 0.9, hide.z + 2.4, 0, 0.9);
  b.solid(hide.x - 1, 0.4, hide.z + 1.5, 0.9, 0.8, 0.9);
  b.solid(hide.x + 0.9, 0.45, hide.z + 2.4, 0.8, 0.9, 0.8);
}
