import assert from 'node:assert/strict';
import test from 'node:test';
import { Levels, rectArea, stripArea } from '../src/world/levels.ts';
import { heightAt } from '../src/world/landscape.ts';
import { stairRun } from '../src/world/stairs.ts';

const flat = new Levels([rectArea('base', { x0: 0, x1: 100, z0: 0, z1: 100 })]);
const raised = flat.with([rectArea('terrace', { x0: 20, x1: 40, z0: 20, z1: 40 }, 3.5, 0)]);

test('later areas win where they overlap; ground can sit below the floor', () => {
  assert.equal(raised.floorAt(30, 30), 3.5);
  assert.equal(raised.groundAt(30, 30), 0);
  assert.equal(raised.floorAt(10, 10), 0);
  assert.equal(raised.distance(30, 30) <= 0, true);
});

test('a strip rises linearly along its heading', () => {
  const lane = stripArea('lane', 0, 0, Math.PI / 2, 12, 3, 0, 2);
  assert.ok(Math.abs(lane.distance(6, 0) + 1.5) < 1e-9);
  const f = lane.floor;
  assert.equal(typeof f, 'function');
  assert.ok(Math.abs(f(6, 0) - 1) < 1e-9);
  assert.ok(Math.abs(f(12, 0) - 2) < 1e-9);
});

test('flat levels give the same terrain as before (0 inside, banks outside)', () => {
  assert.equal(heightAt(50, 50, flat, []), 0);
  assert.ok(heightAt(130, 50, flat, []) > 3);
  assert.equal(heightAt(30, 30, raised, []), 0);
});

test('stair runs use 0.32 m treads and a 1.4 m landing every 12 steps', () => {
  assert.ok(Math.abs(stairRun(1.75) - 11 * 0.32) < 1e-9);
  assert.ok(Math.abs(stairRun(3.5) - (21 * 0.32 + 1.4)) < 1e-9);
});
