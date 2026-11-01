import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

interface KitMaterial {
  id: string;
  name: string;
  category: string;
  source: string;
  sourceUrl: string;
  license: string;
  tiling: number;
  sizeHighKB: number;
  sizeLowKB: number;
  files: {
    high: {
      diffKtx2: string;
      norKtx2: string;
      armKtx2: string;
    };
    low: {
      diffKtx2: string;
      norKtx2: string;
      armKtx2: string;
    };
  };
}

interface KitModel {
  id: string;
  name: string;
  category: string;
  source: string;
  sourceUrl: string;
  license: string;
  sizeHighKB: number;
  sizeLowKB: number;
  trianglesHigh: number;
  trianglesLow: number;
  files: {
    high: string;
    low: string;
  };
}

interface KitData {
  name: string;
  version: string;
  totalSizeHighKB: number;
  totalSizeLowKB: number;
  materials: KitMaterial[];
  models: KitModel[];
}

// Global state
let currentMode: 'MAT_SHEET' | 'MAT_INSPECTOR' | 'MODEL_TURNTABLE' = 'MAT_SHEET';
let qualityMode: 'high' | 'low' = 'high';
let kitData: KitData | null = null;
let selectedMaterialId = 'basalt_cobblestone';
let selectedModelId = 'boulder_small';
let isRotating = true;

// Three.js instances
const canvas = document.getElementById('kit-canvas') as HTMLCanvasElement;
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();
scene.background = new Color(0x0e0c0b);

const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 150);
camera.position.set(0, 3.5, 7.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 45;
controls.minDistance = 0.5;
controls.target.set(0, 0.8, 0);

// Lighting matching scene.ts
const hemiLight = new HemisphereLight(0x444455, 0x221108, 0.65);
scene.add(hemiLight);

const ambientLight = new AmbientLight(0x181412, 0.4);
scene.add(ambientLight);

const SUN_AZIMUTH = 2.6;
const sunElevation = 18 * (Math.PI / 180);
const sunLight = new DirectionalLight(0xffe0bd, 2.4);
sunLight.position.set(
  Math.cos(sunElevation) * Math.cos(SUN_AZIMUTH) * 50,
  Math.sin(sunElevation) * 50,
  Math.cos(sunElevation) * Math.sin(SUN_AZIMUTH) * 50
);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 100;
sunLight.shadow.camera.left = -15;
sunLight.shadow.camera.right = 15;
sunLight.shadow.camera.top = 15;
sunLight.shadow.camera.bottom = -15;
sunLight.shadow.bias = -0.0001;
scene.add(sunLight);

// Load HDRI environment
const hdrLoader = new HDRLoader();
hdrLoader.load('/assets/hdri/belfast_sunset_puresky_1k.hdr', (envTex) => {
  envTex.mapping = EquirectangularReflectionMapping;
  scene.environment = envTex;
});

// Loaders
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('/assets/env/ignis/basis/');
ktx2Loader.detectSupport(renderer);

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

// Content root groups
const sheetGroup = new Group();
const inspectorGroup = new Group();
const modelGroup = new Group();
scene.add(sheetGroup);
scene.add(inspectorGroup);
scene.add(modelGroup);

// Texture cache
const texCache = new Map<string, Texture>();

function loadTexture(pathStr: string, srgb = false, repeat: [number, number] = [1, 1]): Promise<Texture> {
  const key = `${pathStr}_${repeat[0]}_${repeat[1]}_${srgb}`;
  if (texCache.has(key)) return Promise.resolve(texCache.get(key)!);

  return new Promise((resolve) => {
    const onLoaded = (tex: Texture) => {
      tex.wrapS = RepeatWrapping;
      tex.wrapT = RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      tex.anisotropy = 8;
      if (srgb) tex.colorSpace = SRGBColorSpace;
      texCache.set(key, tex);
      resolve(tex);
    };

    ktx2Loader.load(pathStr, onLoaded, undefined, (error) => {
      console.warn(`Texture ${pathStr} failed:`, error);
      resolve(new Texture());
    });
  });
}

async function createMaterialInstance(matDef: KitMaterial, tiling: number): Promise<MeshStandardMaterial> {
  const fileSet = qualityMode === 'high' ? matDef.files.high : matDef.files.low;
  const rx = tiling;
  const ry = tiling;

  // Use KTX2 textures
  const [diffTex, norTex, armTex] = await Promise.all([
    loadTexture(fileSet.diffKtx2, true, [rx, ry]),
    loadTexture(fileSet.norKtx2, false, [rx, ry]),
    loadTexture(fileSet.armKtx2, false, [rx, ry]),
  ]);

  return new MeshStandardMaterial({
    map: diffTex,
    normalMap: norTex,
    aoMap: armTex,
    roughnessMap: armTex,
    roughness: 1.0,
    metalness: matDef.id === 'blackened_rusted_iron' ? 0.75 : 0.0,
  });
}

// Build Sheet View (All 8 materials side by side)
async function buildMaterialsSheet() {
  sheetGroup.clear();
  if (!kitData) return;

  const materials = kitData.materials;
  const cols = 4;
  const spacingX = 3.6;
  const spacingZ = 4.2;

  for (let i = 0; i < materials.length; i++) {
    const matDef = materials[i];
    if (!matDef) continue;
    const col = i % cols;
    const row = Math.floor(i / cols);

    const posX = (col - (cols - 1) / 2) * spacingX;
    const posZ = (row - 0.5) * spacingZ;

    const group = new Group();
    group.position.set(posX, 0, posZ);

    const pbrMat = await createMaterialInstance(matDef, 2.0);

    // 2m Sphere (radius 1m)
    const sphereGeo = new SphereGeometry(0.85, 48, 24);
    const sphereMesh = new Mesh(sphereGeo, pbrMat);
    sphereMesh.position.set(0, 1.4, 0);
    sphereMesh.castShadow = true;
    sphereMesh.receiveShadow = true;
    group.add(sphereMesh);

    // 2.8m x 2.8m Tiled Floor Slab
    const slabGeo = new PlaneGeometry(2.6, 2.6, 24, 24);
    const slabMesh = new Mesh(slabGeo, pbrMat);
    slabMesh.rotation.x = -Math.PI / 2;
    slabMesh.position.set(0, 0.05, 0);
    slabMesh.receiveShadow = true;
    group.add(slabMesh);

    // Dark Basalt Pedestal base
    const baseGeo = new PlaneGeometry(2.8, 2.8);
    const baseMat = new MeshStandardMaterial({ color: 0x141211, roughness: 0.95 });
    const baseMesh = new Mesh(baseGeo, baseMat);
    baseMesh.rotation.x = -Math.PI / 2;
    baseMesh.position.set(0, 0.0, 0);
    group.add(baseMesh);

    sheetGroup.add(group);
  }
}

// Build Inspector View
async function buildMaterialInspector() {
  inspectorGroup.clear();
  if (!kitData) return;

  const matDef = kitData.materials.find((m) => m.id === selectedMaterialId) || kitData.materials[0];
  if (!matDef) return;
  const pbrMat = await createMaterialInstance(matDef, 4.0 / matDef.tiling);

  // 2 m Sphere (diameter = 2m, radius = 1m)
  const sphereGeo = new SphereGeometry(1.0, 64, 32);
  const sphereMesh = new Mesh(sphereGeo, pbrMat);
  sphereMesh.position.set(0, 1.8, 0);
  sphereMesh.castShadow = true;
  sphereMesh.receiveShadow = true;
  inspectorGroup.add(sphereMesh);

  // 4x4 m Tiled ground plane
  const planeGeo = new PlaneGeometry(4.0, 4.0, 64, 64);
  const planeMesh = new Mesh(planeGeo, pbrMat);
  planeMesh.rotation.x = -Math.PI / 2;
  planeMesh.position.set(0, 0.02, 0);
  planeMesh.receiveShadow = true;
  inspectorGroup.add(planeMesh);

  // Pedestal rim
  const rimGeo = new PlaneGeometry(4.4, 4.4);
  const rimMat = new MeshStandardMaterial({ color: 0x110f0e, roughness: 0.95 });
  const rimMesh = new Mesh(rimGeo, rimMat);
  rimMesh.rotation.x = -Math.PI / 2;
  rimMesh.position.set(0, 0.0, 0);
  inspectorGroup.add(rimMesh);

  updateSidebarMeta(matDef.name, matDef.category, `${qualityMode === 'high' ? '2K' : '1K'} (KTX2 / UASTC + ETC1S)`, `${qualityMode === 'high' ? matDef.sizeHighKB : matDef.sizeLowKB} KB`, matDef.source);
}

// Load Model Turntable
let currentLoadedModel: Group | null = null;

function loadModelTurntable() {
  modelGroup.clear();
  currentLoadedModel = null;
  if (!kitData) return;

  const modelDef = kitData.models.find((m) => m.id === selectedModelId) || kitData.models[0];
  if (!modelDef) return;
  const glbUrl = qualityMode === 'high' ? modelDef.files.high : modelDef.files.low;

  // Turntable circular pedestal
  const pedGeo = new SphereGeometry(2.2, 32, 16);
  pedGeo.scale(1, 0.08, 1);
  const pedMat = new MeshStandardMaterial({ color: 0x181514, roughness: 0.85 });
  const pedMesh = new Mesh(pedGeo, pedMat);
  pedMesh.position.set(0, 0, 0);
  pedMesh.receiveShadow = true;
  modelGroup.add(pedMesh);

  gltfLoader.load(glbUrl, (gltf) => {
    const root = gltf.scene;
    root.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    // Auto-center and normalize scale if huge
    const box = new Box3().setFromObject(root);
    const size = new Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 3.5) {
      const scale = 3.0 / maxDim;
      root.scale.set(scale, scale, scale);
    }

    const boxAfter = new Box3().setFromObject(root);
    const center = new Vector3();
    boxAfter.getCenter(center);
    root.position.x = -center.x;
    root.position.z = -center.z;
    root.position.y = -boxAfter.min.y + 0.08;

    currentLoadedModel = root;
    modelGroup.add(root);
  });

  const tris = qualityMode === 'high' ? modelDef.trianglesHigh : modelDef.trianglesLow;
  const sz = qualityMode === 'high' ? modelDef.sizeHighKB : modelDef.sizeLowKB;
  updateSidebarMeta(modelDef.name, modelDef.category, `${qualityMode === 'high' ? 'High LOD' : 'Low LOD'} (Meshopt)`, `${sz} KB (${tris} triangles)`, modelDef.source);
}

function updateSidebarMeta(name: string, cat: string, res: string, size: string, source: string) {
  document.getElementById('meta-name')!.textContent = name;
  document.getElementById('meta-cat')!.textContent = cat;
  document.getElementById('meta-res')!.textContent = res;
  document.getElementById('meta-size')!.textContent = size;
  document.getElementById('meta-source')!.textContent = source;
}

function updateSidebarList() {
  const container = document.getElementById('selector-list')!;
  container.innerHTML = '';

  if (currentMode === 'MAT_SHEET' || currentMode === 'MAT_INSPECTOR') {
    document.getElementById('sidebar-heading')!.textContent = 'Materials (8 PBR)';
    kitData?.materials.forEach((m) => {
      const btn = document.createElement('button');
      btn.className = `selector-item ${m.id === selectedMaterialId ? 'active' : ''}`;
      btn.innerHTML = `<span>${m.name}</span><span style="font-size:10px;color:#78716c;">${m.tiling}m</span>`;
      btn.onclick = () => {
        selectedMaterialId = m.id;
        updateSidebarList();
        if (currentMode === 'MAT_SHEET') {
          switchMode('MAT_INSPECTOR');
        } else {
          buildMaterialInspector();
        }
      };
      container.appendChild(btn);
    });
  } else {
    document.getElementById('sidebar-heading')!.textContent = 'Models (17 Scans / Props)';
    kitData?.models.forEach((mod) => {
      const btn = document.createElement('button');
      btn.className = `selector-item ${mod.id === selectedModelId ? 'active' : ''}`;
      btn.innerHTML = `<span>${mod.name}</span><span style="font-size:10px;color:#78716c;">${mod.category}</span>`;
      btn.onclick = () => {
        selectedModelId = mod.id;
        updateSidebarList();
        loadModelTurntable();
      };
      container.appendChild(btn);
    });
  }
}

function switchMode(newMode: 'MAT_SHEET' | 'MAT_INSPECTOR' | 'MODEL_TURNTABLE') {
  currentMode = newMode;
  document.getElementById('tab-mat-sheet')!.className = `tab-btn ${newMode === 'MAT_SHEET' ? 'active' : ''}`;
  document.getElementById('tab-materials')!.className = `tab-btn ${newMode === 'MAT_INSPECTOR' ? 'active' : ''}`;
  document.getElementById('tab-models')!.className = `tab-btn ${newMode === 'MODEL_TURNTABLE' ? 'active' : ''}`;

  sheetGroup.visible = newMode === 'MAT_SHEET';
  inspectorGroup.visible = newMode === 'MAT_INSPECTOR';
  modelGroup.visible = newMode === 'MODEL_TURNTABLE';

  updateSidebarList();

  if (newMode === 'MAT_SHEET') {
    camera.position.set(0, 6.5, 9.5);
    controls.target.set(0, 0.4, 0);
    controls.update();
  } else if (newMode === 'MAT_INSPECTOR') {
    camera.position.set(0, 2.4, 4.6);
    controls.target.set(0, 1.2, 0);
    controls.update();
    buildMaterialInspector();
  } else {
    camera.position.set(0, 2.2, 4.4);
    controls.target.set(0, 1.0, 0);
    controls.update();
    loadModelTurntable();
  }
}

function setQuality(newQ: 'high' | 'low') {
  qualityMode = newQ;
  document.getElementById('btn-high')!.className = `quality-btn ${newQ === 'high' ? 'active' : ''}`;
  document.getElementById('btn-low')!.className = `quality-btn ${newQ === 'low' ? 'active' : ''}`;
  document.getElementById('stat-quality')!.textContent = newQ.toUpperCase();

  buildMaterialsSheet();
  if (currentMode === 'MAT_INSPECTOR') buildMaterialInspector();
  if (currentMode === 'MODEL_TURNTABLE') loadModelTurntable();
}

// UI bindings
document.getElementById('tab-mat-sheet')!.onclick = () => switchMode('MAT_SHEET');
document.getElementById('tab-materials')!.onclick = () => switchMode('MAT_INSPECTOR');
document.getElementById('tab-models')!.onclick = () => switchMode('MODEL_TURNTABLE');

document.getElementById('btn-high')!.onclick = () => setQuality('high');
document.getElementById('btn-low')!.onclick = () => setQuality('low');

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    isRotating = !isRotating;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Load kit.json
async function init() {
  // Query param quality check
  const params = new URLSearchParams(window.location.search);
  if (params.get('quality') === 'low') {
    qualityMode = 'low';
    document.getElementById('btn-high')!.classList.remove('active');
    document.getElementById('btn-low')!.classList.add('active');
    document.getElementById('stat-quality')!.textContent = 'LOW (1K)';
  }

  const res = await fetch('/assets/env/ignis/kit.json');
  kitData = await res.json();

  await buildMaterialsSheet();
  updateSidebarList();
  switchMode(currentMode);

  // Expose for Playwright verification
  (window as unknown as { __IGNIS_KIT__: unknown }).__IGNIS_KIT__ = {
    kitData,
    switchMode,
    setQuality,
    renderer,
  };
}

init();

// Animation & Render loop
let frameCount = 0;
let lastFpsTime = performance.now();
const fpsElem = document.getElementById('stat-fps')!;
const drawCallsElem = document.getElementById('stat-drawcalls')!;
const trisElem = document.getElementById('stat-tris')!;

function animate(time: number) {
  requestAnimationFrame(animate);

  controls.update();

  if (isRotating && currentLoadedModel) {
    currentLoadedModel.rotation.y += 0.008;
  }

  renderer.render(scene, camera);

  // Stats
  frameCount++;
  if (time - lastFpsTime >= 500) {
    const fps = Math.round((frameCount * 1000) / (time - lastFpsTime));
    fpsElem.textContent = `${fps}`;
    drawCallsElem.textContent = `${renderer.info.render.calls}`;
    trisElem.textContent = `${(renderer.info.render.triangles / 1000).toFixed(1)}k`;
    frameCount = 0;
    lastFpsTime = time;
  }
}

requestAnimationFrame(animate);
