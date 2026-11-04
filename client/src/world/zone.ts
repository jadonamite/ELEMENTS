import RAPIER from '@dimforge/rapier3d-compat';
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  FogExp2,
  Group,
  HalfFloatType,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  Object3D,
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
import { cellLods, createAoMaterial, WorldBuilder, type Bucket, type Part } from './builder.js';
import { skyUniforms, WorldClock } from './clock.js';
import { createEmbers, createFires, createForgeMaterial, createLavaMaterial, createPaperMaterial, createSmoke, createWaterMaterial, createWetMaterial, createWindowMaterial, LightPool, nightness, STEAM, worldTime } from './effects.js';
import { createSky, fieldMesh, heightAt, sampleField, slopeBlend } from './landscape.js';
import { LOOKS, SurfaceLibrary, worldUv, type Surface } from './materials.js';
import { buildSindr, PEAKS, WALKABLE } from './sindr.js';
import { createPlants } from './trees.js';
import { installHaze } from './haze.js';
import { warm } from './warmup.js';
import { buildGorge } from './gorge.js';
import { buildBarrens } from './barrens.js';
import { buildFort } from './fort.js';
import { buildRoofTestRow } from './roof-test.js';
import { buildTerraceTest, terraceTestAreas } from './terrace-test.js';
import { buildStyleStreet, STYLES, type StreetStyle } from './style-streets.js';

export { SPAWN } from './sindr.js';

export interface Zone {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  physics: PhysicsWorld;
  clock: WorldClock;
  /** Readies something that will appear during play (a villain, an effect) so its first frame does not stall. */
  warm(object: Object3D): Promise<void>;
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
      vec3 shadowTint = vec3(0.9, 0.96, 1.1);
      vec3 highTint = vec3(1.06, 1.0, 0.92);
      c.rgb *= mix(shadowTint, highTint, smoothstep(0.05, 0.6, l));
      c.rgb = mix(vec3(l), c.rgb, 1.08);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

export async function createZone(canvas: HTMLCanvasElement): Promise<Zone> {
  const params = new URLSearchParams(window.location.search);
  const low = params.get('fxQuality') === 'low';
  const debug = params.has('debug');
  const clock = new WorldClock(params);
  installHaze();
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
  const fog = new FogExp2(0x2e2a32, 0.0042);
  scene.fog = fog;
  const camera = new PerspectiveCamera(balance.camera.fov, 1, balance.camera.near, 2600);

  // Sky first: it also lights the town through a prefiltered environment map.
  const sky = createSky();
  scene.add(sky);
  const pmrem = new PMREMGenerator(renderer);
  const skyScene = new Scene();
  skyScene.add(createSky());
  // The environment is re-baked from the sky whenever the hour has moved enough to show;
  // 64 px is plenty for rough stone and keeps each bake under a frame.
  let envTarget = pmrem.fromScene(skyScene, 0, 0.1, 2000, { size: 64 });
  scene.environment = envTarget.texture;
  const baked = { night: nightness.value, dusk: skyUniforms.uDusk.value, sun: skyUniforms.uSunDir.value.clone() };
  const rebakeEnv = (): void => {
    const sunNow = skyUniforms.uSunDir.value;
    if (Math.abs(baked.night - nightness.value) < 0.04 && Math.abs(baked.dusk - skyUniforms.uDusk.value) < 0.06
      && baked.sun.angleTo(sunNow) < 0.12) return;
    baked.night = nightness.value; baked.dusk = skyUniforms.uDusk.value; baked.sun.copy(sunNow);
    const next = pmrem.fromScene(skyScene, 0, 0.1, 2000, { size: 64 });
    scene.environment = next.texture;
    envTarget.dispose();
    envTarget = next;
  };

  // Sun by day, moon by night (one light, so one shadow map); the town's fires do the rest.
  const sun = new DirectionalLight(0xffffff, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  const s = sun.shadow.camera;
  s.left = -45; s.right = 45; s.top = 45; s.bottom = -45; s.near = 1; s.far = 260;
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  // Cool sky fill against warm fires: shadowed stone reads slate, firelit stone reads amber.
  const hemi = new HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);
  const look = {
    daySky: new Color(0xb6c4dc), duskSky: new Color(0xc89a80), nightSky: new Color(0x8496c4),
    dayGround: new Color(0x6e5644), nightGround: new Color(0x2e1c12),
    dayFog: new Color(0xb2aca4), duskFog: new Color(0x8a6450), nightFog: new Color(0x161822),
  };
  const applyHour = (): void => {
    const night = nightness.value, dusk = skyUniforms.uDusk.value * (1 - night);
    sun.color.copy(clock.light.color);
    sun.intensity = clock.light.intensity;
    hemi.color.copy(look.daySky).lerp(look.duskSky, dusk * 0.6).lerp(look.nightSky, night);
    hemi.groundColor.copy(look.dayGround).lerp(look.nightGround, night);
    hemi.intensity = 1.1 + 0.4 * night;
    fog.color.copy(look.dayFog).lerp(look.duskFog, dusk).lerp(look.nightFog, night);
    // Haze down the streets: about a third gone at 50 m by day, thicker with the night's smoke.
    fog.density = 0.0075 + 0.002 * night;
    scene.environmentIntensity = 0.8 - 0.2 * night;
    renderer.toneMappingExposure = 0.9 + 0.7 * night;
  };

  // Physics: a floor under everything, then the land and the town's solids.
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -balance.controller.gravity, z: 0 });
  world.timestep = balance.controller.fixedStep;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.05, 2000).setTranslation(0, -0.05, 0));

  const lib = new SurfaceLibrary(renderer, low ? '1k' : '2k');
  const terraceTest = params.has('terraceTest');
  const styleParam = params.get('style') as StreetStyle | null;
  const style = styleParam && STYLES.includes(styleParam) ? styleParam : null;
  // The town's built ground (terraces, flights, the keep road) and any trial street's are collected on a
  // scratch build first, so the terrain is shaped to them before they are built.
  const townAreas = buildSindr(new WorldBuilder());
  const styleAreas = style ? buildStyleStreet(style, new WorldBuilder()) : [];
  const walkable = WALKABLE.with([...townAreas, ...(terraceTest ? terraceTestAreas() : []), ...styleAreas]);
  const ground = (x: number, z: number): number => heightAt(x, z, walkable, PEAKS);

  // Near land: walkable flats, banks and hills, matched by a physics heightfield spanning the entire nation.
  const near = sampleField(340, -10, 1020, 500, low ? 4 : 3, ground);
  const terrainMat = slopeBlend(lib.get('ash_cinder_ground'), lib.get('basalt_rock_face'));
  const terrain = fieldMesh(near, terrainMat);
  terrain.name = 'terrain';
  scene.add(terrain);
  world.createCollider(RAPIER.ColliderDesc.heightfield(near.nz, near.nx, near.heights, { x: near.width, y: 1, z: near.depth })
    .setTranslation(near.cx, 0, near.cz));

  // Far ranges and the volcano, coarse and lost in the haze.
  const volcano = { x: 380, z: -720, radius: 260, height: 330 };
  const far = sampleField(340, -10, 3600, 3600, low ? 45 : 30, (x, z) => {
    const inner = Math.max(Math.abs(x - 340) / 480, Math.abs(z + 10) / 230);
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
  buildSindr(builder);
  buildGorge(builder);
  buildBarrens(builder);
  buildFort(builder);
  if (new URLSearchParams(window.location.search).has('roofTest')) {
    buildRoofTestRow(builder);
  }
  if (terraceTest) buildTerraceTest(builder);
  if (style) buildStyleStreet(style, builder);
  const glows: Record<string, Material> = {
    window: createWindowMaterial(), forge: createForgeMaterial(), lava: createLavaMaterial(), ao: createAoMaterial(),
    wet: createWetMaterial(), water: createWaterMaterial(), paper: createPaperMaterial(),
  };
  const town = builder.build((bucket: Bucket) => glows[bucket] ?? lib.get(bucket as Surface));
  scene.add(town);
  for (const c of builder.colliders) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z)
      .setRotation(c.q ?? { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }));
  }
  if (params.has('debug') && params.has('showColliders')) scene.add(colliderLines(builder.colliders));
  world.step();

  // The volcano's crater glow and plume.
  const crater = new Mesh(new CircleGeometry(30, 24).rotateX(-Math.PI / 2), glows.lava);
  crater.position.set(volcano.x, volcano.height - 50, volcano.z);
  scene.add(crater);

  const fires = createFires(builder.fires);
  const smokeSources = [...builder.chimneys, new Vector3(volcano.x, volcano.height - 40, volcano.z)];
  const smoke = createSmoke(smokeSources, low ? 6 : 10);
  const embers = createEmbers(builder.embers, low ? 6 : 14);
  const steam = createSmoke(builder.steam, low ? 4 : 7, STEAM);
  scene.add(fires, smoke, embers, steam);
  scene.add(createPlants(builder.plants, lib.get('charred_timber_beams'), low));
  const plume = createSmoke(Array.from({ length: 8 }, (_, i) => new Vector3(volcano.x + (i - 4) * 12, volcano.height - 60, volcano.z)), 8);
  plume.scale.setScalar(1);
  (plume.material as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms.uColor!.value = new Color(0x1a1614);
  scene.add(plume);

  const pool = new LightPool(scene, builder.emitters, low ? 4 : 8);

  // Kit models placed as instances, one draw call per model part.
  // They load after the town stands; they join it only once warmed, so walking into them never stalls a frame.
  const props = new Group();
  void loadProps(renderer, builder.props, props, low, lib.get('blackened_rusted_iron'))
    .then(() => warmUp(props))
    .then(() => scene.add(props));

  // Post: sanitize first (stops NaN black frames), bloom for fire and slag, grade, then anti-aliasing.
  const composer = new EffectComposer(renderer);
  composer.renderTarget1.texture.type = HalfFloatType;
  composer.renderTarget2.texture.type = HalfFloatType;
  composer.addPass(new RenderPass(scene, camera));
  /** Readies an object to draw the way the scene pass draws it, before it first shows. */
  const warmUp = (object: Object3D): Promise<void> => warm(renderer, scene, camera, object, composer.renderTarget1);
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
    scene, camera, renderer, clock,
    physics: { world, step: () => world.step(), dispose: () => world.free() },
    follow(point) { followed = point; },
    warm: warmUp,
    setSize(w, h) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.resolution.set(w / 2, h / 2);
    },
    render() {
      renderer.info.reset();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      worldTime.value += dt;
      last = now;
      clock.update(dt);
      applyHour();
      rebakeEnv();
      if (followed) focus.copy(followed);
      // The shadow box follows the hero, snapped to texels so edges do not crawl.
      const texel = 90 / sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx, 0, fz).addScaledVector(clock.light.direction, 120);
      pool.update(focus, worldTime.value, camera);
      // Debug only: a fixed photographer's camera for comparison shots (window.elementsShotCam = [px, py, pz, tx, ty, tz]).
      const shot = debug ? (window as unknown as { elementsShotCam?: number[] }).elementsShotCam : undefined;
      if (shot && shot.length === 6) { camera.position.set(shot[0]!, shot[1]!, shot[2]!); camera.lookAt(shot[3]!, shot[4]!, shot[5]!); }
      sky.position.copy(camera.position);
      composer.render();
    },
    dispose() {
      pool.dispose();
      composer.dispose();
      lib.dispose();
      envTarget.dispose();
      pmrem.dispose();
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

/**
 * The scanned props, instanced per ground cell: the full model near, the low model past `near`, nothing
 * past the distance the haze swallows a thing of its size. On low quality only the low model is loaded.
 */
async function loadProps(renderer: WebGLRenderer, placements: WorldBuilder['props'], into: Group, low: boolean, iron: Material): Promise<void> {
  const ktx2 = new KTX2Loader().setTranscoderPath('/assets/env/ignis/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const byId = new Map<string, WorldBuilder['props']>();
  for (const p of placements) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
  // The procedural iron pieces export without textures; they take the scanned blackened iron.
  const partsOf = async (id: string, file: string): Promise<{ parts: Part[]; radius: number }> => {
    const gltf = await loader.loadAsync(`/assets/env/ignis/models/${file}.glb`);
    gltf.scene.updateMatrixWorld(true);
    const forged = id === 'iron_brazier' || id === 'anvil';
    const parts: Part[] = [];
    let radius = 0;
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const geometry = forged ? bakeIronUv(mesh.geometry, mesh.matrixWorld) : mesh.geometry;
      const mat = mesh.material as MeshStandardMaterial;
      if (mat.isMeshStandardMaterial) mat.envMapIntensity = 0.8;
      geometry.computeBoundingSphere();
      radius = Math.max(radius, geometry.boundingSphere!.radius);
      parts.push({ geometry, material: forged ? iron : mesh.material as Material, local: forged ? undefined : mesh.matrixWorld.clone(), castShadow: true, name: id });
    });
    return { parts, radius };
  };
  await Promise.all([...byId].map(async ([id, list]) => {
    try {
      const far = await partsOf(id, `${id}_low`);
      const size = far.radius * Math.max(...list.map((p) => p.scale));
      // A barrel (0.5 m) is gone at about 100 m, a cart at 250 m, a boulder or dead tree carries to 600 m.
      const hideAt = Math.min(600, Math.max(100, size * 130));
      const near = Math.max(10, size * 8);
      const levels = low ? [{ from: 0, parts: far.parts }] : [{ from: 0, parts: (await partsOf(id, id)).parts }, { from: near, parts: far.parts }];
      for (const lod of cellLods(list, levels, hideAt)) into.add(lod);
    } catch (error) {
      console.warn(`Prop ${id} failed to load:`, error);
    }
  }));
  ktx2.dispose();
}

/** The procedural iron pieces have collapsed UVs: unpack them to floats in metres and project the iron scan on. */
function bakeIronUv(source: BufferGeometry, matrix: Matrix4): BufferGeometry {
  const g = new BufferGeometry();
  const v = new Vector3();
  for (const name of ['position', 'normal']) {
    const a = source.getAttribute(name);
    const f = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) v.fromBufferAttribute(a, i).toArray(f, i * 3);
    g.setAttribute(name, new BufferAttribute(f, 3));
  }
  g.setIndex(source.index);
  g.applyMatrix4(matrix);
  return worldUv(g, LOOKS.blackened_rusted_iron.tile);
}

/** Every town collider as a wireframe box, for checking them against what is drawn (?debug&showColliders). */
function colliderLines(colliders: WorldBuilder['colliders']): LineSegments {
  const edges = new EdgesGeometry(new BoxGeometry(2, 2, 2));
  const unit = edges.getAttribute('position');
  const out = new Float32Array(unit.count * 3 * colliders.length);
  const m = new Matrix4(), v = new Vector3(), q = new Quaternion();
  colliders.forEach((c, i) => {
    if (c.q) q.set(c.q.x, c.q.y, c.q.z, c.q.w); else q.setFromAxisAngle(new Vector3(0, 1, 0), c.yaw);
    m.compose(new Vector3(c.x, c.y, c.z), q, new Vector3(c.hx, c.hy, c.hz));
    for (let k = 0; k < unit.count; k++) v.fromBufferAttribute(unit, k).applyMatrix4(m).toArray(out, (i * unit.count + k) * 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(out, 3));
  const lines = new LineSegments(g, new LineBasicMaterial({ color: 0x40ff70, depthTest: false, transparent: true, opacity: 0.8 }));
  lines.renderOrder = 10;
  lines.frustumCulled = false;
  return lines;
}
