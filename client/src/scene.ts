/**
 * Hyper-real arena scene: golden-hour dusk light, cascaded shadow maps,
 * scanned 2K stone flag floor with parallax relief and dirt masking,
 * rolling foothills and distant mountain ridge line, atmospheric height fog,
 * wind-driven instanced grass, floating dust motes and brazier embers/smoke,
 * volumetric god rays, and filmic LUT color grading.
 */

import {
  ACESFilmicToneMapping,
  BufferGeometry,
  Color,
  FogExp2,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import balance from '../../shared/balance.json';
import type { Element } from '../../shared/src/index.js';
import { getNationGeography } from './env/nations.js';
import { QualityManager } from './env/quality.js';
import { HeightFogSystem } from './env/height-fog.js';
import { LightingSystem, SUN_AZIMUTH } from './env/lighting.js';
import { TerrainSystem, ARENA_SIZE, RADIUS } from './env/terrain.js';
import { FoliageSystem } from './env/foliage.js';
import { ParticleSystem } from './env/particles.js';
import { GodRaysSystem } from './env/godrays.js';
import { PostProcessingPipeline, SANITIZE_SHADER } from './env/postprocessing.js';

export { ARENA_SIZE, SANITIZE_SHADER };

export interface ArenaObjects {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  setSize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

export function createArena(
  canvas: HTMLCanvasElement,
  nation: Element = 'IGNIS',
  isFullMoon = false
): ArenaObjects {
  const look = balance.look;
  const geo = getNationGeography(nation);
  const met = geo.meteorology;

  // Initialize renderer
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = look.exposure ?? 0.78;
  renderer.info.autoReset = false;

  const scene = new Scene();
  (window as unknown as { arenaRenderer?: WebGLRenderer }).arenaRenderer = renderer;
  const win = window as unknown as { elements?: { renderer?: WebGLRenderer } };
  if (!win.elements) win.elements = {};
  win.elements.renderer = renderer;

  // Camera setup
  const camera = new PerspectiveCamera(
    balance.camera.fov,
    1,
    balance.camera.near,
    balance.camera.far
  );
  camera.position.set(0, 3, 8);

  // 1. Quality Manager with auto-fallback
  const qualityManager = new QualityManager();
  const quality = qualityManager.profile;

  // 2. Height Fog System attuned to nation meteorology
  const heightFog = new HeightFogSystem();
  scene.fog = new FogExp2(new Color(met.fogColor), met.fogDensity);

  // 3. Lighting System with Cascaded Shadow Maps (CSM) & Sky HDR attuned to nation
  const lighting = new LightingSystem(scene, camera, renderer, quality, nation, isFullMoon);
  heightFog.update(lighting.sunDirection);

  const setupMaterial = (mat: Material): void => {
    lighting.setupMaterial(mat);
    heightFog.setupMaterial(mat);
  };

  // Store hook on scene so async loaded props can attach
  scene.userData['setupMaterial'] = setupMaterial;

  // 4. Terrain System: Geographically attuned floor, organic perimeter wall, distant ridges
  const terrain = new TerrainSystem(scene, renderer, quality, (m) => setupMaterial(m), nation);

  // 5. Foliage System: Wind-animated instanced grass attuned to nation
  const foliage = new FoliageSystem(scene, quality, (m) => setupMaterial(m), nation);

  // 6. Particle System: Nation-attuned weather particles (ash, snow, wind, dust)
  const particles = new ParticleSystem(scene, quality, lighting.sunDirection, nation);

  // 7. God Rays: Screen-space volumetric light shafts
  const godRays = new GodRaysSystem(lighting.sunDirection, quality.enableGodRays);

  // 8. Post-Processing Pipeline
  const pipeline = new PostProcessingPipeline(renderer, scene, camera, quality, godRays);

  // Pre-warm WebGL shader compilation to prevent mid-frame pipeline stalls
  renderer.compile(scene, camera);

  // Render loop tracking
  let lastTime = performance.now();
  let heroPos: Vector3 | null = null;

  return {
    scene,
    camera,
    renderer,
    setSize(w: number, h: number): void {
      pipeline.setSize(w, h);
    },
    render(): void {
      renderer.info.reset();
      const now = performance.now();
      const deltaSec = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const elapsedSec = now * 0.001;

      // Monitor performance for 5-second automatic fallback
      qualityManager.sampleFrame(deltaSec);

      // Expose renderer on window.elements for debug telemetry and measure-fps
      const win = window as unknown as { elements?: { renderer?: WebGLRenderer } };
      if (win.elements && !win.elements.renderer) {
        win.elements.renderer = renderer;
      }

      // Update systems
      lighting.update();
      heightFog.update(lighting.sunDirection);
      foliage.update(elapsedSec);
      particles.update(elapsedSec);
      godRays.update(camera);

      // Hero contact shadow update
      if (!heroPos && (window as unknown as { elements?: { controller?: { position: Vector3 } } }).elements?.controller) {
        heroPos = (window as unknown as { elements: { controller: { position: Vector3 } } }).elements.controller.position;
      }
      if (heroPos) {
        terrain.updateHeroContact(heroPos);
      }

      pipeline.render();
    },
    dispose(): void {
      pipeline.dispose();
      lighting.dispose();
      terrain.dispose();
      foliage.dispose();
      particles.dispose();
      disposeObject(scene);
      renderer.dispose();
    },
  };
}

interface PropPlacement {
  file: string;
  x: number;
  z: number;
  scale: number;
  yaw: number;
  y?: number;
}

/** Props and crags attuned to nation geography. */
export async function loadProps(scene: Scene, loader = new GLTFLoader(), nation: Element = 'IGNIS'): Promise<void> {
  const placements: PropPlacement[] = [];

  if (nation === 'AQUES') {
    // River delta: embankment stones and boulders by the channels, no Sindr statue
    placements.push(
      { file: 'rock_face_01', x: -8, z: -8, scale: 2.8, yaw: 0.5, y: 0.2 },
      { file: 'rock_face_02', x: 9, z: -6, scale: 2.6, yaw: -0.8, y: 0.2 },
      { file: 'namaqualand_boulder_02', x: -8.5, z: 6, scale: 2.2, yaw: 1.2 },
      { file: 'namaqualand_boulder_02', x: 8, z: 8, scale: 2.0, yaw: 2.1 },
    );
  } else if (nation === 'TERRA') {
    // Canyon quarry: massive sandstone monoliths and boulders
    placements.push(
      { file: 'namaqualand_boulder_02', x: 0, z: -10, scale: 3.2, yaw: 0.2 },
      { file: 'rock_face_01', x: 9, z: 4, scale: 2.8, yaw: -1.2 },
      { file: 'rock_face_02', x: -9, z: -3, scale: 2.9, yaw: 0.8 },
      { file: 'namaqualand_boulder_02', x: 6, z: 7, scale: 2.4, yaw: 2.4 },
    );
  } else if (nation === 'AURA') {
    // Wind cliffs: tall rock faces at the cliff edge
    placements.push(
      { file: 'rock_face_01', x: 0, z: -12, scale: 3.5, yaw: 0.0, y: 0.5 },
      { file: 'rock_face_02', x: 8, z: 6, scale: 2.4, yaw: 1.5 },
      { file: 'rock_face_01', x: -8, z: 6, scale: 2.4, yaw: -1.5 },
    );
  } else {
    // IGNIS / Sindr caldera
    placements.push(
      ...balance.arena.obstacles.map((o) => ({
        file: o.file,
        x: o.x,
        z: o.z,
        scale: o.scale,
        yaw: o.yaw,
      }))
    );
  }

  // Crags ring the perimeter beyond the wall
  const crags = ['rock_face_01', 'rock_face_02'];
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + 0.2;
    const distance = RADIUS + 6.5 + (i % 3) * 2.5;
    placements.push({
      file: crags[i % 2]!,
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      scale: 2.2 + (i % 4) * 0.4,
      yaw: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
      y: 0.15 + (i % 3) * 0.35,
    });
  }

  for (const angle of [0.9, 2.6, 4.1, 5.5]) {
    placements.push({
      file: 'rock_moss_set_01',
      x: Math.cos(angle) * (RADIUS + 9),
      z: Math.sin(angle) * (RADIUS + 9),
      scale: 1.3,
      yaw: angle,
      y: 0.5,
    });
  }

  const setupMaterial = scene.userData['setupMaterial'] as ((mat: Material) => void) | undefined;
  const sources = new Map<string, Object3D>();

  await Promise.all(
    [...new Set(placements.map((p) => p.file))].map(async (file) => {
      const gltf = await loader.loadAsync(`/assets/props/${file}.glb`);
      gltf.scene.traverse((node) => {
        if (node instanceof Mesh) {
          node.castShadow = !file.startsWith('rock_');
          node.receiveShadow = true;
          if (setupMaterial && node.material) {
            setupMaterial(node.material);
          }
        }
      });
      sources.set(file, gltf.scene);
    })
  );

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

  root.traverse((node) => {
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

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}
