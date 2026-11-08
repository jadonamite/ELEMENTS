import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { CrowdOcclusion, hidesHero } from '../src/life/occlusion.ts';

test('only bodies between the camera and the hero on the same visible height fade',()=>{
  const eye=new Vector3(0,1.6,-3.4),hero=new Vector3();
  assert.ok(hidesHero(eye,hero,new Vector3(0,0,-1.5)));
  for(const at of [new Vector3(2,0,-1.5),new Vector3(0,0,2),new Vector3(0,0,-4),new Vector3(0,3,-1.5),new Vector3(0,-3,-1.5)])assert.ok(!hidesHero(eye,hero,at),at.toArray().join(','));
  assert.ok(!hidesHero(new Vector3(0,8,-3),hero,new Vector3(0,0,-2)), 'a high camera sees over a standing body');
});

test('fade preserves skin hooks and opaque depth, is independent per person, then restores',()=>{
  const original=new MeshStandardMaterial();original.onBeforeCompile=s=>{s.fragmentShader+='\n// skin';};original.customProgramCacheKey=()=> 'skin';
  const make=()=>{const g=new Group();g.add(new Mesh(new BoxGeometry(),original));return g;};
  const a=make(),b=make(),fade=new CrowdOcclusion();fade.attach(a);
  const shader={uniforms:{},fragmentShader:'#include <alphatest_fragment>'};a.children[0].material.onBeforeCompile(shader,{});
  assert.ok(shader.fragmentShader.includes('// skin'));assert.ok(shader.fragmentShader.includes('crowdThreshold'));
  assert.equal(a.children[0].material.transparent,false);assert.equal(a.children[0].material.depthWrite,true);
  assert.equal(b.children[0].material,original);assert.notEqual(a.children[0].material,original);
  for(let i=0;i<30;i++)fade.update(true,1/60);assert.ok(fade.uniform.value<0.05);
  for(let i=0;i<90;i++)fade.update(false,1/60);assert.ok(fade.uniform.value>0.999);
  assert.equal(shader.uniforms.uCrowdVisible,fade.uniform);fade.dispose();
});
