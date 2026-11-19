import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { groundHeight, mineAt, minePointAt } from '../src/world/ignis/ground.js';
import { rockHouseClear, ROCK_BANK } from '../src/world/ignis/rock-bank.js';
import {
  checkRockHouseSite, ROCK_HOUSE_GROUPS, ROCK_HOUSE_RULES, ROCK_HOUSE_SITES, rockGroupCells, siteToWorld,
  type RockHouseSite,
} from '../src/world/ignis/rock-houses.js';
import { CINDERPIT_CENTRE, CINDERPIT_LANE_HEIGHT, worldToSite } from '../src/world/ignis/rock-sites.js';
import { SETTLEMENT_PRECINCTS } from '../src/world/ignis/settlements.js';

const rim = ROCK_HOUSE_SITES.filter(s => s.group === 'cinderpit');
const hamlet = ROCK_HOUSE_SITES.filter(s => s.group === 'mine-hamlet');
const flat = (site: RockHouseSite): (() => number) => () => site.sill - 0.3;

test('siteToWorld is Three rotation.y: Matrix4 compose, yaw 0, ±π/2 and 2.3', () => {
  const origin = { x: 10500, z: 7000 };
  // Asymmetric on both axes, so a sign error or a swap shows.
  const local = { x: 2.3, z: -4.7 };
  const up = new Vector3(0, 1, 0), one = new Vector3(1, 1, 1);
  for (const yaw of [0, Math.PI / 2, -Math.PI / 2, 2.3]) {
    const matrix = new Matrix4().compose(new Vector3(origin.x, 0, origin.z), new Quaternion().setFromAxisAngle(up, yaw), one);
    const expected = new Vector3(local.x, 0, local.z).applyMatrix4(matrix);
    const got = siteToWorld({ ...origin, yaw }, local.x, local.z);
    assert.ok(Math.abs(got.x - expected.x) < 1e-9, `x at yaw ${yaw}: ${got.x} vs ${expected.x}`);
    assert.ok(Math.abs(got.z - expected.z) < 1e-9, `z at yaw ${yaw}: ${got.z} vs ${expected.z}`);
  }
});

test('both groups have eight sites, fronts on the lane, and every site passes the placement rules', () => {
  assert.equal(rim.length, 8);
  assert.equal(hamlet.length, 8);
  assert.equal(new Set(ROCK_HOUSE_SITES.map(s => s.id)).size, ROCK_HOUSE_SITES.length);
  for (const site of ROCK_HOUSE_SITES) {
    assert.deepEqual(checkRockHouseSite(site), { ok: true }, site.id);
    // Local +z (the door side) is the front: the centre and the foot are on the landing side of the rear wall.
    assert.ok(site.sill >= site.landing - 1e-9, `${site.id} sill covers the landing`);
  }
  // Four houses a side on the mine road, each row facing the other.
  for (let i = 0; i < 8; i++) {
    const site = hamlet[i]!, other = hamlet[(i + 4) % 8]!;
    const front = siteToWorld(site, 0, 1);
    const toOther = Math.hypot(other.x - site.x, other.z - site.z);
    assert.ok(toOther > 20 && Math.abs(Math.hypot(front.x - site.x, front.z - site.z) - 1) < 1e-9, `${site.id} front`);
  }
  // The rim fronts look inward: every front is nearer the precinct centre than its rear.
  for (const site of rim) {
    const front = siteToWorld(site, 0, site.d / 2), rear = siteToWorld(site, 0, -site.d / 2);
    const dFront = Math.hypot(front.x - CINDERPIT_CENTRE.x, front.z - CINDERPIT_CENTRE.z);
    const dRear = Math.hypot(rear.x - CINDERPIT_CENTRE.x, rear.z - CINDERPIT_CENTRE.z);
    assert.ok(dFront < dRear, `${site.id} faces the centre`);
  }
});

test('the Cinderpit precinct hands its plain houses to the rim group and derives its reach from the sites', () => {
  const cinderpit = SETTLEMENT_PRECINCTS.find(p => p.name === 'Cinderpit')!;
  assert.equal(cinderpit.houses.length, 0);
  let needed = 0;
  for (const site of rim) {
    needed = Math.max(needed, Math.hypot(site.x - cinderpit.x, site.z - cinderpit.z) + Math.hypot(site.w, site.d) / 2);
  }
  assert.ok(cinderpit.contentReach >= needed, `reach ${cinderpit.contentReach} covers ${needed.toFixed(1)}`);
  const group = ROCK_HOUSE_GROUPS.find(g => g.id === 'cinderpit')!;
  assert.ok(group.reach >= needed);
  for (const site of ROCK_HOUSE_SITES) {
    const owner = ROCK_HOUSE_GROUPS.find(g => g.id === site.group)!;
    const corner = Math.hypot(site.x - owner.x, site.z - owner.z) + Math.hypot(site.w, site.d) / 2;
    assert.ok(owner.reach >= corner, `${site.id} inside its group reach`);
    const cell = `${Math.floor(site.x / 256)}:${Math.floor(site.z / 256)}`;
    assert.ok(rockGroupCells(owner).includes(cell), `${site.id}'s cell is owned by its group`);
  }
  // The rim lane runs at lane level: every arc point stands on the bench, 0.3 m below the pad.
  const lane = ROCK_HOUSE_GROUPS.find(g => g.id === 'cinderpit')!.lane;
  assert.ok(lane.length > 20);
  for (const p of lane.slice(0, -1)) {
    const r = Math.hypot(p.x - CINDERPIT_CENTRE.x, p.z - CINDERPIT_CENTRE.z);
    if (r < 190) continue; // the spoke crosses the flat pad itself
    assert.ok(Math.abs(groundHeight(p.x, p.z) - CINDERPIT_LANE_HEIGHT) < 0.1, `lane at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
  }
});

test('wrong-sign yaw is refused: a sloped ground at yaw π/2 that only the correct rotation accepts', () => {
  // ground rises 0.6 m per metre in +z; at yaw π/2 local +x runs along -z, so lx = door sets the door's z.
  const ground = (x: number, z: number): number => 100 + 0.6 * z;
  const base: RockHouseSite = {
    id: 'fault:yaw', group: 'mine-hamlet', x: 0, z: 0, yaw: Math.PI / 2,
    w: 10, d: 6, variant: 2, door: 4, sill: 103, landing: 97.6, access: 'ramp',
  };
  assert.deepEqual(checkRockHouseSite(base, ground), { ok: true });
  // The opposite sign the old module used: local (lx, lz) -> (x + lx cos - lz sin, z + lx sin + lz cos).
  const wrong = (site: RockHouseSite, lx: number, lz: number): { x: number; z: number } => {
    const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
    return { x: site.x + lx * c - lz * s, z: site.z + lx * s + lz * c };
  };
  const foot = wrong(base, base.door, base.d / 2 + (base.sill - base.landing) / ROCK_HOUSE_RULES.maxRampGrade);
  assert.ok(Math.abs(ground(foot.x, foot.z) - base.landing) > 0.15, 'the mirrored foot misses the lane');
  // The same site checked against the mirrored ground (the footprint the old sign sampled) is refused, so the
  // validation only accepts the convention Three renders with.
  const mirroredGround = (x: number, z: number): number => ground(x, -z);
  assert.equal(checkRockHouseSite(base, mirroredGround).ok, false);
});

test('a door threshold above the sill is refused', () => {
  const site = ROCK_HOUSE_SITES[0]!;
  const threshold = siteToWorld(site, site.door, site.d / 2);
  const bumped = (x: number, z: number): number => (x === threshold.x && z === threshold.z ? site.sill + 0.5 : flat(site)());
  const result = checkRockHouseSite(site, bumped);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : '', /threshold/);
});

test('a landing that does not meet the ground at the access foot is refused', () => {
  const site = ROCK_HOUSE_SITES[0]!;
  const result = checkRockHouseSite({ ...site, landing: site.landing - 0.5 }, flat(site));
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : '', /landing/);
});

test('NaN ground and NaN in every site field are refused as non-finite', () => {
  const site = ROCK_HOUSE_SITES[0]!;
  const nanGround = checkRockHouseSite(site, () => NaN);
  assert.equal(nanGround.ok, false);
  assert.match(nanGround.ok === false ? nanGround.reason : '', /^non-finite/);
  for (const key of ['x', 'z', 'yaw', 'w', 'd', 'door', 'sill', 'landing'] as const) {
    const broken = { ...site, [key]: NaN };
    const result = checkRockHouseSite(broken, flat(site));
    assert.equal(result.ok, false, key);
    assert.match(result.ok === false ? result.reason : '', new RegExp(`^non-finite ${key}`));
  }
});

test('the road band stays at road height within 9 m inside the bank stretch', () => {
  for (let s = ROCK_BANK.s0; s <= ROCK_BANK.s1; s += 1) {
    const p = minePointAt(s), a = minePointAt(s - 0.5), b = minePointAt(s + 0.5);
    const run = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / run, nz = (b.x - a.x) / run;
    for (const side of [-1, 1]) {
      for (let d = 0; d <= 9; d += 1) {
        const x = p.x + nx * side * d, z = p.z + nz * side * d;
        const near = mineAt(x, z);
        // "Within 9 m of the centre" is the true distance to the centre line, which a bend can push past the
        // perpendicular offset; those samples stand on the rising bank, not the road band.
        if (near.distance > 9) continue;
        assert.ok(Math.abs(groundHeight(x, z) - near.height) < 1e-6, `s ${s} d ${d} side ${side}: ${groundHeight(x, z)} vs ${near.height}`);
      }
    }
  }
});

test('the bank and its tapers are continuous: no step over 0.5 m between samples 1 m apart', () => {
  for (let s = ROCK_BANK.s0 - ROCK_BANK.taper; s <= ROCK_BANK.s1 + ROCK_BANK.taper; s += 5) {
    const p = minePointAt(s), a = minePointAt(s - 0.5), b = minePointAt(s + 0.5);
    const run = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / run, nz = (b.x - a.x) / run;
    for (const side of [-1, 1]) {
      let previous = groundHeight(p.x, p.z);
      for (let d = 1; d <= 80; d++) {
        const h = groundHeight(p.x + nx * side * d, p.z + nz * side * d);
        assert.ok(Math.abs(h - previous) <= 0.5, `cross-section step at s ${s} d ${d} side ${side}: ${previous} -> ${h}`);
        previous = h;
      }
    }
  }
  // Along the road too, so the taper joins cannot hide a ledge.
  const sample = (s: number, side: number, d: number): number => {
    const p = minePointAt(s), a = minePointAt(s - 0.5), b = minePointAt(s + 0.5);
    const run = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / run, nz = (b.x - a.x) / run;
    return groundHeight(p.x + nx * side * d, p.z + nz * side * d);
  };
  for (const d of [0, 9, 20, 33, 50, 73]) {
    for (const side of [-1, 1]) {
      let previous = sample(ROCK_BANK.s0 - ROCK_BANK.taper, side, d);
      for (let s = ROCK_BANK.s0 - ROCK_BANK.taper + 1; s <= ROCK_BANK.s1 + ROCK_BANK.taper; s += 1) {
        const h = sample(s, side, d);
        assert.ok(Math.abs(h - previous) <= 0.5, `along-road step at s ${s} d ${d} side ${side}: ${previous} -> ${h}`);
        previous = h;
      }
    }
  }
});

test('clearance keeps trees and ground cover out of every footprint and off the bank', () => {
  for (const site of ROCK_HOUSE_SITES) {
    const centre = worldToSite(site, site.x, site.z);
    assert.ok(Math.abs(centre.x) < 1e-9 && Math.abs(centre.z) < 1e-9);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const corner = siteToWorld(site, (sx * site.w) / 2, (sz * site.d) / 2);
      assert.equal(rockHouseClear(corner.x, corner.z), false, `${site.id} corner`);
    }
  }
  const p = minePointAt((ROCK_BANK.s0 + ROCK_BANK.s1) / 2);
  assert.equal(rockHouseClear(p.x + 40, p.z + 40), false, 'the bank is kept clear');
  assert.equal(rockHouseClear(2000, 15000, 2), true, 'open land stays plantable');
});
