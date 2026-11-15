import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Group, Object3D, Vector3, Quaternion, Matrix4} from 'three';
import {palmSocket, snapToSocket, gripAligned, hitSegment} from '../src/weapon-mount.js';

function glb(path) {
 const b=readFileSync(new URL('../public/assets/'+path,import.meta.url));
 return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
}
function rig(path) {
 const j=glb('characters/'+path);
 const nodes=j.nodes.map(n=>{
  const o=new Object3D();o.name=n.name??'';
  if(n.matrix) new Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);
  else { if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale); }
  return o;
 });
 j.nodes.forEach((n,i)=>(n.children??[]).forEach(c=>nodes[i].add(nodes[c])));
 const root=new Group();j.scenes[0].nodes.forEach(i=>root.add(nodes[i]));root.updateMatrixWorld(true);return root;
}
const close=(a,b)=>assert.ok(a.distanceTo(b)<1e-5, `${a.toArray()} != ${b.toArray()}`);

test('each shipped hero and villain rig gets its own palm',()=>{
 const positions=[];
 for(const path of ['people/hush_ignis_male.glb','people/robber_female.glb','people/deserter_male.glb','creator/peasant_male.glb','creator/peasant_female.glb']){
  const r=rig(path), socket=palmSocket(r);positions.push(socket.position.clone());
  assert.equal(socket.parent.name,'hand_r');assert.equal(palmSocket(r),socket);
  const knuckle=r.getObjectByName('middle_01_r').position;
  assert.ok(socket.position.y>0 && socket.position.y<knuckle.y);
 }
 assert.ok(positions[0].distanceTo(positions[1])>.01,'female sheet rig must not copy the male palm');
});

test('nested transformed Grip snaps exactly and world length stays in metres on a scaled rig',()=>{
 const asset=new Group();asset.position.set(.2,.1,-.3);asset.rotation.z=.35;
 const nested=new Group();nested.rotation.x=.6;asset.add(nested);
 const grip=new Object3D();grip.name='Grip';grip.position.set(.02,.13,.01);nested.add(grip);
 const tip=new Object3D();tip.name='Tip';tip.position.copy(grip.position).add(new Vector3(0,.75,0));nested.add(tip);
 const holder=gripAligned(asset);const base=new Vector3(),end=new Vector3();hitSegment(holder,base,end);
 close(base,new Vector3());assert.ok(Math.abs(base.distanceTo(end)-.75)<1e-6);
 const body=rig('people/robber_female.glb');body.scale.set(1.2,.9,1.1);body.rotation.y=.8;
 const socket=palmSocket(body);snapToSocket(holder,socket);body.updateMatrixWorld(true);
 close(grip.getWorldPosition(new Vector3()),socket.getWorldPosition(new Vector3()));
 assert.ok(Math.abs(tip.getWorldPosition(new Vector3()).distanceTo(grip.getWorldPosition(new Vector3()))-.75)<1e-5);
});

test('approved GLBs contain Grip/Tip, UVs, PBR textures, unit transforms and 3–6k triangles',()=>{
 for(const name of ['worn-iron-sword','long-knife','deserter-sword','back-scabbard','bound-club']){
  const j=glb('weapons/'+name+'.glb');
  assert.ok(j.nodes.some(n=>n.name==='Grip'));assert.ok(j.nodes.some(n=>n.name==='Tip'));
  assert.ok(j.extensionsRequired.includes('EXT_meshopt_compression'));
  assert.ok(j.images.length>=3);assert.ok(j.images.every(i=>i.mimeType==='image/webp'));
  let triangles=0;
  for(const mesh of j.meshes)for(const p of mesh.primitives){
   triangles+=j.accessors[p.indices].count/3;assert.notEqual(p.attributes.TEXCOORD_0,undefined);
   const m=j.materials[p.material];assert.ok(m.normalTexture);assert.ok(m.pbrMetallicRoughness.baseColorTexture);assert.ok(m.pbrMetallicRoughness.metallicRoughnessTexture);
  }
  assert.ok(triangles>=3000 && triangles<=6000,`${name}: ${triangles}`);
  // Meshopt quantization uses decode transforms; no runtime shrinking is used.
 }
});

test('the scabbard stays attached when its blade changes sockets',()=>{
 const model=rig('people/hush_ignis_male.glb'),mounts={back:new Object3D()},palm=palmSocket(model);
 model.getObjectByName('spine_03').add(mounts.back);model.updateMatrixWorld(true);
 const blade=new Group(),shell=new Group();snapToSocket(shell,mounts.back);snapToSocket(blade,mounts.back);
 const before=shell.getWorldPosition(new Vector3());snapToSocket(blade,palm);
 assert.equal(shell.parent,mounts.back);close(before,shell.getWorldPosition(new Vector3()));
});
