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

test('touch and desktop feed the same action queue, held guard, run and movement state', () => {
  const f = fixture();
  try {
    f.input.useDevice('touch');
    f.input.press('strike'); f.input.press('heavy'); f.input.press('rise');
    assert.deepEqual(f.input.takeActions(), ['light', 'heavy', 'uppercut']);
    f.input.hold('block', 'finger1', true); f.input.hold('run', 'finger2', true);
    f.input.move(.6, -.8);
    assert.equal(f.input.blocking, true);
    assert.deepEqual(f.input.read(), { forward: .6, right: -.8, running: true });
    f.input.hold('block', 'finger1', false);
    assert.equal(f.input.blocking, false);
    key('KeyQ', f.canvas);
    assert.equal(f.input.device, 'desktop');
    assert.deepEqual(f.input.takeActions(), ['uppercut']);
    assert.deepEqual(f.input.read(), { forward: 0, right: 0, running: false });
  } finally { f.restore(); }
});

test('locked actions cannot be queued and an interaction consumes E before its ground move', () => {
  const f = fixture();
  try {
    f.input.allowed = action => action !== 'ultimate';
    key('KeyG', f.canvas); f.input.press('ultimate');
    assert.deepEqual(f.input.takeActions(), []);
    let interactions = 0;
    f.input.onInteract = () => { interactions++; return true; };
    key('KeyE', f.canvas);
    assert.equal(interactions, 1); assert.deepEqual(f.input.takeActions(), []);
    f.input.onInteract = () => false;
    key('KeyE', f.canvas);
    assert.deepEqual(f.input.takeActions(), ['ground_pound']);
    f.input.press('strike'); dispatch(window, 'blur');
    assert.deepEqual(f.input.takeActions(), []);
  } finally { f.restore(); }
});

test('Rise and shard spark have distinct keys and respect the character role', () => {
  const f = fixture();
  try {
    f.input.allowed = action => action !== 'rise';
    key('KeyQ', f.canvas);
    assert.deepEqual(f.input.takeActions(), []);
    key('KeyT', f.canvas);
    f.input.press('spark');
    assert.deepEqual(f.input.takeActions(), ['spark', 'spark']);
    f.input.allowed = action => action !== 'spark';
    key('KeyT', f.canvas);
    key('KeyQ', f.canvas);
    assert.deepEqual(f.input.takeActions(), ['uppercut']);
  } finally { f.restore(); }
});

test('device changes include menu touches and keyboard navigation away from the canvas', () => {
  const f = fixture();
  try {
    dispatch(window, 'pointerdown', { pointerType: 'touch' });
    assert.equal(f.input.device, 'touch');
    document.activeElement = f.button;
    key('Tab', f.button);
    assert.equal(f.input.device, 'desktop');
    assert.deepEqual(f.input.takeActions(), []);
    dispatch(window, 'pointerdown', { pointerType: 'touch' });
    assert.equal(f.input.device, 'touch');
  } finally { f.restore(); }
});

test('the opening flow pauses combat actions and menu access', () => {
  const f = fixture();
  try {
    document.getElementById = () => ({});
    let menu = 0; f.input.onMenu = () => { menu++; };
    assert.equal(f.input.paused, true);
    assert.equal(f.input.press('strike'), false);
    assert.equal(f.input.press('menu'), false);
    assert.deepEqual(f.input.takeActions(), []);
    assert.equal(menu, 0);
    document.getElementById = () => null;
    assert.equal(f.input.press('strike'), true);
  } finally { f.restore(); }
});


test('touch releases a captured mouse without opening the menu or accepting stale mouse motion', () => {
  const f = fixture();
  try {
    document.hasFocus = () => true;
    let menus = 0; f.input.onMenu = () => { menus++; };
    document.pointerLockElement = f.canvas;
    dispatch(document, 'pointerlockchange');
    dispatch(window, 'pointerdown', { pointerType: 'touch' });
    assert.equal(document.pointerLockElement, null);
    assert.equal(f.input.device, 'touch');
    assert.equal(menus, 0);
    dispatch(document, 'mousemove', { movementX: 5, movementY: 2 });
    assert.equal(f.input.device, 'touch');
    assert.deepEqual(f.orbits, []);
  } finally { f.restore(); }
});

test('first game key requests capture; loading input cannot capture or queue actions', () => {
  const f = fixture();
  try {
    let captures = 0;
    f.canvas.requestPointerLock = () => { captures++; return Promise.resolve(); };
    let menus = 0;
    f.input.onMenu = () => { menus++; };
    let loading = true;
    document.getElementById = id => id === 'elements-loader' && loading ? {} : null;
    key('KeyQ', f.canvas);
    key('Escape', f.canvas);
    dispatch(f.canvas, 'click');
    assert.equal(menus, 0, 'The loading screen blocks the menu as well as game actions');
    assert.equal(captures, 0);
    assert.deepEqual(f.input.takeActions(), []);
    loading = false;
    key('Escape', f.canvas);
    assert.equal(captures, 0, 'Opening the menu does not capture the mouse');
    assert.equal(menus, 1, 'The menu becomes available after loading');
    key('KeyQ', f.canvas);
    assert.equal(captures, 1);
    assert.deepEqual(f.input.takeActions(), ['uppercut']);
  } finally { f.restore(); }
});


test('capturing from the first movement key preserves that held movement', () => {
  const f = fixture();
  try {
    let captures = 0;
    f.canvas.requestPointerLock = () => { captures++; return new Promise(() => {}); };
    key('KeyW', f.canvas);
    key('ShiftLeft', f.canvas);
    assert.equal(captures, 1, 'Only one capture request can be pending');
    document.pointerLockElement = f.canvas;
    dispatch(document, 'pointerlockchange');
    assert.deepEqual(f.input.read(), { forward: 1, right: 0, running: true });
    document.exitPointerLock();
    assert.deepEqual(f.input.read(), { forward: 0, right: 0, running: false });
  } finally { f.restore(); }
});

test('an open conversation takes number keys, wheel, left button and the context key while the mouse is captured', () => {
  const f = fixture();
  try {
    const log = [];
    let open = true;
    f.input.conversation = {
      active: () => open,
      choose: i => { log.push(['choose', i]); return true; },
      step: d => log.push(['step', Math.sign(d)]),
      confirm: () => { log.push(['confirm']); return true; },
    };
    document.pointerLockElement = f.canvas;
    dispatch(document, 'pointerlockchange');
    key('Digit2', f.canvas);
    dispatch(document, 'wheel', { deltaY: 120 });
    dispatch(document, 'mousedown', { button: 0 });
    f.input.press('interact');
    assert.deepEqual(log, [['choose', 1], ['step', 1], ['confirm'], ['confirm']]);
    assert.deepEqual(f.input.takeActions(), [], 'no strike while talking');
    open = false;
    dispatch(document, 'mousedown', { button: 0 });
    key('Digit2', f.canvas);
    assert.deepEqual(f.input.takeActions(), ['light']);
    assert.equal(log.length, 4, 'closed conversation takes nothing');
  } finally {
    f.restore();
  }
});
