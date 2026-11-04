import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Group, Scene, Vector3 } from 'three';
import balance from '../../shared/balance.json' with { type: 'json' };
import { Fight } from '../src/fight.ts';
import { HeroController } from '../src/controller.ts';

const still = { forward: 0, right: 0, running: false };

async function openGround() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  return world;
}

const foe = (x, z, attacking = false) => ({
  model: new Group(), hittable: true, alive: true, attacking, controller: { position: new Vector3(x, 0, z) },
});

test('a jump rises about v^2/2g and lands; a second tap in the air makes the super jump', async () => {
  const world = await openGround();
  world.step();
  const hero = new HeroController(world, { x: 0, z: 0 }, undefined, false);
  const peak = (tapAgainAfter) => {
    hero.launch(balance.controller.jumpSpeed);
    let top = 0;
    for (let f = 0; f < 240; f++) {
      if (f === tapAgainAfter) hero.launch(balance.controller.superJumpSpeed);
      hero.step(still, 0); world.step();
      top = Math.max(top, hero.position.y);
      if (f > 5 && hero.grounded) break;
    }
    assert.ok(hero.grounded, 'lands again');
    return top;
  };
  for (let i = 0; i < 10; i++) { hero.step(still, 0); world.step(); }
  const jump = peak(-1);
  const expected = balance.controller.jumpSpeed ** 2 / (2 * balance.controller.gravity);
  assert.ok(Math.abs(jump - expected) < 0.25, `jump peak ${jump.toFixed(2)} vs ${expected.toFixed(2)}`);
  const big = peak(8);
  assert.ok(big > 3 * jump, `super jump ${big.toFixed(2)} well above a jump ${jump.toFixed(2)}`);
  world.free();
});

test('the dodge takes the way asked for when open, else steps out of the attacker\'s line; cornered when shut in', async () => {
  const world = await openGround();
  // A wall 1 m to the east of the hero.
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 3, 20).setTranslation(1.5, 3, 0));
  world.step();
  const fight = new Fight({}, world, new Scene(), { heroHit() {}, heroDied() {}, enemyHit() {} }, () => foe(0, 0));
  const feet = new Vector3(0, 0, 0);

  // Open ground, wish north (-z): granted.
  let way = fight.dodgeWay(feet, Math.PI);
  assert.ok(way.open && Math.abs(way.angle - Math.PI) < 1e-6);

  // Wish east, into the wall: turned aside, still open.
  way = fight.dodgeWay(feet, Math.PI / 2);
  assert.ok(way.open, 'finds another way');
  assert.ok(Math.sin(way.angle) < 0.95, 'not into the wall');

  // An attacker to the south, nothing asked: the dodge leaves its line and never goes toward it.
  fight.enemies.push(foe(0, 2, true));
  way = fight.dodgeWay(feet, null);
  assert.ok(way.open);
  assert.ok(Math.cos(way.angle) < 0.2, `does not dodge toward the attacker (angle ${way.angle.toFixed(2)})`);
  assert.ok(Math.sin(way.angle) < 0.9, 'and not into the wall');

  // Foes all round on the open sides and the wall on the east: cornered.
  for (const [x, z] of [[0, -1.2], [-1.2, 0], [-0.9, 0.9], [-0.9, -0.9], [0.6, -1.1], [0.6, 1.1]]) fight.enemies.push(foe(x, z));
  way = fight.dodgeWay(feet, null);
  assert.equal(way.open, false, 'surrounded: no open way');
  world.free();
});
