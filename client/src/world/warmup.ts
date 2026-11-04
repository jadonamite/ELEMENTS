import type { Camera, Material, Mesh, Object3D, Scene, Texture, WebGLRenderer, WebGLRenderTarget } from 'three';

/**
 * Gets an object ready to draw before it is first seen: uploads its textures and compiles its programs
 * against the scene it will join and the target it is drawn into (lights, fog, shadows, and the target's colour
 * space and tone mapping all decide the program). Whatever can
 * appear in the middle of play (villains, props that load late, effects) passes through here first, so
 * its first frame on screen costs no more than any other.
 */
export async function warm(renderer: WebGLRenderer, scene: Scene, camera: Camera, object: Object3D,
  target: WebGLRenderTarget | null): Promise<void> {
  const textures = new Set<Texture>();
  object.traverse((o) => {
    const material = (o as Mesh).material as Material | Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(m)) if ((value as Texture | null)?.isTexture) textures.add(value as Texture);
    }
  });
  for (const t of textures) renderer.initTexture(t);
  // Programs are made when compileAsync is called; the wait after is only for the driver to finish them.
  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  const ready = renderer.compileAsync(object, camera, scene);
  renderer.setRenderTarget(was);
  await ready;
}
