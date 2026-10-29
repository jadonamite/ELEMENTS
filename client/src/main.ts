import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Game canvas is missing.');

const scene = new Scene();
scene.background = new Color('#111111');
const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
const renderer = new WebGLRenderer({ canvas, antialias: true });

function resize(): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

resize();
window.addEventListener('resize', resize);
renderer.setAnimationLoop(() => renderer.render(scene, camera));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('resize', resize);
    renderer.setAnimationLoop(null);
    renderer.dispose();
  });
}
