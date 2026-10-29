import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('locomotion and camera tuning fits the arena', async () => {
  const data = JSON.parse(await readFile(new URL('../balance.json', import.meta.url), 'utf8'));
  const { arena, controller, camera } = data;
  assert.ok(controller.walkSpeed > 0 && controller.runSpeed > controller.walkSpeed);
  assert.ok(controller.height > 2 * controller.radius);
  assert.ok(controller.skin > 0 && controller.skin < controller.radius);
  assert.ok(controller.fixedStep > 0 && controller.maxFrameDelta >= controller.fixedStep);
  assert.ok(controller.idleSpeedThreshold < controller.walkSpeed);
  assert.ok(controller.runSpeedThreshold > controller.walkSpeed && controller.runSpeedThreshold < controller.runSpeed);
  assert.ok(camera.minPitch < camera.initialPitch && camera.initialPitch < camera.maxPitch);
  assert.ok(camera.targetHeight < arena.wallHeight && camera.targetHeight > camera.collisionRadius);
  assert.ok(camera.distance < arena.size / 2);
});
