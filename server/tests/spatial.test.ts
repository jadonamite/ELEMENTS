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
