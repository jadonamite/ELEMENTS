import './ui/tokens.css';
import './style.css';
import balance from '../../shared/balance.json';
import { createArena, disposeObject, loadProps } from './scene.js';
import { initPhysics } from './physics.js';
import { FpsCounter } from './fps.js';
import { loadHero, type HeroInstance } from './hero.js';
import { FixedStepper, HeroController, locomotionForSpeed, movementVelocity, turnToward } from './controller.js';
import { ShoulderCamera } from './camera.js';
import { GameInput } from './input.js';
import { Combat, type CombatAction } from './combat.js';
import { loadEnemyTemplate } from './enemy.js';
import { Fight } from './fight.js';
import { FightHud } from './hud.js';
import { SwordStance } from './sword.js';
import { Vector3 } from 'three';

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
  panel.innerHTML = '<button type="button" disabled>Loading</button>' +
    '<p class="hud-keys"><kbd>W A S D</kbd> move <kbd>Shift</kbd> run <kbd>Mouse</kbd> look</p>' +
    '<p class="hud-keys"><kbd>Left click</kbd> light combo <kbd>Right click</kbd> heavy <kbd>Q</kbd> uppercut ' +
    '<kbd>E</kbd> ground pound <kbd>F</kbd> dash strike <kbd>R</kbd> block <kbd>Space</kbd> dodge</p>' +
    '<p id="control-status" class="hud-status" role="status">Loading the arena.</p>';
  document.body.appendChild(panel);
  cleanup.push(() => panel.remove());
  const button = panel.querySelector('button')!;
  const status = (message: string): void => { panel.querySelector('#control-status')!.textContent = message; };

  const physics = await initPhysics();
  if (disposed) { physics.dispose(); return; }
  cleanup.push(() => physics.dispose());
  const arena = createArena(canvas);
  const { scene, camera, renderer } = arena;
  loadProps(scene).catch((error: unknown) => console.error('Arena props failed to load:', error));
  cleanup.push(() => { renderer.setAnimationLoop(null); arena.dispose(); });
  const controller = new HeroController(physics.world);
  cleanup.push(() => controller.dispose());
  const shoulderCamera = new ShoulderCamera(camera, physics.world);
  let hero: HeroInstance;
  const husks = loadEnemyTemplate();
  try {
    hero = await loadHero();
  } catch (error) {
    if (!disposed) {
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
  button.textContent = 'Enter the arena';
  status('');
  // The HUD fades out while the mouse is captured.
  const togglePlaying = (): void => { document.body.classList.toggle('playing', document.pointerLockElement === canvas); };
  document.addEventListener('pointerlockchange', togglePlaying);
  cleanup.push(() => { document.removeEventListener('pointerlockchange', togglePlaying); document.body.classList.remove('playing'); });
  const input = new GameInput(canvas, button, (dx, dy) => shoulderCamera.orbit(dx, dy), status);
  cleanup.push(() => input.dispose());
  const fps = new URLSearchParams(window.location.search).has('debug') ? new FpsCounter() : null;
  // Debug builds expose the live objects for frame sampling.
  if (fps) Object.assign(window, { elements: { hero, controller, camera, shoulderCamera, input, get fight() { return fight; }, get combat() { return combat; }, get sword() { return sword; } } });
  if (fps) cleanup.push(() => fps.dispose());
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function resize(): void {
    arena.setSize(window.innerWidth, window.innerHeight);
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

  const fightHud = new FightHud();
  cleanup.push(() => fightHud.dispose());
  let hitStop = 0;
  let reviveIn = 0;
  const fight = new Fight(await husks, physics.world, scene, {
    heroHit(blocked) {
      hitStop = balance.combat.hitStop * (blocked ? 0.5 : 1);
      // A hit only flinches the hero when it isn't mid-move or guarding.
      if (!combat.current && !blocked) combat.react('hit');
    },
    heroDied() {
      combat.react('death');
      fightHud.say('You fell');
      reviveIn = balance.hero.respawnSeconds;
    },
    enemyHit(_enemy, killed) { hitStop = balance.combat.hitStop * (killed ? 1.6 : 1); },
  });
  cleanup.push(() => fight.dispose());
  const combat = new Combat(hero.anim, (move) => fight.ready(move));
  const drawn = new Vector3();
  const { clipSpeeds } = balance.controller;
  // Calm stance carries the sword on the back; fighting draws it, and the camera follows.
  const sword = new SwordStance(hero);
  let calmIn = 0;
  /** An attack pressed while the sword was sheathed, thrown once it is drawn. */
  let pending: CombatAction | null = null;
  const attack = (action: CombatAction): void => {
    if (!combat.current) {
      // Attacks go where the camera looks, turned onto a husk just off that line.
      const looking = shoulderCamera.yaw + Math.PI;
      const { aimAssistRange, aimAssistAngle } = balance.combat;
      const mark = fight.nearestInFront(controller.position, looking, aimAssistRange, aimAssistAngle);
      controller.facing = mark
        ? Math.atan2(mark.controller.position.x - controller.position.x, mark.controller.position.z - controller.position.z)
        : looking;
    }
    combat.press(action);
  };
  const bladeBase = new Vector3();
  const bladeTip = new Vector3();
  const heroView = { position: controller.position, facing: 0, bladeBase, bladeTip };
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, balance.controller.maxFrameDelta);
    lastTime = now;
    const alive = fight.heroAlive;
    for (const action of alive ? input.takeActions() : []) {
      if (action !== 'dodge') {
        if (sword.armed) attack(action);
        else { sword.draw(true); pending = action; }
        continue;
      }
      if (!combat.press(action)) continue;
      // Roll the way the keys point, relative to the camera; with no keys held, roll back from the view.
      const roll = movementVelocity(input.read(), shoulderCamera.yaw);
      controller.facing = roll.lengthSq() > 0 ? Math.atan2(roll.x, roll.z) : shoulderCamera.yaw;
    }
    if (!alive) { input.takeActions(); pending = null; }
    if (pending && sword.armed) { attack(pending); pending = null; }
    if (alive && input.blocking && !sword.engaged) sword.draw(true);
    combat.blocking = alive && input.blocking && sword.armed && !combat.current;
    if (combat.blocking) {
      // The guard turns to meet the nearest husk, or the way the camera looks.
      const threat = fight.nearestInFront(controller.position, controller.facing, balance.hero.guardTurnRange, Math.PI);
      const toward = threat
        ? Math.atan2(threat.controller.position.x - controller.position.x, threat.controller.position.z - controller.position.z)
        : shoulderCamera.yaw + Math.PI;
      controller.facing = turnToward(controller.facing, toward, delta);
    }
    combat.update(delta);
    // Stay drawn while fighting or with a husk close by; sheathe after a quiet spell.
    const threatened = fight.nearestDistance(controller.position) < balance.stance.engageRadius;
    if ((combat.current && combat.current !== 'dodge') || combat.blocking || pending || threatened) {
      calmIn = balance.stance.calmAfterSeconds;
    }
    if (threatened && alive) sword.draw(false);
    calmIn = Math.max(0, calmIn - delta);
    if (calmIn === 0 && !combat.current) sword.sheathe();
    shoulderCamera.fight = sword.engaged ? 1 : 0;
    if (reviveIn > 0 && (reviveIn -= delta) <= 0) {
      fight.reviveHero();
      combat.reset();
      fightHud.say('');
    }
    hero.sword.updateMatrixWorld(true);
    hero.sword.localToWorld(bladeBase.copy(hero.bladeBase));
    hero.sword.localToWorld(bladeTip.copy(hero.bladeTip));
    heroView.facing = controller.facing;
    const rooted = combat.current !== null || combat.blocking;
    const alpha = stepper.advance(delta, () => {
      // Lunges stop at sword range instead of carrying the hero into a husk.
      const stop = combat.current !== 'dodge' && fight.nearestDistance(controller.position) < balance.combat.lungeStopDistance;
      const lunge = stop ? 0 : combat.lunge;
      controller.step(rooted ? { forward: 0, right: 0, running: false } : input.read(), shoulderCamera.yaw, lunge);
      fight.step(heroView, combat);
    });
    // Hit-stop: a short near-freeze of every body on impact.
    const animDelta = hitStop > 0 ? delta * 0.08 : delta;
    hitStop = Math.max(0, hitStop - delta);
    // Draw between the last two physics steps so motion stays smooth on fast displays.
    drawn.lerpVectors(controller.previous, controller.position, alpha);
    hero.model.position.copy(drawn);
    hero.model.rotation.y = controller.facing + balance.controller.modelForwardYaw;
    if (combat.blocking) {
      hero.anim.play('block', balance.combat.fade);
    } else if (!combat.current) {
      const pace = locomotionForSpeed(controller.speed);
      const clip = pace === 'idle' && !sword.engaged ? 'idle_relaxed' : pace;
      hero.anim.play(clip, balance.controller.animationFade);
      // Match foot speed to ground speed so the feet don't slide or hop.
      if (pace !== 'idle') hero.anim.setSpeed(pace, Math.max(0.5, controller.speed / clipSpeeds[pace]));
    }
    hero.anim.update(animDelta);
    // The draw reach poses the arm on top of whatever the body is playing.
    sword.update(animDelta);
    fight.draw(animDelta, alpha, controller.position);
    fightHud.update(delta, fight.heroHealth, fight.enemies, camera, balance.enemy.healthBarHeight);
    shoulderCamera.update(drawn, delta, reducedMotion.matches);
    // Hide the hero when a wall pushes the camera inside its body.
    hero.model.visible = camera.position.distanceTo(shoulderCamera.target) > balance.camera.hideHeroDistance;
    fps?.tick();
    arena.render();
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start the game:', error);
});
