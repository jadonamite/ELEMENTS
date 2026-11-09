import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Loader } from '../src/ui/loader.ts';
import { actionGlyph } from '../src/controls/glyphs.js';

test('hints.json is valid and covers all required categories', () => {
  const filePath = new URL('../public/hints/hints.json', import.meta.url);
  const raw = readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  assert.equal(data.version, 1, 'Version is 1');
  assert.ok(Array.isArray(data.hints), 'Hints is an array');
  assert.ok(data.hints.length >= 40, `At least 40 hints present (found ${data.hints.length})`);

  const ids = new Set();
  const kinds = new Set();
  for (const h of data.hints) {
    assert.ok(h.id, 'Hint has id');
    assert.ok(!ids.has(h.id), `Duplicate hint id: ${h.id}`);
    ids.add(h.id);

    assert.ok(h.title, `Hint ${h.id} has title`);
    assert.ok(h.text, `Hint ${h.id} has text`);
    assert.ok(Array.isArray(h.where) && h.where.length > 0, `Hint ${h.id} has valid where array`);
    assert.ok(['lore', 'controls', 'fighting', 'world', 'tip'].includes(h.kind), `Invalid kind ${h.kind} on ${h.id}`);
    kinds.add(h.kind);

    if (h.kind === 'controls') {
      assert.ok(h.action, `Controls hint ${h.id} must specify action`);
    }

    if (h.minSeconds) {
      assert.ok(h.minSeconds >= 4, `minSeconds should be at least 4s on ${h.id}`);
    }
  }

  assert.ok(kinds.has('lore'), 'Has lore hints');
  assert.ok(kinds.has('controls'), 'Has controls hints');
  assert.ok(kinds.has('fighting'), 'Has fighting hints');
  assert.ok(kinds.has('world'), 'Has world hints');
  assert.ok(kinds.has('tip'), 'Has tip hints');
});

test('controls hints produce valid SVG glyphs for both desktop and touch', () => {
  const filePath = new URL('../public/hints/hints.json', import.meta.url);
  const data = JSON.parse(readFileSync(filePath, 'utf8'));

  const controlsHints = data.hints.filter(h => h.kind === 'controls');
  assert.ok(controlsHints.length >= 12, 'At least 12 controls hints');

  for (const h of controlsHints) {
    const desktopSvg = actionGlyph(h.action, 'desktop');
    assert.ok(desktopSvg.startsWith('<svg') && desktopSvg.endsWith('</svg>'), `Desktop SVG valid for ${h.action}`);
    assert.ok(!desktopSvg.includes('undefined'), `Desktop SVG for ${h.action} has no undefined`);

    const touchSvg = actionGlyph(h.action, 'touch');
    assert.ok(touchSvg.startsWith('<svg') && touchSvg.endsWith('</svg>'), `Touch SVG valid for ${h.action}`);
    assert.ok(!touchSvg.includes('undefined'), `Touch SVG for ${h.action} has no undefined`);
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
    querySelector(selector) {
      const cls = selector.replace(/^\./, '');
      const id = selector.replace(/^#/, '');
      for (const c of this.children) {
        if (c.className.split(/\s+/).includes(cls) || c.id === id) {
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
    restore() {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
    },
  };
}

test('Loader manages progress monotonically and handles enter handover', () => {
  const fx = domFixture();
  try {
    let entered = false;
    let changedFighter = false;
    const loader = new Loader({
      destination: 'town',
      element: 'IGNIS',
      onEnter: () => { entered = true; },
      onChangeFighter: () => { changedFighter = true; },
    });

    const root = document.querySelector('#elements-loader');
    assert.ok(root, 'Loader mounted in document');
    assert.equal(root.getAttribute('role'), 'region');

    const barFill = root.querySelector('.loader-bar-fill');
    const stageEl = root.querySelector('.loader-stage');
    const percentEl = root.querySelector('.loader-percentage');
    const enterBtn = root.querySelector('.loader-enter-btn');

    assert.ok(barFill && stageEl && percentEl && enterBtn);
    assert.equal(enterBtn.disabled, true, 'Enter button is initially disabled');

    // Test stage and progress update
    loader.setProgress(0.25, "Raising Sindr's streets");
    assert.equal(percentEl.textContent, '25%');
    assert.equal(stageEl.textContent, "Raising Sindr's streets");

    // Monotonic guarantee: smaller progress is ignored
    loader.setProgress(0.10, 'Early check');
    assert.equal(percentEl.textContent, '25%', 'Progress does not move backward');
    assert.equal(stageEl.textContent, "Raising Sindr's streets");

    loader.setProgress(0.60, 'Forging the hero');
    assert.equal(percentEl.textContent, '60%');
    assert.equal(stageEl.textContent, 'Forging the hero');

    // Handover to ready
    loader.ready('Enter Sindr');
    assert.equal(percentEl.textContent, '100%');
    assert.equal(stageEl.textContent, 'Sindr is ready');
    assert.equal(enterBtn.disabled, false);
    assert.equal(enterBtn.textContent, 'Enter Sindr');

    // Clicking enter fires onEnter
    enterBtn.click();
    assert.equal(entered, true, 'onEnter callback fired');

    loader.dispose();
  } finally {
    fx.restore();
  }
});

test('Loader shows hints with action glyphs and adapts to device', async () => {
  const fx = domFixture();
  try {
    const loader = new Loader({
      destination: 'town',
      onEnter: () => {},
    });

    const root = document.querySelector('#elements-loader');
    const [knowPanel, hintPanel] = root.querySelector('.loader-hints').children;
    assert.equal(knowPanel.dataset.class, 'know');
    assert.equal(hintPanel.dataset.class, 'hint');
    const hintBadge = hintPanel.querySelector('.loader-hint-badge');
    const hintTitle = hintPanel.querySelector('.loader-hint-title');
    const hintText = hintPanel.querySelector('.loader-hint-text');
    const hintGlyph = hintPanel.querySelector('.loader-hint-glyph');

    // Show a controls hint explicitly (instant for testing)
    loader.showHint({
      id: 'ctrl-strike',
      kind: 'controls',
      title: 'Light strike',
      text: 'Deliver quick strikes with weapon or bare fists to open combat.',
      action: 'strike',
      element: null,
      where: ['town', 'arena'],
      minSeconds: 4,
    }, true);

    assert.equal(hintBadge.dataset.kind, 'controls');
    assert.equal(hintTitle.textContent, 'Light strike');
    assert.ok(hintGlyph.innerHTML.includes('<svg'), 'Renders SVG glyph');

    // Switch device to touch and verify glyph updates
    loader.setDevice('touch');
    assert.ok(hintGlyph.innerHTML.includes('<svg'), 'Touch glyph rendered');

    loader.setDevice('desktop');
    assert.ok(hintGlyph.innerHTML.includes('<svg'), 'Desktop glyph rendered');

    // Show a lore hint without action (instant for testing)
    loader.showHint({
      id: 'lore-rising',
      kind: 'lore',
      title: 'The rising',
      text: "You don't choose what you become.",
      element: null,
      where: ['town', 'arena'],
    }, true);

    // Lore goes to "Did you know"; the controls hint stays in its own panel.
    assert.equal(knowPanel.querySelector('.loader-hint-badge').dataset.kind, 'lore');
    assert.equal(knowPanel.querySelector('.loader-hint-title').textContent, 'The rising');
    assert.equal(knowPanel.querySelector('.loader-hint-glyph').innerHTML, '', 'No glyph for non-action hint');
    assert.equal(hintTitle.textContent, 'Light strike');
    assert.equal(loader.getHint('know').id, 'lore-rising');
    assert.equal(loader.getHint('hint').id, 'ctrl-strike');

    loader.dispose();
  } finally {
    fx.restore();
  }
});
