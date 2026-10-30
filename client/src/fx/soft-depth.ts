import { DepthTexture, MeshDepthMaterial, Vector2, Vector4, WebGLRenderTarget, type Group, type Scene } from 'three';

/** Captures opaque scene depth before effects, including animated bodies. */
export class SoftDepth {
  readonly uniforms = {
    uSceneDepth: { value: null as DepthTexture | null },
    uViewport: { value: new Vector2(1, 1) },
    uNearFar: { value: new Vector2(0.1, 100) },
    uSoftReady: { value: 0 },
  };
  private readonly target = new WebGLRenderTarget(1, 1);
  private readonly material = new MeshDepthMaterial();
  private readonly previous: Scene['onBeforeRender'];
  private readonly hook: Scene['onBeforeRender'];
  private busy = false;
  private scale = 0.5;

  constructor(private readonly scene: Scene, root: Group) {
    this.target.depthTexture = new DepthTexture(1, 1);
    this.previous = scene.onBeforeRender;
    this.hook = (renderer, currentScene, camera, geometry, material, group) => {
      if (this.busy) return;
      this.previous.call(scene, renderer, currentScene, camera, geometry, material, group);
      const destination = renderer.getRenderTarget();
      const size = destination ? new Vector2(destination.width, destination.height) : renderer.getDrawingBufferSize(new Vector2());
      const width = Math.max(1, Math.round(size.x * this.scale));
      const height = Math.max(1, Math.round(size.y * this.scale));
      if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
      this.uniforms.uViewport.value.copy(size);
      const lens = camera as typeof camera & { near: number; far: number };
      this.uniforms.uNearFar.value.set(lens.near, lens.far);
      const override = scene.overrideMaterial;
      const background = scene.background;
      const visible = root.visible;
      const viewport = renderer.getViewport(new Vector4());
      const scissor = renderer.getScissor(new Vector4());
      const scissorTest = renderer.getScissorTest();
      const shadows = renderer.shadowMap.autoUpdate;
      const autoClear = renderer.autoClear;
      this.busy = true;
      try {
        root.visible = false;
        scene.overrideMaterial = this.material;
        scene.background = null;
        renderer.shadowMap.autoUpdate = false;
        renderer.autoClear = true;
        renderer.setRenderTarget(this.target);
        renderer.setScissorTest(false);
        renderer.render(scene, camera);
        this.uniforms.uSceneDepth.value = this.target.depthTexture;
        this.uniforms.uSoftReady.value = 1;
      } finally {
        renderer.setRenderTarget(destination);
        renderer.setViewport(viewport);
        renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest);
        renderer.shadowMap.autoUpdate = shadows;
        renderer.autoClear = autoClear;
        scene.overrideMaterial = override;
        scene.background = background;
        root.visible = visible;
        this.busy = false;
      }
    };
    scene.onBeforeRender = this.hook;
  }

  setQuality(low: boolean): void { this.scale = low ? 0.3 : 0.5; }

  dispose(): void {
    if (this.scene.onBeforeRender === this.hook) this.scene.onBeforeRender = this.previous;
    this.target.dispose();
    this.material.dispose();
  }
}
