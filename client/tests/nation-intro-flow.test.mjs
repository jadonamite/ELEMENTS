import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { NationIntroFlow } from '../src/story/nation-intro-flow.ts';
import { LeadManager } from '../../shared/src/story/leads.ts';

function setupDom() {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
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
      this.style = {};
      this.children = [];
      this.attributes = new Map();
      this._textContent = '';
      this.parentElement = null;
    }
    get textContent() { return this._textContent; }
    set textContent(v) { this._textContent = v; }
    get innerHTML() { return this._innerHTML || ''; }
    set innerHTML(val) {
      this._innerHTML = val;
      this.children = [];
      const tagRegex = /<([a-z0-9]+)([^>]*)>/gi;
      let m;
      while ((m = tagRegex.exec(val)) !== null) {
        const tag = m[1];
        const attrs = m[2];
        const el = new MockElement(tag);
        const classMatch = attrs.match(/class=["']([^"']+)["']/i);
        if (classMatch) {
          el.className = classMatch[1];
          for (const c of classMatch[1].split(/\s+/)) el.classList.add(c);
        }
        el.parentElement = this;
        this.children.push(el);
      }
    }
    querySelector(sel) {
      if (sel.startsWith('.')) {
        const c = sel.slice(1);
        const findIn = (node) => {
          for (const child of node.children) {
            if (child.classList.contains(c) || (child.className && child.className.includes(c))) return child;
            const res = findIn(child);
            if (res) return res;
          }
          return null;
        };
        return findIn(this);
      }
      return null;
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
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
        this.parentElement = null;
      }
    }
  }

  const documentMock = {
    createElement(tag) { return new MockElement(tag); },
    body: new MockElement('body'),
  };

  globalThis.document = documentMock;
  globalThis.window = {
    location: { search: '' },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  };

  return () => {
    globalThis.window = originals.window;
    globalThis.document = originals.document;
    globalThis.localStorage = originals.localStorage;
  };
}

test('NationIntroFlow: initializes at level 0 and steps through interactive training (IGNIS Shaper)', () => {
  const restoreDom = setupDom();
  try {
    let currentTier = -1;
    let starterWeaponEquipped = '';
    let missionCompletedCalled = false;

    const mockController = { position: new Vector3(8, 0, 0), facing: 0, grounded: true };
    const mockShoulderCamera = { yaw: 0, pitch: 0, distance: 3.5 };
    let runningState = false;
    const mockInput = {
      read: () => ({ forward: 0, right: 0, running: runningState }),
    };
    const mockCombat = {
      current: null,
      fightingStyle: 'hands',
      blocking: false,
    };
    const mockFight = { heroAlive: true, tier: 0 };
    const mockSound = { speak: async () => true };
    const mockLeadManager = new LeadManager([]);
    const mockWaypointMarker = { activeLead: null, setLead(lead) { this.activeLead = lead; } };

    const intro = new NationIntroFlow({
      nation: 'IGNIS',
      isDim: false,
      controller: mockController,
      shoulderCamera: mockShoulderCamera,
      input: mockInput,
      combat: mockCombat,
      fight: mockFight,
      sound: mockSound,
      leadManager: mockLeadManager,
      waypointMarker: mockWaypointMarker,
      applyTier: (t) => { currentTier = t; mockFight.tier = t; },
      onEquipStarterWeapon: (w) => { starterWeaponEquipped = w; },
      onMissionComplete: () => { missionCompletedCalled = true; },
    });

    // 1. Initial state: Level/Tier 0
    assert.equal(currentTier, 0, 'Must start at level 0');
    assert.equal(intro.step, 'idle');

    // 2. Start intro -> approach -> greeting
    intro.start();
    assert.equal(intro.step, 'approach');

    intro['startTraining']();
    assert.equal(intro.step, 'step_move');

    // 3. Movement test: Player moves 2.5 meters
    mockController.position.set(11, 0, 0);
    intro.update(0.016);
    assert.equal(intro.step, 'step_sprint_jump');

    // 4. Sprint & Jump test
    runningState = true;
    mockController.grounded = false;
    intro.update(0.016);
    assert.equal(intro.step, 'step_weapon');
    assert.equal(starterWeaponEquipped, 'sword', 'IGNIS starter weapon must be sword');

    // 5. Draw Weapon test
    mockCombat.fightingStyle = 'weapon';
    intro.update(0.016);
    assert.equal(intro.step, 'step_attacks');

    // 6. Light & Heavy Attack test
    mockCombat.current = 'light_1';
    intro.update(0.016);
    mockCombat.current = 'heavy_1';
    intro.update(0.016);
    assert.equal(intro.step, 'step_defense');

    // 7. Guard & Dodge test
    mockCombat.blocking = true;
    mockCombat.current = 'dodge';
    intro.update(0.016);
    assert.equal(intro.step, 'lore_and_mission');

    // 8. Dispatch first mission
    intro['dispatchFirstMission']();
    assert.equal(intro.step, 'active_mission');
    assert.ok(mockWaypointMarker.activeLead !== null, 'Waypoint marker must be set for first mission');
    assert.equal(mockWaypointMarker.activeLead.id, 'first_mission_ignis_gate');
    assert.equal(currentTier, 0, 'Player remains tier 0 during the mission');

    // 9. Reaching target completes mission & promotes player to Level 1
    mockController.position.set(52, 0, 0); // West Gate coordinates
    intro.update(0.016);

    assert.equal(intro.step, 'completed');
    assert.equal(currentTier, 1, 'Reaching first mission target transfers player to Level 1');
    assert.equal(missionCompletedCalled, true, 'onMissionComplete must be called');
    assert.equal(mockWaypointMarker.activeLead, null, 'Waypoint marker cleared on completion');

    intro.dispose();
  } finally {
    restoreDom();
  }
});

test('NationIntroFlow: modular across AURA and HUSH role', () => {
  const restoreDom = setupDom();
  try {
    let currentTier = -1;
    let starterWeaponEquipped = '';

    const mockController = { position: new Vector3(0, 0, 0), facing: 0, grounded: false };
    const mockShoulderCamera = { yaw: 0, pitch: 0, distance: 3.5 };
    const mockInput = { read: () => ({ forward: 0, right: 0, running: true }) };
    const mockCombat = { current: 'dodge', fightingStyle: 'weapon', blocking: true };
    const mockFight = { heroAlive: true, tier: 0 };
    const mockSound = { speak: async () => true };
    const mockLeadManager = new LeadManager([]);
    const mockWaypointMarker = { activeLead: null, setLead(lead) { this.activeLead = lead; } };

    const intro = new NationIntroFlow({
      nation: 'AURA',
      isDim: true, // Hush role in Aura
      controller: mockController,
      shoulderCamera: mockShoulderCamera,
      input: mockInput,
      combat: mockCombat,
      fight: mockFight,
      sound: mockSound,
      leadManager: mockLeadManager,
      waypointMarker: mockWaypointMarker,
      applyTier: (t) => { currentTier = t; mockFight.tier = t; },
      onEquipStarterWeapon: (w) => { starterWeaponEquipped = w; },
    });

    assert.equal(intro.config.starterWeapon, 'staff');
    assert.equal(intro.config.master.name, 'Master Zephyr');

    intro.start();
    intro['startTraining']();

    // Trigger step moves
    mockController.position.set(5, 0, 0);
    intro.update(0.016); // to step_sprint_jump
    intro.update(0.016); // to step_weapon
    assert.equal(starterWeaponEquipped, 'staff', 'AURA equips staff');

    mockCombat.current = 'light_1';
    intro.update(0.016);
    mockCombat.current = 'heavy_1';
    intro.update(0.016); // to step_defense
    mockCombat.current = 'dodge';
    intro.update(0.016); // to lore_and_mission

    intro['dispatchFirstMission']();
    assert.equal(intro.step, 'active_mission');
    assert.equal(mockWaypointMarker.activeLead.id, 'first_mission_aura_arch');

    // Reach Sky Arch target (x: 48, z: -8)
    mockController.position.set(48, 0, -8);
    intro.update(0.016);

    assert.equal(intro.step, 'completed');
    assert.equal(currentTier, 1, 'Hush promoted to Level 1 Wayfarer upon reaching goal');

    intro.dispose();
  } finally {
    restoreDom();
  }
});
