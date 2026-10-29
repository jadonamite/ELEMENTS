import assert from 'node:assert/strict';
import test from 'node:test';
import { bladeTouches, inFront, segmentDistance } from '../src/hits.ts';

const p = (x, y, z) => ({ x, y, z });

test('segment distance handles crossing, parallel and end-point cases', () => {
  assert.equal(segmentDistance(p(-1, 0, 0), p(1, 0, 0), p(0, -1, 1), p(0, 1, 1)), 1);
  assert.equal(segmentDistance(p(0, 0, 0), p(1, 0, 0), p(0, 1, 0), p(1, 1, 0)), 1);
  assert.equal(segmentDistance(p(0, 0, 0), p(1, 0, 0), p(3, 0, 0), p(4, 0, 0)), 2);
  assert.equal(segmentDistance(p(0, 0, 0), p(0, 0, 0), p(0, 2, 0), p(0, 2, 0)), 2);
});

test('a blade touches a capsule only when it reaches the body', () => {
  const feet = p(0, 0, 2);
  // Swing at chest height, tip passing through the body.
  assert.ok(bladeTouches(p(0, 1.3, 0.8), p(0, 1.3, 1.9), feet, 1.8, 0.3));
  // Same swing stopping 0.5 m short.
  assert.equal(bladeTouches(p(0, 1.3, 0.2), p(0, 1.3, 1.2), feet, 1.8, 0.3), false);
  // Blade above the head misses.
  assert.equal(bladeTouches(p(-1, 2.2, 2), p(1, 2.2, 2), feet, 1.8, 0.3), false);
});

test('front cone uses yaw with +Z forward and wraps around', () => {
  assert.ok(inFront(p(0, 0, 0), 0, p(0, 0, 2), 0.5));
  assert.equal(inFront(p(0, 0, 0), 0, p(0, 0, -2), 0.5), false);
  assert.ok(inFront(p(0, 0, 0), Math.PI - 0.1, p(0.1, 0, -2), 0.5));
});
