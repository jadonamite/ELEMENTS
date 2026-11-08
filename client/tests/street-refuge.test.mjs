import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Scene, Vector3 } from 'three';
import { makeCrowd } from '../src/life/crowd.ts';
import { TownManager, SINDR_WALK } from '../src/life/town-manager.ts';
import { townWorld } from './town-world.mjs';

let world;
test.before(async()=>{world=await townWorld();});
test.after(()=>world.world.free());

test('townsfolk leave the fight, hold reachable cover and return after a quiet interval', async()=>{
  const {looks,people}=makeCrowd(8,1);
  const manager=new TownManager(new Scene(),world.space,()=>0.5);
  await manager.init(new Map(looks.map(l=>[l.id,{model:new Group(),clips:[]}])),people,[],SINDR_WALK,world.builder.browse,world.builder.posts);
  const starts=[[106,1],[109,-1],[111,2],[115,1],[117,-1],[119,0],[122,1],[124,-1]];
  manager.townsfolk.forEach((p,i)=>{p.position.set(starts[i][0],0,starts[i][1]);p.path=[];p.rest=100;});
  const threats=[new Vector3(114,0,0),new Vector3(116,0,0)],hero=new Vector3(114,0,0);
  const samples=[];
  for(let frame=0;frame<900;frame++){
    manager.update(1/60,6,hero,threats);
    for(const p of manager.townsfolk){
      const a=p.position.clone().setY(p.position.y+1),b=a.clone().setX(a.x+0.01);
      assert.ok(world.space.clear(a,b,0.3),'the fleeing body stays out of walls');
    }
  }
  const sheltered=manager.townsfolk.filter(p=>p.shelter&&!p.path.length);
  assert.ok(sheltered.length>=6,`${sheltered.length}/8 reached cover`);
  assert.ok(manager.townsfolk.every(p=>p.fleeing),'hold the alarm after leaving its original radius');
  const before=sheltered.map(p=>p.position.clone());
  for(let f=0;f<120;f++)manager.update(1/60,6,hero,threats);
  assert.ok(sheltered.every((p,i)=>p.position.distanceTo(before[i])<0.7),'watch from cover rather than running indefinitely');
  for(let f=0;f<120;f++)manager.update(1/60,6,hero,[]);
  assert.ok(manager.townsfolk.every(p=>p.fleeing),'a brief pause does not recall the crowd');
  for(let f=0;f<100;f++)manager.update(1/60,6,hero,[]);
  assert.ok(manager.townsfolk.every(p=>!p.fleeing&&!p.cowering&&!p.shelter),'alarm ends after three quiet seconds');
  assert.ok(manager.townsfolk.every((p,i)=>p.targetPosition.distanceTo(new Vector3(starts[i][0],0,starts[i][1]))<0.1),'wanderers return to their original places');
  manager.dispose();
});

test('danger-aware path straightening does not send someone back through the fight',()=>{
  const from=new Vector3(105,0,0),to=new Vector3(123,0,0),danger=[new Vector3(114,0,0)];
  const route=world.map.route(from,to,danger,3);
  assert.ok(route.length>0,'there is a route round the fight');
  let previous=from;
  for(const next of route){for(let t=0;t<=1;t+=0.02){const at=previous.clone().lerp(next,t);assert.ok(at.distanceTo(danger[0])>=2.85,'every smoothed segment avoids the fight');}previous=next;}
});

test('a worker returns to the schedule that is current when the fight ends, facing their work', async()=>{
  const {looks,people}=makeCrowd(1,1);
  const worker={...people[0],wander:false,schedule:{work:{x:108,y:0,z:1,facing:0},...Object.fromEntries(['home','inn','market'].map(k=>[k,{x:129,y:0,z:0,facing:0.7}]))}};
  const manager=new TownManager(new Scene(),world.space,()=>0.5);
  await manager.init(new Map([[looks[0].id,{model:new Group(),clips:[]}]]),[worker],[],SINDR_WALK,world.builder.browse,world.builder.posts);
  const hero=new Vector3(114,0,0),threats=[hero];
  for(let i=0;i<400;i++)manager.update(1/60,6,hero,threats);
  assert.ok(manager.townsfolk[0].fleeing);
  for(let i=0;i<200;i++)manager.update(1/60,14,hero,[]);
  const person=manager.townsfolk[0];
  assert.ok(!person.fleeing);
  assert.ok(person.targetPosition.distanceTo(new Vector3(129,0,0))<1.6);
  assert.equal(person.targetFacing,0.7);
  manager.dispose();
});
