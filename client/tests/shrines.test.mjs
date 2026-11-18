import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRST_SHRINE, LEGACY_SINDR_ORIGIN, SHRINES, shrineById, shrineTravel, isOutlawKind, shardCount } from '../../shared/src/index.js';
import { ShrineState } from '../src/shrine-state.ts';

test('ShrineState begins with Shrine of Embers lit', () => {
  const state = new ShrineState();
  assert.ok(state.isLit(FIRST_SHRINE));
  assert.equal(state.lit.size, 1);
});

test('ShrineState: reaching an unlit shrine lights it outside a fight, notices, and updates wake spot', () => {
  const notices = [];
  let changes = 0;
  const state = new ShrineState({
    onNotice: (msg) => notices.push(msg),
    onChange: () => { changes++; },
  });

  const pinewatch = SHRINES.find(s => s.name === 'Pinewatch Shrine');
  assert.ok(pinewatch);

  // Pinewatch scene position = global minus origin
  const sceneX = pinewatch.x - LEGACY_SINDR_ORIGIN.x;
  const sceneZ = pinewatch.z - LEGACY_SINDR_ORIGIN.z;

  // Mid fight: does not light
  state.update(0.6, { x: sceneX, z: sceneZ }, true, false);
  assert.ok(!state.isLit(pinewatch.id));

  // Online the room lights shrines, not the browser
  state.update(0.6, { x: sceneX, z: sceneZ }, false, true);
  assert.ok(!state.isLit(pinewatch.id));

  // Outside a fight: lights it, once
  state.update(0.6, { x: sceneX, z: sceneZ }, false, false);
  assert.ok(state.isLit(pinewatch.id));
  state.update(0.6, { x: sceneX, z: sceneZ }, false, false);
  assert.deepEqual(notices, ['Pinewatch Shrine lit']);
  assert.ok(changes >= 1);

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

test('settlement shrines stand clear of the lane, the repair room and the houses', async () => {
  const { SETTLEMENT_PRECINCTS } = await import('../../shared/src/world/ignis/settlements.js');
  const ringRadius = 3;
  for (const place of SETTLEMENT_PRECINCTS) {
    const shrine = SHRINES.find(s => s.precinct === place.id);
    assert.ok(shrine, place.id);
    const x = shrine.x - place.x, z = shrine.z - place.z;
    // The six-metre lane, and the 14 x 11 repair room at z -69.
    assert.ok(Math.abs(x) - ringRadius > 3, `${place.id} on the lane`);
    assert.ok(Math.abs(x) - ringRadius > 7 || Math.abs(z + 69) - ringRadius > 5.5, `${place.id} in the repair room`);
    for (const h of place.houses) {
      const clear = Math.abs(x - h.x) - ringRadius > h.d / 2 || Math.abs(z - h.z) - ringRadius > h.w / 2;
      assert.ok(clear, `${place.id} in a house`);
    }
    // The wake spot is off the plinth and within reach to light the shrine again.
    const wake = Math.hypot(shrine.wake.x - shrine.x, shrine.wake.z - shrine.z);
    assert.ok(wake > 1.8 && wake <= 6, `${place.id} wake ${wake}`);
  }
});

test('shrine travel: from a lit shrine to another lit one, by the same rules everywhere', () => {
  const pinewatch = SHRINES.find(s => s.name === 'Pinewatch Shrine');
  const embers = shrineById(FIRST_SHRINE);
  const calm = { inFight: false, bounty: false, shards: 0, coin: 10 };
  const lit = [pinewatch.id];
  assert.deepEqual(shrineTravel(lit, embers.x, embers.z, pinewatch.id, calm, 25).ok, true);
  assert.equal(shrineTravel(lit, embers.x + 40, embers.z, pinewatch.id, calm, 25).error, 'Stand at a lit shrine to travel');
  assert.equal(shrineTravel([], embers.x, embers.z, pinewatch.id, calm, 25).error, 'You have not lit that shrine');
  assert.equal(shrineTravel(lit, pinewatch.x, pinewatch.z, pinewatch.id, calm, 25).error, 'You are already here');
  assert.equal(shrineTravel(lit, embers.x, embers.z, pinewatch.id, { ...calm, shards: 1 }, 25).error, 'Shards travel by road: bank them or carry them');
  assert.equal(shardCount({ shard_ignis: 2, shard_aura: 1, material_linen: 4, potion: 1 }), 3);
});

test('killers: beasts are nobody\'s hand, every villain body is an outlaw', () => {
  for (const kind of ['hound', 'bull']) assert.equal(isOutlawKind(kind), false, kind);
  for (const kind of ['brawler', 'armed', 'bender', 'husk', 'robber', 'deserter']) assert.equal(isOutlawKind(kind), true, kind);
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
      pileId: 'pile_1',
      title: 'Taken by an outlaw',
      getPosition: () => ({ x: 10, y: 0, z: 20 }),
      expiresAt: Date.now() + 600000,
      onExpired: () => { expiredCalled = true; },
    });

    assert.ok(marker.activeDropTarget);
    assert.equal(marker.activeDropTarget.title, 'Taken by an outlaw');

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
