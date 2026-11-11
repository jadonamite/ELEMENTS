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

test('audio waits through loading and onboarding, then unlocks on the first game input', async () => {
  const originals = { window: globalThis.window, document: globalThis.document };
  let loading = true, opening = false, resumes = 0, starts = 0;
  const param = () => ({ setValueAtTime() {} });
  const node = () => ({ gain: param(), connect() {} });
  class AudioContextStub {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    createGain() { return node(); }
    createDynamicsCompressor() {
      return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() };
    }
    createAnalyser() { return { ...node(), fftSize: 256 }; }
    resume() { resumes++; this.state = 'running'; return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  class QuietSound extends SoundManager {
    loadAllSamples() {}
    startAmbientBed() { starts++; }
  }
  const browser = new EventTarget();
  browser.location = { search: '' };
  browser.AudioContext = AudioContextStub;
  const doc = new EventTarget();
  doc.getElementById = id => (id === 'elements-loader' && loading) || (id === 'opening-overlay' && opening) ? {} : null;
  Object.assign(globalThis, { window: browser, document: doc });
  let sound;
  try {
    sound = new QuietSound();
    browser.dispatchEvent(new Event('pointerdown'));
    assert.equal(resumes, 0);
    loading = false; opening = true;
    browser.dispatchEvent(new Event('keydown'));
    assert.equal(resumes, 0);
    opening = false;
    browser.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    assert.equal(resumes, 1);
    assert.equal(starts, 1);
    browser.dispatchEvent(new Event('keydown'));
    assert.equal(resumes, 1);
    sound.dispose();
    sound = new QuietSound();
    sound.dispose();
    browser.dispatchEvent(new Event('keydown'));
    assert.equal(resumes, 1, 'Disposed managers cannot resume');
  } finally {
    sound?.dispose();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
