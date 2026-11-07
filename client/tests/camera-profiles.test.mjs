import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { PerspectiveCamera, Vector3 } from 'three';
import balance from '../../shared/balance.json' with { type: 'json' };
import { ShoulderCamera, cameraCollisionRadius } from '../src/camera.ts';
import { THREAT_RADIUS, threatBearing } from '../src/threat-arrows.ts';

const identity = { x: 0, y: 0, z: 0, w: 1 };
const hero = new Vector3();
const close = (a, b, tolerance = 0.01) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
async function setup() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 500);
  return { world, camera, rig: new ShoulderCamera(camera, world, false) };
}
function settle(rig, seconds = 4, rate = 60, reduced = false, position = hero) {
  for (let i = 0; i < seconds * rate; i++) rig.update(position, 1 / rate, reduced);
  rig.camera.updateMatrixWorld(true);
}
function forwardPitch(camera) {
  return -Math.asin(camera.getWorldDirection(new Vector3()).y);
}

test('walking starts low immediately and small fights retain a low shoulder and near/far lock-on', async () => {
  const { world, camera, rig } = await setup();
  try {
    rig.update(hero, 1 / 60);
    close(rig.target.y, 1.5);
    close(camera.position.distanceTo(rig.target), balance.camera.world.distance);
    assert.ok(camera.position.y < 1.7);
    close(forwardPitch(camera), balance.camera.world.pitch);
    rig.fight = 1;
    for (const distance of [2, 12]) {
      rig.lockTarget = new Vector3(0, 0, -distance);
      settle(rig);
      close(camera.position.x, balance.camera.shoulder);
      assert.ok(camera.position.y < 2.2, `low lock-on at ${distance} m: ${camera.position.y}`);
      const mark = rig.lockTarget.clone().setY(1.2).project(camera);
      assert.ok(Math.abs(mark.x) < 1 && Math.abs(mark.y) < 1, `target stays visible at ${distance} m`);
    }
  } finally { world.free(); }
});

test('walking to crowd and back stays below 0.6 m per-frame height and distance changes at 30/60/144 fps', async (t) => {
  const measurements = [];
  for (const rate of [30, 60, 144]) {
    const { world, camera, rig } = await setup();
    try {
      rig.update(hero, 1 / rate);
      const walkingY = camera.position.y;
      let heightStep = 0, distanceStep = 0;
      for (const crowd of [true, false]) {
        // Crowd is independent of whether the stance has drawn yet.
        rig.crowd = crowd;
        rig.fight = 0;
        let previousY = camera.position.y;
        let previousDistance = camera.position.distanceTo(rig.target);
        for (let frame = 0; frame < rate * 8; frame++) {
          rig.update(hero, 1 / rate);
          const distance = camera.position.distanceTo(rig.target);
          heightStep = Math.max(heightStep, Math.abs(camera.position.y - previousY));
          distanceStep = Math.max(distanceStep, Math.abs(distance - previousDistance));
          assert.ok(Math.abs(camera.position.y - previousY) <= 0.6);
          assert.ok(Math.abs(distance - previousDistance) <= 0.6);
          previousY = camera.position.y;
          previousDistance = distance;
        }
        if (crowd) {
          assert.ok(camera.position.y > 3.5 && camera.position.y < 6, `crowd sits at middle height, not overhead: ${camera.position.y}`);
          close(forwardPitch(camera), balance.camera.crowd.pitch);
          close(camera.position.distanceTo(rig.target), Math.hypot(balance.camera.crowd.distance, balance.camera.crowd.shoulder));
        } else {
          close(camera.position.y, walkingY);
          close(rig.target.y, 1.5);
        }
      }
      measurements.push({ rate, heightStep, distanceStep });
    } finally { world.free(); }
  }
  t.diagnostic(JSON.stringify(measurements));
});

test('crowd profile keeps attackers behind and to both sides in frame', async () => {
  const { world, camera, rig } = await setup();
  const player = new Vector3(119, 0, 5);
  try {
    rig.yaw = -Math.PI / 2;
    rig.crowd = true;
    settle(rig, 4, 60, false, player);
    const attackers = [
      new Vector3(123, 1.2, 5),
      new Vector3(116, 1.2, 2),
      new Vector3(116, 1.2, 8),
      new Vector3(117, 1.2, 0),
    ];
    for (const attacker of attackers) {
      const screen = attacker.project(camera);
      assert.ok(Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1,
        `attacker ${attacker.toArray()} projected outside crowd frame: ${screen.toArray()}`);
    }
  } finally { world.free(); }
});

test('crowd framing shows rear attackers at 3 m; farther ones get warning arrows', async () => {
  const { world, camera, rig } = await setup();
  const player = new Vector3(119, 0, 5);
  const visibleBody = (point) => {
    const screen = point.project(camera);
    return Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1;
  };
  try {
    rig.crowd = true;
    for (const yaw of [0, Math.PI / 2]) {
      rig.yaw = yaw;
      rig.lockTarget = null;
      settle(rig, 8, 60, false, player);
      const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw);
      const sideX = Math.cos(yaw), sideZ = -Math.sin(yaw);
      for (const distance of [3, 6]) {
        for (const side of [-2.2, 2.2]) {
          for (const height of [0, 1, 2]) {
            const attacker = new Vector3(
              player.x - forwardX * distance + sideX * side,
              height,
              player.z - forwardZ * distance + sideZ * side,
            );
            const feet = attacker.clone().setY(0);
            const arrow = threatBearing(player, feet, camera);
            if (distance === 3) assert.ok(visibleBody(attacker),
              `rear attacker at ${distance} m, side ${side}, height ${height}, yaw ${yaw} clips`);
            assert.ok(visibleBody(feet.clone().setY(1.2)) || arrow !== null,
              `rear attacker at ${distance} m, side ${side}, yaw ${yaw} is neither seen nor warned`);
          }
        }
      }
      for (const lockDistance of [3, 12]) {
        rig.lockTarget = new Vector3(player.x + forwardX * lockDistance, 0, player.z + forwardZ * lockDistance);
        settle(rig, 2, 60, false, player);
        assert.ok(visibleBody(rig.lockTarget.clone().setY(1.2)), `lock target at ${lockDistance} m clips at yaw ${yaw}`);
      }
      rig.lockTarget = null;
    }
  } finally { world.free(); }
});

test('kill framing wins over crowd and remains close after the final foe ends the stance', async () => {
  const { world, camera, rig } = await setup();
  try {
    rig.fight = 1;
    rig.crowd = true;
    settle(rig);
    rig.killCloseUp();
    rig.fight = 0;
    settle(rig, 0.5);
    assert.ok(camera.position.distanceTo(rig.target) < 1.9, 'kill overrides high crowd framing');
    assert.ok(camera.position.y < 2);
    rig.crowd = false;
    settle(rig, 8);
    close(camera.position.distanceTo(rig.target), balance.camera.world.distance);
    close(rig.target.y, 1.5);
  } finally { world.free(); }
});

test('reduced motion skips and discards kill close-up, including a preference change during its hold', async () => {
  const { world, camera, rig } = await setup();
  try {
    rig.crowd = true;
    settle(rig);
    const before = camera.position.clone();
    rig.killCloseUp();
    rig.update(hero, 1 / 60, true);
    assert.ok(camera.position.distanceTo(before) < 0.01);
    rig.update(hero, 1 / 60, false);
    assert.ok(camera.position.distanceTo(before) < 0.01, 'skipped close-up does not replay');
  } finally { world.free(); }
});

test('camera sphere clears eaves, thin stall posts and stairs in walking, fight, crowd and kill profiles', async () => {
  const { world, camera } = await setup();
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.12, 2).setTranslation(0, 2.05, 1));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.05, 1.4, 0.05).setTranslation(0.45, 1.4, 0.35));
  for (let i = 0; i < 5; i++) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, (i + 1) * 0.1, 0.2)
      .setTranslation(5, (i + 1) * 0.1, i * 0.4));
  }
  world.step();
  let cases = 0;
  try {
    for (const aspect of [0.5, 16 / 9, 4]) {
      camera.aspect = aspect;
      for (const mode of ['walking', 'fight', 'crowd', 'kill']) {
        const rig = new ShoulderCamera(camera, world, false);
        rig.fight = mode === 'walking' ? 0 : 1;
        rig.crowd = mode === 'crowd';
        for (const position of [hero, new Vector3(5, 0.6, 0.8), new Vector3(-1.8, 0, 0)]) {
          for (const pitch of [-0.3, 0.12, 0.8]) {
            rig.pitch = pitch;
            for (let angle = 0; angle < 16; angle++) {
              rig.yaw = angle * Math.PI / 8;
              if (mode === 'kill') rig.killCloseUp();
              rig.update(position, 1 / 30);
              const radius = cameraCollisionRadius(camera);
              assert.equal(world.intersectionWithShape(camera.position, identity,
                new RAPIER.Ball(radius), RAPIER.QueryFilterFlags.ONLY_FIXED), null,
              `${mode}, aspect ${aspect}, pos ${position.toArray()}, pitch ${pitch}, yaw ${rig.yaw}`);
              cases++;
            }
          }
        }
      }
    }
    assert.equal(cases, 1728);
  } finally { world.free(); }
});

test('warning arrows point at unseen foes behind and beside, never at foes on screen or far off', async () => {
  const { world, camera, rig } = await setup();
  try {
    rig.yaw = 0;
    rig.fight = 1;
    settle(rig);
    // Yaw 0 looks toward -z: ahead is -z, behind is +z, right is +x.
    assert.equal(threatBearing(hero, new Vector3(0, 0, -5), camera), null, 'a foe ahead is on screen');
    close(threatBearing(hero, new Vector3(0, 0, 4), camera), Math.PI, 0.05);
    const leftOrRightBehind = threatBearing(hero, new Vector3(3, 0, 3), camera);
    assert.ok(leftOrRightBehind > Math.PI / 2 && leftOrRightBehind < Math.PI, `behind right: ${leftOrRightBehind}`);
    assert.equal(threatBearing(hero, new Vector3(0, 0, THREAT_RADIUS + 1), camera), null, 'far foes get no arrow');
  } finally { world.free(); }
});
