import './ui/tokens.css';
import './style.css';
import balance from '../../shared/balance.json';
import { createArena, disposeObject } from './scene.js';
import { initPhysics } from './physics.js';
import { FpsCounter } from './fps.js';
import { loadHero, type HeroInstance } from './hero.js';
import { FixedStepper, HeroController, locomotionForSpeed } from './controller.js';
import { ShoulderCamera } from './camera.js';
import { GameInput } from './input.js';

let disposed = false;
const cleanup: Array<() => void> = [];
const dispose = (): void => {
  disposed = true;
  for (const release of cleanup.reverse()) release();
  cleanup.length = 0;
};
import.meta.hot?.dispose(dispose);

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('Game canvas is missing.');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Arena. WASD to move. Shift to run. Click to capture the mouse.');

  const panel = document.createElement('section');
  panel.id = 'hero-hud';
  panel.setAttribute('aria-label', 'Arena controls');
  panel.innerHTML = '<strong>ELEMENTS</strong><span id="hud-clip">Loading hero</span>' +
    '<p>WASD to move · Shift to run · Mouse to look</p>' +
    '<button type="button" disabled>Loading hero</button>' +
    '<p id="control-status" role="status">Loading the arena and hero.</p>';
  document.body.appendChild(panel);
  cleanup.push(() => panel.remove());
  const button = panel.querySelector('button')!;
  const clipDisplay = panel.querySelector('#hud-clip')!;
  const status = (message: string): void => { panel.querySelector('#control-status')!.textContent = message; };

  const physics = await initPhysics();
  if (disposed) { physics.dispose(); return; }
  cleanup.push(() => physics.dispose());
  const arena = createArena(canvas);
  const { scene, camera, renderer } = arena;
  cleanup.push(() => { renderer.setAnimationLoop(null); arena.dispose(); });
  const controller = new HeroController(physics.world);
  cleanup.push(() => controller.dispose());
  const shoulderCamera = new ShoulderCamera(camera, physics.world);
  let hero: HeroInstance;
  try {
    hero = await loadHero();
  } catch (error) {
    if (!disposed) {
      clipDisplay.textContent = 'Hero unavailable';
      button.textContent = 'Reload to retry';
      button.disabled = false;
      button.addEventListener('click', () => window.location.reload(), { once: true });
      status('The hero could not load. Reload the page to try again.');
    }
    throw error;
  }
  if (disposed) { hero.anim.dispose(); disposeObject(hero.model); return; }
  scene.add(hero.model);
  cleanup.push(() => hero.anim.dispose());
  button.disabled = false;
  button.textContent = 'Play';
  status('Select Play or click the arena to capture the mouse.');
  const input = new GameInput(canvas, button, (dx, dy) => shoulderCamera.orbit(dx, dy), status);
  cleanup.push(() => input.dispose());
  const fps = new FpsCounter();
  cleanup.push(() => fps.dispose());
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function resize(): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  cleanup.push(() => window.removeEventListener('resize', resize));
  let lastTime = performance.now();
  const stepper = new FixedStepper();
  const resetTime = (): void => { lastTime = performance.now(); stepper.reset(); };
  window.addEventListener('blur', resetTime);
  document.addEventListener('visibilitychange', resetTime);
  cleanup.push(() => {
    window.removeEventListener('blur', resetTime);
    document.removeEventListener('visibilitychange', resetTime);
  });
  shoulderCamera.update(controller.position, 1, true);

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, balance.controller.maxFrameDelta);
    lastTime = now;
    stepper.advance(delta, () => controller.step(input.read(), shoulderCamera.yaw));
    hero.model.position.copy(controller.position);
    hero.model.rotation.y = controller.facing + balance.controller.modelForwardYaw;
    const clip = locomotionForSpeed(controller.speed);
    hero.anim.play(clip, balance.controller.animationFade);
    hero.anim.update(delta);
    clipDisplay.textContent = clip;
    shoulderCamera.update(controller.position, delta, reducedMotion.matches);
    fps.tick();
    renderer.render(scene, camera);
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start the game:', error);
});
