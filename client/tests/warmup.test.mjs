import assert from 'node:assert/strict';
import test from 'node:test';
import { DepthTexture, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, LOD, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, PointLight, Scene, ShaderMaterial, Texture, Vector4, WebGLRenderTarget } from 'three';
import { warm } from '../src/world/warmup.ts';

function renderer(onCompile = () => {}, onRender = () => {}) {
  return {
    target: { name: 'destination' }, viewport: new Vector4(3, 4, 80, 90), scissor: new Vector4(5, 6, 20, 30), scissorTest: true,
    textures: [], face: 2, mip: 1,
    initTexture(t) { this.textures.push(t); },
    getRenderTarget() { return this.target; },
    setRenderTarget(t, face = 0, mip = 0) { this.target = t; this.face = face; this.mip = mip; },
    getActiveCubeFace() { return this.face; }, getActiveMipmapLevel() { return this.mip; },
    getViewport(out) { return out.copy(this.viewport); },
    setViewport(...args) { args.length === 1 ? this.viewport.copy(args[0]) : this.viewport.set(...args); },
    getScissor(out) { return out.copy(this.scissor); }, setScissor(v) { this.scissor.copy(v); },
    getScissorTest() { return this.scissorTest; }, setScissorTest(v) { this.scissorTest = v; },
    compileAsync(scene) { onCompile(scene); return Promise.resolve(); },
    render(scene) { onRender(scene); },
  };
}

test('warm uploads material and uniform textures once, excluding render targets and depth', async () => {
  const scene = new Scene();
  const map = new Texture(), atlas = new Texture(), depth = new DepthTexture(1, 1);
  const target = new WebGLRenderTarget(2, 2);
  scene.add(new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ map })));
  scene.add(new Mesh(new PlaneGeometry(), new ShaderMaterial({ uniforms: {
    atlas: { value: atlas }, layers: { value: [map, atlas] }, depth: { value: depth }, output: { value: target.texture },
  } })));
  const r = renderer();
  await warm(r, scene, new PerspectiveCamera(), scene, target);
  assert.deepEqual(r.textures, [map, atlas]);
});

for (const fails of [false, true]) test(`warm draws hidden LODs and restores visibility and render state${fails ? ' on failure' : ''}`, async () => {
  const scene = new Scene(), lod = new LOD(), near = new Group(), far = new Group();
  near.visible = false;
  lod.addLevel(near, 0); lod.addLevel(far, 30); scene.add(lod);
  const target = new WebGLRenderTarget(2, 2);
  const r = renderer(() => {}, () => {
    assert.equal(near.visible, true); assert.equal(far.visible, true);
    assert.equal(lod.autoUpdate, false); assert.equal(lod.frustumCulled, false);
    assert.equal(r.target, target); assert.deepEqual(r.viewport.toArray(), [0, 0, 1, 1]);
    if (fails) throw new Error('draw failed');
  });
  const destination = r.target;
  const result = warm(r, scene, new PerspectiveCamera(), scene, target);
  if (fails) await assert.rejects(result, /draw failed/); else await result;
  assert.equal(near.visible, false); assert.equal(far.visible, true);
  assert.equal(lod.autoUpdate, true); assert.equal(lod.frustumCulled, true);
  assert.equal(r.target, destination); assert.deepEqual(r.viewport.toArray(), [3, 4, 80, 90]);
  assert.deepEqual(r.scissor.toArray(), [5, 6, 20, 30]); assert.equal(r.scissorTest, true);
  assert.equal(r.face, 2); assert.equal(r.mip, 1);
});

test('warm includes object lights once and restores detached parent order when compilation fails', async () => {
  const scene = new Scene(), parent = new Group(), before = new Group(), object = new Group(), after = new Group();
  parent.add(before, object, after); object.add(new PointLight());
  const r = renderer((compiled) => {
    let lights = 0; compiled.traverse((o) => { if (o.isLight) lights++; });
    assert.equal(lights, 1);
    throw new Error('compile failed');
  });
  const target = r.target;
  await assert.rejects(warm(r, scene, new PerspectiveCamera(), object, null), /compile failed/);
  assert.equal(object.parent, parent); assert.deepEqual(parent.children, [before, object, after]);
  assert.equal(r.target, target); assert.equal(scene.children.length, 0);
});

for (const fails of [false, true]) test(`warm draws inactive pools and restores their counts${fails ? ' on failure' : ''}`, async () => {
  const scene = new Scene();
  const particles = new InstancedMesh(new PlaneGeometry(), new MeshBasicMaterial(), 8);
  particles.count = 0;
  const empty = new InstancedMesh(new PlaneGeometry(), new MeshBasicMaterial(), 0);
  const quads = new InstancedBufferGeometry().copy(new PlaneGeometry());
  quads.setAttribute('offset', new InstancedBufferAttribute(new Float32Array(24), 3));
  quads.instanceCount = 0;
  const trail = new PlaneGeometry(); trail.setDrawRange(3, 0);
  scene.add(particles, empty, new Mesh(quads), new Mesh(trail));
  const r = renderer(() => {}, () => {
    assert.equal(particles.count, 1); assert.equal(empty.count, 0);
    assert.equal(quads.instanceCount, 1); assert.deepEqual(trail.drawRange, { start: 0, count: 3 });
    if (fails) throw new Error('draw failed');
  });
  const result = warm(r, scene, new PerspectiveCamera(), scene, null);
  if (fails) await assert.rejects(result, /draw failed/); else await result;
  assert.equal(particles.count, 0); assert.equal(quads.instanceCount, 0);
  assert.deepEqual(trail.drawRange, { start: 3, count: 0 });
});

test('a detached object stays outside the live scene while compilation is pending', async () => {
  const scene = new Scene(), parent = new Group(), object = new Group();
  parent.add(object);
  let complete;
  const r = renderer(() => {}, () => assert.equal(object.parent, scene));
  r.compileAsync = () => new Promise((resolve) => { complete = resolve; });
  const result = warm(r, scene, new PerspectiveCamera(), object, null);
  assert.equal(object.parent, parent);
  complete(); await result;
  assert.equal(object.parent, parent); assert.equal(scene.children.length, 0);
});
