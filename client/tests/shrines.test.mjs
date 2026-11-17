import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRST_SHRINE, LEGACY_SINDR_ORIGIN, SHRINES, shrineById } from '../../shared/src/index.js';
import { ShrineState } from '../src/shrine-state.ts';

test('ShrineState begins with Shrine of Embers lit', () => {
  const state = new ShrineState();
  assert.ok(state.isLit(FIRST_SHRINE));
  assert.equal(state.lit.size, 1);
});

test('ShrineState: reaching an unlit shrine lights it outside a fight, notices, and updates wake spot', () => {
  const notices = [];
  const state = new ShrineState({
    onNotice: (msg) => notices.push(msg),
  });

  const pinewatch = SHRINES.find(s => s.name === 'Pinewatch Shrine');
  assert.ok(pinewatch);

  // Pinewatch scene position = global minus origin
  const sceneX = pinewatch.x - LEGACY_SINDR_ORIGIN.x;
  const sceneZ = pinewatch.z - LEGACY_SINDR_ORIGIN.z;

  // Mid fight: does not light
  assert.equal(state.checkReach({ x: sceneX, z: sceneZ }, true), null);
  assert.ok(!state.isLit(pinewatch.id));

  // Outside fight: lights it
  const lit = state.checkReach({ x: sceneX, z: sceneZ }, false);
  assert.equal(lit?.id, pinewatch.id);
  assert.ok(state.isLit(pinewatch.id));
  assert.ok(notices.includes('Pinewatch Shrine lit'));

  // Falling near Pinewatch revives at Pinewatch's wake spot
  const wake = state.wakeSpot({ x: sceneX + 2, z: sceneZ + 2 });
  assert.equal(wake.shrine.id, pinewatch.id);
  assert.equal(wake.x, pinewatch.wake.x - LEGACY_SINDR_ORIGIN.x);
  assert.equal(wake.z, pinewatch.wake.z - LEGACY_SINDR_ORIGIN.z);
  assert.equal(wake.facing, pinewatch.wake.facing);
});

test('ShrineState: falling near Sindr with multiple lit shrines still wakes at the nearest lit shrine', () => {
  const state = new ShrineState();
  const pinewatch = SHRINES.find(s => s.name === 'Pinewatch Shrine');
  assert.ok(pinewatch);
  state.setOnlineLit([FIRST_SHRINE, pinewatch.id]);

  // Fall at Sindr origin (0, 0 scene coords)
  const embersWake = state.wakeSpot({ x: 0, z: 0 });
  assert.equal(embersWake.shrine.id, FIRST_SHRINE);

  // Fall near Pinewatch
  const pinewatchScene = {
    x: pinewatch.x - LEGACY_SINDR_ORIGIN.x,
    z: pinewatch.z - LEGACY_SINDR_ORIGIN.z,
  };
  const pwWake = state.wakeSpot(pinewatchScene);
  assert.equal(pwWake.shrine.id, pinewatch.id);
});

test('SettlementStream tracks lit state of precinct shrines', async () => {
  const { SettlementStream } = await import('../src/world/settlements.ts');
  const { SETTLEMENT_PRECINCTS } = await import('../../shared/src/world/ignis/settlements.js');
  const pinewatch = SETTLEMENT_PRECINCTS.find(p => p.name === 'Pinewatch');
  assert.ok(pinewatch);

  const stream = new SettlementStream(null, () => null, false);
  assert.equal(stream.isShrineLit(pinewatch), false);

  stream.setLit('shrine_pinewatch', true);
  assert.equal(stream.isShrineLit(pinewatch), true);

  stream.setLit('shrine_pinewatch', false);
  assert.equal(stream.isShrineLit(pinewatch), false);
});

test('globalMapMarkup includes shrines and fast travel markup', async () => {
  const { globalMapMarkup } = await import('../src/ui/global-map.ts');
  const html = globalMapMarkup(true);
  assert.ok(html.includes('atlas-shrines-wrap'));
  assert.ok(html.includes('Shrines'));
  assert.ok(html.includes('atlas-travel-wrap'));
  assert.ok(html.includes('Fast Travel'));
  assert.ok(html.includes('atlas-travel-hint'));
  assert.ok(html.includes('atlas-drop-wrap'));
});

test('WaypointMarker tracks death drop target and outlaw holder', async () => {
  const originals = { document: globalThis.document, window: globalThis.window };
  const mockElements = [];
  globalThis.document = {
    createElement: (tag) => {
      const el = { tag, style: {}, innerHTML: '', id: '', className: '', remove: () => {} };
      mockElements.push(el);
      return el;
    },
    body: { appendChild: () => {} },
  };
  globalThis.window = { innerWidth: 1920, innerHeight: 1080 };

  try {
    const { Scene, Camera, Vector3 } = await import('three');
    const { WaypointMarker } = await import('../src/story/waypoint-marker.ts');
    const scene = new Scene();
    const marker = new WaypointMarker(scene);

    let expiredCalled = false;
    marker.setDropTarget({
      kind: 'outlaw',
      title: 'Hunt Outlaw: Recover Drop',
      getPosition: () => ({ x: 10, y: 0, z: 20 }),
      expiresAt: Date.now() + 600000,
      onExpired: () => { expiredCalled = true; },
    });

    assert.ok(marker.activeDropTarget);
    assert.equal(marker.activeDropTarget.title, 'Hunt Outlaw: Recover Drop');

    const camera = new Camera();
    marker.update(0.016, camera, new Vector3(0, 0, 0));

    // Clearing drop target removes active target
    marker.setDropTarget(null);
    assert.equal(marker.activeDropTarget, null);

    marker.dispose();
  } finally {
    globalThis.document = originals.document;
    globalThis.window = originals.window;
  }
});

test('shrine travel rules: refusal with bounty, in fight, with shards, or high coin', async () => {
  const { travelRefusal } = await import('../../shared/src/index.js');
  const coinAllowance = 25;

  assert.equal(travelRefusal({ inFight: true, bounty: false, shards: 0, coin: 10 }, coinAllowance), 'Not while you are fighting');
  assert.equal(travelRefusal({ inFight: false, bounty: true, shards: 0, coin: 10 }, coinAllowance), 'The shrines will not carry someone the watch is hunting');
  assert.equal(travelRefusal({ inFight: false, bounty: false, shards: 2, coin: 10 }, coinAllowance), 'Shards travel by road: bank them or carry them');
  assert.equal(travelRefusal({ inFight: false, bounty: false, shards: 0, coin: 50 }, coinAllowance), 'Bank your coin first (up to 25 travels with you)');
  assert.equal(travelRefusal({ inFight: false, bounty: false, shards: 0, coin: 25 }, coinAllowance), null);
  assert.equal(travelRefusal({ inFight: false, bounty: false, shards: 0, coin: 0 }, coinAllowance), null);
});
