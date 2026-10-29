/**
 * Arena scene: a round flagstone floor ringed by a dry-stone wall, crags and
 * standing stones beyond it, a statue landmark, a low evening sky, fog,
 * filmic tone mapping and a light bloom and vignette pass.
 */

import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  FogExp2,
  HalfFloatType,
  HemisphereLight,
  LatheGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type BufferGeometry,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import balance from '../../shared/balance.json';

/** Arena diameter in metres (1 unit = 1 metre). */
export const ARENA_SIZE = balance.arena.size;
const RADIUS = ARENA_SIZE / 2;
const look = balance.look;

/** Sun position in the sky panorama, measured from the image (u across, elevation in degrees). */
const SKY_SUN_U = 0.604;
/** Where the sun should sit in the world, as a compass angle atan2(z, x) in radians. */
const SUN_AZIMUTH = 2.6;

const textureLoader = new TextureLoader();

function loadTex(path: string, repeat: number, srgb = false): Texture {
  const tex = textureLoader.load(path);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Poly Haven material set: colour, OpenGL normal and packed AO/roughness/metal maps. */
function pbr(name: string, repeat: number | [number, number]): MeshStandardMaterial {
  const [rx, ry] = typeof repeat === 'number' ? [repeat, repeat] : repeat;
  const tex = (suffix: string, srgb = false): Texture => {
    const t = loadTex(`/assets/textures/${name}_${suffix}_1k.webp`, 1, srgb);
    t.repeat.set(rx, ry);
    return t;
  };
  const arm = tex('arm');
  return new MeshStandardMaterial({
    map: tex('diff', true),
    normalMap: tex('nor_gl'),
    aoMap: arm,
    roughnessMap: arm,
    metalnessMap: arm,
  });
}

/** Soft blotchy mask: white where dirt shows, heavier toward the wall. */
function dirtMask(size = 512): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2);
  edge.addColorStop(0, 'rgba(255,255,255,0)');
  edge.addColorStop(0.75, 'rgba(255,255,255,0.85)');
  edge.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);
  // Seeded scatter so the floor looks the same every load.
  let seed = 7;
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 140; i++) {
    const x = rand() * size, y = rand() * size, r = size * (0.01 + rand() * 0.06);
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, `rgba(255,255,255,${0.25 + rand() * 0.5})`);
    blob.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return new CanvasTexture(canvas);
}

export interface ArenaObjects {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  setSize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

export function createArena(canvas: HTMLCanvasElement): ArenaObjects {
  // Antialiasing lives in the composer's buffers, since every frame goes through them.
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = look.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const fogColor = new Color().setRGB(...(look.fogColor as [number, number, number]));
  scene.fog = new FogExp2(fogColor, look.fogDensity);

  const camera = new PerspectiveCamera(balance.camera.fov, 1, balance.camera.near, balance.camera.far);
  camera.position.set(0, 3, 8);

  /* --- sky: rotate the panorama so its sun sits at SUN_AZIMUTH --- */
  const skyYaw = (SKY_SUN_U - 0.5) * Math.PI * 2 - SUN_AZIMUTH;
  scene.backgroundRotation.set(0, skyYaw, 0);
  scene.environmentRotation.set(0, skyYaw, 0);
  scene.backgroundIntensity = look.skyIntensity;
  scene.environmentIntensity = look.environmentIntensity;
  let disposed = false;
  new HDRLoader().load('/assets/hdri/belfast_sunset_puresky_1k.hdr', (hdr) => {
    if (disposed) { hdr.dispose(); return; }
    hdr.mapping = EquirectangularReflectionMapping;
    scene.background = hdr;
    scene.environment = hdr;
  });

  /* --- key light at the sun's compass direction, raised so shadows stay readable --- */
  const elevation = look.sunElevationDeg * Math.PI / 180;
  const sunDir = new Vector3(Math.cos(SUN_AZIMUTH) * Math.cos(elevation), Math.sin(elevation),
    Math.sin(SUN_AZIMUTH) * Math.cos(elevation));
  const sun = new DirectionalLight(new Color().setRGB(1, 0.72, 0.48), look.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -RADIUS - 6;
  sun.shadow.camera.right = sun.shadow.camera.top = RADIUS + 6;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);
  // Cool sky fill from above, dark earth bounce from below.
  scene.add(new HemisphereLight(new Color().setRGB(0.35, 0.4, 0.5), new Color().setRGB(0.12, 0.09, 0.07),
    look.fillIntensity));

  /* --- floor: flagstones with dirt worked in toward the wall --- */
  const floorGeo = new CircleGeometry(RADIUS + 1, 96);
  const floor = new Mesh(floorGeo, pbr('monastery_stone_floor', look.floorRepeat));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const dirtMat = pbr('forest_ground_04', look.dirtRepeat);
  dirtMat.alphaMap = dirtMask();
  dirtMat.transparent = true;
  dirtMat.depthWrite = false;
  dirtMat.polygonOffset = true;
  dirtMat.polygonOffsetFactor = -1;
  const dirt = new Mesh(floorGeo, dirtMat);
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.002;
  dirt.receiveShadow = true;
  scene.add(dirt);
  // Ground beyond the wall, so crags stand on earth instead of the sky.
  const outerGround = new Mesh(new CircleGeometry(80, 64), pbr('forest_ground_04', 20));
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.02;
  outerGround.receiveShadow = true;
  scene.add(outerGround);

  /* --- ring wall: battered dry-stone face, flat top, outer face --- */
  const { wallHeight, wallThickness } = balance.arena;
  const profile = [
    new Vector2(RADIUS, 0),
    new Vector2(RADIUS + 0.25, wallHeight),
    new Vector2(RADIUS + wallThickness, wallHeight),
    new Vector2(RADIUS + wallThickness + 0.3, 0),
  ];
  const circumference = Math.PI * 2 * RADIUS;
  const wall = new Mesh(new LatheGeometry(profile, 128),
    pbr('rock_wall_08', [circumference / look.wallTileMetres, (wallHeight * 2 + wallThickness) / look.wallTileMetres]));
  (wall.material as MeshStandardMaterial).side = DoubleSide;
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);

  /* --- post: bloom kept for element glow, gentle vignette, then tone mapping --- */
  const composer = new EffectComposer(renderer,
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: look.msaaSamples }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(1, 1), look.bloomStrength, 0.4, look.bloomThreshold);
  composer.addPass(bloom);
  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms['offset']!.value = 0.95;
  vignette.uniforms['darkness']!.value = look.vignette;
  composer.addPass(vignette);
  composer.addPass(new OutputPass());

  /* --- resolution: capped for fill rate, lowered a step at a time when frames run slow --- */
  let width = 1, height = 1, scale = 1, frames = 0, frameTime = 0, last = performance.now();
  const applySize = (): void => {
    const ratio = Math.max(look.minPixelRatio, Math.min(window.devicePixelRatio, look.maxPixelRatio) * scale);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
  };
  const govern = (): void => {
    const now = performance.now();
    const delta = now - last;
    last = now;
    if (delta > 100) return; // tab switches and stalls are not render cost
    frameTime += delta;
    if (++frames < 60) return;
    const average = frameTime / frames;
    frames = 0;
    frameTime = 0;
    const ceiling = Math.min(window.devicePixelRatio, look.maxPixelRatio);
    const ratio = renderer.getPixelRatio();
    if (average > look.slowFrameMs && ratio > look.minPixelRatio) scale -= look.pixelRatioStep / ceiling;
    else if (average < look.fastFrameMs && ratio < ceiling) scale = Math.min(1, scale + look.pixelRatioStep / ceiling);
    else return;
    applySize();
  };

  return {
    scene, camera, renderer,
    setSize(w, h) {
      width = w;
      height = h;
      applySize();
    },
    render: () => { govern(); composer.render(); },
    dispose: () => {
      disposed = true;
      sun.shadow.map?.dispose();
      scene.environment?.dispose();
      composer.dispose();
      disposeObject(scene);
      renderer.dispose();
    },
  };
}

interface PropPlacement { file: string; x: number; z: number; scale: number; yaw: number; y?: number }

/** Statue landmark, boulders and the crags and standing stones beyond the wall. */
export async function loadProps(scene: Scene, loader = new GLTFLoader()): Promise<void> {
  const placements: PropPlacement[] = [
    ...balance.arena.obstacles.map(o => ({ file: o.file, x: o.x, z: o.z, scale: o.scale, yaw: o.yaw })),
  ];
  // Crags ring the arena outside the wall, each turning its scanned face (+Z) to the centre.
  const crags = ['rock_face_01', 'rock_face_02'];
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + 0.2;
    const distance = RADIUS + 7 + (i % 3) * 2.5;
    placements.push({
      file: crags[i % 2]!, x: Math.cos(angle) * distance, z: Math.sin(angle) * distance,
      scale: 1.4 + (i % 4) * 0.3, yaw: Math.atan2(-Math.cos(angle), -Math.sin(angle)), y: -0.1,
    });
  }
  for (const angle of [0.9, 2.6, 4.1, 5.5]) {
    placements.push({ file: 'rock_moss_set_01', x: Math.cos(angle) * (RADIUS + 9),
      z: Math.sin(angle) * (RADIUS + 9), scale: 1.3, yaw: angle, y: 0.5 });
  }
  const sources = new Map<string, Object3D>();
  await Promise.all([...new Set(placements.map(p => p.file))].map(async file => {
    const gltf = await loader.loadAsync(`/assets/props/${file}.glb`);
    gltf.scene.traverse(node => {
      if (node instanceof Mesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    sources.set(file, gltf.scene);
  }));
  for (const p of placements) {
    const prop = sources.get(p.file)!.clone();
    prop.position.set(p.x, p.y ?? 0, p.z);
    prop.rotation.y = p.yaw;
    prop.scale.setScalar(p.scale);
    scene.add(prop);
  }
}

/** Release resources shared by meshes only once. */
export function disposeObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
    if ('skeleton' in node) (node.skeleton as { dispose(): void }).dispose();
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}
