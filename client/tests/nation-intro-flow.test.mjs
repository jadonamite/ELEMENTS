import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { NationIntroFlow } from '../src/story/nation-intro-flow.ts';
import { LeadManager } from '../../shared/src/story/leads.ts';
import { IGNIS_MISSION } from '../../shared/src/story/missions.ts';

const GATE = IGNIS_MISSION.gate;

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

/** The hero's arrival as the intro sees it: dropped, down on landing, up when raised. */
function arrival() {
  const state = { dropped: false, standing: false };
  return {
    state,
    drop() { state.dropped = true; },
    down: () => state.dropped && !state.standing,
    standUp() { state.standing = true; },
    standing: () => state.standing,
  };
}

/** The controls as the intro narrows them: a control answers when no lesson runs or the lesson has taught it. */
function controlLesson() {
  let taught = null;
  return {
    restrict: (set) => { taught = set; },
    allowed: (action) => action === 'menu' || taught === null || taught.has(action),
  };
}

/** Winds the line timers forward until the intro reaches `step` (the greeting and lore lines play out). */
async function windUntil(t, intro, step) {
  for (let i = 0; i < 200 && intro.step !== step; i++) {
    t.mock.timers.tick(500);
    intro.update(0.016);
    for (let k = 0; k < 6; k++) await Promise.resolve();
  }
  assert.equal(intro.step, step);
}

/**
 * A finished step is acknowledged before the next starts: the step reads 'heard' and shows the master's
 * acknowledgement, and the next step starts only after the line has been heard out (timers wound forward).
 */
async function heardThen(t, intro, index, next) {
  assert.equal(intro.step, 'heard', `step ${index + 1} done: the master acknowledges it first`);
  for (let i = 0; i < 40 && intro.step === 'heard'; i++) {
    t.mock.timers.tick(500);
    for (let k = 0; k < 6; k++) await Promise.resolve();
    if (intro.step === 'heard' && intro['dialogueLine'].textContent === intro.config.stepHeard[index]) intro['ackShown'] = true;
  }
  assert.ok(intro['ackShown'], `the acknowledgement "${intro.config.stepHeard[index]}" is shown before the next step`);
  intro['ackShown'] = false;
  assert.equal(intro.step, next);
}

test('NationIntroFlow: initializes at level 0 and steps through interactive training (IGNIS Shaper)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restoreDom = setupDom();
  try {
    let currentTier = -1;
    let weaponReceived = false;
    let missionCompletedCalled = false;
    const arrived = arrival();
    const lesson = controlLesson();

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
      isDim: () => false,
      controller: mockController,
      shoulderCamera: mockShoulderCamera,
      input: mockInput,
      combat: mockCombat,
      fight: mockFight,
      sound: mockSound,
      voices: { speak: async () => true },
      leadManager: mockLeadManager,
      waypointMarker: mockWaypointMarker,
      applyTier: (t) => { currentTier = t; mockFight.tier = t; },
      arrival: arrived, restrictControls: lesson.restrict, weapon: { assetPath: '' }, heroPalm: () => null, heroReach: () => {},
      receiveWeapon: () => { weaponReceived = true; },
      beforeUnlock: async () => {},
      onMissionComplete: () => { missionCompletedCalled = true; },
    });

    // 1. Initial state: Level/Tier 0
    assert.equal(currentTier, 0, 'Must start at level 0');
    assert.equal(intro.step, 'idle');

    // 2. Start intro -> approach -> greeting
    // 2. The hero falls in; nothing answers but the menu until the master teaches it.
    intro.start();
    assert.equal(intro.step, 'arriving');
    assert.equal(arrived.state.dropped, true, 'the hero is dropped into the arrival ground');
    assert.equal(lesson.allowed('move'), false, 'no walking before the lesson');
    assert.equal(lesson.allowed('menu'), true);
    intro.update(0.016);
    assert.equal(intro.step, 'down', 'landed: the master walks in');

    t.mock.timers.tick(4000);
    for (let k = 0; k < 6; k++) await Promise.resolve();
    assert.equal(arrived.state.standing, false, 'the hero stays down a few seconds after landing');
    t.mock.timers.tick(1100);
    assert.equal(arrived.state.standing, true, 'then gets up without waiting for the master');
    await windUntil(t, intro, 'step_move');
    for (let k = 0; k < 6; k++) await Promise.resolve();
    assert.equal(lesson.allowed('move'), true, 'footing teaches moving');
    assert.equal(lesson.allowed('jump'), false, 'jumping waits for its own lesson');
    assert.equal(lesson.allowed('strike'), false);

    // 3. Movement test: Player moves 2.5 meters
    mockController.position.set(11, 0, 0);
    intro.update(0.016);
    // While acknowledged, play is not read: sprinting now does not count for the next step.
    runningState = true; mockController.grounded = false;
    intro.update(0.016);
    runningState = false; mockController.grounded = true;
    await heardThen(t, intro, 0, 'step_sprint_jump');
    intro.update(0.016);
    assert.equal(intro.step, 'step_sprint_jump', 'a sprint during the acknowledgement does not count');

    // 4. Sprint & Jump test: both in one frame
    runningState = true;
    mockController.grounded = false;
    intro.update(0.016);
    await heardThen(t, intro, 1, 'step_weapon');
    for (let k = 0; k < 6; k++) await Promise.resolve();
    assert.equal(weaponReceived, true, 'the master hands the weapon over');
    assert.equal(intro.config.starterWeapon, 'sword', 'IGNIS starter weapon must be sword');
    assert.equal(lesson.allowed('weapon'), true, 'drawing is taught once the weapon is in hand');
    assert.equal(lesson.allowed('strike'), false, 'striking waits for its lesson');

    // 5. Draw Weapon test
    mockCombat.fightingStyle = 'weapon';
    intro.update(0.016);
    await heardThen(t, intro, 2, 'step_attacks');

    // 6. Light & Heavy Attack test
    mockCombat.current = 'light_1';
    intro.update(0.016);
    mockCombat.current = 'heavy_1';
    intro.update(0.016);
    await heardThen(t, intro, 3, 'step_defense');

    // 7. Guard & Dodge test
    mockCombat.blocking = true;
    mockCombat.current = 'dodge';
    intro.update(0.016);
    await heardThen(t, intro, 4, 'lore_and_mission');
    assert.equal(lesson.allowed('bending'), true, 'every control answers once the lesson is done');

    // 8. Dispatch first mission
    intro['dispatchFirstMission']();
    assert.equal(intro.step, 'active_mission');
    assert.ok(mockWaypointMarker.activeLead !== null, 'Waypoint marker must be set for first mission');
    assert.equal(mockWaypointMarker.activeLead.id, 'first_mission_ignis_gate');
    assert.equal(currentTier, 0, 'Player remains tier 0 during the mission');

    // 9. Reaching target completes mission & promotes player to Level 1
    mockController.position.set(GATE.x, GATE.y, GATE.z); // in front of the registrar's desk
    intro.update(0.016);

    for (let k = 0; k < 12; k++) await Promise.resolve();
    assert.equal(intro.step, 'completed');
    assert.equal(currentTier, 1, 'Reaching first mission target transfers player to Level 1');
    assert.equal(missionCompletedCalled, true, 'onMissionComplete must be called');
    assert.equal(mockWaypointMarker.activeLead, null, 'Waypoint marker cleared on completion');

    intro.dispose();
  } finally {
    restoreDom();
  }
});

test('NationIntroFlow: modular across AURA and HUSH role', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restoreDom = setupDom();
  try {
    let currentTier = -1;
    let weaponReceived = false;

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
      isDim: () => true, // Hush role in Aura
      controller: mockController,
      shoulderCamera: mockShoulderCamera,
      input: mockInput,
      combat: mockCombat,
      fight: mockFight,
      sound: mockSound,
      voices: { speak: async () => true },
      leadManager: mockLeadManager,
      waypointMarker: mockWaypointMarker,
      applyTier: (t) => { currentTier = t; mockFight.tier = t; },
      arrival: arrival(), restrictControls: () => {}, weapon: { assetPath: '' }, heroPalm: () => null, heroReach: () => {},
      receiveWeapon: () => { weaponReceived = true; },
      beforeUnlock: async () => {},
    });

    assert.equal(intro.config.starterWeapon, 'staff');
    assert.equal(intro.config.master.name, 'Master Zephyr');

    intro.start();
    intro.update(0.016);
    await windUntil(t, intro, 'step_move');

    // Trigger step moves
    mockController.position.set(5, 0, 0);
    intro.update(0.016);
    await heardThen(t, intro, 0, 'step_sprint_jump');
    intro.update(0.016);
    await heardThen(t, intro, 1, 'step_weapon');
    for (let k = 0; k < 6; k++) await Promise.resolve();
    assert.equal(weaponReceived, true, 'AURA is handed the staff');

    intro.update(0.016);
    await heardThen(t, intro, 2, 'step_attacks');
    mockCombat.current = 'light_1';
    intro.update(0.016);
    mockCombat.current = 'heavy_1';
    intro.update(0.016);
    await heardThen(t, intro, 3, 'step_defense');
    mockCombat.current = 'dodge';
    intro.update(0.016);
    await heardThen(t, intro, 4, 'lore_and_mission');

    intro['dispatchFirstMission']();
    assert.equal(intro.step, 'active_mission');
    assert.equal(mockWaypointMarker.activeLead.id, 'first_mission_aura_arch');

    // Every nation lands in Sindr: the first mission ends at the registrar's desk.
    mockController.position.set(GATE.x, GATE.y, GATE.z);
    intro.update(0.016);

    for (let k = 0; k < 12; k++) await Promise.resolve();
    assert.equal(intro.step, 'completed');
    assert.equal(currentTier, 1, 'Hush promoted to Level 1 Wayfarer upon reaching goal');

    intro.dispose();
  } finally {
    restoreDom();
  }
});

test('NationIntroFlow: the gate sign-in runs before the level is granted, and the result decides the banner', async () => {
  const restoreDom = setupDom();
  try {
    let currentTier = -1;
    let dim = false;
    let releaseSignIn = () => {};
    const mockFight = { heroAlive: true, tier: 0 };
    const mockWaypointMarker = { activeLead: null, setLead(lead) { this.activeLead = lead; } };
    const intro = new NationIntroFlow({
      nation: 'IGNIS',
      isDim: () => dim,
      controller: { position: new Vector3(8, 0, 0), facing: 0, grounded: true },
      shoulderCamera: { yaw: 0, pitch: 0, distance: 3.5 },
      input: { read: () => ({ forward: 0, right: 0, running: false }) },
      combat: { current: null, fightingStyle: 'hands', blocking: false },
      fight: mockFight,
      sound: { speak: async () => true },
      leadManager: new LeadManager([]),
      waypointMarker: mockWaypointMarker,
      applyTier: (t) => { currentTier = t; mockFight.tier = t; },
      arrival: arrival(), restrictControls: () => {}, weapon: { assetPath: '' }, heroPalm: () => null, heroReach: () => {}, receiveWeapon: () => {},
      beforeUnlock: () => new Promise((resolve) => { releaseSignIn = () => { dim = true; resolve(); }; }),
    });
    intro['dispatchFirstMission']();
    const lead = mockWaypointMarker.activeLead;
    intro['completeFirstMission'](lead);
    for (let k = 0; k < 12; k++) await Promise.resolve();
    assert.equal(intro.step, 'awaiting_gate');
    assert.equal(currentTier, 0, 'no level while the sign-in is open');

    releaseSignIn();
    for (let k = 0; k < 12; k++) await Promise.resolve();
    assert.equal(currentTier, 1, 'the level is granted once the sign-in step ends');
    const banner = document.body.children.filter((c) => c.className === 'nation-mission-banner').at(-1);
    assert.match(banner?.innerHTML ?? '', /Rank Attained/, 'the banner follows the Drawing the account came back with');
    intro.dispose();
  } finally {
    restoreDom();
  }
});


test('NationIntroFlow: failed registration leaves the mission and tier locked, with an explicit retry', async () => {
  const restoreDom = setupDom();
  let intro;
  try {
    let tier = -1, fail = true;
    const marker = { activeLead: null, setLead(lead) { this.activeLead = lead; } };
    intro = new NationIntroFlow({
      nation: 'IGNIS', isDim: () => false,
      controller: { position: new Vector3(GATE.x, GATE.y, GATE.z), facing: 0, grounded: true },
      shoulderCamera: {}, input: { read: () => ({ running: false }) }, combat: {}, fight: {}, sound: {},
      leadManager: new LeadManager([]), waypointMarker: marker,
      applyTier: value => { tier = value; }, arrival: arrival(), restrictControls: () => {}, weapon: { assetPath: '' }, heroPalm: () => null, heroReach: () => {}, receiveWeapon: () => {},
      beforeUnlock: async () => { if (fail) throw new Error('cancelled'); },
    });
    intro['dispatchFirstMission']();
    intro.update(0.016);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(tier, 0);
    assert.equal(intro.step, 'awaiting_gate');
    assert.equal(marker.activeLead.completed, false);
    intro.update(0.016);
    assert.equal(tier, 0, 'remaining in the gate radius cannot unlock after a failure');
    fail = false;
    intro.retryGate();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(intro.step, 'completed');
    assert.equal(tier, 1);
  } finally { intro?.dispose(); restoreDom(); }
});


test('NationIntroFlow: saved training resumes the gate objective without replaying training or unlocking', () => {
  const restoreDom = setupDom();
  let intro;
  try {
    let tier = -1, weapon = null, trained = false;
    const marker = { lead: null, setLead(lead) { this.lead = lead; } };
    intro = new NationIntroFlow({
      nation: 'IGNIS', isDim: () => false,
      controller: { position: new Vector3(8, 0, 0), facing: 0, grounded: true },
      shoulderCamera: {}, input: { read: () => ({ running: false }) }, combat: {}, fight: {}, sound: {},
      leadManager: new LeadManager([]), waypointMarker: marker,
      applyTier: value => { tier = value; }, arrival: arrival(), restrictControls: () => {}, weapon: { assetPath: '' }, heroPalm: () => null, heroReach: () => {}, receiveWeapon: () => { weapon = 'received'; },
      onTrainingComplete: () => { trained = true; }, beforeUnlock: async () => {},
    });
    intro.resumeAtGate();
    assert.equal(intro.step, 'active_mission');
    assert.equal(tier, 0);
    assert.equal(weapon, 'received', 'a hero trained before already has the weapon');
    assert.equal(trained, true);
    assert.equal(marker.lead.id, 'first_mission_ignis_gate');
  } finally { intro?.dispose(); restoreDom(); }
});
