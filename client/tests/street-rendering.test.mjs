import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { BoxGeometry, MeshStandardMaterial, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { cellLods, seeded, WorldBuilder } from '../src/world/builder.ts';
import { surfaceColor } from '../src/world/materials.ts';
import { townHouse } from '../src/world/style-kit.ts';
import { createWaterMaterial } from '../src/world/effects.ts';
import { skyUniforms, WorldClock } from '../src/world/clock.ts';
import balance from '../../shared/balance.json' with { type: 'json' };

test('the rotated sun stays continuous at dusk and dawn', () => {
  const clock = new WorldClock(new URLSearchParams());
  const cfg = balance.world.dayNight;
  for (const boundary of [cfg.dayMinutes + cfg.duskMinutes, cfg.dayMinutes + cfg.duskMinutes + cfg.nightMinutes]) {
    clock.setMinute(boundary - 0.0001, 0);
    const before = skyUniforms.uSunDir.value.clone();
    clock.setMinute(boundary + 0.0001, 0);
    assert.ok(before.angleTo(skyUniforms.uSunDir.value) < 0.001, `continuous across minute ${boundary}`);
  }
});

test('the fresh canal and hot runnel compile separate water programs', () => {
  const hot = createWaterMaterial('hot'), fresh = createWaterMaterial('fresh');
  assert.notEqual(hot.customProgramCacheKey(), fresh.customProgramCacheKey());
  hot.dispose(); fresh.dispose();
});

test('batched plaster and produce keep their requested colour on both quality levels', () => {
  for (const low of [false, true]) {
    const b = new WorldBuilder({ low });
    for (const [i, surface] of ['ash_plaster', 'terracotta', 'moss', 'gold_trim'].entries()) b.box(surface, i * 2, 0, 0, 1, 1, 1);
    const scene = b.build(bucket => new MeshStandardMaterial({ color: surfaceColor(bucket), vertexColors: true }));
    for (const [i, surface] of ['ash_plaster', 'terracotta', 'moss', 'gold_trim'].entries()) {
      let actual;
      scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        const p = mesh.geometry.attributes.position, c = mesh.geometry.attributes.color;
        for (let j = 0; j < p.count; j++) if (Math.abs(p.getX(j) - i * 2) <= 0.51) {
          actual = mesh.material.color.clone();
          actual.r *= c.getX(j); actual.g *= c.getY(j); actual.b *= c.getZ(j);
          break;
        }
      });
      assert.ok(actual, `${surface}: surface was drawn`);
      const expected = surfaceColor(surface);
      for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(actual[channel] - expected[channel]) < 0.00001, `${surface}, ${low}: ${channel}`);
    }
    scene.traverse(mesh => { mesh.geometry?.dispose(); mesh.material?.dispose(); });
  }
});

test('a shop counter opens onto its interior instead of a solid facade', () => {
  const b = new WorldBuilder();
  townHouse(b, { x: 0, z: 0, y: 0, yaw: 0, w: 6, d: 6, floors: 2, rank: 'merchant', shop: true, weeds: false }, seeded(7));
  const scene = b.build(() => new MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const hits = new Raycaster(new Vector3(0, 2.1, 5), new Vector3(0, 0, -1)).intersectObject(scene, true);
  assert.ok(hits.length > 0);
  assert.ok(hits[0].distance > 3.3, `first visible surface is inside the shop: ${hits[0].distance}`);
  scene.traverse(mesh => { mesh.geometry?.dispose(); mesh.material?.dispose(); });
});

const glb = path => {const b=readFileSync(path);return {json:JSON.parse(b.subarray(20,20+b.readUInt32LE(12))),bin:b.subarray(28+b.readUInt32LE(12))};};
const triangles = j => j.meshes.reduce((n,m)=>n+m.primitives.reduce((n,p)=>n+j.accessors[p.indices].count/3,0),0);

test('offline crowd models preserve material references with fewer triangles and a valid reduced skeleton', async () => {
  await MeshoptDecoder.ready;
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
  const root = new URL('../public/assets/characters/creator/', import.meta.url);
  for (const file of readdirSync(new URL('far/', root)).filter(f=>f.endsWith('.glb'))) {
    const near=glb(new URL(file,root)).json, {json:far}=glb(new URL(`far/${file}`,root));
    assert.ok(triangles(far)<triangles(near)*0.35,file);
    assert.equal(far.skins[0].joints.length,21,file);
    const reachable=new Set(),visit=i=>{reachable.add(i);for(const c of far.nodes[i].children??[])visit(c);};
    for(const i of far.scenes[0].nodes)visit(i);
    assert.ok(far.skins[0].joints.every(i=>reachable.has(i)),`${file}: every joint is in the scene`);
    // Joint indices read through the meshopt decoder, as the game reads them.
    const doc=await io.read(new URL(`far/${file}`,root).pathname);
    for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
      const joints=p.getAttribute('JOINTS_0').getArray();
      assert.ok(joints.every(j=>j<far.skins[0].joints.length),`${file}: joint index`);
    }
  }
});

test('prop instances choose their own detail and disappearance distances inside a large batch', () => {
  const geometry=new BoxGeometry(),material=new MeshStandardMaterial();
  const near={geometry,material,castShadow:true,name:'near'},far={...near,name:'far'};
  const [batch]=cellLods([0,25,90,150].map(x=>({x,y:0,z:0,yaw:0,scale:1})),[{from:0,parts:[near]},{from:20,parts:[far]}],100,300);
  const camera=new PerspectiveCamera();camera.position.set(0,1,0);camera.updateMatrixWorld();batch.update(camera);
  assert.equal(batch.children[0].children[0].count,1);
  assert.equal(batch.children[1].children[0].count,2);
  camera.position.x=150;camera.updateMatrixWorld();batch.update(camera);
  assert.equal(batch.children[0].children[0].count,1);
  assert.equal(batch.children[1].children[0].count,1);
  camera.position.x=1000;camera.updateMatrixWorld();batch.update(camera);
  assert.ok(batch.children.every(g=>g.children.every(m=>!m.visible&&m.count===0)));
});
