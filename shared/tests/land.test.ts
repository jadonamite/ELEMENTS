import assert from 'node:assert/strict';
import test from 'node:test';
import { baseGround } from '../src/world/ignis/base-ground.js';
import { dominantLand, LAND_COUNT, landAt, landColour, type LandType } from '../src/world/ignis/land.js';

const at = (x: number, z: number): { type: LandType; weights: Float32Array; glow: number } => {
  const weights = new Float32Array(LAND_COUNT), h = baseGround(x, z).height;
  const slope = Math.hypot(baseGround(x + 8, z).height - h, baseGround(x, z + 8).height - h) / 8;
  const glow = landAt(x, z, h, slope, weights);
  return { type: dominantLand(weights), weights, glow };
};

test('land weights always sum to one and are repeatable', () => {
  for (let x = 500; x < 16000; x += 1700) for (let z = 500; z < 18000; z += 1900) {
    const a = at(x, z), b = at(x, z);
    assert.ok(Math.abs(a.weights.reduce((sum, w) => sum + w, 0) - 1) < 1e-5, `${x},${z}`);
    assert.deepEqual(a.weights, b.weights);
  }
});

test('named places carry their land type', () => {
  const expected: [number, number, LandType][] = [
    [7700, 8600, 'ginkgo'], [4200, 6400, 'pine'], [9100, 10700, 'terrace'], [12200, 10300, 'slag'],
    [10100, 8100, 'clay'], [9900, 4500, 'burn'], [8000, 15500, 'ash'], [7600, 6200, 'white_grass'],
    [10500, 7000, 'earth'], [5600, 2500, 'sulphur'],
  ];
  for (const [x, z, type] of expected) assert.equal(at(x, z).type, type, `${x},${z}`);
});

test('only lava glows, and every type has a colour', () => {
  assert.ok(at(12000, 4100).glow > 0);
  assert.equal(at(7700, 8600).glow, 0);
  const rgba = new Uint8Array(4), spot = at(7700, 8600);
  landColour(spot.weights, 0, 7700, 8600, 400, rgba, 0);
  assert.ok(rgba[0]! > rgba[2]! + 60, 'ginkgo floor is gold');
});
