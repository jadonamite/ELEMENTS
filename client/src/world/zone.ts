import RAPIER from '@dimforge/rapier3d-compat';
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CircleGeometry,
  DepthTexture,
  DirectionalLight,
  EdgesGeometry,
  FloatType,
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
  WebGLRenderTarget,
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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loaders } from '../assets/loaders.js';
import balance from '../../../shared/balance.json';
import { SANITIZE_SHADER } from '../env/postprocessing.js';
import type { PhysicsWorld } from '../physics.js';
import { cellLods, createAoMaterial, WorldBuilder, type Browse, type Bucket, type Part, type Post } from './builder.js';
import { skyUniforms, WorldClock } from './clock.js';
import { createEmbers, createFires, createForgeMaterial, createLavaMaterial, createPaperMaterial, createSmoke, createWaterMaterial, createWetMaterial, createWindowMaterial, LightPool, nightness, STEAM, worldTime } from './effects.js';
import { createSky, surfaceAt, slopeBlend } from './landscape.js';
import { createNationalForest } from './national-forest.js';
import { createGroundCover } from './ground-cover.js';
import { createLandAir } from './land-air.js';
import { TerrainStream } from './terrain-stream.js';
import { SettlementStream } from './settlements.js';
import { NationalQuarryStream } from './national-quarry.js';
import { NationalWaterworksStream } from './national-waterworks.js';
import { nationalRoadChunks, nationalRoadMesh } from './national-roads.js';
import { mineRoadMesh, nationalView, terrainAir } from './national-view.js';
import { createLandMap } from './land-map.js';
import { MINE_LENGTH, MINE_MAX_GRADE, minePointAt, VOLCANO, waterHeight } from '../../../shared/src/world/ignis/ground.js';
import { LEGACY_SINDR_ORIGIN as ORIGIN } from '../../../shared/src/world/ignis/coordinates.js';
import { waterAt } from '../../../shared/src/world/ignis/market-slice.js';
import { LOOKS, SurfaceLibrary, worldUv, type Surface } from './materials.js';
import { buildSindr, sindrGround, SPAWN } from './sindr.js';
import { createPlants } from './trees.js';
import { addTownPhysics } from './town-physics.js';
import { installHaze } from './haze.js';
import { inTurn, warm } from './warmup.js';
import { buildGorge } from './gorge.js';
import { buildWildLands } from './wild-lands.js';
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
  warm(object: Object3D, onProgress?: (fraction: number) => void): Promise<void>;
  /** Resolves when the town surfaces (at 1K) and every prop LOD have loaded. */
  ready: Promise<void>;
  /** Brings the surfaces' colour and packed maps up to full size after play has started. */
  sharpen(): Promise<void>;
  /** Where people belong, as the town was built: counters, anvils, doors. */
  posts: readonly Post[];
  /** Where passers-by stop to look at goods: stalls, tables, counters. */
  browse: readonly Browse[];
  /** Where trade is heard (stalls, counters, goods tables) and where hammers ring (anvils), as built. */
  sounds: { market: readonly Vector3[]; forge: readonly Vector3[] };
  /** What the ground is made of under feet at a spot; open land outside the town is ash and cinder. */
  surfaceAt(x: number, y: number, z: number): Surface;
  /** Inhabited precincts streamed along the road network. */
  settlements: SettlementStream;
  /** The point the shadows and the nearest lights follow, usually the hero. */
  follow(point: Vector3): void;
  groundStep(controller: { position: Vector3; place(x: number, y: number, z: number): void }): boolean;
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
      vec3 shadowTint = vec3(0.98, 0.92, 0.84);
      vec3 highTint = vec3(1.08, 1.01, 0.88);
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
  // One camera sees from the hero's feet to the far coast, so depth is reversed and stored as a float: precision then
  // holds at 0.1 m and at 20 km alike. Without EXT_clip_control three keeps the standard buffer, whose precision is set
  // by the near plane, not the far one, so the same 26 km camera still works, coarser at the horizon.
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true });
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
  const camera = new PerspectiveCamera(balance.camera.fov, 1, balance.camera.near, 26000);

  // Sky first: it also lights the town through a prefiltered environment map.

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
  sun.castShadow = !low;
  sun.shadow.mapSize.set(low ? 512 : 1024, low ? 512 : 1024);
  const s = sun.shadow.camera;
  const shadowSpan = low ? 25 : 32;
  s.left = -shadowSpan; s.right = shadowSpan; s.top = shadowSpan; s.bottom = -shadowSpan; s.near = 1; s.far = 260;
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  // Cool sky fill against warm fires: shadowed stone reads slate, firelit stone reads amber.
  const hemi = new HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);
  const look = {
    daySky: new Color(0xc4cbd1), duskSky: new Color(0xe4ae78), nightSky: new Color(0x8496c4),
    dayGround: new Color(0x8a7050), nightGround: new Color(0x2e1c12),
    dayFog: new Color(0xdac5ad), duskFog: new Color(0xe5ba8f), nightFog: new Color(0x161822),
  };
  const applyHour = (): void => {
    const night = nightness.value, dusk = skyUniforms.uDusk.value * (1 - night);
    sun.color.copy(clock.light.color);
    sun.intensity = clock.light.intensity;
    hemi.color.copy(look.daySky).lerp(look.duskSky, dusk * 0.6).lerp(look.nightSky, night);
    hemi.groundColor.copy(look.dayGround).lerp(look.nightGround, night);
    // Less sky fill as the sun lowers, so its long shadows read; the night's fill comes back with the moon.
    hemi.intensity = 0.52 - 0.20 * dusk + 0.88 * night;
    fog.color.copy(look.dayFog).lerp(look.duskFog, dusk).lerp(look.nightFog, night);
    // Haze down the streets: about a fifth gone at 50 m by day, warmer and a little thicker into the evening smoke.
    fog.density = 0.0055 + 0.0015 * dusk + 0.0015 * night;
    scene.environmentIntensity = 0.52 - 0.14 * dusk + 0.10 * night;
    renderer.toneMappingExposure = 1.08 + 0.52 * night;
  };

  // Physics: the land and the town's solids over a last floor (town-physics.ts), added once the town is built.
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -balance.controller.gravity, z: 0 });
  world.timestep = balance.controller.fixedStep;

  const lib = new SurfaceLibrary(renderer, low ? '1k' : '2k');
  const terraceTest = params.has('terraceTest');
  const styleParam = params.get('style') as StreetStyle | null;
  const style = styleParam && STYLES.includes(styleParam) ? styleParam : null;
  // The town's built ground (terraces, flights, the keep road) and any trial street's are collected on a
  // scratch build first, so the terrain is shaped to them before they are built.
  const townAreas = buildSindr(new WorldBuilder());
  const styleAreas = style ? buildStyleStreet(style, new WorldBuilder()) : [];
  const legacyEast = params.has('legacyEast');
  const built = sindrGround([...townAreas, ...(terraceTest ? terraceTestAreas() : []), ...styleAreas], legacyEast);
  const ground = (x: number, z: number): number => surfaceAt(x, z, built);
  const landMap = createLandMap();
  const terrainMat = terrainAir(slopeBlend(lib.get('ash_cinder_ground'), lib.get('basalt_rock_face'), landMap), fog);
  const stream = new TerrainStream(world, ground, scene, terrainMat, low);
  stream.initialize(SPAWN.x, SPAWN.z);
  stream.startWorker({
    x0: Math.min(...built.areas.map(a => a.bounds.x0)), x1: Math.max(...built.areas.map(a => a.bounds.x1)),
    z0: Math.min(...built.areas.map(a => a.bounds.z0)), z1: Math.max(...built.areas.map(a => a.bounds.z1)),
  });
  const national = nationalView(ground, terrainMat, low, fog);
  scene.add(national.group);
  const residentCells = [stream.near.cells, stream.mid.cells];
  const roadMaterial = terrainAir(lib.get('packed_dirt_road'), fog);
  // Road ribbons carry no vertex colours; reading the missing attribute draws them black.
  roadMaterial.vertexColors = false;
  scene.add(mineRoadMesh(roadMaterial));
  const nationalRoadGroup = new Group(); nationalRoadGroup.name = 'ignis-national-roads'; scene.add(nationalRoadGroup);
  const routeChunks = nationalRoadChunks();
  const chunksByCell = new Map<string, typeof routeChunks[number][]>();
  for (const chunk of routeChunks) for (const key of chunk.cells) {
    const list = chunksByCell.get(key);
    if (list) list.push(chunk); else chunksByCell.set(key, [chunk]);
  }
  const residentRoads = new Map<string, Mesh>();
  const updateNationalRoads = (cells: ReadonlyMap<string, unknown>): void => {
    const wanted = new Set<string>();
    for (const key of cells.keys()) for (const chunk of chunksByCell.get(key) ?? []) wanted.add(chunk.id);
    for (const id of wanted) if (!residentRoads.has(id)) {
      const chunk = routeChunks.find(candidate => candidate.id === id);
      if (!chunk) continue;
      const mesh = nationalRoadMesh(chunk, roadMaterial, ORIGIN);
      nationalRoadGroup.add(mesh); residentRoads.set(id, mesh);
    }
    for (const [id, mesh] of residentRoads) if (!wanted.has(id)) {
      nationalRoadGroup.remove(mesh); mesh.geometry.dispose(); residentRoads.delete(id);
    }
  };
  updateNationalRoads(stream.near.cells);
  const turning = new Mesh(new CircleGeometry(22, 40).rotateX(-Math.PI / 2), roadMaterial);
  turning.position.set(10500 - ORIGIN.x, 740 - ORIGIN.y + 0.08, 7000 - ORIGIN.z); turning.name = 'cinderpit-turning-area'; scene.add(turning);
  const nationalForest = await createNationalForest({ renderer, bark: lib.get('charred_timber_beams'), low, fog, world, origin: ORIGIN });
  scene.add(nationalForest.group);
  nationalForest.update(stream.near.cells, stream.mid.cells, SPAWN);
  // The forest ring seen from the gate is part of the first view: planted before play, built by one update.
  const forestReady = nationalForest.plantAround(SPAWN).then(() => nationalForest.update(stream.near.cells, stream.mid.cells, SPAWN));
  const cover = createGroundCover({ ground, origin: ORIGIN, low }); scene.add(cover.mesh);
  const landAir = createLandAir({ ground, origin: ORIGIN, low }); scene.add(landAir.points);
  const map = {
    ready: false, groundAt: ground,
    road: { lengthKm: MINE_LENGTH / 1000, pointAt(s: number) {
      const p = minePointAt(s); return { x: p.x - ORIGIN.x, y: p.y - ORIGIN.y, z: p.z - ORIGIN.z };
    } },
    maxGrade: MINE_MAX_GRADE,
    forest: { get count() { return nationalForest.stats.stems; } },
    get cells() { return { near: stream.near.cells.size, mid: stream.mid.cells.size, far: national.visible }; },
    get streamIdle() { return stream.idle; },
    far: national.stats, timing: stream.timing, streamStatus: stream.status,
    prepare: (x: number, z: number) => stream.prepare(x, z),
    waterAt(x: number, z: number) {
      return waterAt(x, z)?.surface ?? ((waterHeight(x + ORIGIN.x, z + ORIGIN.z) ?? NaN) - ORIGIN.y);
    },
    probeClear(x: number, y: number, z: number, dx: number, dz: number, distance: number): boolean {
      const length = Math.hypot(dx, dz); if (!length) return false;
      dx /= length; dz /= length;
      // The fixed physics query includes terrain and town geometry, never character bodies.
      const hit = world.castRay(new RAPIER.Ray({ x, y, z }, { x: dx, y: 0, z: dz }), distance, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
      if (hit) return false;
      for (let d = 0; d <= distance; d += 0.5) if (ground(x + dx * d, z + dz * d) >= y) return false;
      return true;
    },
    sightClear(x: number, y: number, z: number, tx: number, ty: number, tz: number): boolean {
      const dx = tx - x, dy = ty - y, dz = tz - z, length = Math.hypot(dx, dy, dz);
      const hit = world.castRay(new RAPIER.Ray({ x, y, z }, { x: dx / length, y: dy / length, z: dz / length }), length - 5, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
      if (hit) return false;
      for (let t = 0.002; t < 0.998; t += 0.002) if (ground(x + dx * t, z + dz * t) > y + dy * t) return false;
      return true;
    },
    volcano: { x: VOLCANO.x - ORIGIN.x, y: VOLCANO.height - ORIGIN.y, z: VOLCANO.z - ORIGIN.z },
  };
  // Debug only: the frame is built from these three layers, so a review can show and hide each one.
  if (debug) Object.assign(win.elements!, { map, layers: { town: scene, far: national.group, near: stream.near.batch, mid: stream.mid.batch } });
  if (debug) Object.assign(map, { nationalForest, cover, landAir });

  // The town.
  const builder = new WorldBuilder({ low });
  buildSindr(builder);
  if (legacyEast) { buildGorge(builder); buildBarrens(builder); buildFort(builder); } else buildWildLands(builder);
  if (new URLSearchParams(window.location.search).has('roofTest')) {
    buildRoofTestRow(builder);
  }
  if (terraceTest) buildTerraceTest(builder);
  if (style) buildStyleStreet(style, builder);
  const glows: Record<string, Material> = {
    window: createWindowMaterial(), forge: createForgeMaterial(), lava: createLavaMaterial(), ao: createAoMaterial(),
    wet: createWetMaterial(), water: createWaterMaterial(), fresh_water: createWaterMaterial('fresh'), paper: createPaperMaterial(),
  };
  // The nearest lights: the town's braziers and lamps, plus those of whichever settlements are loaded.
  const pool = new LightPool(scene, builder.emitters, low ? 2 : 3);
  const placeProps = propKit(renderer, low, lib.get('blackened_rusted_iron'));
  const settlements = new SettlementStream(world, bucket => glows[bucket] ?? lib.get(bucket as Surface), low, pool, placeProps);
  scene.add(settlements.group);
  settlements.update(stream.near.cells);
  if (debug) Object.assign(map, { settlements });
  const quarry = new NationalQuarryStream({ world, material: bucket => glows[bucket] ?? lib.get(bucket as Surface), low, origin: ORIGIN, height: ground });
  scene.add(quarry.group);
  quarry.update(stream.near.cells);
  if (debug) Object.assign(map, { quarry });
  const waterworks = new NationalWaterworksStream(world, bucket => glows[bucket] ?? lib.get(bucket as Surface), low);
  scene.add(waterworks.group);
  waterworks.update(stream.near.cells);
  if (debug) Object.assign(map, { waterworks });
  const town = builder.build((bucket: Bucket) => glows[bucket] ?? lib.get(bucket as Surface));
  scene.add(town);
  addTownPhysics(world, null, builder.colliders, builder.shells);
  if (params.has('debug') && params.has('showColliders')) scene.add(colliderLines(builder.colliders));
  world.step();

  const fires = createFires(builder.fires);
  const smoke = createSmoke(builder.chimneys, low ? 6 : 10);
  const embers = createEmbers(builder.embers, low ? 6 : 14);
  const steam = createSmoke(builder.steam, low ? 4 : 7, STEAM);
  scene.add(fires, smoke, embers, steam);
  scene.add(createPlants(builder.plants, lib.get('charred_timber_beams'), low));


  // Kit models placed as instances, one draw call per model part.
  // Entry waits for every level and surface before warming the completed scene.
  const props = new Group();
  const ready = Promise.all([placeProps(builder.props, props), lib.ready(), national.ready, landMap.ready, forestReady])
    .then(() => { scene.add(props); map.ready = true; });

  // Post: sanitize first (stops NaN black frames), bloom only for what is brighter than sunlit ground (fire, lava, slag), grade, then anti-aliasing.
  // One pass draws the town, the streamed cells and the national view with one camera into a float depth buffer.
  const depthTexture = new DepthTexture(1, 1, FloatType);
  const composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthTexture }));
  composer.addPass(new RenderPass(scene, camera));
  /**
   * Readies an object to draw the way the scene pass draws it, before it first shows. Objects arriving after play
   * are warmed in turn (one a frame), in one scene that holds copies of the town's lights, so their shadow maps are made once.
   */
  let lateScene: Scene | null = null;
  const warmUp = (object: Object3D, onProgress?: (fraction: number) => void): Promise<void> => {
    if (object === scene) return warm(renderer, scene, camera, scene, composer.renderTarget1, onProgress);
    if (!lateScene) {
      lateScene = new Scene(); lateScene.fog = fog;
      lateScene.environment = scene.environment; lateScene.environmentIntensity = scene.environmentIntensity;
      for (const child of scene.children) if ('isLight' in child) lateScene.add(child.clone());
    }
    const into = lateScene;
    return inTurn(() => warm(renderer, into, camera, object, composer.renderTarget1, onProgress));
  };
  composer.addPass(new ShaderPass(SANITIZE_SHADER));
  const bloom = new UnrealBloomPass(new Vector2(640, 360), 0.55, 0.6, 1.05);
  composer.addPass(bloom);
  if (debug) Object.assign(win.elements!, { post: { bloom }, terrainMat });
  composer.addPass(new ShaderPass(GRADE_SHADER));
  composer.addPass(new OutputPass());
  const aa = low ? new FXAAPass() : new SMAAPass();
  composer.addPass(aa);

  const focus = new Vector3();
  let last = performance.now();
  let followed: Vector3 | null = null;

  return {
    scene, camera, renderer, clock, ready, posts: builder.posts, browse: builder.browse,
    settlements,
    surfaceAt: (x, y, z) => waterworks.surfaceAt(x, y, z) ?? quarry.surfaceAt(x, y, z) ?? settlements.surfaceAt(x, y, z) ?? builder.treads.at(x, y, z) ?? 'ash_cinder_ground',
    sounds: {
      market: [...builder.browse, ...builder.posts.filter(post => post.kind === 'keeper')].map(spot => new Vector3(spot.x, spot.y, spot.z)),
      forge: builder.posts.filter(post => post.kind === 'smith').map(post => new Vector3(post.x, post.y, post.z)),
    },
    physics: { world, step: () => world.step(), dispose: () => world.free() },
    follow(point) { followed = point; },
    groundStep(controller) {
      const ready = stream.guard(controller);
      settlements.update(stream.near.cells);
      quarry.update(stream.near.cells);
      waterworks.update(stream.near.cells);
      updateNationalRoads(stream.near.cells);
      nationalForest.update(stream.near.cells, stream.mid.cells, controller.position);
      cover.update(controller.position);
      landAir.update(controller.position);
      return ready;
    },
    warm: warmUp,
    sharpen: () => lib.sharpen((texture) => renderer.initTexture(texture)),
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
      const texel = (shadowSpan * 2) / sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx, 0, fz).addScaledVector(clock.light.direction, 120);
      pool.update(focus, worldTime.value, camera);
      // Debug only: a fixed photographer's camera for comparison shots (window.elementsShotCam = [px, py, pz, tx, ty, tz]).
      const shot = debug ? (window as unknown as { elementsShotCam?: number[] }).elementsShotCam : undefined;
      if (shot && shot.length === 6) { camera.position.set(shot[0]!, shot[1]!, shot[2]!); camera.lookAt(shot[3]!, shot[4]!, shot[5]!); }
      camera.updateMatrixWorld(); national.update(camera, residentCells); settlements.updateCamera(camera);
      national.sky.position.copy(camera.position);
      composer.render();
    },
    dispose() {
      settlements.dispose();
      quarry.dispose();
      waterworks.dispose();
      for (const mesh of residentRoads.values()) mesh.geometry.dispose();
      residentRoads.clear(); nationalRoadGroup.removeFromParent();
      landMap.dispose(); nationalForest.dispose(); cover.dispose(); landAir.dispose(); stream.dispose(); national.dispose(); roadMaterial.dispose(); terrainMat.dispose();
      pool.dispose();
      for (const light of lateScene?.children ?? []) {
        const shadow = (light as DirectionalLight).shadow;
        shadow?.map?.dispose(); shadow?.mapPass?.dispose();
      }
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

/** Places scanned props as instanced cells into a group; each model loads once and is shared by every caller. */
export type PlaceProps = (placements: WorldBuilder['props'], into: Group) => Promise<void>;

/**
 * The scanned props, instanced per ground cell: the full model near, the low model past `near`, nothing
 * past the distance the haze swallows a thing of its size. On low quality only the low model is loaded.
 * Models are fetched once; the town and every settlement that streams in share them.
 */
function propKit(renderer: WebGLRenderer, low: boolean, iron: Material): PlaceProps {
  const loader = loaders(renderer).gltf;
  const cache = new Map<string, Promise<{ parts: Part[]; radius: number }>>();
  // The procedural iron pieces export without textures; they take the scanned blackened iron.
  const partsOf = (id: string, file: string): Promise<{ parts: Part[]; radius: number }> => {
    const cached = cache.get(file);
    if (cached) return cached;
    const loading = (async () => {
      const gltf = await loader.loadAsync(`/assets/env/ignis/models/${file}.glb`);
      gltf.scene.updateMatrixWorld(true);
      const forged = id === 'iron_brazier' || id === 'anvil';
      const byMat = new Map<Material, BufferGeometry[]>();
      let radius = 0;
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        let geometry = forged ? bakeIronUv(mesh.geometry, mesh.matrixWorld) : mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        if (geometry.index) geometry = geometry.toNonIndexed();
        const mat = forged ? iron : (mesh.material as Material);
        if ((mat as MeshStandardMaterial).isMeshStandardMaterial) (mat as MeshStandardMaterial).envMapIntensity = 0.8;
        geometry.computeBoundingSphere();
        radius = Math.max(radius, geometry.boundingSphere!.radius);
        const list = byMat.get(mat);
        if (list) list.push(geometry); else byMat.set(mat, [geometry]);
      });
      const parts: Part[] = [];
      for (const [material, list] of byMat) {
        const merged = list.length === 1 ? list[0]! : mergeGeometries(list, false)!;
        merged.computeBoundingSphere();
        parts.push({
          geometry: merged,
          material,
          castShadow: !low && (id === 'boulder_large' || id === 'boulder_huge' || id === 'dead_burnt_tree' || id === 'iron_brazier'),
          name: id,
        });
      }
      return { parts, radius };
    })();
    cache.set(file, loading);
    return loading;
  };
  return async (placements, into) => {
    const byId = new Map<string, WorldBuilder['props']>();
    for (const p of placements) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
    await Promise.all([...byId].map(async ([id, list]) => {
      try {
        const far = await partsOf(id, `${id}_low`);
        const size = far.radius * Math.max(...list.map((p) => p.scale));
        // A barrel (0.5 m) is gone at about 100 m, a cart at 250 m, a boulder or dead tree carries to 600 m.
        const hideAt = low ? Math.min(180, Math.max(40, size * 50)) : Math.min(600, Math.max(100, size * 130));
        const near = Math.max(6, size * 5);
        const levels = low ? [{ from: 0, parts: far.parts }] : [{ from: 0, parts: (await partsOf(id, id)).parts }, { from: near, parts: far.parts }];
        for (const lod of cellLods(list, levels, hideAt)) into.add(lod);
      } catch (error) {
        console.warn(`Prop ${id} failed to load:`, error);
      }
    }));
  };
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
