import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { Loader, hintClass, hintDuration } from '../src/ui/loader.ts';
import { LOADER_PICTURES, nextLoaderPicture } from '../src/ui/loader-pictures.ts';
import { ACTIONS } from '../src/controls/actions.ts';
import { actionGlyph } from '../src/controls/glyphs.ts';

const data = JSON.parse(readFileSync(new URL('../public/hints/hints.json', import.meta.url), 'utf8'));

test('both hint classes have at least 60 distinct sourced entries', () => {
  assert.equal(data.version, 1);
  const ids = new Set(), texts = new Set();
  for (const hint of data.hints) {
    assert.ok(!ids.has(hint.id), hint.id);
    assert.ok(!texts.has(hint.text), hint.text);
    ids.add(hint.id); texts.add(hint.text);
    assert.ok(hint.title && hint.text && hint.source, hint.id);
    assert.ok(hint.where.includes('town') && hint.where.includes('arena'));
    assert.ok(hintDuration(hint) >= 5000);
    if (hint.kind === 'controls') assert.ok(ACTIONS.some(a => a.id === hint.action));
  }
  for (const kind of ['know', 'hint']) assert.ok(data.hints.filter(h => hintClass(h.kind) === kind).length >= 60);
});

test('control glyphs use current actions on desktop and touch', () => {
  const controls = data.hints.filter(h => h.action);
  assert.ok(controls.length >= 12);
  for (const hint of controls) for (const device of ['desktop', 'touch']) {
    assert.match(actionGlyph(hint.action, device), /^<svg[^]*<\/svg>$/);
    assert.doesNotMatch(actionGlyph(hint.action, device), /undefined/);
  }
});

test('the picture collection has at least 30 distinct compact JPGs', () => {
  assert.ok(LOADER_PICTURES.length >= 30);
  assert.equal(new Set(LOADER_PICTURES).size, LOADER_PICTURES.length);
  for (const id of LOADER_PICTURES) {
    const file = new URL(`../public/assets/ui/loader/pictures/${id}.jpg`, import.meta.url);
    assert.ok(statSync(file).size <= 120 * 1024, `${id} is under 120 KB`);
    assert.equal(readFileSync(file).subarray(0, 2).toString('hex'), 'ffd8');
  }
});

function domFixture() {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
  };

  class MockClassList {
    constructor() { this.classes = new Set(); }
    add(c) { this.classes.add(c); }
    remove(c) { this.classes.delete(c); }
    contains(c) { return this.classes.has(c); }
  }

  class MockElement extends EventTarget {
    constructor(tag) {
      super();
      this.tagName = tag.toUpperCase();
      this.id = '';
      this.className = '';
      this.classList = new MockClassList();
      this.dataset = {};
      this.style = {};
      this.children = [];
      this.attributes = new Map();
      this.textContent = '';
      this.disabled = false;
      this.parentElement = null;
    }
    get innerHTML() { return this._innerHTML || ''; }
    set innerHTML(val) { this._innerHTML = val; this.parseChildren(val); }
    parseChildren(html) {
      const tagRegex = /<([a-z0-9]+)([^>]*)>/gi;
      let m;
      while ((m = tagRegex.exec(html)) !== null) {
        if (m[1].startsWith('/')) continue;
        const tag = m[1];
        const attrs = m[2];
        const el = new MockElement(tag);
        const classMatch = attrs.match(/class=["']([^"']+)["']/i);
        if (classMatch) el.className = classMatch[1];
        const idMatch = attrs.match(/id=["']([^"']+)["']/i);
        if (idMatch) el.id = idMatch[1];
        if (/\bdisabled\b/i.test(attrs)) el.disabled = true;
        const dataMatches = attrs.matchAll(/data-([a-z0-9-]+)=["']([^"']+)["']/gi);
        for (const dm of dataMatches) el.dataset[dm[1]] = dm[2];
        el.parentElement = this;
        this.children.push(el);
      }
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) ?? null; }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx !== -1) this.parentElement.children.splice(idx, 1);
      }
    }
    focus() {}
    querySelectorAll(selector) {
      const matches = [];
      for (const child of this.children) {
        if (child.className.split(/\s+/).includes(selector.replace(/^\./, '')) || child.tagName.toLowerCase() === selector) matches.push(child);
        matches.push(...child.querySelectorAll(selector));
      }
      return matches;
    }
    querySelector(selector) {
      const cls = selector.replace(/^\./, '');
      const id = selector.replace(/^#/, '');
      for (const c of this.children) {
        if (c.className.split(/\s+/).includes(cls) || c.id === id || c.tagName.toLowerCase() === selector) {
          return c;
        }
        const found = c.querySelector(selector);
        if (found) return found;
      }
      return null;
    }
    click() {
      this.dispatchEvent(new Event('click'));
    }
  }

  const storage = new Map();
  const mockLocalStorage = {
    getItem(k) { return storage.get(k) ?? null; },
    setItem(k, v) { storage.set(k, String(v)); },
    removeItem(k) { storage.delete(k); },
    clear() { storage.clear(); },
  };

  const mockWindow = new EventTarget();
  mockWindow.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  const mockDoc = new EventTarget();
  mockDoc.body = new MockElement('body');
  mockDoc.createElement = (tag) => new MockElement(tag);
  mockDoc.querySelector = (sel) => mockDoc.body.querySelector(sel);

  Object.assign(globalThis, {
    window: mockWindow,
    document: mockDoc,
    localStorage: mockLocalStorage,
    fetch: () => Promise.resolve({ ok: false }),
  });

  return {
    storage: mockLocalStorage,
    restore() {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
    },
  };
}

test('pictures persist a no-repeat cycle and avoid the cycle-boundary repeat', () => {
  const fx = domFixture();
  try {
    fx.storage.setItem('elements_loader_pictures_v2', '[]');
    const cycle = () => Array.from({ length: LOADER_PICTURES.length }, nextLoaderPicture);
    const first = cycle(), second = cycle();
    assert.equal(new Set(first).size, LOADER_PICTURES.length);
    assert.equal(new Set(second).size, LOADER_PICTURES.length);
    assert.notEqual(first.at(-1), second[0]);
    assert.equal(JSON.parse(fx.storage.getItem('elements_loader_pictures_v2')).length, LOADER_PICTURES.length);
    fx.storage.setItem('elements_loader_pictures_v2', '{broken');
    assert.doesNotThrow(nextLoaderPicture);
    fx.storage.setItem('elements_loader_pictures_v2', JSON.stringify([null, {}, 'not-a-picture']));
    assert.ok(nextLoaderPicture().endsWith('.jpg'));
  } finally { fx.restore(); }
});

test('blocked storage still provides a complete session picture cycle', () => {
  const fx = domFixture();
  try {
    fx.storage.setItem('elements_loader_pictures_v2', '[]');
    const first = nextLoaderPicture();
    globalThis.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    const rest = Array.from({ length: LOADER_PICTURES.length - 1 }, nextLoaderPicture);
    assert.equal(new Set([first, ...rest]).size, LOADER_PICTURES.length);
  } finally { fx.restore(); }
});

test('real progress draws four triangles and fills rule ticks monotonically', () => {
  const fx = domFixture();
  let loader;
  try {
    loader = new Loader({ destination: 'town', onEnter() {} });
    const root = document.querySelector('#elements-loader');
    const marks = root.querySelectorAll('.loader-element-ink');
    const ticks = root.querySelectorAll('.loader-tick-ink');
    const ink = () => marks.map(m => 100 - Number(m.style.strokeDashoffset));
    const filled = () => ticks.filter(t => t.style.opacity === '1').length;
    assert.equal(marks.length, 4);
    assert.equal(ticks.length, 51);
    assert.deepEqual(ink(), [0, 0, 0, 0]);
    assert.equal(filled(), 0);
    loader.setProgress(.1);
    assert.deepEqual(ink(), [40, 0, 0, 0]);
    assert.equal(filled(), 6);
    loader.setProgress(.4);
    assert.deepEqual(ink(), [100, 60.00000000000001, 0, 0]);
    assert.equal(filled(), 21);
    loader.setProgress(.5, 'Half loaded');
    assert.deepEqual(ink(), [100, 100, 0, 0]);
    loader.setProgress(.1, 'Old stage');
    loader.setProgress(NaN, 'Invalid');
    loader.setProgress(Infinity, 'Invalid');
    assert.equal(root.querySelector('.loader-percentage').textContent, '50%');
    assert.equal(root.querySelector('.loader-stage').textContent, 'Half loaded');
    assert.deepEqual(ink(), [100, 100, 0, 0]);
    loader.setProgress(.9);
    assert.ok(Math.abs(ink()[3] - 60) < 1e-8);
    assert.equal(filled(), 46);
    loader.setProgress(5);
    assert.deepEqual(ink(), [100, 100, 100, 100]);
    assert.equal(filled(), 51);
    assert.equal(root.querySelector('.loader-elements').getAttribute('aria-valuenow'), '100');
  } finally { loader?.dispose(); fx.restore(); }
});

test('a single panel alternates only after the full reading time, then fades', t => {
  const fx = domFixture();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const loader = new Loader({ destination: 'town', onEnter() {} });
    const root = document.querySelector('#elements-loader');
    assert.equal(root.querySelectorAll('.loader-hint').length, 1);
    assert.equal(root.querySelectorAll('button').length, 0);
    const first = loader.getHint();
    const duration = hintDuration(first);
    t.mock.timers.tick(duration - 1);
    assert.equal(loader.getHint().id, first.id);
    t.mock.timers.tick(1);
    assert.equal(loader.getHint().id, first.id, 'Old text remains during fade');
    t.mock.timers.tick(200);
    assert.notEqual(hintClass(loader.getHint().kind), hintClass(first.kind));
    const second = loader.getHint();
    assert.equal(root.querySelector('.loader-hint-badge').textContent, hintClass(second.kind) === 'know' ? 'Did you know' : 'Hint');
    t.mock.timers.tick(hintDuration(second));
    t.mock.timers.tick(200);
    assert.equal(hintClass(loader.getHint().kind), hintClass(first.kind));
    loader.dispose();
    t.mock.timers.tick(100000);
    assert.equal(document.querySelector('#elements-loader'), null);
  } finally { t.mock.timers.reset(); fx.restore(); }
});

test('long hints get 300ms per word and never less than five seconds', () => {
  assert.equal(hintDuration({ title: 'A fact', text: 'Short text.' }), 5000);
  assert.equal(hintDuration({ title: 'One', text: Array(30).fill('word').join(' ') }), 9300);
  assert.equal(hintDuration({ title: 'One', text: 'Two', minSeconds: 12 }), 12000);
});

test('hint glyphs follow the visible hint and device without a second panel', () => {
  const fx = domFixture();
  try {
    const loader = new Loader({ destination: 'town', onEnter() {} });
    const root = document.querySelector('#elements-loader');
    const hint = data.hints.find(h => h.action === 'strike');
    loader.showHint(hint, true);
    const glyph = root.querySelector('.loader-hint-glyph');
    assert.equal(glyph.innerHTML, actionGlyph('strike', 'desktop'));
    loader.setDevice('touch');
    assert.equal(glyph.innerHTML, actionGlyph('strike', 'touch'));
    const lore = data.hints.find(h => hintClass(h.kind) === 'know');
    loader.showHint(lore, true);
    assert.equal(loader.getHint('hint'), null);
    assert.equal(loader.getHint('know').id, lore.id);
    assert.equal(glyph.innerHTML, '');
    loader.dispose();
  } finally { fx.restore(); }
});

test('ready starts once without input and removes the loader after its fade', t => {
  const fx = domFixture();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let entered = 0;
    const loader = new Loader({ destination: 'arena', onEnter() { entered++; } });
    loader.setProgress(.99);
    assert.equal(entered, 0);
    loader.ready();
    loader.ready();
    assert.equal(entered, 1);
    const root = document.querySelector('#elements-loader');
    assert.ok(root.classList.contains('loader-hidden'));
    assert.equal(root.querySelector('.loader-percentage').textContent, '100%');
    t.mock.timers.tick(300);
    assert.equal(document.querySelector('#elements-loader'), null);
    assert.equal(window.elementsLoader, undefined);
    loader.ready();
    assert.equal(entered, 1);
  } finally { t.mock.timers.reset(); fx.restore(); }
});

test('reduced motion swaps content and completes the handover without a fade', t => {
  const fx = domFixture();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    window.matchMedia = query => ({ matches: query.includes('reduced-motion') });
    const loader = new Loader({ destination: 'town', onEnter() {} });
    const hint = data.hints.find(h => h.action === 'jump');
    loader.showHint(hint);
    assert.equal(loader.getHint().id, hint.id);
    loader.setProgress(.1);
    const marks = document.querySelector('#elements-loader').querySelectorAll('.loader-element-ink');
    assert.deepEqual(marks.map(m => m.style.strokeDashoffset), ['0', '100', '100', '100']);
    loader.ready();
    t.mock.timers.tick(0);
    assert.equal(document.querySelector('#elements-loader'), null);
  } finally { t.mock.timers.reset(); fx.restore(); }
});
