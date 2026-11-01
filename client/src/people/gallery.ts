import {
  ACESFilmicToneMapping, AnimationMixer, Clock, Color, DirectionalLight, Group, HemisphereLight, Mesh,
  MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fitClip } from '../body.js';
import { fitToReference } from './rig.js';

/**
 * people.html: every person side by side under daylight, playing the game's own clips.
 * ?people=a,b,c picks files from /assets/people/; ?clip=idle|walk|punch_jab; ?view=face.
 */
const params = new URLSearchParams(location.search);
const names = (params.get('people') ?? 'test_m').split(',');
const clipName = params.get('clip') ?? 'idle_relaxed';
const info = document.getElementById('info')!;

const renderer = new WebGLRenderer({ antialias: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0x5a5c62);
const camera = new PerspectiveCamera(30, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
const sun = new DirectionalLight(0xfff1dc, 2.6);
sun.position.set(-3, 6, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 4, bottom: -1 });
scene.add(sun, new HemisphereLight(0xc4d2e8, 0x5a4a3c, 1.1));
const floor = new Mesh(new PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x6a645c, roughness: 0.95 }));
floor.receiveShadow = true;
scene.add(floor);

const loader = new GLTFLoader();
const mixers: AnimationMixer[] = [];
const spacing = 1.1;

async function main(): Promise<void> {
  const [reference, clipsA, clipsB] = await Promise.all([
    loader.loadAsync('/assets/characters/creator/peasant_male.glb'),
    loader.loadAsync('/assets/characters/hero.glb'),
    loader.loadAsync('/assets/characters/unarmed_a.glb'),
  ]);
  const clips = [...clipsA.animations, ...clipsB.animations];
  const source = clips.find((c) => c.name === clipName) ?? clips.find((c) => c.name === 'idle')!;
  const row = new Group();
  scene.add(row);
  for (const [i, name] of names.entries()) {
    const body = (await loader.loadAsync(`/assets/people/${name}.glb`)).scene;
    const person: Object3D = fitToReference(body, reference.scene, { outfit: params.get('outfit') === '1' });
    person.traverse((n) => { const m = (n as Mesh).material as MeshStandardMaterial | undefined; if (m && 'map' in m) console.log(n.name, m.name, !!m.map, m.transparent, m.alphaTest); });
    person.position.x = (i - (names.length - 1) / 2) * spacing;
    row.add(person);
    const pelvis = person.getObjectByName('pelvis');
    const mixer = new AnimationMixer(person);
    mixer.clipAction(fitClip(source, pelvis ? pelvis.position.length() / 0.918 : 1)).play();
    mixers.push(mixer);
  }
  const face = params.get('view') === 'face';
  camera.position.set(0, face ? 1.66 : 1.0, face ? 0.75 : 3.6 + names.length * 0.55);
  controls.target.set(0, face ? 1.62 : 0.92, 0);
  controls.update();
  info.textContent = `${names.length} people, clip ${source.name}`;
  (window as unknown as { peopleReady: boolean }).peopleReady = true;
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
const clock = new Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  for (const m of mixers) m.update(dt);
  renderer.render(scene, camera);
});
void main();
