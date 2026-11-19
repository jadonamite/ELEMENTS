import { Vector4, type BufferGeometry, type Camera, type InstancedBufferGeometry, type InstancedMesh, type LOD, type Material, type Mesh, type Object3D, type Scene, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three';

/** Resolves at the start of the next frame. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

let turns: Promise<unknown> = Promise.resolve();
let held: Promise<unknown> = Promise.resolve();
let holds = 0;
let compiling: Promise<unknown> = Promise.resolve();

/** Settles once every shader compile already handed to the GPU has finished; those cannot be paused. */
export function compilesSettled(): Promise<void> {
  return compiling.then(() => undefined, () => undefined);
}

/** Keeps `inTurn` work and warming waiting until `until` settles, so a timed scene on screen (the Drawing) plays without them. */
export function holdTurns(until: Promise<unknown>): void {
  holds++;
  const settled = until.catch(() => undefined).then(() => { holds--; });
  held = Promise.all([held, settled]);
}

/**
 * Runs heavy work that arrives during play (building a body, baking a far body, readying a model to draw) one
 * piece a frame, in the order asked, whichever system asked, so pieces arriving together never share a frame.
 * A task must not wait on another `inTurn` task.
 */
export function inTurn<T>(task: () => T | Promise<T>): Promise<T> {
  const turn = turns.then(() => held).then(nextFrame).then(task);
  turns = turn.catch(() => undefined);
  return turn;
}

/** Uploads textures, compiles materials and exercises the scene's depth and shadow passes before play. */
export async function warm(renderer: WebGLRenderer, scene: Scene, camera: Camera, object: Object3D,
  target: WebGLRenderTarget | null, onProgress?: (fraction: number) => void): Promise<void> {
  // Warming freezes the page for seconds at a time; it waits out a held scene like any `inTurn` work, between
  // each of its steps.
  if (holds > 0) await held;
  const textures = new Set<Texture>();
  const collect = (value: unknown): void => {
    if ((value as Texture | null)?.isTexture) {
      const texture = value as Texture;
      if (!texture.isRenderTargetTexture && !('isDepthTexture' in texture)) textures.add(texture);
    } else if (Array.isArray(value)) value.forEach(collect);
  };
  object.traverse((o) => {
    const material = (o as Mesh).material as Material | Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      Object.values(m).forEach(collect);
      const uniforms = (m as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
      if (uniforms) Object.values(uniforms).forEach((u) => collect(u.value));
    }
  });
  let slice = performance.now();
  let texIndex = 0;
  for (const t of textures) {
    renderer.initTexture(t);
    texIndex++;
    onProgress?.(0.35 * (texIndex / Math.max(1, textures.size)));
    if (performance.now() - slice > 8) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (holds > 0) await held;
      slice = performance.now();
    }
  }
  if (holds > 0) await held;

  const parent = object.parent;
  const index = parent?.children.indexOf(object) ?? -1;
  const attached = object === scene || isWithin(object, scene);
  let added = false;
  try {
    const was = renderer.getRenderTarget();
    const wasFace = renderer.getActiveCubeFace(), wasMip = renderer.getActiveMipmapLevel();
    let ready: Promise<unknown>;
    try {
      renderer.setRenderTarget(target);
      // Compile the scene once so lights within the object are not counted twice.
      ready = renderer.compileAsync(attached ? scene : object, camera, scene);
      compiling = Promise.all([compiling.catch(() => undefined), ready]);
    } finally {
      renderer.setRenderTarget(was, wasFace, wasMip);
    }
    await ready;
    if (holds > 0) await held;
    onProgress?.(0.8);
    if (!attached) { scene.add(object); added = true; }

    const instanceCounts = new Map<InstancedMesh, number>();
    const geometryCounts = new Map<InstancedBufferGeometry, number>();
    const drawRanges = new Map<BufferGeometry, { start: number; count: number }>();
    const states: Array<{ object: Object3D; visible: boolean; culled: boolean; autoUpdate?: boolean }> = [];
    object.traverse((o) => {
      const lod = o as LOD;
      states.push({ object: o, visible: o.visible, culled: o.frustumCulled, ...(lod.isLOD ? { autoUpdate: lod.autoUpdate } : {}) });
      o.visible = true;
      o.frustumCulled = false;
      if (lod.isLOD) lod.autoUpdate = false;
      // Empty pools still need a draw to prepare the driver's vertex bindings and pipeline.
      const mesh = o as InstancedMesh;
      if (mesh.isInstancedMesh && mesh.count === 0 && mesh.instanceMatrix.count > 0) {
        instanceCounts.set(mesh, mesh.count);
        mesh.count = 1;
      }
      const geometry = (o as Mesh).geometry as InstancedBufferGeometry | undefined;
      const vertices = geometry?.index?.count ?? geometry?.getAttribute('position')?.count ?? 0;
      if (geometry && vertices > 0) {
        if (geometry.isInstancedBufferGeometry && geometry.instanceCount === 0) {
          geometryCounts.set(geometry, geometry.instanceCount);
          geometry.instanceCount = 1;
        }
        if (geometry.drawRange.count === 0) {
          drawRanges.set(geometry, { ...geometry.drawRange });
          geometry.setDrawRange(0, Math.min(3, vertices));
        }
      }
    });
    const destination = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const viewport = renderer.getViewport(new Vector4());
    const scissor = renderer.getScissor(new Vector4());
    const scissorTest = renderer.getScissorTest();
    try {
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, 1, 1);
      renderer.setScissorTest(false);
      // Passes that draw only when needed (soft depth) draw now, so their programs are made too.
      scene.userData.warming = true;
      renderer.render(scene, camera);
      onProgress?.(1.0);
    } finally {
      scene.userData.warming = false;
      for (const [mesh, count] of instanceCounts) mesh.count = count;
      for (const [geometry, count] of geometryCounts) geometry.instanceCount = count;
      for (const [geometry, range] of drawRanges) geometry.setDrawRange(range.start, range.count);
      for (const state of states) {
        state.object.visible = state.visible;
        state.object.frustumCulled = state.culled;
        if (state.autoUpdate !== undefined) (state.object as LOD).autoUpdate = state.autoUpdate;
      }
      renderer.setRenderTarget(destination, face, mip);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
    }
  } finally {
    if (added) {
      object.removeFromParent();
      if (parent) {
        parent.add(object);
        parent.children.splice(parent.children.indexOf(object), 1);
        parent.children.splice(index, 0, object);
      }
    }
  }
}

function isWithin(object: Object3D, scene: Scene): boolean {
  for (let p = object.parent; p; p = p.parent) if (p === scene) return true;
  return false;
}
