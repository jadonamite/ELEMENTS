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
import {
  EmberHound,
  HoundPack,
  type HoundQuarry,
  type HoundTemplate,
  loadHoundTemplate,
} from './hound.js';
import { Enemy, type EnemyTemplate, loadEnemyTemplate, type Quarry } from '../enemy.js';
import {
  ClientRobberGang,
  DEFAULT_ROBBER_LIMITS,
} from '../agents/outlaws/robberGang.js';
import type { OutlawSenses } from '../../../shared/src/agents/index.js';

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
controls.minDistance = 2;
controls.maxDistance = 50;

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

// Stand-in Target (Hero)
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

// Input State
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

// Combat Log
const logContainer = document.getElementById('combat-log')!;
function logCombat(text: string, className = 'log-entry') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${className}`;
  entry.textContent = text;
  logContainer.prepend(entry);
  if (logContainer.children.length > 7) {
    logContainer.removeChild(logContainer.lastChild!);
  }
}

// Kill Drop Hook (returns nothing itself, pure hook for economy lane)
const onKillDropHook = (kind: string, pos: { x: number; y: number; z: number }) => {
  logCombat(`onKill("${kind}", x:${pos.x.toFixed(1)}, z:${pos.z.toFixed(1)}) triggered [Economy Hook]`, 'log-death');
};

// Quarry definition for creatures and enemies
const quarry: HoundQuarry & Quarry = {
  position: targetMesh.position,
  alive: true,
  takeHit: (damage) => {
    logCombat(`Target struck for ${damage} damage!`, 'log-entry');
    targetMat.emissive.setHex(0xef4444);
    setTimeout(() => targetMat.emissive.setHex(0x0284c7), 120);
  },
};

// Mode state: 'hound' or 'robber'
let currentMode: 'hound' | 'robber' = 'hound';
let carriedChroma = 500;
let timeOfDay: 'day' | 'night' = 'night';
let hour = 23;
let zoneType: 'alley' | 'open_street' | 'road_out_of_town' = 'alley';

// Raycasting for clicking to strike
const raycaster = new Raycaster();
const mouse = new Vector2();

window.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  if (currentMode === 'hound') {
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
        const res = hitHound.hit(30, first.point, targetMesh.position);
        if (res.isWeakSpot) {
          logCombat(`CRITICAL WEAK SPOT HIT! 2x damage (${res.damage}) and STAGGER!`, 'log-weakspot');
        } else {
          logCombat(`Hit Ember Hound for ${res.damage} damage.`, 'log-entry');
        }
        if (!hitHound.alive) {
          logCombat(`Ember Hound died! Economy onKill hook triggered.`, 'log-death');
        }
      }
    }
  } else if (currentMode === 'robber' && robberGang) {
    const enemyMeshes: Mesh[] = [];
    const meshToEnemy = new Map<Mesh, Enemy>();

    for (const enemy of robberGang.activeEnemies.values()) {
      if (!enemy.alive) continue;
      enemy.model.traverse((node) => {
        if ((node as Mesh).isMesh) {
          enemyMeshes.push(node as Mesh);
          meshToEnemy.set(node as Mesh, enemy);
        }
      });
    }

    const hits = raycaster.intersectObjects(enemyMeshes, false);
    if (hits.length > 0) {
      const first = hits[0]!;
      const enemy = meshToEnemy.get(first.object as Mesh);
      if (enemy) {
        const newHealth = { current: Math.max(0, enemy.health.current - 45), maximum: enemy.health.maximum };
        const killed = enemy.hurt(newHealth, 'heavy_1', targetMesh.position, false);
        logCombat(`Hit robber! Health: ${newHealth.current}/${newHealth.maximum}`, 'log-entry');
        if (killed) {
          logCombat(`Robber killed! onKill hook triggered.`, 'log-death');
        } else if (newHealth.current <= enemy.health.maximum * 0.4) {
          enemy.flee();
          logCombat(`Robber takes critical wounds and runs!`, 'log-retreat');
        }
      }
    }
  }
});

// Floating Badges
const labelsContainer = document.getElementById('labels-container')!;
interface EntityBadge {
  el: HTMLElement;
  stateText: HTMLElement;
  fill: HTMLElement;
  getPos: () => Vector3;
  getState: () => string;
  getHealthPct: () => number;
  getRole: () => string;
  isAlive: () => boolean;
}
const badges: EntityBadge[] = [];

function createBadge(badgeDef: Omit<EntityBadge, 'el' | 'stateText' | 'fill'>): EntityBadge {
  const el = document.createElement('div');
  el.className = 'hound-badge';

  const stateText = document.createElement('div');
  stateText.className = 'hound-state-text';

  const bar = document.createElement('div');
  bar.className = 'hound-hp-bar';

  const fill = document.createElement('div');
  fill.className = 'hound-hp-fill';
  fill.style.width = '100%';

  bar.appendChild(fill);
  el.appendChild(stateText);
  el.appendChild(bar);
  labelsContainer.appendChild(el);

  return { el, stateText, fill, ...badgeDef };
}

// UI Buttons
document.getElementById('btn-mode-hound')?.addEventListener('click', () => switchMode('hound'));
document.getElementById('btn-mode-robber')?.addEventListener('click', () => switchMode('robber'));

document.getElementById('btn-cam-follow')?.addEventListener('click', () => {
  followTarget = true;
});
document.getElementById('btn-cam-overhead')?.addEventListener('click', () => {
  followTarget = false;
  camera.position.set(0, 15, 0.1);
  controls.target.set(0, 0, 0);
  controls.update();
});
document.getElementById('btn-cam-closeup')?.addEventListener('click', () => {
  followTarget = false;
  if (currentMode === 'hound' && activePacks.length > 0 && activePacks[0]!.hounds.length > 0) {
    const h = activePacks[0]!.hounds[0]!;
    camera.position.set(h.position.x + 1.8, h.position.y + 0.85, h.position.z + 2.2);
    controls.target.set(h.position.x - 0.1, h.position.y + 0.5, h.position.z);
    controls.update();
  }
});
document.getElementById('btn-lighting-dusk')?.addEventListener('click', () => {
  scene.background = new Color(0x381e14);
  scene.fog = new FogExp2(0x381e14, 0.025);
  sun.color.setHex(0xff7733);
  sun.intensity = 1.8;
  ambient.color.setHex(0x442211);
  ambient.intensity = 1.2;
  logCombat('Lighting set to Dusk in wild lands.', 'log-alert');
});

document.getElementById('btn-pack-3')?.addEventListener('click', () => setPackCount(1));
document.getElementById('btn-pack-9')?.addEventListener('click', () => setPackCount(3));
document.getElementById('btn-kill-leader')?.addEventListener('click', () => killLeader());

document.getElementById('btn-carry-500')?.addEventListener('click', () => setCarry(500));
document.getElementById('btn-carry-20')?.addEventListener('click', () => setCarry(20));
document.getElementById('btn-toggle-time')?.addEventListener('click', () => toggleTime());
document.getElementById('btn-wound-robber')?.addEventListener('click', () => woundRobberToFlee());
document.getElementById('btn-reset')?.addEventListener('click', () => respawn());

// App State
let world: RAPIER.World;
let template: HoundTemplate;
let enemyTemplate: EnemyTemplate | null = null;
let activePacks: HoundPack[] = [];
let targetPackCount = 1;
let robberGang: ClientRobberGang | null = null;

async function init() {
  await RAPIER.init();
  world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));

  // Floor collider
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.05, 40), floorBody);

  // Load Hound Template
  const gltfLoader = new GLTFLoader();
  template = await loadHoundTemplate(gltfLoader, renderer);

  // Load Villain Template for Outlaws
  try {
    enemyTemplate = await loadEnemyTemplate(gltfLoader);
  } catch (err) {
    console.warn('Failed loading enemy template:', err);
  }

  setPackCount(1);
  requestAnimationFrame(loop);
}

function switchMode(mode: 'hound' | 'robber') {
  currentMode = mode;
  document.getElementById('btn-mode-hound')?.classList.toggle('active', mode === 'hound');
  document.getElementById('btn-mode-robber')?.classList.toggle('active', mode === 'robber');

  const houndCtrl = document.getElementById('hound-ctrl-group')!;
  const btnPack3 = document.getElementById('btn-pack-3')!;
  const btnPack9 = document.getElementById('btn-pack-9')!;
  const btnKillLead = document.getElementById('btn-kill-leader')!;

  const robberCtrl = document.getElementById('robber-ctrl-group')!;
  const btn500 = document.getElementById('btn-carry-500')!;
  const btn20 = document.getElementById('btn-carry-20')!;
  const btnToggleTime = document.getElementById('btn-toggle-time')!;
  const btnWoundRobber = document.getElementById('btn-wound-robber')!;

  const statMode = document.getElementById('stat-mode')!;
  statMode.textContent = mode === 'hound' ? 'Hounds' : 'Robber Gang';

  if (mode === 'hound') {
    houndCtrl.style.display = '';
    btnPack3.style.display = '';
    btnPack9.style.display = '';
    btnKillLead.style.display = '';

    robberCtrl.style.display = 'none';
    btn500.style.display = 'none';
    btn20.style.display = 'none';
    btnToggleTime.style.display = 'none';
    btnWoundRobber.style.display = 'none';

    document.getElementById('view-title')!.textContent = 'Ember Hound Pack — Creatures Lane';
    document.getElementById('view-sub')!.textContent = 'Leader stalks in front, flankers circle. When leader falls, flankers retreat.';
  } else {
    houndCtrl.style.display = 'none';
    btnPack3.style.display = 'none';
    btnPack9.style.display = 'none';
    btnKillLead.style.display = 'none';

    robberCtrl.style.display = '';
    btn500.style.display = '';
    btn20.style.display = '';
    btnToggleTime.style.display = '';
    btnWoundRobber.style.display = '';

    document.getElementById('view-title')!.textContent = 'Robber Gang Ambush Simulation — AGENTS 15';
    document.getElementById('view-sub')!.textContent = '500 CHROMA at night draws ambush; 20 CHROMA ignored; losing robber runs; gang remembers player.';
  }

  respawn();
}

function setCarry(chroma: number) {
  carriedChroma = chroma;
  const el = document.getElementById('stat-carry')!;
  el.textContent = `${carriedChroma} CHROMA`;
  logCombat(`Player now carries ${carriedChroma} CHROMA.`, 'log-entry');
  if (robberGang) {
    evaluateOutlawAmbush();
  }
}

function toggleTime() {
  timeOfDay = timeOfDay === 'night' ? 'day' : 'night';
  hour = timeOfDay === 'night' ? 23 : 14;
  const el = document.getElementById('stat-time')!;
  el.textContent = timeOfDay === 'night' ? 'Night (23:00)' : 'Day (14:00)';
  logCombat(`Time changed to ${timeOfDay} (${hour}:00).`, 'log-entry');
  if (robberGang) {
    evaluateOutlawAmbush();
  }
}

function setPackCount(count: number) {
  targetPackCount = count;
  respawn();
}

function killLeader() {
  if (currentMode === 'hound' && activePacks.length > 0) {
    const pack = activePacks[0]!;
    const leader = pack.leader;
    if (leader && leader.alive) {
      leader.die(onKillDropHook);
      logCombat('Pack leader killed! Flankers breaking into retreat!', 'log-retreat');
    }
  }
}

function woundRobberToFlee() {
  if (currentMode === 'robber' && robberGang) {
    for (const enemy of robberGang.activeEnemies.values()) {
      if (enemy.alive) {
        enemy.health = { current: 15, maximum: enemy.health.maximum };
        enemy.flee();
      }
    }
    robberGang.state.state = 'fleeing';
    logCombat('Robber gang defeated and fleeing to alleys! Memory updated.', 'log-retreat');
  }
}

function evaluateOutlawAmbush() {
  if (!robberGang) return;
  const senses: OutlawSenses = {
    playerCarry: { accountId: 'player_hero', chroma: carriedChroma, satchelWeight: carriedChroma > 50 ? 6 : 1 },
    playerLocation: { x: targetMesh.position.x, z: targetMesh.position.z, zoneType },
    timeOfDay,
    hour,
    sentriesNear: false,
    sentryDistance: 65,
  };

  const decision = robberGang.evaluate(senses);
  const statDec = document.getElementById('stat-decider')!;
  statDec.textContent = `${decision.action.toUpperCase()} (${decision.reason})`;
}

function respawn() {
  labelsContainer.innerHTML = '';
  badges.length = 0;

  if (currentMode === 'hound') {
    if (robberGang) {
      robberGang.despawn();
      robberGang = null;
    }
    for (const pack of activePacks) {
      for (const h of pack.hounds) {
        scene.remove(h.model);
      }
    }
    activePacks = [];

    const packOffsets = targetPackCount === 1
      ? [{ x: 0, z: -8 }]
      : [
          { x: 0, z: -9 },
          { x: -9, z: -5 },
          { x: 9, z: -5 },
        ];

    for (const offset of packOffsets) {
      const pack = new HoundPack(template, world, offset, true, onKillDropHook);
      for (const h of pack.hounds) {
        scene.add(h.model);
        badges.push(
          createBadge({
            getPos: () => h.position,
            getState: () => h.state,
            getHealthPct: () => (h.health / h.maxHealth) * 100,
            getRole: () => (h.role === 'leader' ? '[LEAD]' : '[FLANK]'),
            isAlive: () => h.alive,
          })
        );
      }
      activePacks.push(pack);
    }

    const statCount = document.getElementById('stat-count');
    if (statCount) statCount.textContent = (targetPackCount * 3).toString();
    logCombat(`Spawned ${targetPackCount * 3} hounds (${targetPackCount} pack with leader & flankers).`, 'log-entry');
  } else {
    // Mode: Robber Gang
    for (const pack of activePacks) {
      for (const h of pack.hounds) {
        scene.remove(h.model);
      }
    }
    activePacks = [];

    if (robberGang) {
      robberGang.despawn();
    }

    robberGang = new ClientRobberGang({
      onKill: onKillDropHook,
      onAlert: (msg) => logCombat(msg, 'log-alert'),
    });

    if (enemyTemplate) {
      robberGang.bindWorld(scene, world, enemyTemplate);
    }

    evaluateOutlawAmbush();

    // Add badges for gang members once spawned
    setTimeout(() => {
      if (robberGang) {
        for (const [id, enemy] of robberGang.activeEnemies.entries()) {
          badges.push(
            createBadge({
              getPos: () => enemy.controller.position,
              getState: () => enemy.state,
              getHealthPct: () => (enemy.health.current / enemy.health.maximum) * 100,
              getRole: () => (enemy.kind === 'bender' ? '[LIT ROBBER]' : '[DIM ROBBER]'),
              isAlive: () => enemy.alive,
            })
          );
        }
      }
    }, 200);

    const statCount = document.getElementById('stat-count');
    if (statCount) statCount.textContent = 'Robber Gang';
    logCombat(`Robber Gang active. Carrying ${carriedChroma} CHROMA at ${timeOfDay}.`, 'log-entry');
  }
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

  const workStart = performance.now();

  // Target movement
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

  // Update entities
  if (currentMode === 'hound') {
    for (const pack of activePacks) {
      pack.update(dt, quarry);
    }
  } else if (currentMode === 'robber' && robberGang) {
    const senses: OutlawSenses = {
      playerCarry: { accountId: 'player_hero', chroma: carriedChroma, satchelWeight: carriedChroma > 50 ? 6 : 1 },
      playerLocation: { x: targetMesh.position.x, z: targetMesh.position.z, zoneType },
      timeOfDay,
      hour,
      sentriesNear: false,
      sentryDistance: 65,
    };
    robberGang.update(dt, quarry, senses);
  }

  // Update Badges
  const tempV = new Vector3();
  for (const b of badges) {
    if (!b.isAlive()) {
      b.fill.style.width = '0%';
      b.stateText.textContent = `${b.getRole()} DEAD`;
      b.stateText.style.color = '#78716c';
    } else {
      const stateStr = b.getState().toUpperCase();
      b.stateText.textContent = `${b.getRole()} ${stateStr}`;
      if (stateStr === 'RETREAT' || stateStr === 'FLEE') {
        b.stateText.style.color = '#38bdf8';
      } else {
        b.stateText.style.color = '#fdba74';
      }
      b.fill.style.width = `${Math.max(0, Math.min(100, b.getHealthPct()))}%`;
    }

    tempV.copy(b.getPos());
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
(window as unknown as { houndTest: unknown; creaturesTest: unknown }).houndTest = {
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
  killLeader,
  switchMode,
  setCarry,
  toggleTime,
  woundRobberToFlee,
  getRobberGang: () => robberGang,
};
(window as unknown as { houndTest: unknown; creaturesTest: unknown }).creaturesTest =
  (window as unknown as { houndTest: unknown }).houndTest;

init().catch(console.error);
