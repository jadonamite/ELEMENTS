import assert from 'node:assert/strict';
import test from 'node:test';
import { GameInput } from '../src/input.ts';

function fixture() {
  const originals = Object.fromEntries(['window', 'document', 'HTMLElement'].map(key => [key, globalThis[key]]));
  const document = new EventTarget();
  class Element extends EventTarget {
    isContentEditable = false;
    disabled = false;
    textContent = '';
    editable = false;
    closest() { return this.editable ? this : null; }
    focus() {
      document.activeElement = this;
      dispatch(document, 'focusin', { target: this });
    }
    requestPointerLock() { return Promise.resolve(); }
  }
  Object.assign(globalThis, { window: new EventTarget(), document, HTMLElement: Element });
  document.exitPointerLock = () => {
    document.pointerLockElement = null;
    document.dispatchEvent(new Event('pointerlockchange'));
  };
  const canvas = new Element();
  const button = new Element();
  const inputField = new Element();
  inputField.editable = true;
  const messages = [];
  const orbits = [];
  const input = new GameInput(canvas, button, (x, y) => orbits.push([x, y]), text => messages.push(text));
  canvas.focus();
  return { input, canvas, button, inputField, messages, orbits, restore() {
    input.dispose();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  } };
}

function dispatch(target, type, properties = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
}

function key(code, target) { return dispatch(window, 'keydown', { code, target }); }

test('input handles physical keys, opposite keys, Shift, focus and lifecycle cleanup', () => {
  const f = fixture();
  try {
    assert.equal(key('KeyW', f.canvas).defaultPrevented, true);
    key('ShiftLeft', f.canvas);
    assert.deepEqual(f.input.read(), { forward: 1, right: 0, running: true });
    key('KeyS', f.canvas);
    assert.equal(f.input.read().forward, 0);
    dispatch(window, 'keyup', { code: 'KeyS' });
    assert.equal(f.input.read().forward, 1);
    dispatch(window, 'blur');
    assert.deepEqual(f.input.read(), { forward: 0, right: 0, running: false });
    key('KeyW', f.canvas);
    f.inputField.focus();
    assert.equal(f.input.read().forward, 0);
    assert.equal(key('KeyW', f.inputField).defaultPrevented, false);
    f.canvas.focus();
    key('KeyW', f.canvas);
    dispatch(document, 'visibilitychange');
    assert.equal(f.input.read().forward, 0);
    document.pointerLockElement = f.canvas;
    dispatch(document, 'pointerlockchange');
    key('KeyW', f.canvas);
    dispatch(document, 'mousemove', { movementX: 10, movementY: -4 });
    assert.deepEqual(f.orbits, [[10, -4]]);
    document.exitPointerLock();
    assert.equal(f.input.read().forward, 0);
    dispatch(document, 'mousemove', { movementX: 30, movementY: 4 });
    assert.equal(f.orbits.length, 1);
    f.input.dispose();
    key('KeyW', f.canvas);
    assert.equal(f.input.read().forward, 0);
  } finally { f.restore(); }
});

test('capture errors have a retry message and capture can be requested by keyboard button', async () => {
  const f = fixture();
  try {
    f.canvas.requestPointerLock = () => Promise.reject(new Error('denied'));
    dispatch(f.button, 'click');
    await Promise.resolve();
    assert.match(f.messages.at(-1), /could not be captured.*try again/);
    assert.equal(document.activeElement, f.canvas);
    f.canvas.requestPointerLock = undefined;
    dispatch(f.canvas, 'click');
    assert.match(f.messages.at(-1), /unavailable/);
    dispatch(document, 'pointerlockerror');
    assert.match(f.messages.at(-1), /could not be captured.*try again/);
  } finally { f.restore(); }
});
