import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerPlayer } from '../src/net/world.js';

const who = { accountId: 'spatial_test', role: 'Shaper' as const, element: 'IGNIS' as const };
const report = (x: number, y: number, z: number) => ({x,y,z,vx:0,vz:0,f:0,t:0,r:1});

test('server preserves the inclusive local envelope before the initial warp and rejects outside/nonfinite values', () => {
  for (const [x,y,z,ok] of [
    [5000,500,-5000,true],[-5000,-500,5000,true],
    [5000.001,0,0,false],[0,500.001,0,false],[0,0,-5000.001,false],
    [NaN,0,0,false],[0,Infinity,0,false],
  ] as const) {
    const p = new ServerPlayer('p',who,{x:8,z:0},0);
    assert.equal(p.move(report(x,y,z),0),ok,`${x},${y},${z}`);
    if (!ok) assert.deepEqual([p.x,p.y,p.z],[8,0,0]);
  }
});

test('every national road, settlement and wild place can be walked region by region under server rules', async () => {
  const { regionFor } = await import('@elements/shared');
  const { NATIONAL_ROUTES } = await import('../../shared/src/world/ignis/routes.js');
  const { SETTLEMENT_PRECINCTS } = await import('../../shared/src/world/ignis/settlements.js');
  const { WILD_PLACES } = await import('../../shared/src/world/ignis/wild.js');
  const { CRATER } = await import('../../shared/src/world/ignis/ground.js');
  const { adjacentRegions, nationalRegion, networkPosition, regionContains } = await import('../src/net/coordinates.js');
  const regionAt = (p: { x: number; y: number; z: number }) => nationalRegion(regionFor(p).id);
  let crossings = 0;
  for (const road of NATIONAL_ROUTES) {
    const first = road.points[0]!;
    let region = regionAt(first), now = 0;
    assert.ok(region, `${road.id} starts outside every region`);
    const player = new ServerPlayer('p', who, { x: 0, z: 0 }, 0);
    player.enterRegion(region, networkPosition(region.id, first), 0);
    for (const point of road.points) {
      now += 1; // a walker covers one 8 m station a second, well inside the speed check
      const next = regionAt(point);
      assert.ok(next, `${road.id} leaves the regions at ${point.s.toFixed(0)}`);
      if (next.id !== region.id) {
        // The crossing point is inside both owners' overlap, and the two regions touch.
        assert.ok(adjacentRegions(region, next), `${road.id} jumps regions at ${point.s.toFixed(0)}`);
        assert.ok(regionContains(region, networkPosition(region.id, point)), `${road.id} seam at ${point.s.toFixed(0)}`);
        player.enterRegion(next, networkPosition(next.id, point), now);
        region = next; crossings++;
      }
      const local = networkPosition(region.id, point);
      assert.ok(player.move(report(local.x, local.y, local.z), now), `${road.id} refused at ${point.s.toFixed(0)}`);
    }
  }
  assert.ok(crossings > 40, `only ${crossings} crossings`);
  for (const place of [...SETTLEMENT_PRECINCTS, ...WILD_PLACES, { x: CRATER.x, z: CRATER.z, height: CRATER.floor }, { x: 12000, z: 4000, height: 1850 }]) {
    const p = { x: place.x, y: place.height, z: place.z }, region = regionAt(p);
    assert.ok(region && regionContains(region, networkPosition(region.id, p)), `${place.x},${place.z}`);
  }
});
