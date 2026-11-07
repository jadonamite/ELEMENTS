import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  isColliding,
  nightnessAt,
  NIGHT_FROM,
  sindrSentryDistance,
  sindrStreet,
  SINDR_COLLISION_BOXES,
  SINDR_STALLS,
  standClear,
  standOff,
} from '@elements/shared';
import { createOrGetAccount, migrateDatabase, setDatabase } from '../src/db.js';
import { ensureSindrMerchants } from '../src/economy/agents/agentLoop.js';
import { balance } from '../src/net/balance.js';
import { ServerEnemy } from '../src/net/enemies.js';
import { ServerRobberGang } from '../src/net/outlaws.js';
import { ZoneWorld } from '../src/net/world.js';
import { ZoneEconomy } from '../src/net/zone-economy.js';

function setup(zone = 'sindr') {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  setDatabase(db);
  ensureSindrMerchants(db, 0);
  const world = new ZoneWorld(zone, () => 0.5);
  const econ = new ZoneEconomy(world, db, () => 1000, () => 0.5);
  const gang = new ServerRobberGang();
  return { db, world, econ, gang };
}

test('Collision boxes: town stalls, well, and obstacles are defined and standClear prevents standing inside them', () => {
  // Stalls in Sindr
  const suppliesStall = SINDR_STALLS.find((s) => s.id === 'sindr_supplies')!;
  assert.ok(suppliesStall);
  assert.equal(suppliesStall.x, 137);
  assert.equal(suppliesStall.z, -8);

  // A spot right inside the stall
  assert.equal(isColliding(137, -8, 0.5), true);
  // Old spawn spot at (140, -8) touched the stall boundary
  assert.equal(isColliding(140, -8, 0.5), true);

  // standClear pushes it out to clear ground
  const cleared = standClear(140, -8, 0.5);
  assert.equal(isColliding(cleared.x, cleared.z, 0.5), false);

  // Stand-off near a stall pulls back or steps clear of the box
  const pos = standOff({ x: 137, z: -4 }, -Math.PI / 2, 6, 0.5);
  assert.equal(isColliding(pos.x, pos.z, 0.5), false);

  // Initial server enemies in Sindr all stand clear of collision boxes
  const world = new ZoneWorld('sindr', () => 0.5);
  for (const enemy of world.enemies.values()) {
    assert.equal(
      isColliding(enemy.x, enemy.z, 0.4),
      false,
      `Enemy ${enemy.id} at (${enemy.x}, ${enemy.z}) should not stand inside a stall or obstacle`,
    );
  }
});

test('Outlaws sensing: street kinds, sentry safe distance, and clock nightness', () => {
  const dayNight = balance.world.dayNight;
  // Day at minute 4: nightness 0
  assert.equal(nightnessAt(4, dayNight), 0);
  assert.ok(nightnessAt(4, dayNight) < NIGHT_FROM);

  // Night at minute 18: nightness 1
  assert.equal(nightnessAt(18, dayNight), 1);
  assert.ok(nightnessAt(18, dayNight) >= NIGHT_FROM);

  // Street kinds
  assert.equal(sindrStreet(100, -12), 'alley');
  assert.equal(sindrStreet(120, 0), 'open_street');
  assert.equal(sindrStreet(240, 2), 'road_out_of_town');

  // Sentry distance: near shrine vs east market
  assert.equal(sindrSentryDistance(20), 12);
  assert.equal(sindrSentryDistance(100), 60);
});

test('ServerRobberGang: heavy purse at night in an alley triggers ambush sequence', () => {
  const { world, econ, gang } = setup();

  // Player Alice in alley with 350 CHROMA
  createOrGetAccount('dev_alice');
  const alice = world.join('session_a', { accountId: 'dev_alice', role: 'Shaper', element: 'IGNIS', forcedCarry: 350 }, 0);
  alice.x = 100;
  alice.z = -12;

  // Gang starts idle
  assert.equal(gang.state.state, 'idle');

  // Minute 18 is full night
  const nightMinute = 18;

  // Tick 1 (1s elapsed): gang shadows target
  gang.update(1.0, 1.0, world, econ, nightMinute);
  assert.equal(gang.state.state, 'shadowing');
  assert.equal(gang.state.currentTargetId, 'dev_alice');

  // Tick 2 (1s elapsed): gang calls members
  gang.update(1.0, 2.0, world, econ, nightMinute);
  assert.equal(gang.state.state, 'calling_members');

  // Tick 3 (1s elapsed): gang launches ambush
  const notices = gang.update(1.0, 3.0, world, econ, nightMinute);
  assert.equal(gang.state.state, 'ambushing');
  assert.ok(notices.length > 0);
  assert.ok(notices[0]!.includes('Robbers strike from the alley shadows'));

  // Active enemies spawned into world.enemies
  assert.ok(gang.activeEnemyIds.size >= 2);
  for (const id of gang.activeEnemyIds) {
    const enemy = world.enemies.get(id);
    assert.ok(enemy, `Enemy ${id} exists in world.enemies`);
    assert.equal(enemy.target, 'session_a');
    assert.ok(enemy.kind === 'robber' || enemy.kind === 'armed');
    // None spawned inside an obstacle
    assert.equal(isColliding(enemy.x, enemy.z, 0.4), false);
  }

  // Second player Bob in the room sees the robbers in the snapshot
  const bob = world.join('session_b', { accountId: 'dev_bob', role: 'Shaper', element: 'IGNIS' }, 0);
  bob.x = 96;
  bob.z = -9;

  const snap = world.snapshot(3.0);
  const robberTuples = snap.e.filter((tuple) => gang.activeEnemyIds.has(tuple[0] as string));
  assert.equal(robberTuples.length, gang.activeEnemyIds.size);
});

test('ServerRobberGang: defeating a robber drops loot through ZoneEconomy', () => {
  const { world, econ, gang } = setup();

  const alice = world.join('session_a', { accountId: 'dev_alice', role: 'Shaper', element: 'IGNIS', forcedCarry: 350 }, 0);
  alice.x = 100;
  alice.z = -12;

  gang.spawnAmbush(alice, world);

  const memberId = [...gang.activeEnemyIds][0]!;
  const enemy = world.enemies.get(memberId)!;
  assert.ok(enemy);

  // Alice moves within sword reach of the robber and faces it
  alice.allowWarp();
  world.move('session_a', { t: 10, x: enemy.x, y: 0, z: enemy.z + 1.2, vx: 0, vz: 0, f: Math.PI, a: 'idle', r: 1 }, 10);
  enemy.history.push(10, enemy.x, enemy.z, 0);

  // Alice strikes until the robber falls
  let killed = false;
  for (let sw = 1; sw <= 10 && enemy.alive; sw++) {
    const t = 10 + sw * 2;
    world.move('session_a', { t, x: enemy.x, y: 0, z: enemy.z + 1.2, vx: 0, vz: 0, f: Math.PI, a: 'idle', r: 1 }, t);
    enemy.history.push(t, enemy.x, enemy.z, 0);
    const events = world.hit('session_a', { e: memberId, m: 'heavy_1', sw, t, v: t, lit: false }, t + 0.05);
    if (events.some((e) => e.type === 'enemy_died')) {
      killed = true;
      break;
    }
  }
  assert.ok(killed);

  // Economy received kill and created loot pile
  const pending = econ.drain();
  const lootNew = pending.filter((e) => e.type === 'loot_new');
  assert.equal(lootNew.length, 1);
  const pile = (lootNew[0]!.body as { pile: { contents: { chroma: number } } }).pile;
  assert.equal(pile.contents.chroma, 20);
});

test('ServerRobberGang: heavy casualties trigger flee state and record memory', () => {
  const { world, econ, gang } = setup();

  const alice = world.join('session_a', { accountId: 'dev_alice', role: 'Shaper', element: 'IGNIS', forcedCarry: 350 }, 0);
  alice.x = 100;
  alice.z = -12;

  gang.spawnAmbush(alice, world);
  assert.equal(gang.state.state, 'ambushing');

  // Wound/kill half the members
  const memberIds = [...gang.activeEnemyIds];
  const halfCount = Math.ceil(memberIds.length * 0.5);
  for (let i = 0; i < halfCount; i++) {
    const enemy = world.enemies.get(memberIds[i]!)!;
    enemy.wound(999, 'session_a');
  }

  // Update tick assesses casualties and triggers flee
  const notices = gang.update(0.1, 10.0, world, econ, 18);
  assert.equal(gang.state.state, 'fleeing');
  assert.ok(notices.some((n) => n.includes('fleeing back to their hideout')));

  // Remaining alive enemies enter flee state
  for (let i = halfCount; i < memberIds.length; i++) {
    const enemy = world.enemies.get(memberIds[i]!)!;
    assert.equal(enemy.state, 'flee');
  }

  // Defeat is recorded in gang memory for this player
  const mem = gang.state.memories['dev_alice'];
  assert.ok(mem);
  assert.equal(mem.timesBeaten, 1);
  assert.ok(mem.fearScore > 0);
});

test('ServerRobberGang: sentries near shrine prevent robbers attacking', () => {
  const { world, econ, gang } = setup();

  // Player stands by shrine (x < 48) where sentries guard
  const alice = world.join('session_a', { accountId: 'dev_alice', role: 'Shaper', element: 'IGNIS', forcedCarry: 500 }, 0);
  alice.x = 24;
  alice.z = 0;

  // Even at night with 500 CHROMA, guards hold robbers back
  gang.update(1.0, 1.0, world, econ, 18);
  assert.equal(gang.state.state, 'idle');
  assert.equal(gang.decision?.action, 'ignore');
  assert.ok(gang.decision?.reason.includes('Guards near'));
});
