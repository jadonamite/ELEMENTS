import RAPIER from '@dimforge/rapier3d-compat';
import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HalfFloatType,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type MeshStandardMaterial,
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
import type { PhysicsWorld } from '../physics.js';
import { WorldBuilder, type Bucket } from './builder.js';
import { createEmbers, createFires, createForgeMaterial, createLavaMaterial, createSmoke, createWindowMaterial, LightPool, nightness, worldTime } from './effects.js';
import { createSky, fieldMesh, heightAt, sampleField, slopeBlend } from './landscape.js';
import { SurfaceLibrary, type Surface } from './materials.js';
import { buildSindr, PEAKS, WALKABLE } from './sindr.js';

export { SPAWN } from './sindr.js';

export interface Zone {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  physics: PhysicsWorld;
  /** The point the shadows and the nearest lights follow, usually the hero. */
  follow(point: Vector3): void;
  setSize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

/** Grade: lift the shadows toward cool soot, warm the highlights, a soft vignette. */
const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.32 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.92, 0.96, 1.06);
      vec3 highTint = vec3(1.06, 1.0, 0.92);
      c.rgb *= mix(shadowTint, highTint, smoothstep(0.05, 0.6, l));
      c.rgb = mix(vec3(l), c.rgb, 1.08);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

export async function createZone(canvas: HTMLCanvasElement): Promise<Zone> {
  const low = new URLSearchParams(window.location.search).get('fxQuality') === 'low';
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.info.autoReset = false;
  const win = window as unknown as { elements?: { renderer?: WebGLRenderer } };
  win.elements = { ...(win.elements ?? {}), renderer };

  const scene = new Scene();
  const fogColor = new Color(0x2a1f1c);
  scene.fog = new FogExp2(fogColor, 0.0042);
  const camera = new PerspectiveCamera(balance.camera.fov, 1, balance.camera.near, 2600);

  // Sky first: it also lights the town through a prefiltered environment map.
  const sky = createSky();
  scene.add(sky);
  const pmrem = new PMREMGenerator(renderer);
  const skyScene = new Scene();
  const skyCopy = createSky();
  skyScene.add(skyCopy);
  const envTarget = pmrem.fromScene(skyScene, 0, 0.1, 2000);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 1.0;
  skyCopy.geometry.dispose();
  pmrem.dispose();

  // Low sun in the west under the soot deck; the town's fires do the rest.
  const sun = new DirectionalLight(0xff9a5a, 2.6);
  const sunDir = new Vector3(-0.82, 0.3, 0.48).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  const s = sun.shadow.camera;
  s.left = -45; s.right = 45; s.top = 45; s.bottom = -45; s.near = 1; s.far = 260;
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new HemisphereLight(0x6a5a62, 0x2a1a12, 0.9);
  scene.add(hemi);

  // Physics: a floor under everything, then the land and the town's solids.
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -balance.controller.gravity, z: 0 });
  world.timestep = balance.controller.fixedStep;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.05, 2000).setTranslation(0, -0.05, 0));

  const lib = new SurfaceLibrary(renderer, low ? '1k' : '2k');
  const ground = (x: number, z: number): number => heightAt(x, z, WALKABLE, PEAKS);

  // Near land: walkable flats, banks and hills, matched by a physics heightfield.
  const near = sampleField(110, -40, 560, 480, low ? 3 : 2, ground);
  const terrainMat = slopeBlend(lib.get('ash_cinder_ground'), lib.get('basalt_rock_face'));
  const terrain = fieldMesh(near, terrainMat);
  terrain.name = 'terrain';
  scene.add(terrain);
  world.createCollider(RAPIER.ColliderDesc.heightfield(near.nz, near.nx, near.heights, { x: near.width, y: 1, z: near.depth })
    .setTranslation(near.cx, 0, near.cz));

  // Far ranges and the volcano, coarse and lost in the haze.
  const volcano = { x: 380, z: -720, radius: 260, height: 330 };
  const far = sampleField(110, -40, 3200, 3200, low ? 40 : 25, (x, z) => {
    const inner = Math.max(Math.abs(x - 110) / 260, Math.abs(z + 40) / 220);
    const edge = Math.min(1, Math.max(0, (inner - 1) / 0.6));
    const range = edge * (60 + 120 * Math.pow(Math.max(0, Math.sin(x * 0.004 + 1.3) * Math.cos(z * 0.003)), 2))
      * (0.5 + heightAt(x * 0.7 + 900, z * 0.7 + 900, { distance: () => 80 }, []) / 50);
    const r = Math.hypot(x - volcano.x, z - volcano.z) / volcano.radius;
    const cone = r < 1 ? volcano.height * (1 - Math.pow(r, 0.85)) - (r < 0.12 ? (0.12 - r) * 500 : 0) : 0;
    return Math.max(range, cone, -5) - (inner < 1 ? 30 : 0);
  });
  const farMesh = fieldMesh(far, terrainMat);
  farMesh.castShadow = false;
  farMesh.name = 'far';
  scene.add(farMesh);

  // The town.
  const builder = new WorldBuilder();
  buildSindr(builder, ground);
  const glows: Record<string, Material> = { window: createWindowMaterial(), forge: createForgeMaterial(), lava: createLavaMaterial() };
  const town = builder.build((bucket: Bucket) => glows[bucket] ?? lib.get(bucket as Surface));
  scene.add(town);
  for (const c of builder.colliders) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z)
      .setRotation({ x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }));
  }
  world.step();

  // The volcano's crater glow and plume.
  const crater = new Mesh(new CircleGeometry(30, 24).rotateX(-Math.PI / 2), glows.lava);
  crater.position.set(volcano.x, volcano.height - 50, volcano.z);
  scene.add(crater);

  const fires = createFires(builder.fires);
  const smokeSources = [...builder.chimneys, new Vector3(volcano.x, volcano.height - 40, volcano.z)];
  const smoke = createSmoke(smokeSources, low ? 6 : 10);
  const embers = createEmbers(builder.embers, low ? 6 : 14);
  scene.add(fires, smoke, embers);
  const plume = createSmoke(Array.from({ length: 8 }, (_, i) => new Vector3(volcano.x + (i - 4) * 12, volcano.height - 60, volcano.z)), 8);
  plume.scale.setScalar(1);
  (plume.material as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms.uColor!.value = new Color(0x1a1614);
  scene.add(plume);

  const pool = new LightPool(scene, builder.emitters, low ? 4 : 8);

  // Kit models placed as instances, one draw call per model part.
  const props = new Group();
  scene.add(props);
  void loadProps(renderer, builder.props, props, low, lib.get('blackened_rusted_iron'));

  // Post: sanitize first (stops NaN black frames), bloom for fire and slag, grade, then anti-aliasing.
  const composer = new EffectComposer(renderer);
  composer.renderTarget1.texture.type = HalfFloatType;
  composer.renderTarget2.texture.type = HalfFloatType;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(SANITIZE_SHADER));
  const bloom = new UnrealBloomPass(new Vector2(640, 360), 0.55, 0.6, 0.85);
  composer.addPass(bloom);
  composer.addPass(new ShaderPass(GRADE_SHADER));
  composer.addPass(new OutputPass());
  const aa = low ? new FXAAPass() : new SMAAPass();
  composer.addPass(aa);

  const focus = new Vector3();
  let last = performance.now();
  let followed: Vector3 | null = null;

  return {
    scene, camera, renderer,
    physics: { world, step: () => world.step(), dispose: () => world.free() },
    follow(point) { followed = point; },
    setSize(w, h) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.resolution.set(w / 2, h / 2);
    },
    render() {
      renderer.info.reset();
      const now = performance.now();
      worldTime.value += Math.min(0.1, (now - last) / 1000);
      last = now;
      if (followed) focus.copy(followed);
      // The shadow box follows the hero, snapped to texels so edges do not crawl.
      const texel = 90 / sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx, 0, fz).addScaledVector(sunDir, 120);
      pool.update(focus, worldTime.value, camera);
      sky.position.copy(camera.position);
      hemi.intensity = 1.0 - 0.4 * nightness.value;
      composer.render();
    },
    dispose() {
      pool.dispose();
      composer.dispose();
      lib.dispose();
      envTarget.dispose();
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const mat = m.material as Material | Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
      });
      renderer.dispose();
    },
  };
}

async function loadProps(renderer: WebGLRenderer, placements: WorldBuilder['props'], into: Group, low: boolean, iron: Material): Promise<void> {
  const ktx2 = new KTX2Loader().setTranscoderPath('/assets/env/ignis/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const byId = new Map<string, WorldBuilder['props']>();
  for (const p of placements) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
  await Promise.all([...byId].map(async ([id, list]) => {
    try {
      const gltf = await loader.loadAsync(`/assets/env/ignis/models/${id}${low ? '_low' : ''}.glb`);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        // The procedural iron pieces export without textures; they take the scanned blackened iron.
        const forged = id === 'iron_brazier' || id === 'anvil';
        const inst = new InstancedMesh(mesh.geometry, forged ? iron : mesh.material, list.length);
        const m = new Matrix4();
        list.forEach((p, i) => {
          m.compose(new Vector3(p.x, p.y, p.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), p.yaw), new Vector3(p.scale, p.scale, p.scale));
          inst.setMatrixAt(i, m.multiply(mesh.matrixWorld));
        });
        inst.castShadow = true;
        inst.receiveShadow = true;
        const mat = mesh.material as MeshStandardMaterial;
        if (mat.isMeshStandardMaterial) {
          mat.envMapIntensity = 0.8;
        }
        inst.computeBoundingSphere();
        into.add(inst);
      });
    } catch (error) {
      console.warn(`Prop ${id} failed to load:`, error);
    }
  }));
  ktx2.dispose();
}
