import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Scene, Vector3 } from 'three';
import balance from '../../shared/balance.json' with { type: 'json' };
import { Combat } from '../src/combat.ts';
import { Fight, ZOMBIE_ROUNDS } from '../src/fight.ts';

function fakeAnim() {
  const played = [];
  return {
    played,
    playOnce(name) { played.push(name); return true; },
    play(name) { played.push(name); return true; },
    setSpeed() {},
    duration() { return 1; },
    hasClip() { return true; },
  };
}

function createMockEnemy(spawnPoint, maxHealth = 90) {
  let alive = true;
  let gone = false;
  const model = new Group();
  model.position.set(spawnPoint.x, 0, spawnPoint.z);
  return {
    get alive() { return alive; },
    get gone() { return gone; },
    hittable: true,
    attacking: false,
    lastSwing: -1,
    body: { feet: new Vector3(spawnPoint.x, 0, spawnPoint.z), height: 1.8, radius: 0.3 },
    controller: { position: new Vector3(spawnPoint.x, 0, spawnPoint.z), facing: 0 },
    model,
    health: { current: maxHealth, maximum: maxHealth },
    step() { return false; },
    draw() {},
    hurt() {
      alive = false;
      return true;
    },
    dispose() {
      gone = true;
    },
  };
}

test('round 4 spawns and clears its full count of 7 husks (capping at 6 active)', () => {
  const scene = new Scene();
  let roundClearedNum = 0;
  let nextRoundCount = 0;

  const fight = new Fight(
    {},
    {},
    scene,
    {
      heroHit() {},
      heroDied() {},
      enemyHit() {},
      roundCleared(roundNum, nextTarget) {
        roundClearedNum = roundNum;
        nextRoundCount = nextTarget;
      },
    },
    (_tmpl, _world, point, maxHealth) => createMockEnemy(point, maxHealth),
  );

  // Jump to Round 4
  fight.setRound(4);
  assert.equal(fight.currentRoundNumber, 4);
  assert.equal(fight.roundZombieTarget, 7);
  assert.equal(ZOMBIE_ROUNDS[3], 7);

  const heroPos = new Vector3(0, 0, 0);

  // Step through time to spawn the first wave of 6 husks
  for (let frame = 0; frame < 100; frame++) {
    fight.draw(0.1, 1, heroPos);
    assert.ok(fight.livingCount <= 6, `At most 6 husks alive at once (was ${fight.livingCount})`);
  }

  // Exactly 6 husks are alive on the field (the cap)
  assert.equal(fight.livingCount, 6);
  assert.equal(fight.zombiesRemaining, 7);

  // Kill the first husk to free a slot
  const firstEnemy = fight.enemies.find(e => e.alive);
  assert.ok(firstEnemy);
  fight.defeatEnemy(firstEnemy);
  firstEnemy.dispose();

  // Run frames to let the 7th husk spawn
  for (let frame = 0; frame < 30; frame++) {
    fight.draw(0.1, 1, heroPos);
    assert.ok(fight.livingCount <= 6);
  }

  // Now the 7th husk has spawned!
  const living = fight.enemies.filter(e => e.alive);
  assert.equal(living.length, 6, '6 remaining alive husks (1 was killed, 1 new spawned = 7 total spawned)');

  // Kill the remaining 6 husks one by one
  for (const enemy of living) {
    fight.defeatEnemy(enemy);
    enemy.dispose();
  }

  // Draw one frame to process the clears
  fight.draw(0.1, 1, heroPos);

  assert.equal(fight.zombiesKilledInRound, 7, 'All 7 husks in round 4 defeated');
  assert.equal(fight.zombiesRemaining, 0);
  assert.equal(roundClearedNum, 4, 'Round 4 cleared');
  assert.equal(nextRoundCount, 9, 'Next round target is 9');
});

test('round 8 spawns and clears its full count of 15 husks to victory', () => {
  const scene = new Scene();
  let victoryCalled = false;

  const fight = new Fight(
    {},
    {},
    scene,
    {
      heroHit() {},
      heroDied() {},
      enemyHit() {},
      victory() {
        victoryCalled = true;
      },
    },
    (_tmpl, _world, point, maxHealth) => createMockEnemy(point, maxHealth),
  );

  fight.setRound(8);
  assert.equal(fight.currentRoundNumber, 8);
  assert.equal(fight.roundZombieTarget, 15);
  assert.equal(ZOMBIE_ROUNDS[7], 15);

  const heroPos = new Vector3(0, 0, 0);

  let killedTotal = 0;
  // Simulate fight loop until all 15 are spawned and killed
  for (let step = 0; step < 500 && killedTotal < 15; step++) {
    fight.draw(0.1, 1, heroPos);
    assert.ok(fight.livingCount <= 6, `At most 6 husks alive at once (was ${fight.livingCount})`);

    // Kill one living husk every few steps
    if (step % 5 === 0) {
      const target = fight.enemies.find(e => e.alive);
      if (target) {
        fight.defeatEnemy(target);
        target.dispose();
        killedTotal++;
      }
    }
  }

  fight.draw(0.1, 1, heroPos);

  assert.equal(fight.zombiesKilledInRound, 15, 'All 15 husks in round 8 defeated');
  assert.equal(fight.isVictory, true, 'Victory reached');
  assert.equal(victoryCalled, true, 'Victory event fired');
});

test('cooldowns start on move accept and show timers even on a miss', () => {
  const scene = new Scene();
  const anim = fakeAnim();

  const fight = new Fight(
    {},
    {},
    scene,
    { heroHit() {}, heroDied() {}, enemyHit() {} },
    (_tmpl, _world, point, maxHealth) => createMockEnemy(point, maxHealth),
  );

  const combat = new Combat(
    anim,
    (move) => fight.ready(move),
    (move, swingAt) => fight.startMove(move, swingAt),
  );

  const heroView = {
    position: new Vector3(0, 0, 0),
    facing: 0,
    bladeBase: new Vector3(0, 0, 0),
    bladeTip: new Vector3(0, 0, 1),
  };

  // Initially off cooldown
  assert.equal(fight.ready('uppercut'), true);
  assert.equal(fight.cooldownRemaining('uppercut'), 0);

  // Press Q (uppercut)
  assert.equal(combat.press('uppercut'), true);
  assert.equal(combat.current, 'uppercut');

  // Cooldown immediately begins!
  assert.equal(fight.ready('uppercut'), false);
  const remaining = fight.cooldownRemaining('uppercut');
  assert.ok(remaining > 5.0 && remaining <= 6.0, `Cooldown remaining should be ~6s, got ${remaining}`);

  // Step fight forward by 0.5s - blade touches nothing (complete miss!)
  for (let i = 0; i < 30; i++) {
    combat.update(1 / 60);
    fight.step(heroView, combat);
  }

  // After 0.5s of animation, the move is still cooling down
  assert.equal(fight.ready('uppercut'), false);
  const remainingMid = fight.cooldownRemaining('uppercut');
  assert.ok(remainingMid > 4.5 && remainingMid < 6.0, `Cooldown ticks down on miss, got ${remainingMid}`);

  // Test ground_pound (E) and dash_strike (F)
  combat.reset();
  assert.equal(combat.press('ground_pound'), true);
  assert.equal(fight.ready('ground_pound'), false);
  assert.ok(fight.cooldownRemaining('ground_pound') > 8.0);

  combat.reset();
  assert.equal(combat.press('dash'), true);
  assert.equal(fight.ready('dash_strike'), false);
  assert.ok(fight.cooldownRemaining('dash_strike') > 4.0);
});
