import test from 'node:test';
import assert from 'node:assert/strict';
import { SINDR_ANCHORS } from '../src/world/ignis/sindr.js';
import { cellId, CITY_ORIGIN, LEGACY_SINDR_ORIGIN, placeId, regionFor, toGlobal, toLocal, withinLocalBounds } from '../src/world/ignis/coordinates.js';
import { validateAnchors, validateWater, type WaterReach } from '../src/world/ignis/validate.js';
import { atPlace, SINDR_COUNTING_HOUSES, SINDR_SPAWN, SINDR_STALLS } from '../src/net/places.js';

test('one manifest preserves account IDs and matches counting-house entrance reach', () => {
  assert.deepEqual(validateAnchors(SINDR_ANCHORS), []);
  assert.deepEqual(SINDR_COUNTING_HOUSES, [{id:'ch_ignis_sindr_upper',x:119.7,z:-43},{id:'ch_ignis_sindr_lower',x:130.3,z:-43}]);
  // Fifteen keepers trade in Sindr: the three market stalls, the yard stall and eleven counters.
  assert.deepEqual(SINDR_STALLS.map(a=>a.id), ['sindr_shards','sindr_supplies','sindr_arms','sindr_loom','sindr_whetstone','sindr_packs','sindr_potter','sindr_anvil','sindr_coal','sindr_crimson','sindr_scales','sindr_cork','sindr_tally','sindr_wick','sindr_bright']);
  assert.deepEqual(SINDR_SPAWN,{x:8,y:0,z:0,facing:Math.PI/2});
  for (const h of SINDR_COUNTING_HOUSES) assert.equal(atPlace(h,h.x,h.z,0),true);
  assert.equal(atPlace(SINDR_COUNTING_HOUSES[0]!,125,-14),false);
  assert.equal(atPlace(SINDR_COUNTING_HOUSES[1]!,60,6),false);
});

test('validator rejects duplicate institution IDs and missing entrance', () => {
  const house=SINDR_ANCHORS.find(a=>a.institution)!;
  assert.match(validateAnchors([house,{...house,id:'other'}]).join(),/Duplicate institution/);
  const {door,...missing}=house;
  assert.match(validateAnchors([missing]).join(),/entrance/);
});

test('nation corners, altitude bands and negative coordinates round trip within local bounds', () => {
  for (const p of [{x:0,y:0,z:0},{x:16000,y:1850,z:18000},{x:-1,y:-1,z:-1},{x:2000,y:800,z:2000}]) {
    const region=regionFor(p), local=toLocal(p,region.origin);
    assert.equal(withinLocalBounds(local),true);
    assert.deepEqual(toGlobal(local,region.origin),p);
  }
  assert.equal(cellId({x:-1,y:0,z:256}),'ignis:cell:-1:1');
  assert.equal(regionFor({x:2000,y:800,z:2000}).id,'ignis:region:1:1:1');
  assert.equal(placeId('counting_house_w'),'ignis:sindr:counting_house_w');
  assert.deepEqual(toGlobal({x:125,y:0,z:0},LEGACY_SINDR_ORIGIN),toGlobal({x:450,y:380,z:350},CITY_ORIGIN));
  assert.equal(withinLocalBounds({x:5000,y:500,z:-5000}),true);
  assert.equal(withinLocalBounds({x:5001,y:0,z:0}),false);
  assert.equal(withinLocalBounds({x:0,y:NaN,z:0}),false);
  assert.throws(()=>regionFor({x:Infinity,y:0,z:0}));
});

test('water validator rejects reversed flow, zero depth, bad joins, kinds and cycles', () => {
  const reach:WaterReach={id:'market',source:'north_feeder',kind:'fresh',samples:[{x:320,z:318,surface:378,bed:377},{x:680,z:318,surface:374,bed:373}]};
  assert.deepEqual(validateWater([reach]),[]);
  assert.match(validateWater([{...reach,samples:[...reach.samples].reverse()}]).join(),/rises/);
  assert.match(validateWater([{...reach,samples:reach.samples.map(p=>({...p,bed:p.surface}))}]).join(),/depth/);
  assert.match(validateWater([{...reach,downstream:'missing'}]).join(),/Missing downstream/);
  const next:WaterReach={...reach,id:'tail',kind:'lava'};
  assert.match(validateWater([{...reach,downstream:'tail'},next]).join(),/Disconnected.*Contradictory/);
  assert.match(validateWater([{...reach,downstream:'market'}]).join(),/cycle/);
});
