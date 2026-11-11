import assert from 'node:assert/strict';
import test from 'node:test';
import { groundAt, groundHeight, landDistance, LAKE, MINE_LENGTH, MINE_MAX_GRADE, minePointAt, RIVER, riverAt, waterHeight } from '../src/world/ignis/ground.js';

test('national datum, coast, lake and named summits are fixed', () => {
  assert.equal(groundHeight(7100, 9000), 380);
  assert.equal(groundHeight(10500, 7000), 740);
  assert.equal(groundHeight(12000, 4000), 1850);
  assert.equal(groundHeight(5600, 2500), 1320);
  assert.equal(groundHeight(18000, 10000), -12);
  assert.ok(landDistance(7000, 9000) > 0);
  assert.ok(landDistance(17000, 10000) < 0);
  assert.equal(waterHeight(18000, 10000), 0);
  for (let x = -300; x <= 300; x += 50) {
    assert.equal(waterHeight(LAKE.x + x, LAKE.z), 820);
    assert.equal(groundHeight(LAKE.x + x, LAKE.z), 818.5);
  }
});

test('river surface never rises downstream and its connected bed is 1.5 m below it', () => {
  let previous = Infinity;
  for (let i = 1; i < RIVER.length; i++) for (let j = 0; j <= 40; j++) {
    const a = RIVER[i - 1]!, b = RIVER[i]!, t = j / 40;
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    const h = riverAt(x, z).water;
    assert.ok(h <= previous + 1e-8); previous = h;
    assert.ok(Math.abs(groundHeight(x, z) - (h - 1.5)) < 0.001, `${x},${z}`);
  }
});

test('mine road has legal length, sustained grade, crossfall and a grounded 5.5 m surface at 1001 stations', () => {
  assert.ok(MINE_LENGTH >= 5200);
  assert.ok(MINE_MAX_GRADE <= 0.07, `sustained ${MINE_MAX_GRADE}`);
  for (let i = 0; i <= 1000; i++) {
    const s = MINE_LENGTH * i / 1000, p = minePointAt(s);
    const a = minePointAt(Math.max(0, s - 0.5)), b = minePointAt(Math.min(MINE_LENGTH, s + 0.5));
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    assert.ok(Math.abs(b.y - a.y) / run <= 0.08 + 1e-8);
    const nx = -(b.z - a.z) / run, nz = (b.x - a.x) / run;
    const left = groundHeight(p.x + nx * 2.75, p.z + nz * 2.75);
    const right = groundHeight(p.x - nx * 2.75, p.z - nz * 2.75);
    assert.ok(Math.abs(left - right) / 5.5 <= 0.03 + 1e-6, `crossfall ${s}`);
    assert.ok(Math.abs(p.y + 0.08 - groundHeight(p.x, p.z)) <= 0.15, `floating ${s}`);
  }
});

test('global cell edges have identical height samples and biome masks are deterministic', () => {
  for (const step of [2, 8, 32, 64]) for (let z = 8704; z <= 8960; z += step) {
    const east = groundHeight(27 * 256, z), west = groundHeight(26 * 256 + 256, z);
    assert.equal(east, west);
  }
  assert.deepEqual(groundAt(8500, 8200), groundAt(8500, 8200));
  assert.ok(Math.abs(groundAt(8500, 8200).mask.reduce((a, b) => a + b, 0) - 1) < 1e-10);
});
