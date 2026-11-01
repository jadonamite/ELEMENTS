import RAPIER from '@dimforge/rapier3d-compat';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  EmberHound,
  HoundPack,
  type HoundQuarry,
  type HoundTemplate,
  loadHoundTemplate,
} from './hound.js';

// Setup canvas and renderer
const canvas = document.getElementById('hound-canvas') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
scene.background = new Color(0x140e0b);
scene.fog = new FogExp2(0x140e0b, 0.02);

// Camera and Controls
const camera = new PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 150);
camera.position.set(0, 7, 14);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.minDistance = 3;
controls.maxDistance = 40;

let followTarget = true;

// Lighting
const ambient = new AmbientLight(0x38221b, 1.4);
scene.add(ambient);

const sun = new DirectionalLight(0xffdfb8, 2.5);
sun.position.set(15, 24, 18);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
sun.shadow.bias = -0.0002;
scene.add(sun);

// Stone Floor
const floorGeo = new PlaneGeometry(80, 80);
const floorMat = new MeshStandardMaterial({
  color: 0x221d1b,
  roughness: 0.85,
  metalness: 0.1,
});
const floorMesh = new Mesh(floorGeo, floorMat);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

// Stand-in Target (Capsule representing player hero)
const targetGeo = new CapsuleGeometry(0.3, 1.2, 8, 16);
const targetMat = new MeshStandardMaterial({
  color: 0x38bdf8,
  roughness: 0.4,
  metalness: 0.2,
  emissive: 0x0284c7,
  emissiveIntensity: 0.3,
});
const targetMesh = new Mesh(targetGeo, targetMat);
targetMesh.position.set(0, 0.9, 0);
targetMesh.castShadow = true;
scene.add(targetMesh);

// Target Input State
const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w') keys.w = true;
  if (k === 'a') keys.a = true;
  if (k === 's') keys.s = true;
  if (k === 'd') keys.d = true;
  if (e.code === 'Space') respawn();
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w') keys.w = false;
  if (k === 'a') keys.a = false;
  if (k === 's') keys.s = false;
  if (k === 'd') keys.d = false;
});

// Quarry definition for hounds
const quarry: HoundQuarry = {
  position: targetMesh.position,
  alive: true,
  takeHit: (damage, origin) => {
    logCombat(`Quarry bitten for ${damage} damage!`, 'log-entry');
    targetMat.emissive.setHex(0xef4444);
    setTimeout(() => targetMat.emissive.setHex(0x0284c7), 120);
  },
};

// Combat log helper
const logContainer = document.getElementById('combat-log')!;
function logCombat(text: string, className = 'log-entry') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${className}`;
  entry.textContent = text;
  logContainer.prepend(entry);
  if (logContainer.children.length > 6) {
    logContainer.removeChild(logContainer.lastChild!);
  }
}

// Raycasting for clicking to strike
const raycaster = new Raycaster();
const mouse = new Vector2();

window.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // Find all hound meshes
  const houndMeshes: Mesh[] = [];
  const meshToHound = new Map<Mesh, EmberHound>();

  for (const pack of activePacks) {
    for (const h of pack.hounds) {
      if (!h.alive) continue;
      h.model.traverse((node) => {
        if ((node as Mesh).isMesh) {
          houndMeshes.push(node as Mesh);
          meshToHound.set(node as Mesh, h);
        }
      });
    }
  }

  const hits = raycaster.intersectObjects(houndMeshes, false);
  if (hits.length > 0) {
    const first = hits[0]!;
    const hitHound = meshToHound.get(first.object as Mesh);
    if (hitHound) {
      const res = hitHound.hit(25, first.point, targetMesh.position);
      if (res.isWeakSpot) {
        logCombat(`CRITICAL WEAK SPOT HIT! 2x damage (${res.damage}) and STAGGER!`, 'log-weakspot');
      } else {
        logCombat(`Hit Ember Hound for ${res.damage} damage.`, 'log-entry');
      }
      if (!hitHound.alive) {
        const dropNames = (hitHound.drops ?? []).map((d) => `${d.name} x${d.count}`).join(', ');
        logCombat(`Ember Hound died! Dropped: ${dropNames}`, 'log-death');
      }
    }
  }
});

// Badges Container for floating HP and State
const labelsContainer = document.getElementById('labels-container')!;
interface HoundBadge {
  el: HTMLElement;
  stateText: HTMLElement;
  fill: HTMLElement;
  hound: EmberHound;
}
const badges: HoundBadge[] = [];

function createBadge(hound: EmberHound): HoundBadge {
  const el = document.createElement('div');
  el.className = 'hound-badge';

  const stateText = document.createElement('div');
  stateText.className = 'hound-state-text';
  stateText.textContent = hound.state;

  const bar = document.createElement('div');
  bar.className = 'hound-hp-bar';

  const fill = document.createElement('div');
  fill.className = 'hound-hp-fill';
  fill.style.width = '100%';

  bar.appendChild(fill);
  el.appendChild(stateText);
  el.appendChild(bar);
  labelsContainer.appendChild(el);

  return { el, stateText, fill, hound };
}

// UI Buttons
document.getElementById('btn-cam-follow')?.addEventListener('click', () => {
  followTarget = true;
});
document.getElementById('btn-cam-free')?.addEventListener('click', () => {
  followTarget = false;
});
document.getElementById('btn-pack-3')?.addEventListener('click', () => {
  setPackCount(1);
});
document.getElementById('btn-pack-9')?.addEventListener('click', () => {
  setPackCount(3);
});
document.getElementById('btn-reset')?.addEventListener('click', () => {
  respawn();
});

// App State
let world: RAPIER.World;
let template: HoundTemplate;
let activePacks: HoundPack[] = [];
let targetPackCount = 1;

async function init() {
  await RAPIER.init();
  world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));

  // Floor collider
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.05, 40), floorBody);

  // Load Hound Template
  const gltfLoader = new GLTFLoader();
  template = await loadHoundTemplate(gltfLoader, renderer);
  setPackCount(1);

  requestAnimationFrame(loop);
}

function setPackCount(count: number) {
  targetPackCount = count;
  respawn();
}

function respawn() {
  for (const pack of activePacks) {
    for (const h of pack.hounds) {
      scene.remove(h.model);
    }
  }
  activePacks = [];
  labelsContainer.innerHTML = '';
  badges.length = 0;

  const packOffsets = targetPackCount === 1
    ? [{ x: 0, z: -8 }]
    : [
        { x: 0, z: -9 },
        { x: -9, z: -5 },
        { x: 9, z: -5 },
      ];

  for (const offset of packOffsets) {
    const pack = new HoundPack(template, world, offset, true);
    for (const h of pack.hounds) {
      scene.add(h.model);
      badges.push(createBadge(h));
    }
    activePacks.push(pack);
  }

  const statCount = document.getElementById('stat-count');
  if (statCount) statCount.textContent = (targetPackCount * 3).toString();
  logCombat(`Spawned ${targetPackCount * 3} hounds (${targetPackCount} pack).`, 'log-entry');
}

// Performance Tracking
let lastTime = performance.now();
const frameDeltas: number[] = [];
const renderPassTimes: number[] = [];
const statFps = document.getElementById('stat-fps')!;
const statMs = document.getElementById('stat-ms')!;
const statHeadroom = document.getElementById('stat-headroom')!;
let perfTimer = 0;

function loop(now: number) {
  requestAnimationFrame(loop);

  const deltaMs = now - lastTime;
  lastTime = now;
  const dt = Math.min(deltaMs / 1000, 0.1);

  frameDeltas.push(deltaMs);
  if (frameDeltas.length > 60) frameDeltas.shift();

  // Measure actual update & render workload (uncapped compute time)
  const workStart = performance.now();

  // Update Stand-in Target movement
  const speed = 5.0;
  let moveX = 0, moveZ = 0;
  if (keys.w) moveZ -= 1;
  if (keys.s) moveZ += 1;
  if (keys.a) moveX -= 1;
  if (keys.d) moveX += 1;

  if (moveX !== 0 || moveZ !== 0) {
    const len = Math.hypot(moveX, moveZ);
    targetMesh.position.x += (moveX / len) * speed * dt;
    targetMesh.position.z += (moveZ / len) * speed * dt;
  }

  // Update Hounds and Physics
  for (const pack of activePacks) {
    pack.update(dt, quarry);
  }

  // Update Badges on Screen
  const tempV = new Vector3();
  for (const b of badges) {
    if (!b.hound.alive && b.hound.state === 'death') {
      b.fill.style.width = '0%';
      b.stateText.textContent = 'DEAD';
      b.stateText.style.color = '#78716c';
    } else {
      b.stateText.textContent = b.hound.state;
      const hpPct = Math.max(0, Math.min(100, (b.hound.health / b.hound.maxHealth) * 100));
      b.fill.style.width = hpPct + '%';
    }

    tempV.copy(b.hound.position);
    tempV.y += 1.3;
    tempV.project(camera);

    if (tempV.z > 1) {
      b.el.style.display = 'none';
    } else {
      b.el.style.display = 'flex';
      const x = (tempV.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-(tempV.y * 0.5) + 0.5) * window.innerHeight;
      b.el.style.left = `${x}px`;
      b.el.style.top = `${y}px`;
    }
  }

  // Camera Follow
  if (followTarget) {
    controls.target.lerp(targetMesh.position, 0.1);
  }
  controls.update();

  renderer.render(scene, camera);

  const workElapsed = performance.now() - workStart;
  renderPassTimes.push(workElapsed);
  if (renderPassTimes.length > 60) renderPassTimes.shift();

  perfTimer += dt;
  if (perfTimer >= 0.25) {
    perfTimer = 0;
    const avgWorkMs = renderPassTimes.reduce((a, b) => a + b, 0) / renderPassTimes.length;
    const avgDeltaMs = frameDeltas.reduce((a, b) => a + b, 0) / frameDeltas.length;
    const fps = Math.round(1000 / Math.max(0.001, avgDeltaMs));
    statFps.textContent = fps.toString();
    statMs.textContent = avgWorkMs.toFixed(2) + ' ms';
    // Headroom against 16.67ms (60 fps frame budget)
    const headroom = Math.max(0, Math.round(((16.67 - avgWorkMs) / 16.67) * 100));
    statHeadroom.textContent = headroom + ' %';
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Expose on window for test automation and diagnostics
(window as unknown as { houndTest: unknown }).houndTest = {
  scene,
  camera,
  controls,
  targetMesh,
  quarry,
  getActivePacks: () => activePacks,
  setFollowTarget: (f: boolean) => { followTarget = f; },
  setPackCount,
  respawn,
  logCombat,
};

init().catch(console.error);
