/**
 * Entry point: initialises Rapier physics, builds the arena scene, loads the
 * 1.8m hero character with sword and animation player, spawns a 1m test box,
 * attaches keyboard triggers (keys 1, 2, 3) for locomotion blending, and runs
 * the render loop with an FPS counter.
 */

import {
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './ui/tokens.css';
import './style.css';
import { createArena } from './scene.js';
import { initPhysics } from './physics.js';
import { FpsCounter } from './fps.js';
import { loadHero, createTestBox, type HeroInstance } from './hero.js';

/**
 * Creates a clean typographic HUD overlay displaying current animation and controls.
 */
function createControlHud(): {
  updateClip(name: string): void;
  dispose(): void;
} {
  const panel = document.createElement('div');
  panel.id = 'hero-hud';
  Object.assign(panel.style, {
    position: 'fixed',
    bottom: '16px',
    left: '16px',
    padding: '12px 16px',
    fontFamily: 'var(--font-family-body, sans-serif)',
    fontSize: 'var(--font-size-sm, 14px)',
    lineHeight: '1.4',
    color: 'var(--color-text-primary, #f0f2f5)',
    background: 'rgba(20, 24, 31, 0.85)',
    border: '1px solid var(--color-border-default, #323b49)',
    borderRadius: 'var(--radius-lg, 8px)',
    backdropFilter: 'blur(8px)',
    zIndex: '1000',
    userSelect: 'none',
    pointerEvents: 'auto',
    maxWidth: '480px',
  });

  const titleRow = document.createElement('div');
  Object.assign(titleRow.style, {
    fontFamily: 'var(--font-family-display, Georgia, serif)',
    fontWeight: 'var(--font-weight-bold, 700)',
    letterSpacing: 'var(--letter-spacing-wider, 0.05em)',
    fontSize: 'var(--font-size-base, 16px)',
    marginBottom: '6px',
    color: 'var(--color-aura-glow-bright, #ffffff)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  });
  titleRow.innerHTML = '<span>HERO ANIMATION</span><span id="hud-clip" style="color:var(--color-ignis-glow-bright, #ff5765);font-family:var(--font-family-mono, monospace);font-size:13px;">IDLE</span>';
  panel.appendChild(titleRow);

  const descRow = document.createElement('div');
  Object.assign(descRow.style, {
    fontSize: 'var(--font-size-xs, 12px)',
    color: 'var(--color-text-secondary, #9ba3af)',
    marginBottom: '8px',
  });
  descRow.textContent = 'Hero height: 1.8 m | Reference box: 1.0 m | Drag mouse to orbit';
  panel.appendChild(descRow);

  const controlsRow = document.createElement('div');
  Object.assign(controlsRow.style, {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  });

  const buttons = [
    { key: '1', label: '1: Idle', clip: 'idle', loop: true },
    { key: '2', label: '2: Walk', clip: 'walk', loop: true },
    { key: '3', label: '3: Run', clip: 'run', loop: true },
    { key: '4', label: '4: Attack', clip: 'attack_light', loop: false },
    { key: '5', label: '5: Heavy', clip: 'attack_heavy', loop: false },
    { key: '6', label: '6: Dodge', clip: 'dodge', loop: false },
  ];

  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.dataset.clip = b.clip;
    btn.textContent = b.label;
    Object.assign(btn.style, {
      fontFamily: 'var(--font-family-mono, monospace)',
      fontSize: '12px',
      padding: '4px 8px',
      background: 'var(--color-bg-raised, #1c222c)',
      color: 'var(--color-text-primary, #f0f2f5)',
      border: '1px solid var(--color-border-subtle, #222933)',
      borderRadius: 'var(--radius-sm, 4px)',
      cursor: 'pointer',
    });
    controlsRow.appendChild(btn);
  }
  panel.appendChild(controlsRow);
  document.body.appendChild(panel);

  const clipDisplay = panel.querySelector<HTMLSpanElement>('#hud-clip');

  return {
    updateClip(name: string): void {
      if (clipDisplay) {
        clipDisplay.textContent = name.toUpperCase();
      }
      for (const el of controlsRow.querySelectorAll<HTMLButtonElement>('button')) {
        const active = el.dataset.clip === name;
        el.style.borderColor = active
          ? 'var(--color-ignis-glow, #e63946)'
          : 'var(--color-border-subtle, #222933)';
        el.style.background = active
          ? 'var(--color-ignis-glow-dim, rgba(230, 57, 70, 0.2))'
          : 'var(--color-bg-raised, #1c222c)';
      }
    },
    dispose(): void {
      panel.remove();
    },
  };
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('Game canvas is missing.');

  /* --- physics (must init WASM before anything else) --- */
  const physics = await initPhysics();

  /* --- arena scene --- */
  const { scene, camera, renderer } = createArena(canvas);

  /* --- camera position framing hero and 1m reference box --- */
  camera.position.set(0.75, 1.8, 4.2);
  camera.lookAt(0.75, 1.0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.75, 1.0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below floor
  controls.minDistance = 1.0;
  controls.maxDistance = 25.0;

  /* --- 1m test box placed on the floor for height comparison --- */
  const testBox = createTestBox(1.5, 0);
  scene.add(testBox);

  /* --- hero character and animation player --- */
  let hero: HeroInstance | null = null;
  const hud = createControlHud();

  try {
    hero = await loadHero();
    hero.model.position.set(0, 0, 0);
    scene.add(hero.model);
    hud.updateClip('idle');
  } catch (err) {
    console.error('Failed to load hero model:', err);
  }

  /* --- test ball (physics verification from M1.3) --- */
  const ballRadius = 0.25;
  const ballGeo = new SphereGeometry(ballRadius, 24, 24);
  const ballMat = new MeshStandardMaterial({ color: 0x884444, roughness: 0.4, metalness: 0.3 });
  const ballMesh = new Mesh(ballGeo, ballMat);
  ballMesh.position.set(-4, 5, 0);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  scene.add(ballMesh);
  const ballBody = physics.dropTestBall(5);

  /* --- locomotion trigger helper --- */
  let lastLoopClip = 'idle';

  function triggerClip(name: string, loop = true): void {
    if (!hero) return;
    const ok = hero.anim.play(name, 0.25, loop);
    if (ok) {
      if (loop) lastLoopClip = name;
      hud.updateClip(name);
    }
  }

  // When a one-shot clip completes, cross-fade back to base locomotion
  if (hero) {
    hero.anim.mixer.addEventListener('finished', () => {
      triggerClip(lastLoopClip, true);
    });
  }

  /* --- keyboard triggers --- */
  const onKeyDown = (e: KeyboardEvent): void => {
    // Avoid interfering with inputs if any
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    switch (e.key) {
      case '1':
        triggerClip('idle', true);
        break;
      case '2':
        triggerClip('walk', true);
        break;
      case '3':
        triggerClip('run', true);
        break;
      case '4':
        triggerClip('attack_light', false);
        break;
      case '5':
        triggerClip('attack_heavy', false);
        break;
      case '6':
        triggerClip('dodge', false);
        break;
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // HUD button click triggers
  const hudEl = document.getElementById('hero-hud');
  if (hudEl) {
    hudEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (target?.dataset.clip) {
        const isOneShot = target.dataset.clip.startsWith('attack') || target.dataset.clip === 'dodge';
        triggerClip(target.dataset.clip, !isOneShot);
      }
    });
  }

  /* --- FPS counter --- */
  const fps = new FpsCounter();

  /* --- resize handler --- */
  function resize(): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  /* --- render loop --- */
  let lastTime = performance.now();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    physics.step();

    /* Sync test ball */
    const pos = ballBody.translation();
    ballMesh.position.set(pos.x - 4, pos.y, pos.z);

    /* Update hero animation player */
    if (hero) {
      hero.anim.update(delta);
    }

    controls.update();
    fps.tick();
    renderer.render(scene, camera);
  });

  /* --- HMR cleanup --- */
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      controls.dispose();
      renderer.setAnimationLoop(null);
      renderer.dispose();
      fps.dispose();
      hud.dispose();
      hero?.anim.dispose();
    });
  }
}

main().catch((err: unknown) => {
  console.error('Failed to start the game:', err);
});
