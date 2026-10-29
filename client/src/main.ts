import './ui/tokens.css';
import './style.css';
import './opening.css';
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
import { SoundManager } from './audio.js';
import { BendingEffects } from './bending-fx.js';
import { OpeningFlow } from './opening.js';
import type { Enemy } from './enemy.js';
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
    '<p class="hud-keys"><kbd>W A S D</kbd> move <kbd>Shift</kbd> run <kbd>Mouse</kbd> look <kbd>Tab</kbd> lock-on</p>' +
    '<p class="hud-keys"><kbd>Left click</kbd> strike <kbd>Right click</kbd> heavy <kbd>Q</kbd> uppercut ' +
    '<kbd>E</kbd> ground slam <kbd>F</kbd> dash <kbd>R</kbd> block <kbd>Space</kbd> dodge</p>' +
    '<p class="hud-keys"><kbd>X</kbd> draw/sheathe sword <kbd>B</kbd> ignite bending (lit mode)</p>' +
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
  if (!new URLSearchParams(window.location.search).has('skipIntro')) {
    const opening = new OpeningFlow(() => {});
    cleanup.push(() => opening.dispose());
  }
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

  const sound = new SoundManager();
  cleanup.push(() => sound.dispose());
  const bending = new BendingEffects(scene);
  cleanup.push(() => bending.dispose());

  const fightHud = new FightHud();
  cleanup.push(() => fightHud.dispose());
  let hitStop = 0;
  let reviveIn = 0;
  let slowMotion = 0;
  let isLit = false;
  let lockedEnemy: Enemy | null = null;

  const fight = new Fight(await husks, physics.world, scene, {
    heroHit(blocked) {
      hitStop = balance.combat.hitStop * (blocked ? 0.5 : 1);
      shoulderCamera.shake(blocked ? 0.25 : 0.55);
      sound.playImpact(false, blocked);
      if (!combat.current && !blocked) combat.react('hit');
    },
    heroDied() {
      combat.react('death');
      fightHud.say('You fell');
      shoulderCamera.shake(0.6);
      sound.playThump(50, 0.6, 0.7);
      reviveIn = balance.hero.respawnSeconds;
    },
    enemyHit(_enemy, killed) {
      hitStop = balance.combat.hitStop * (killed ? 1.6 : 1);
      shoulderCamera.shake(killed ? 0.45 : 0.2);
      sound.playImpact(killed, false);
      if (killed && fight.allDead) {
        slowMotion = 1.2;
      }
    },
  });
  cleanup.push(() => fight.dispose());
  const combat = new Combat(hero.anim, (move) => fight.ready(move));
  const drawn = new Vector3();
  const { clipSpeeds } = balance.controller;
  const sword = new SwordStance(hero);
  let calmIn = 0;

  input.onLockToggle = () => {
    lockedEnemy = fight.findLockTarget(controller.position, lockedEnemy);
    shoulderCamera.lockTarget = lockedEnemy ? lockedEnemy.controller.position : null;
  };

  input.onStanceToggle = () => {
    if (sword.armed) sword.sheathe();
    else sword.draw(false);
  };

  input.onBendingToggle = () => {
    isLit = !isLit;
    hero.setElemental(isLit);
    if (isLit) sound.playFireBurst(0.35);
  };

  const attack = (action: CombatAction): void => {
    if (!combat.current) {
      if (lockedEnemy && lockedEnemy.alive) {
        const dx = lockedEnemy.controller.position.x - controller.position.x;
        const dz = lockedEnemy.controller.position.z - controller.position.z;
        controller.facing = Math.atan2(dx, dz);
      } else {
        const looking = shoulderCamera.yaw + Math.PI;
        const { aimAssistRange, aimAssistAngle } = balance.combat;
        const mark = fight.nearestInFront(controller.position, looking, aimAssistRange, aimAssistAngle);
        controller.facing = mark
          ? Math.atan2(mark.controller.position.x - controller.position.x, mark.controller.position.z - controller.position.z)
          : looking;
      }
    }

    // Play attack whooshes and elemental bending effects
    sound.playSwing(1.0, action === 'heavy' || action === 'ground_pound');
    if (isLit) {
      if (action === 'ground_pound') {
        bending.spawnGroundPound(controller.position);
        sound.playGroundPound();
        shoulderCamera.shake(0.35);
      } else if (action === 'uppercut') {
        const forward = new Vector3(Math.sin(controller.facing), 0, Math.cos(controller.facing));
        const pillarPos = controller.position.clone().addScaledVector(forward, 1.2);
        bending.spawnUppercutPillar(pillarPos);
        sound.playFireBurst(0.35);
        shoulderCamera.shake(0.25);
      }
    }

    combat.press(action);
  };

  const bladeBase = new Vector3();
  const bladeTip = new Vector3();
  const heroView = { position: controller.position, facing: 0, bladeBase, bladeTip };

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const rawDelta = Math.min((now - lastTime) / 1000, balance.controller.maxFrameDelta);
    lastTime = now;

    let timeScale = 1.0;
    if (slowMotion > 0) {
      slowMotion = Math.max(0, slowMotion - rawDelta);
      timeScale = 0.25;
    }
    const delta = rawDelta * timeScale;

    // Validate lock-on target
    if (lockedEnemy && !lockedEnemy.alive) {
      lockedEnemy = fight.findLockTarget(controller.position, null);
    }
    shoulderCamera.lockTarget = lockedEnemy ? lockedEnemy.controller.position : null;

    const alive = fight.heroAlive;
    for (const action of alive ? input.takeActions() : []) {
      if (action !== 'dodge') {
        attack(action);
        continue;
      }
      if (!fight.ready('dodge') || !combat.press(action)) continue;
      fight.recordDodge();
      sound.playDodge();
      const roll = movementVelocity(input.read(), shoulderCamera.yaw);
      controller.facing = roll.lengthSq() > 0 ? Math.atan2(roll.x, roll.z) : shoulderCamera.yaw;
    }
    if (!alive) { input.takeActions(); }
    if (alive && input.blocking && !sword.engaged) sword.draw(true);
    combat.blocking = alive && input.blocking && sword.armed && !combat.current;
    if (combat.blocking) {
      const threat = lockedEnemy ?? fight.nearestInFront(controller.position, controller.facing, balance.hero.guardTurnRange, Math.PI);
      const toward = threat
        ? Math.atan2(threat.controller.position.x - controller.position.x, threat.controller.position.z - controller.position.z)
        : shoulderCamera.yaw + Math.PI;
      controller.facing = turnToward(controller.facing, toward, delta);
    }
    combat.update(delta);

    // Camera view stance
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
      const stop = combat.current !== 'dodge' && fight.nearestDistance(controller.position) < balance.combat.lungeStopDistance;
      const lunge = stop ? 0 : combat.lunge;
      controller.step(rooted ? { forward: 0, right: 0, running: false } : input.read(), shoulderCamera.yaw, lunge);
      fight.step(heroView, combat);
    });

    const animDelta = hitStop > 0 ? delta * 0.08 : delta;
    hitStop = Math.max(0, hitStop - delta);
    drawn.lerpVectors(controller.previous, controller.position, alpha);
    hero.model.position.copy(drawn);
    hero.model.rotation.y = controller.facing + balance.controller.modelForwardYaw;
    if (combat.blocking) {
      hero.anim.play('block', balance.combat.fade);
    } else if (!combat.current) {
      const pace = locomotionForSpeed(controller.speed);
      const clip = pace === 'idle' && !sword.engaged ? 'idle_relaxed' : pace;
      hero.anim.play(clip, balance.controller.animationFade);
      if (pace !== 'idle') hero.anim.setSpeed(pace, Math.max(0.5, controller.speed / clipSpeeds[pace]));
    }
    hero.anim.update(animDelta);
    sword.update(animDelta);
    bending.update(delta);
    fight.draw(animDelta, alpha, controller.position);
    const cooldowns = [
      { move: 'uppercut', remaining: fight.cooldownRemaining('uppercut'), total: fight.cooldownTotal('uppercut') },
      { move: 'ground_pound', remaining: fight.cooldownRemaining('ground_pound'), total: fight.cooldownTotal('ground_pound') },
      { move: 'dash_strike', remaining: fight.cooldownRemaining('dash_strike'), total: fight.cooldownTotal('dash_strike') },
      { move: 'dodge', remaining: fight.cooldownRemaining('dodge'), total: fight.cooldownTotal('dodge') },
    ];
    fightHud.update(delta, fight.heroHealth, fight.enemies, camera, balance.enemy.healthBarHeight, isLit, sword.armed, lockedEnemy, cooldowns);
    shoulderCamera.update(drawn, delta, reducedMotion.matches);
    hero.model.visible = camera.position.distanceTo(shoulderCamera.target) > balance.camera.hideHeroDistance;
    fps?.tick();
    arena.render();
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start the game:', error);
});
