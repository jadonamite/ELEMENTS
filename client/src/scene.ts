/**
 * Arena scene setup: 30x30m stone floor with low walls, HDRI sky lighting,
 * sun shadows, and PBR textures from Poly Haven (CC0).
 */

import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
  type Texture,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/* ---------- constants (1 unit = 1 metre) ---------- */

/** Arena floor size in metres. */
export const ARENA_SIZE = 30;
/** Wall height in metres. */
const WALL_HEIGHT = 2.5;
/** Wall thickness in metres. */
const WALL_THICKNESS = 0.6;
/** How many times floor texture tiles across the arena. */
const FLOOR_TILE_REPEAT = 8;
/** How many times wall texture tiles along one wall. */
const WALL_TILE_REPEAT_X = 6;
const WALL_TILE_REPEAT_Y = 1;
/** Shadow map resolution. */
const SHADOW_MAP_SIZE = 2048;

/* ---------- texture helpers ---------- */

const textureLoader = new TextureLoader();

function loadTex(path: string, repeatX = 1, repeatY = 1, srgb = false): Texture {
  const tex = textureLoader.load(path);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

/* ---------- public API ---------- */

export interface ArenaObjects {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
}

export function createArena(canvas: HTMLCanvasElement): ArenaObjects {
  /* --- renderer --- */
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  /* --- scene --- */
  const scene = new Scene();

  /* --- camera --- */
  const camera = new PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 12, 20);
  camera.lookAt(0, 0, 0);

  /* --- HDRI environment (sky + diffuse light) --- */
  const hdrLoader = new HDRLoader();
  hdrLoader.load('/assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr', (hdr) => {
    hdr.mapping = EquirectangularReflectionMapping;
    scene.background = hdr;
    scene.environment = hdr;
  });

  /* --- directional (sun) light with shadows --- */
  const sun = new DirectionalLight(0xfff5e0, 2.5);
  sun.position.set(10, 20, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  /* Subtle ambient fill so shadow regions aren't pitch black. */
  const ambient = new AmbientLight(0x607080, 0.4);
  scene.add(ambient);

  /* --- floor --- */
  const floorMat = new MeshStandardMaterial({
    map: loadTex('/assets/textures/stone_floor_diff_1k.jpg', FLOOR_TILE_REPEAT, FLOOR_TILE_REPEAT, true),
    normalMap: loadTex('/assets/textures/stone_floor_nor_gl_1k.jpg', FLOOR_TILE_REPEAT, FLOOR_TILE_REPEAT),
    aoMap: loadTex('/assets/textures/stone_floor_arm_1k.jpg', FLOOR_TILE_REPEAT, FLOOR_TILE_REPEAT),
    roughnessMap: loadTex('/assets/textures/stone_floor_arm_1k.jpg', FLOOR_TILE_REPEAT, FLOOR_TILE_REPEAT),
    metalnessMap: loadTex('/assets/textures/stone_floor_arm_1k.jpg', FLOOR_TILE_REPEAT, FLOOR_TILE_REPEAT),
    roughness: 1,
    metalness: 0,
  });

  const floor = new Mesh(new PlaneGeometry(ARENA_SIZE, ARENA_SIZE), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  /* --- walls --- */
  const wallMat = new MeshStandardMaterial({
    map: loadTex('/assets/textures/castle_brick_diff_1k.jpg', WALL_TILE_REPEAT_X, WALL_TILE_REPEAT_Y, true),
    normalMap: loadTex('/assets/textures/castle_brick_nor_gl_1k.jpg', WALL_TILE_REPEAT_X, WALL_TILE_REPEAT_Y),
    aoMap: loadTex('/assets/textures/castle_brick_arm_1k.jpg', WALL_TILE_REPEAT_X, WALL_TILE_REPEAT_Y),
    roughnessMap: loadTex('/assets/textures/castle_brick_arm_1k.jpg', WALL_TILE_REPEAT_X, WALL_TILE_REPEAT_Y),
    metalnessMap: loadTex('/assets/textures/castle_brick_arm_1k.jpg', WALL_TILE_REPEAT_X, WALL_TILE_REPEAT_Y),
    roughness: 1,
    metalness: 0,
  });

  const wallGeo = new BoxGeometry(ARENA_SIZE + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS);
  const sideWallGeo = new BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, ARENA_SIZE + WALL_THICKNESS);
  const half = ARENA_SIZE / 2 + WALL_THICKNESS / 2;
  const wallY = WALL_HEIGHT / 2;

  /** Create a wall mesh at the given position. */
  function addWall(geo: BoxGeometry, x: number, z: number): void {
    const wall = new Mesh(geo, wallMat);
    wall.position.set(x, wallY, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  addWall(wallGeo, 0, -half);   // north
  addWall(wallGeo, 0, half);    // south
  addWall(sideWallGeo, -half, 0); // west
  addWall(sideWallGeo, half, 0);  // east

  return { scene, camera, renderer };
}
