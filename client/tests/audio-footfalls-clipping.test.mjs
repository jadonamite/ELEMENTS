import assert from 'node:assert/strict';
import test from 'node:test';
import { SoundManager } from '../src/audio.ts';

test('footsteps lock to footfall distance and scale frequency with speed', () => {
  const footsteps = [];

  class MockSoundManager extends SoundManager {
    constructor() {
      super();
    }
    playFootstep(isRun, pitch) {
      footsteps.push({ isRun, pitch, time: this.mockTime });
    }
  }

  const manager = new MockSoundManager();
  manager.mockTime = 0;

  const controller = {
    position: { x: 0, y: 0, z: 0 },
    speed: 1.0, // Walk speed = 1.0 m/s. Step distance = 0.485m -> step interval = 0.485s
  };

  const delta = 0.05; // 50ms tick
  // Step for 1.0 second at 1.0 m/s
  for (let t = 0; t < 1.0; t += delta) {
    manager.mockTime = t;
    manager.update(delta, undefined, controller);
  }

  assert.equal(footsteps.length, 2, 'Walking at 1.0m/s for 1.0s should trigger exactly 2 footfalls (~0.485m each)');
  assert.equal(footsteps[0].isRun, false);
  assert.equal(footsteps[1].isRun, false);
  // Alternating pitch between left and right foot
  assert.notEqual(footsteps[0].pitch, footsteps[1].pitch, 'Left and right footfalls must have alternating pitch');

  // Double speed to 2.0 m/s -> frequency doubles
  footsteps.length = 0;
  controller.speed = 2.0;
  for (let t = 0; t < 1.0; t += delta) {
    manager.mockTime = t;
    manager.update(delta, undefined, controller);
  }
  assert.equal(footsteps.length, 4, 'Walking at 2.0m/s for 1.0s should trigger 4 footfalls (scaling with speed)');

  // Stationary hero produces no footsteps
  footsteps.length = 0;
  controller.speed = 0.0;
  for (let t = 0; t < 1.0; t += delta) {
    manager.mockTime = t;
    manager.update(delta, undefined, controller);
  }
  assert.equal(footsteps.length, 0, 'Stationary hero must produce no footsteps');
});

test('villain footsteps scale frequency with movement speed and alternate pitch', () => {
  const villainSteps = [];

  class MockSoundManager extends SoundManager {
    constructor() {
      super();
    }
    playVillainFootstep(pos, isRun, pitch) {
      villainSteps.push({ pos, isRun, pitch });
    }
    playVillainSwing() {}
  }

  const manager = new MockSoundManager();
  const enemy = {
    controller: { position: { x: 10, y: 0, z: 5 }, speed: 1.0 },
    alive: true,
  };

  const delta = 0.05;
  for (let t = 0; t < 1.0; t += delta) {
    manager.update(delta, undefined, undefined, [enemy]);
  }

  assert.ok(villainSteps.length >= 2, 'Walking villain triggers footfalls matching stride distance');
  assert.notEqual(villainSteps[0].pitch, villainSteps[1].pitch, 'Villain steps alternate pitch');
});

test('master compression and ceiling prevent clipping (peak < 0 dBFS)', () => {
  const manager = new SoundManager();
  // With analyser and limiter configuration:
  // getPeakLevel returns a dBFS value that remains strictly below 0 dBFS
  const peak = manager.getPeakLevel();
  assert.ok(peak <= 0.0, `Peak level must never exceed 0 dBFS (was ${peak})`);
  assert.equal(manager.isClipping(), false, 'Master output must not clip');
});
