import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBarrens, BARRENS } from '../src/world/barrens.ts';
import { buildFort, FORT, isAtFortGate } from '../src/world/fort.ts';
import { WorldBuilder } from '../src/world/builder.ts';

test('buildBarrens constructs ash badlands, basalt columns, dungeon gate, and monster clearing', () => {
  const b = new WorldBuilder();
  buildBarrens(b);

  // Bounds
  assert.equal(BARRENS.x0, 450);
  assert.equal(BARRENS.x1, 680);
  assert.equal(BARRENS.zMin, -110);
  assert.equal(BARRENS.zMax, 110);

  // Colliders for monoliths, dead trees, and clearing boulders
  assert.ok(b.colliders.length >= 40, `Must generate extensive colliders for barrens (got ${b.colliders.length})`);

  // Basalt columns colliders
  const monolithColliders = b.colliders.filter(c => c.x >= 470 && c.x <= 660 && Math.abs(c.z) >= 40);
  assert.ok(monolithColliders.length >= 20, 'Must have hexagonal monolith colliders');

  // Ruined dungeon gate at x=525, z=-75
  const dungeonColliders = b.colliders.filter(c => Math.abs(c.x - 525) < 8 && Math.abs(c.z - -75) < 8);
  assert.ok(dungeonColliders.length >= 1, 'Must have collider blocking dungeon gate');

  // Beast hunt clearing at x=610, z=-36
  const clearingColliders = b.colliders.filter(c => Math.abs(c.x - 610) < 20 && Math.abs(c.z - -36) < 20);
  assert.ok(clearingColliders.length >= 8, 'Must have framing boulder colliders around clearing');
});

test('buildFort constructs curtain wall, watchtowers, gatehouse portcullis, and barracks', () => {
  const b = new WorldBuilder();
  buildFort(b);

  // Fort gate coordinate
  assert.equal(FORT.gateX, 758);
  assert.equal(FORT.gateZ, 0);
  assert.equal(FORT.wallHeight, 14);

  // Curtain walls colliders
  const curtainColliders = b.colliders.filter(c => Math.abs(c.x - 758) < 5 && Math.abs(c.z) >= 14);
  assert.ok(curtainColliders.length >= 2, 'Curtain wall sections must be solid');

  // Central gatehouse portcullis collider
  const gateColliders = b.colliders.filter(c => Math.abs(c.x - 758) < 5 && Math.abs(c.z) < 5);
  assert.ok(gateColliders.length >= 1, 'Portcullis at gate must be solid');

  // Flanking watchtowers
  const towerColliders = b.colliders.filter(c => Math.abs(c.x - 758) < 8 && (Math.abs(c.z - 14) < 4 || Math.abs(c.z + 14) < 4));
  assert.ok(towerColliders.length >= 2, 'Twin watchtowers must have colliders');

  // Barracks in courtyard
  const barracksColliders = b.colliders.filter(c => Math.abs(c.x - (758 - 28)) < 15 && Math.abs(c.z - 24) < 6);
  assert.ok(barracksColliders.length >= 1, 'Barracks building must have colliders');

  // Gate transition detection
  assert.equal(isAtFortGate({ x: 758, z: 0 }), true, 'Player at portcullis is at fort gate');
  assert.equal(isAtFortGate({ x: 755, z: 3 }), true, 'Player approaching gate threshold is at fort gate');
  assert.equal(isAtFortGate({ x: 720, z: 0 }), false, 'Player in courtyard is not at gate');
  assert.equal(isAtFortGate({ x: 758, z: 25 }), false, 'Player along curtain wall is not at gate');
});
