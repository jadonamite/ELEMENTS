import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { segmentHitsWall, anyWallBetween } from '../src/wall-block.ts';

const wall = (facing) => ({ center: new Vector3(0, 1.1, 0), size: new Vector3(3, 2.2, 0.7), facing, expiresAt: 10 });

test('a wall facing straight ahead blocks a strike through its middle', () => {
  assert.equal(segmentHitsWall(new Vector3(0, 0, -3), new Vector3(0, 0, 3), wall(0)), true);
});

test('a wall turned 90 degrees blocks along its real length, not the old unturned box', () => {
  // Turned a quarter, the 3 m length runs along z. A strike along x at z = 1.2 is inside the wall.
  const w = wall(Math.PI / 2);
  assert.equal(segmentHitsWall(new Vector3(-3, 0, 1.2), new Vector3(3, 0, 1.2), w), true);
  // And one at z = 2.2 goes round the end.
  assert.equal(segmentHitsWall(new Vector3(-3, 0, 2.2), new Vector3(3, 0, 2.2), w), false);
});

test('a wall at 45 degrees blocks a strike crossing its face', () => {
  assert.equal(segmentHitsWall(new Vector3(-2, 0, -2), new Vector3(2, 0, 2), wall(Math.PI / 4)), true);
});

test('a strike that stops short of the wall is not blocked', () => {
  assert.equal(segmentHitsWall(new Vector3(0, 0, -3), new Vector3(0, 0, -1.5), wall(0)), false);
});

test('a fallen wall blocks nothing', () => {
  assert.equal(anyWallBetween([wall(0)], 11, new Vector3(0, 0, -3), new Vector3(0, 0, 3)), false);
  assert.equal(anyWallBetween([wall(0)], 9, new Vector3(0, 0, -3), new Vector3(0, 0, 3)), true);
});

test('a shot passing over the top is not blocked', () => {
  assert.equal(segmentHitsWall(new Vector3(0, 3, -3), new Vector3(0, 3, 3), wall(0)), false);
});
