/**
 * Entry point: initialises Rapier physics, builds the arena scene, drops a
 * test ball, and runs the render loop with an FPS counter.
 */

import { Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import './ui/tokens.css';
import './style.css';
import { createArena } from './scene.js';
import { initPhysics } from './physics.js';
import { FpsCounter } from './fps.js';

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('Game canvas is missing.');

  /* --- physics (must init WASM before anything else) --- */
  const physics = await initPhysics();

  /* --- arena scene --- */
  const { scene, camera, renderer } = createArena(canvas);

  /* --- test ball (visible sphere synced to its Rapier rigid body) --- */
  const ballRadius = 0.25;
  const ballGeo = new SphereGeometry(ballRadius, 24, 24);
  const ballMat = new MeshStandardMaterial({ color: 0xff4444, roughness: 0.4, metalness: 0.3 });
  const ballMesh = new Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  scene.add(ballMesh);

  const ballBody = physics.dropTestBall(5);

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
  renderer.setAnimationLoop(() => {
    physics.step();

    /* Sync the Three.js ball mesh to the Rapier body position. */
    const pos = ballBody.translation();
    ballMesh.position.set(pos.x, pos.y, pos.z);

    fps.tick();
    renderer.render(scene, camera);
  });

  /* --- HMR cleanup --- */
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('resize', resize);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      fps.dispose();
    });
  }
}

main().catch((err: unknown) => {
  console.error('Failed to start the game:', err);
});
