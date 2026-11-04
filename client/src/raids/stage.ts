import RAPIER from '@dimforge/rapier3d-compat';
import {
  ACESFilmicToneMapping, Color, DirectionalLight, FogExp2, Group, HalfFloatType, HemisphereLight, InstancedMesh, Matrix4,
  type Material, type Mesh, type MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import balance from '../../../shared/balance.json';
import { SANITIZE_SHADER } from '../env/postprocessing.js';
import { WorldBuilder, type Bucket } from '../world/builder.js';
import { createEmbers, createFires, createForgeMaterial, createLavaMaterial, createWindowMaterial, LightPool, nightness, worldTime } from '../world/effects.js';
import { SurfaceLibrary, type Surface } from '../world/materials.js';

/** One built place: its meshes, colliders, fires and lights, removable as a whole. */
export interface Place {
  group: Group;
  colliders: RAPIER.Collider[];
  pool: LightPool;
  dispose(): void;
}

/** Indoor stage: the Hall and the ruin are always lit by fire, so the clock stays at night. */
export class Stage {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly world: RAPIER.World;
  readonly low: boolean;
  private readonly lib: SurfaceLibrary;
  private readonly glows: Record<string, Material>;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly sun: DirectionalLight;
  private place: Place | null = null;
  private last = performance.now();
  readonly focus = new Vector3();
  private readonly ktx2: KTX2Loader;
  private readonly loader: GLTFLoader;
  private readonly propCache = new Map<string, Promise<Group | null>>();

  private constructor(canvas: HTMLCanvasElement, world: RAPIER.World, low: boolean) {
    this.low = low;
    this.world = world;
    nightness.value = 1;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.info.autoReset = false;
    (window as unknown as { elements?: Record<string, unknown> }).elements = { renderer: this.renderer };
    this.scene.background = new Color(0x050404);
    this.scene.fog = new FogExp2(0x0d0a08, 0.02);
    this.camera = new PerspectiveCamera(balance.camera.fov, 1, balance.camera.near, 400);
    const hemi = new HemisphereLight(0x8a8498, 0x3a2010, 1.7);
    this.scene.add(hemi);
    // A low warm key light for soft contact shadows under bodies and pillars.
    this.sun = new DirectionalLight(0xffb070, 0.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    const s = this.sun.shadow.camera;
    s.left = -24; s.right = 24; s.top = 24; s.bottom = -24; s.near = 1; s.far = 80;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.lib = new SurfaceLibrary(this.renderer, low ? '1k' : '2k');
    this.glows = { window: createWindowMaterial(), forge: createForgeMaterial(), lava: createLavaMaterial() };
    this.composer = new EffectComposer(this.renderer);
    this.composer.renderTarget1.texture.type = HalfFloatType;
    this.composer.renderTarget2.texture.type = HalfFloatType;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ShaderPass(SANITIZE_SHADER));
    this.bloom = new UnrealBloomPass(new Vector2(640, 360), 0.6, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(low ? new FXAAPass() : new SMAAPass());
    this.ktx2 = new KTX2Loader().setTranscoderPath('/assets/env/ignis/basis/').detectSupport(this.renderer);
    this.loader = new GLTFLoader().setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
  }

  static async create(canvas: HTMLCanvasElement, low: boolean): Promise<Stage> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -balance.controller.gravity, z: 0 });
    world.timestep = balance.controller.fixedStep;
    world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.05, 2000).setTranslation(0, -0.05, 0));
    return new Stage(canvas, world, low);
  }

  /** Replaces the current place with a freshly built one. */
  show(build: (b: WorldBuilder) => void): Place {
    this.place?.dispose();
    const b = new WorldBuilder();
    build(b);
    const group = b.build((bucket: Bucket) => this.glows[bucket] ?? this.lib.get(bucket as Surface));
    this.scene.add(group);
    const colliders = b.colliders.map((c) => this.world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z)
      .setRotation(c.q ?? { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) })));
    const fires = createFires(b.fires);
    const embers = createEmbers(b.embers, this.low ? 4 : 10);
    group.add(fires, embers);
    const pool = new LightPool(this.scene, b.emitters, this.low ? 5 : 9);
    void this.placeProps(b.props, group);
    this.world.step();
    const place: Place = {
      group, colliders, pool,
      dispose: () => {
        pool.dispose();
        for (const c of colliders) this.world.removeCollider(c, false);
        group.traverse((o) => { const m = o as Mesh; if (m.isMesh && !(m as unknown as InstancedMesh).isInstancedMesh) m.geometry.dispose(); });
        group.removeFromParent();
      },
    };
    this.place = place;
    return place;
  }

  private async placeProps(list: WorldBuilder['props'], into: Group): Promise<void> {
    const byId = new Map<string, WorldBuilder['props']>();
    for (const p of list) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
    await Promise.all([...byId].map(async ([id, places]) => {
      let pending = this.propCache.get(id);
      if (!pending) {
        pending = this.loader.loadAsync(`/assets/env/ignis/models/${id}${this.low ? '_low' : ''}.glb`).then((g) => { g.scene.updateMatrixWorld(true); return g.scene; }).catch(() => null);
        this.propCache.set(id, pending);
      }
      const source = await pending;
      if (!source) return;
      source.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const material = (id === 'iron_brazier' || id === 'anvil') ? this.lib.get('blackened_rusted_iron') : mesh.material as MeshStandardMaterial;
        const inst = new InstancedMesh(mesh.geometry, material, places.length);
        const m = new Matrix4();
        places.forEach((p, i) => {
          m.compose(new Vector3(p.x, p.y, p.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), p.yaw), new Vector3(p.scale, p.scale, p.scale));
          inst.setMatrixAt(i, m.multiply(mesh.matrixWorld));
        });
        inst.castShadow = true;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        into.add(inst);
      });
    }));
  }

  surface(s: Surface): MeshStandardMaterial { return this.lib.get(s); }

  setSize(w: number, h: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.info.reset();
    const now = performance.now();
    worldTime.value += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const f = this.focus;
    this.sun.target.position.set(f.x, 0, f.z);
    this.sun.position.set(f.x + 8, 30, f.z + 12);
    this.place?.pool.update(f, worldTime.value, this.camera);
    this.composer.render();
  }
}
