import './ui/tokens.css';
import './ui/loader.css';
import './style.css';
import './opening.css';
import './story/nation-intro.css';
import './threat-arrows.css';
import balance from '../../shared/balance.json';
import dialogueData from '../../shared/dialogue.json';
import { dialogueRules } from '../../shared/src/story/dialogue.js';
import { SpeechMemory } from '../../shared/src/story/speech.js';
import { createArena, disposeObject, loadProps } from './scene.js';
import { createZone, SPAWN } from './world/zone.js';
import { initPhysics } from './physics.js';
import { FpsCounter } from './fps.js';
import { loadHero, type HeroInstance } from './hero.js';
import { parseOutfit } from './body.js';
import { FixedStepper, HeroController, locomotionForSpeed, movementVelocity, turnToward } from './controller.js';
import { ShoulderCamera } from './camera.js';
import { GameInput } from './input.js';
import { Controls } from './controls/index.js';
import { Combat, strikeKind, type CombatAction, type FightingStyle } from './combat.js';
import { loadEnemyTemplate, villainLooks, type VillainKind } from './enemy.js';
import { Fight, type HeroView } from './fight.js';
import { inFront } from './hits.js';
import { FightHud, type RoundHudInfo } from './hud.js';
import { ThreatArrows } from './threat-arrows.js';
import { SwordStance } from './sword.js';
import { SoundManager } from './audio.js';
import { BendingEffects, type BendingType } from './bending-fx.js';
import { OpeningFlow, getStoredDrawing, type DrawingResult } from './opening.js';
import { ConsentBanner } from './consent.js';
import type { Enemy } from './enemy.js';
import { createCombatRules, ELEMENTS, isBendMove, NIGHT_FROM, sindrSentryDistance, sindrStreet, type BendMoveId, type CombatBalance, type Element, type Kit, type MoveId } from '../../shared/src/index.js';
import { BendState, type BendRefusal } from './bend-state.js';
import { ElementEffects } from './fx/elements.js';
import { FighterSelect, lastFighter } from './ui/fighter-select.js';
import { heroWeaponFor, STAFF_WEAPON, SWORD_WEAPON } from './weapon.js';
import { TownEconomy } from './economy/town-economy.js';
import { ContextAction } from './ui/context-action.js';
import { StreetChallenges } from './life/street-challenges.js';
import { nightness } from './world/effects.js';
import { HomeMenu } from './ui/home-menu.js';
import { SindrLifeSystem } from './life/index.js';
import { NationIntroFlow } from './story/nation-intro-flow.js';
import { playerPerson } from './life/crowd.js';
import { Group, Vector3 } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ClientRobberGang } from './agents/outlaws/robberGang.js';
import { ClientDeserterBand } from './agents/outlaws/deserterBand.js';
import type { OutlawSenses } from '../../shared/src/agents/types.js';
import type { Quarry } from './enemy.js';
import { CombatSpace } from './attacks/space.js';
import { hasGameServer } from './auth/server-api.js';
import type { OnlineSession } from './net/online.js';
import type { NetEnemy } from './net/puppets.js';
import { isTownMode } from './world-mode.js';
import './controls/controls.css';
import { Loader } from './ui/loader.js';

/** Shortest signed turn from one yaw to another, radians in (-PI, PI]. */
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

let disposed = false;
const cleanup: Array<() => void> = [];
const dispose = (): void => {
  disposed = true;
  for (const release of cleanup.reverse()) release();
  cleanup.length = 0;
};
import.meta.hot?.dispose(dispose);

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const inTown = isTownMode(params);
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('Game canvas is missing.');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', `${inTown ? 'Sindr' : 'Arena'}. WASD to move. Shift to run. Click to capture the mouse.`);

  const panel = document.createElement('section');
  panel.id = 'hero-hud';
  panel.setAttribute('aria-label', inTown ? 'Town controls' : 'Arena controls');
  panel.hidden = true;
  panel.innerHTML = '<button type="button" disabled>Loading</button>' +
    '<p id="control-status" class="hud-status" role="status"></p>';
  document.body.appendChild(panel);
  cleanup.push(() => panel.remove());
  const button = panel.querySelector('button')!;
  const status = (message: string): void => {
    panel.querySelector('#control-status')!.textContent = message;
    if (message) panel.hidden = false;
    else if (!button.disabled) panel.hidden = true;
  };

  const forcedElement = ELEMENTS.find(e => e === params.get('element')?.toUpperCase() || e === params.get('nation')?.toUpperCase()) ?? null;
  const forcedHush = params.has('hush') || params.has('dim');
  const storedChoice = lastFighter();
  const initialChoice: Element = forcedElement || (storedChoice && 'element' in storedChoice ? storedChoice.element : null) || 'IGNIS';
  const isFullMoon = params.get('moon') === 'full';

  let picker: FighterSelect | null = null;
  const loader = new Loader({
    destination: inTown ? 'town' : 'arena',
    onEnter: () => {
      picker?.close();
      if (!document.getElementById('opening-overlay')) canvas.focus({ preventScroll: true });
    },
  });
  cleanup.push(() => loader.dispose());
  loader.setProgress(0.05, 'Reading the world manifest');

  loader.setProgress(0.10, inTown ? "Raising Sindr's streets" : 'Shaping the arena');
  const zoneStart = performance.now();
  const zone = inTown ? await createZone(canvas) : null;
  if (zone) (window as unknown as { zoneLoadMs?: number }).zoneLoadMs = performance.now() - zoneStart;
  const physics = zone ? zone.physics : await initPhysics(initialChoice);
  if (disposed) { physics.dispose(); return; }
  cleanup.push(() => physics.dispose());
  const arena = zone ?? createArena(canvas, initialChoice, isFullMoon);
  const { scene, camera, renderer } = arena;
  if (!zone) loadProps(scene, undefined, initialChoice).catch((error: unknown) => console.error('Arena props failed to load:', error));
  cleanup.push(() => { renderer.setAnimationLoop(null); arena.dispose(); });
  loader.setProgress(0.40, inTown ? "Raising Sindr's streets" : 'Shaping the arena');
  const controller = new HeroController(physics.world, zone ? SPAWN : undefined, undefined, !zone);
  cleanup.push(() => controller.dispose());
  zone?.follow(controller.position);
  const shoulderCamera = new ShoulderCamera(camera, physics.world, !zone);
  if (zone) { controller.facing = SPAWN.facing; shoulderCamera.yaw = SPAWN.facing + Math.PI; }
  let hero: HeroInstance;
  const windskiffBones = ['thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'upperarm_l', 'upperarm_r', 'spine_01'] as const;
  const initialBoneRotations = new Map<string, { x: number; y: number; z: number }>();
  let wasWindskiffActive = false;
  loader.setProgress(0.42, 'Forging the hero');
  const villains = loadEnemyTemplate();
  try {
    hero = await loadHero();
    loader.setProgress(0.55, 'Forging the hero');
    for (const name of windskiffBones) {
      const b = hero.model.getObjectByName(name);
      if (b) initialBoneRotations.set(name, { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z });
    }
  } catch (error) {
    if (!disposed) {
      loader.dispose();
      button.textContent = 'Reload to retry';
      button.disabled = false;
      button.addEventListener('click', () => window.location.reload(), { once: true });
      status('The hero could not load. Reload the page to try again.');
      button.focus({ preventScroll: true });
    }
    throw error;
  }
  if (disposed) { hero.anim.dispose(); disposeObject(hero.model); return; }
  scene.add(hero.model);
  cleanup.push(() => hero.anim.dispose());
  // The HUD fades out while the mouse is captured.
  const togglePlaying = (): void => { document.body.classList.toggle('playing', document.pointerLockElement === canvas); };
  document.addEventListener('pointerlockchange', togglePlaying);
  cleanup.push(() => { document.removeEventListener('pointerlockchange', togglePlaying); document.body.classList.remove('playing'); });
  const input = new GameInput(canvas, button, (dx, dy) => shoulderCamera.orbit(dx, dy), status, inTown ? 'Enter Sindr' : 'Enter the arena');
  input.onSatchelToggle = () => townEconomy?.toggleSatchel();
  cleanup.push(() => input.dispose());
  let controls: Controls | null = null;
  let heroElement: BendingType = 'IGNIS';
  let isDim = false;
  /** Bending is switched on by the player (B); a fight starts with it off. */
  let isLit = false;
  let fightingStyle: FightingStyle = 'weapon';

  /** Set once the fight exists, so a Drawing result arriving later updates the style too. */
  let refreshStyle: (() => void) | null = null;
  // Test flags: ?element=AQUES picks the element, ?dim (or ?hush) plays a Dim, ?tier=N sets the tier (default 5: every move open, no extra strength).
  // Online, the server owns every enemy: no local spawns that other players can't see.
  const playingOnline = hasGameServer() && params.has('online');
  const tier = Math.max(1, Math.min(7, Number(params.get('tier')) || 5));
  /** The element a Hush's shards carry; a Shaper's own element otherwise. */
  let kitElement: Element = 'IGNIS';
  const applyDrawing = (res: DrawingResult | null): void => {
    isDim = forcedHush || (!forcedElement && res?.role === 'Hush');
    kitElement = forcedElement ?? (res?.element as Element | undefined) ?? 'IGNIS';
    if (isDim) kitElement = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)]!;
    heroElement = isDim ? 'HUSH' : kitElement;
    isLit = false;
    hero.setElemental(isLit, heroElement);
    refreshStyle?.();
    picker?.set(isDim ? { role: 'Hush' } : { role: 'Shaper', element: kitElement });
  };
  applyDrawing(forcedElement || forcedHush ? getStoredDrawing() : lastFighter() ?? getStoredDrawing());

  const fps = new URLSearchParams(window.location.search).has('debug') ? new FpsCounter() : null;
  if (!params.has('skipIntro')) {
    const opening = new OpeningFlow((res) => {
      applyDrawing(forcedElement || forcedHush ? res : lastFighter() ?? res);
      if (!document.getElementById('elements-loader')) canvas.focus({ preventScroll: true });
    });
    cleanup.push(() => opening.dispose());
  }
  const consent = new ConsentBanner();
  cleanup.push(() => consent.dispose());
  let lifeSystem: SindrLifeSystem | null = null;
  let townEconomy: TownEconomy | null = null;
  // Debug builds expose the live objects for frame sampling.
  if (fps) Object.assign(window, { elements: { hero, controller, camera, renderer, shoulderCamera, input, get economy() { return townEconomy; }, clock: zone?.clock, surfaceAt: zone?.surfaceAt, sounds: zone?.sounds, get life() { return lifeSystem; }, get hud() { return fightHud; }, get slowMotion() { return slowMotion; }, get fight() { return fight; }, get combat() { return combat; }, get sword() { return sword; }, get bending() { return bending; }, get setFightingStyle() { return setFightingStyle; }, locomotion: { get turnInPlace() { return turnInPlace; }, set turnInPlace(v: boolean) { turnInPlace = v; } } } });
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
  const toElement = (elem: BendingType): Element => (elem === 'HUSH' ? 'IGNIS' : elem);
  const rules = createCombatRules(balance.combat as unknown as CombatBalance);
  const elementFx = new ElementEffects(scene, new URLSearchParams(window.location.search).get('fxQuality') === 'low' ? 'low' : 'high');
  cleanup.push(() => elementFx.dispose());
  // Attuned water sources for AQUES: the Wellspring and natural pools
  if (!zone) {
    if (initialChoice === 'AQUES') {
      elementFx.wellspring(new Vector3(0, 0, 11));
      elementFx.basin(new Vector3(-6, 0, -4));
      elementFx.basin(new Vector3(7, 0, 3));
    } else {
      elementFx.basin(new Vector3(-8.5, 0, 6.5));
      elementFx.basin(new Vector3(9, 0, -6.5));
    }
  }
  // A TERRA wall stops bodies for as long as it stands and physically blocks any elemental attacks.
  elementFx.onWall = (center, facing, size, seconds) => {
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: 0, y: Math.sin(facing / 2), z: 0, w: Math.cos(facing / 2) }),
    );
    setTimeout(() => { if (!disposed) physics.world.removeCollider(collider, false); }, seconds * 1000);
  };
  const space = new CombatSpace(physics.world);
  elementFx.space = space;
  // Wind and water douse / extinguish fire
  elementFx.onExtinguish = (pos, radius) => {
    bending.extinguishAt(pos, radius);
  };
  const bend = new BendState(
    { element: 'IGNIS', weapon: 'sword' },
    tier,
    () => elementFx.waterSources,
    () => elementFx.wellspringSources
  );
  bend.hasWaterEnvironment = initialChoice === 'AQUES';
  bend.isFullMoon = isFullMoon;
  /** Seconds of AQUES Mend left, and how much it heals each second. */
  let mending = { left: 0, perSecond: 0 };

  const bending = new BendingEffects(scene);
  bending.space = elementFx.space;
  cleanup.push(() => bending.dispose());
  bending.onFireballImpact = (pos, elem, hostile) => {
    if (!hostile) fight.spawnBurnPatch(pos, pos, 1.35, 3.2, toElement(elem));
  };

  const fightHud = new FightHud();
  fightHud.onSatchelClick = () => townEconomy?.toggleSatchel();
  const threatArrows = new ThreatArrows();
  cleanup.push(() => fightHud.dispose());
  let hitStop = 0;
  let hurtAt = -Infinity;
  let reviveIn = 0;
  let slowMotion = 0;
  /** Slow motion only where it earns its place: a kill, the last foe, an ultimate landing. Ordinary hits keep the hit-stop. */
  /** Foes within this many metres count toward the wide crowd view. */
  const CROWD_RADIUS = 8;
  const KILL_SLOW_SECONDS = 0.35;
  const LAST_FOE_SLOW_SECONDS = 1.2;
  const ULTIMATE_SLOW_SECONDS = 0.5;
  const markKill = (lastFoe: boolean): void => {
    slowMotion = Math.max(slowMotion, lastFoe ? LAST_FOE_SLOW_SECONDS : KILL_SLOW_SECONDS);
    shoulderCamera.killCloseUp();
  };
  let lockedEnemy: Enemy | null = null;
  let onlineSession: OnlineSession | null = null;
  let remoteLock: NetEnemy | null = null;
  /** A 90° step in place: standing, the camera swings past this and the body turns to follow it. */
  let turnStep: { clip: 'turn_l' | 'turn_r'; from: number; to: number; startedAt: number; span: number } | null = null;
  let turnReadyAt = 0;
  /** Debug builds can hold the in-place turn still for staged stills. */
  let turnInPlace = true;
  const TURN_IN_PLACE_ANGLE = Math.PI / 3;
  const TURN_IN_PLACE_SECONDS = 0.6;

  const fight = new Fight(await villains, physics.world, scene, {
    heroHit(blocked) {
      hurtAt = performance.now();
      if (blocked) bend.gain('blocked');
      else mending.left = 0;
      shoulderCamera.shake(blocked ? 0.15 : 0.25);
      sound.playImpact(false, blocked);
      if (!blocked) sound.playHeroHurt();
      if (!combat.current && !blocked) combat.react('hit');
    },
    wallBlocked(enemyPos) {
      sound.playImpact(false, true);
      shoulderCamera.shake(0.12);
      bending.spawnHitBurst(enemyPos, 'TERRA');
      notice('Terra Wall intercepted attack');
    },
    elementBlocked(enemyPos) {
      sound.playImpact(false, true);
      shoulderCamera.shake(0.15);
      bending.spawnHitBurst(enemyPos, heroElement);
      notice(`${heroElement} bending countered attack`);
    },
    projectileLaunched(p) {
      // The picture rides the projectile the fight judges, so it stops and bursts where the hit is decided.
      if (p.side === 'villain') {
        bending.spawnFireball(p, p.element as Parameters<typeof bending.spawnFireball>[1]);
        sound.playFireBurst(0.3);
        return;
      }
      if (kitElement === 'IGNIS') {
        bending.spawnFireball(p, isDim ? 'IGNIS' : heroElement);
        sound.playFireBurst(isDim ? 0.2 : 0.4);
      } else {
        elementFx.thrown(kitElement, p, isDim ? 0.55 : p.scale);
        if (isDim) sound.playFireBurst(0.2); else sound.playSwing(1.3, false);
      }
      shoulderCamera.shake(isDim ? 0.1 : 0.2);
    },
    projectileEnded(p) {
      if (p.side === 'hero' && kitElement !== 'IGNIS' && p.end) bending.spawnHitBurst(p.end.at, heroElement);
      if (p.end?.reason === 'world') sound.playImpact(false, true);
    },
    heroDied() {
      combat.react('death');
      fightHud.say('You fell');
      shoulderCamera.shake(0.4);
      sound.playThump(50, 0.6, 0.7);
      reviveIn = balance.hero.respawnSeconds;
      townEconomy?.heroDied(controller.position.clone());
    },
    heroParried() {
      controls?.used('parry');
      bend.gain('parry');
      shoulderCamera.shake(0.22);
      sound.playImpact(false, true);
      hitStop = Math.max(hitStop, 0.12);
      notice('Parry');
    },
    enemyHit(_enemy, killed, damage = 35, hitPos, isCrit = false, elemental = false) {
      bend.gain('hit');
      const isHeavy = isCrit || combat.current?.startsWith('heavy') || combat.current === 'uppercut' || combat.current === 'ground_pound';
      hitStop = killed ? 0.12 : isHeavy ? 0.09 : 0.06;
      shoulderCamera.shake(killed ? 0.35 : isHeavy ? 0.24 : 0.14);
      sound.playImpact(killed, false);
      killed ? sound.playVillainDeath(_enemy.controller.position) : sound.playVillainHurt(_enemy.controller.position);
      const pos = hitPos ?? _enemy.controller.position;
      // The effect follows the attack: the element only when bending landed the blow.
      if (elemental) bending.spawnHitBurst(pos, heroElement);
      else bending.spawnImpact(pos, sword.armed);
      fightHud.showDamage(pos, damage, isCrit || isHeavy);
      if (killed && zone) townEconomy?.enemyKilled(_enemy.kind, _enemy.controller.position.clone(), _enemy.element);
      if (killed) markKill(fight.allDead);
      else if (combat.current === 'ultimate') {
        slowMotion = Math.max(slowMotion, ULTIMATE_SLOW_SECONDS);
        shoulderCamera.killCloseUp();
      }
    },
    roundStarted(roundNumber, villainCount) {
      fightHud.say(`Round ${roundNumber} — ${villainCount} ${villainCount === 1 ? 'Villain' : 'Villains'}`);
      setTimeout(() => {
        if (fight.heroAlive && !fight.isVictory && fight.intermissionRemaining <= 0) {
          fightHud.say('');
        }
      }, 2500);
    },
    roundCleared(roundNumber, nextTarget) {
      fightHud.say(`Round ${roundNumber} Cleared!`);
      sound.playSwing(1.0, true);
    },
    victory() {
      fightHud.say('Victory! All 15 Waves Cleared!');
      slowMotion = 2.5;
    },
  }, undefined, !zone);
  // Wind and water put out fire and turn aside earth while the hero is bending, guarding or riding the windskiff.
  fight.isAttackCountered = (element) =>
    (element === 'IGNIS' || element === 'TERRA') && (heroElement === 'AURA' || heroElement === 'AQUES')
    && (isLit || combat.blocking || bend.windskiffActive);
  // ?round=N starts the wave mode at round N, for testing later waves.
  const startRound = Number(new URLSearchParams(window.location.search).get('round'));
  if (startRound > 1) fight.setRound(startRound);
  if (zone) { fight.stopWaves(); fightHud.say(''); }
  let yardSpawned = false;
  if (zone) {
    loader.setProgress(0.70, 'Waking the crowd');
    lifeSystem = new SindrLifeSystem({
      scene,
      camera,
      controller,
      clock: zone.clock,
      sound,
      playerPerson: playerPerson(hero.character),
      getPlayerContext: () => ({
        name: 'Traveler',
        isLit: !isDim,
        role: isDim ? 'Hush' : 'Shaper',
        element: isDim ? 'NONE' : kitElement,
        carriedItemsCount: townEconomy?.carried?.weight ?? 0,
        redFlags: townEconomy?.standing.redFlags ?? 0,
        hasBounty: townEconomy?.standing.hasBounty ?? false,
      }),
      onNotice: (msg) => notice(msg),
      warm: zone.warm,
      getThreats: () => {
        const foes = fight.enemies.filter(e => e.alive && !e.challenging).map(e => e.controller.position);
        return foes.some(at => at.distanceTo(controller.position) < 24) ? [controller.position, ...foes] : foes;
      },
      space,
      posts: zone.posts,
      browse: zone.browse,
      subtitle: (name, line, seconds) => hudLine(`${name}: "${line}"`, seconds * 1000 + 600),
    });
    cleanup.push(() => lifeSystem?.dispose());
  }

  // The context key: what is offered where the player stands, shown over that thing.
  const contextAction = new ContextAction([
    () => streetChallenges?.contextOffer() ?? null,
    () => townEconomy?.contextOffer() ?? null,
    () => lifeSystem?.contextOffer() ?? null,
  ], camera, input, () => controls);
  cleanup.push(() => contextAction.dispose());
  input.onInteract = () => contextAction.interact();
  if (lifeSystem) input.conversation = lifeSystem.conversation;
  // Space jumps; a second tap while still rising or falling from it is the super jump.
  let jumpedAt = -Infinity, superJumped = false;
  input.onJump = () => {
    if (!fight.heroAlive || combat.current || combat.blocking) return;
    const now = performance.now() / 1000;
    if (!controller.grounded) {
      if (!superJumped && now - jumpedAt < balance.controller.superJumpTapSeconds) {
        controller.launch(balance.controller.superJumpSpeed);
        superJumped = true;
      }
      return;
    }
    controls?.used('jump');
    controller.launch(balance.controller.jumpSpeed);
    jumpedAt = now;
    superJumped = false;
  };

  input.onDuelToggle = () => {
    if (playingOnline) return;
    const fwd = new Vector3(Math.sin(controller.facing), 0, Math.cos(controller.facing));
    const spawnPos = controller.position.clone().addScaledVector(fwd, 4.0);
    const kinds: VillainKind[] = ['brawler', 'armed', 'bender'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
    const spawned = fight.spawnVillain({ x: spawnPos.x, z: spawnPos.z }, kind, 120);
    lockedEnemy = spawned;
    shoulderCamera.lockTarget = spawned.controller.position;
    notice(`Challenged ${kind}! Press Tab to lock/unlock.`);
  };
  cleanup.push(() => fight.dispose());
  /** The fighting tier decides which moves are ready and shown; online the room's figure wins. */
  const applyTier = (t: number): void => {
    fight.tier = t;
    bend.tier = t;
  };
  applyTier(tier);
  controls = new Controls(input, canvas, {
    tier, hush: isDim, online: playingOnline, alive: true, nearFoe: false, incoming: false,
    bending: false, ultimateReady: false, interact: false,
  }, applyTier);
  cleanup.push(() => controls?.dispose());

  // --- [creatures: outlaws in Sindr] ---
  const carryParam = params.get('chroma');
  // ?chroma=N overrides the purse for tests; otherwise robbers read the server satchel.
  const forcedCarry = carryParam !== null ? Number(carryParam) : null;
  const carried = (): { chroma: number; weight: number } =>
    forcedCarry !== null ? { chroma: forcedCarry, weight: forcedCarry >= 300 ? 8 : 1 }
      : townEconomy?.carried ?? { chroma: 0, weight: 0 };
  let robberGang: ClientRobberGang | null = null;
  /** Sindr's streets run between the west and east gates; a brawl there breaks the town's law. */
  const SINDR_STREETS = { west: 48, east: 205 };
  // One person in the street calls the hero out; the brawl starts only if the hero accepts.
  const streetChallenges = zone && !playingOnline ? new StreetChallenges({
    spawnVillain: (at) => fight.spawnVillain(at, 'robber', 100),
    enemies: () => fight.enemies,
    space,
    guards: () => lifeSystem?.townManager.townsfolk.filter(t => t.data.role === 'guard').map(t => t.position) ?? [],
    inTown: (at) => at.x > SINDR_STREETS.west && at.x < SINDR_STREETS.east,
    drawForFight: () => { if (fightingStyle === 'weapon' && !sword.engaged) sword.draw(true); },
    onSeenByGuard: () => {
      notice('The town watch saw you brawling: one red flag.');
      townEconomy?.brawlSeen();
    },
    notice: (msg) => notice(msg),
    say: (speaker, concept) => villainSay(speaker, concept),
  }) : null;
  let deserterBand: ClientDeserterBand | null = null;
  if (zone && !playingOnline) {
    villains.then((template) => {
      robberGang = new ClientRobberGang({
        onAlert: (msg) => notice(msg),
        onSpawnEnemy: (enemy) => fight.add(enemy),
        onDespawnEnemy: (enemy) => {
          const idx = fight.enemies.indexOf(enemy);
          if (idx >= 0) fight.enemies.splice(idx, 1);
        },
      });
      robberGang.bindWorld(scene, physics.world, template);

      deserterBand = new ClientDeserterBand({
        onAlert: (msg) => notice(msg),
        onSpawnEnemy: (enemy) => fight.add(enemy),
        onDespawnEnemy: (enemy) => {
          const idx = fight.enemies.indexOf(enemy);
          if (idx >= 0) fight.enemies.splice(idx, 1);
        },
      });
      deserterBand.bindWorld(scene, physics.world, template);
    }).catch(console.error);
  }
  /** Auto-realigns hero facing toward target and glides closer to prevent whiffs on combos and openers. */
  const alignToTarget = (): void => {
    let targetDx = 0;
    let targetDz = 0;
    let hasTarget = false;
    if (remoteLock && remoteLock.view.hp > 0) {
      targetDx = remoteLock.model.position.x - controller.position.x;
      targetDz = remoteLock.model.position.z - controller.position.z;
      hasTarget = true;
    } else if (lockedEnemy && lockedEnemy.alive) {
      targetDx = lockedEnemy.controller.position.x - controller.position.x;
      targetDz = lockedEnemy.controller.position.z - controller.position.z;
      hasTarget = true;
    } else {
      const looking = shoulderCamera.yaw + Math.PI;
      const { aimAssistRange, aimAssistAngle } = balance.combat;
      const mark = fight.nearestInFront(controller.position, looking, aimAssistRange, aimAssistAngle);
      if (mark) {
        targetDx = mark.controller.position.x - controller.position.x;
        targetDz = mark.controller.position.z - controller.position.z;
        hasTarget = true;
      }
    }
    if (hasTarget) {
      controller.facing = Math.atan2(targetDx, targetDz);
      const dist = Math.hypot(targetDx, targetDz);
      if (dist > 1.3 && dist < 3.8) {
        const step = Math.min(dist - 1.25, 0.7);
        controller.shift((targetDx / dist) * step, (targetDz / dist) * step);
      }
    }
  };
  /** A bending move the meter paid for as a chain link: it starts even while on cooldown. */
  let chainPass: string | null = null;
  const combat = new Combat(
    hero.anim,
    (move) => move === chainPass || fight.ready(move, isLit),
    (move, swingAt) => {
      fight.startMove(move, swingAt, isLit);
      controls?.usedMove(move);
      if (move !== 'dodge' && move !== 'hit' && move !== 'death') {
        alignToTarget();
      }
    },
    undefined,
    clip => hero.strikeLimbOf(clip),
  );
  /** The weapon model currently in the hero's hands. */
  let heldWeapon: string = 'sword';
  /** Gives the fight, the moves and the HUD the hero's element, weapon and role. */
  const applyKit = (): void => {
    const weapon = heroWeaponFor({ element: kitElement, hush: isDim });
    const kit: Kit = { element: kitElement, weapon, hush: isDim };
    // AURA carries the staff; everyone else the sword.
    if (weapon !== heldWeapon) { heldWeapon = weapon; void hero.equipWeapon(weapon === 'staff' ? STAFF_WEAPON : SWORD_WEAPON); }
    fight.kit = kit;
    fight.isFullMoon = isFullMoon;
    bend.isFullMoon = fight.isFullMoon;
    bend.hasWaterEnvironment = kitElement === 'AQUES';
    combat.element = kitElement;
    bend.setKit(kit);
    fightHud.setElement(isDim ? 'hush' : kitElement);
    fightHud.setElementArt(kitElement);
  };
  applyKit();
  const drawn = new Vector3();
  const { clipSpeeds } = balance.controller;
  // Calm stance carries the sword on the back; fighting draws it, and the camera follows.
  const sword = new SwordStance(hero);
  let calmIn = 0;
  /** An attack pressed while the sword was sheathed, thrown once it is drawn. */
  let pending: CombatAction | null = null;
  /** Sheathed by hand: a nearby villain doesn't draw the sword until the next attack or guard. */
  let heldCalm = false;

  /** Weapon, hands or legs; bending is a separate switch that works with any of them. */
  let armedWith: 'weapon' | 'hands' | 'legs' = 'weapon';
  let hudClear: ReturnType<typeof setTimeout> | undefined;
  /** One line in the fight HUD for `ms`; a newer line replaces it and its timer. */
  const hudLine = (text: string, ms: number): void => {
    fightHud.say(text);
    clearTimeout(hudClear);
    hudClear = setTimeout(() => { if (fight.heroAlive && !fight.isVictory) fightHud.say(''); }, ms);
  };
  const notice = (text: string): void => {
    status(text);
    hudLine(text, 1600);
  };
  // Street villains speak through the same speech rules as the townsfolk, in their body's voice.
  const streetSpeech = new SpeechMemory();
  const villainSay = (speaker: Enemy, concept: string): void => {
    const said = dialogueRules(dialogueData).speak({ concept, speakerId: 'street_gang', facts: { who: 'street_gang' } }, streetSpeech);
    if (!said) return;
    const p = speaker.controller.position;
    void sound.speak(`street_gang_${speaker.sex}`, said.line, { x: p.x, y: p.y + 1.6, z: p.z });
    hudLine(`Cutthroat: "${said.line}"`, 1500 + said.line.length * 60);
  };
  // Loot, the market stalls and death drops, held by the server. Sindr is an IGNIS town.
  let knownFlags: number | null = null;
  townEconomy = zone ? new TownEconomy(scene, physics.world, 'sindr', 'IGNIS', {
    notice,
    standingChanged: (s) => {
      fightHud.setStanding(s.redFlags, s.hasBounty);
      // A flag added in play, not the standing read on arrival, is called out by whoever saw it.
      if (knownFlags !== null && s.redFlags > knownFlags) lifeSystem?.witness('red_flag_raised', controller.position);
      knownFlags = s.redFlags;
    },
    lootDropped: (x, z) => lifeSystem?.witness('loot_dropped', new Vector3(x, controller.position.y, z)),
    wornChanged: (worn) => {
      void hero.switchOutfit(parseOutfit(worn.outfit));
      fight.setHeroArmour(worn.armour);
    },
    nightness: () => nightness.value,
  }) : null;
  cleanup.push(() => townEconomy?.dispose());
  const applyStyle = (): void => {
    fightingStyle = armedWith === 'weapon' ? 'weapon' : armedWith === 'legs' ? 'legs' : (isLit ? 'bending' : 'bare_hands');
    combat.setStyle(fightingStyle);
    // Only a weapon in hand catches fire; hands and legs bend without lighting the sheathed blade.
    hero.setElemental(isLit && armedWith === 'weapon', heroElement);
    if (armedWith === 'weapon') {
      sword.draw(false);
      heldCalm = false;
      calmIn = balance.stance.calmAfterSeconds;
    } else {
      sword.forceSheathe();
      heldCalm = true;
    }
  };
  refreshStyle = (): void => { applyKit(); applyStyle(); };
  if (!forcedElement && !forcedHush) {
    picker = new FighterSelect(isDim ? { role: 'Hush' } : { role: 'Shaper', element: kitElement }, applyDrawing, () => button.click());
    cleanup.push(() => picker?.dispose());
  }

  const homeMenu = new HomeMenu({
    inTown,
    getCharacterState: () => ({ element: kitElement, isDim, tier: fight.tier }),
    onOpenPicker: () => picker?.open(true),
    onOpenCreator: () => picker?.open(true),
  });
  cleanup.push(() => homeMenu.dispose());
  input.onMenu = () => homeMenu.toggle();
  homeMenu.mountControls(controls!);

  let nationIntro: NationIntroFlow | null = null;
  const introStorageKey = 'elements_intro_v1_completed';
  const isNewArrival = !localStorage.getItem(introStorageKey);
  const shouldRunIntro = (params.has('intro') || isNewArrival) && !params.has('skipIntro');

  if (shouldRunIntro && zone && lifeSystem) {
    nationIntro = new NationIntroFlow({
      scene,
      nation: kitElement,
      isDim,
      controller,
      shoulderCamera,
      input,
      combat,
      fight,
      sound,
      leadManager: lifeSystem.leadManager,
      waypointMarker: lifeSystem.waypointMarker,
      applyTier,
      onEquipStarterWeapon: () => {
        applyKit();
        setFightingStyle('weapon');
        sword.draw(true);
      },
      onMissionComplete: (lead) => {
        localStorage.setItem(introStorageKey, 'done');
        if (townEconomy?.carried) townEconomy.carried.chroma += lead.rewardChroma;
      },
    });
    cleanup.push(() => nationIntro?.dispose());
    nationIntro.start();
  }
  input.onTargetTap = (x, y) => {
    const point = new Vector3(); let target: Enemy | null = null, nearest = 48;
    for (const foe of fight.enemies) {
      if (!foe.alive || foe.controller.position.distanceTo(controller.position) > 30) continue;
      point.copy(foe.controller.position); point.y += 1; point.project(camera);
      if (point.z > 1) continue;
      const distance = Math.hypot((point.x + 1) * window.innerWidth / 2 - x, (1 - point.y) * window.innerHeight / 2 - y);
      if (distance < nearest) { target = foe; nearest = distance; }
    }
    if (playingOnline && onlineSession) {
      let found: NetEnemy | null = null;
      for (const foe of onlineSession.enemies.values()) {
        if (foe.view.hp <= 0 || foe.model.position.distanceTo(controller.position) > 30) continue;
        point.copy(foe.model.position); point.y += 1; point.project(camera);
        if (point.z > 1) continue;
        const distance = Math.hypot((point.x + 1) * window.innerWidth / 2 - x, (1 - point.y) * window.innerHeight / 2 - y);
        if (distance < nearest) { found = foe; nearest = distance; }
      }
      if (!found) return false;
      remoteLock = found === remoteLock ? null : found;
      return true;
    }
    if (!target) return false;
    lockedEnemy = target === lockedEnemy ? null : target;
    return true;
  };
  if (fps) Object.assign((window as unknown as { elements: object }).elements, { controls, homeMenu, contextAction, streetChallenges });
  /** Whether this element keeps its current weapon in hand while bending. */
  const bendsArmed = (): boolean => {
    const allowed = (balance.combat.bendWithWeapon as Record<string, string | string[]>)[kitElement];
    return allowed === 'any' || (Array.isArray(allowed) && allowed.includes(fight.kit.weapon));
  };
  const setBending = (on: boolean): void => {
    if (fight.tier < 1) return;
    if (on && isDim) { notice('The Hush cannot bend'); return; }
    isLit = on;
    if (on) sound.playFireBurst(0.35);
    const sheathed = on && armedWith === 'weapon' && !bendsArmed();
    if (sheathed) armedWith = 'hands';
    applyStyle();
    notice(sheathed ? `Bending on, weapon away: ${kitElement} bends bare-handed` : on ? 'Bending on' : 'Bending off');
  };
  const setFightingStyle = (style: FightingStyle): void => {
    if (style === 'bending') {
      if (fight.tier < 1) return;
      setBending(!isLit);
      return;
    }
    armedWith = style === 'weapon' ? 'weapon' : style === 'legs' ? 'legs' : 'hands';
    const unlit = armedWith === 'weapon' && isLit && !bendsArmed();
    if (unlit) isLit = false;
    applyStyle();
    notice(unlit ? `Weapon drawn, bending off: ${kitElement} can't bend with it in hand` : armedWith === 'weapon' ? 'Weapon drawn' : armedWith === 'legs' ? 'Legs' : 'Bare hands');
  };

  input.onStyleSelect = (style) => {
    setFightingStyle(style);
  };

  input.onLockToggle = () => {
    if (playingOnline && onlineSession) {
      const foes = [...onlineSession.enemies.values()].filter(foe => foe.view.hp > 0 && foe.model.position.distanceTo(controller.position) < 30);
      remoteLock = foes[remoteLock ? foes.indexOf(remoteLock) + 1 : 0] ?? null;
      return;
    }
    lockedEnemy = fight.findLockTarget(controller.position, lockedEnemy);
    shoulderCamera.lockTarget = lockedEnemy ? lockedEnemy.controller.position : null;
  };

  input.onStanceToggle = () => setFightingStyle(armedWith === 'weapon' ? 'bare_hands' : 'weapon');

  input.onBendingToggle = () => {
    if (fight.tier < 1) return;
    setBending(!isLit);
  };

  let techniqueClipUntil = 0;
  let lightningBareUntil = 0;

  input.onTechnique = () => {
    if (kitElement === 'AURA') {
      const active = bend.toggleWindskiff();
      if (active && sword.phase === 'armed') sword.forceSheathe();
      elementFx.setWindskiff(active, controller.position);
      sound.playSwing(1.2, true);
      notice(active ? 'Windskiff technique active (Air Scooter)' : 'Windskiff technique dismissed');
    } else if (kitElement === 'TERRA') {
      const ok = bend.triggerStonehearing();
      if (ok) {
        hero.anim.playOnce('ground_pound', 0.08);
        techniqueClipUntil = performance.now() + 650;
        elementFx.dust(controller.position.clone().setY(0.04), 1.4, 18);
        const positions = fight.enemies.filter(e => e.alive).map(e => e.controller.position);
        elementFx.spawnStonehearingPulse(controller.position, 32.0, positions);
        sound.playGroundPound();
        shoulderCamera.shake(0.35);
        notice(`Stonehearing: ${positions.length} vibration(s) detected through bedrock`);
      }
    } else if (kitElement === 'IGNIS') {
      if (!isLit) setBending(true);
      // Lightning bending requires bare-handed chi channeling through outstretched fingers
      setFightingStyle('bare_hands');
      hero.sword.visible = false;
      hero.anim.playOnce('bare_punch_2', 0.08);
      techniqueClipUntil = performance.now() + 520;
      lightningBareUntil = performance.now() + 650;

      // The bolt runs until the world stops it and strikes every villain on its line.
      const boltEnd = fight.beam(controller.position, controller.facing, 22.0, Math.round(55 * rules.tierBendScale(tier)), 1.2);
      bending.spawnLightningBolt(controller.position, controller.facing, boltEnd.distanceTo(controller.position), boltEnd);
      sound.playThump(90, 0.5, 1.0);
      sound.playFireBurst(1.4);
      shoulderCamera.shake(0.55);
      notice('Lightning Bending (Forge Lightning)');
    }
  };

  if (fps && (window as unknown as { elements?: Record<string, unknown> }).elements) {
    Object.assign((window as unknown as { elements: Record<string, unknown> }).elements, {
      get elementFx() { return elementFx; },
      get setBending() { return setBending; },
      get applyStyle() { return applyStyle; },
      get bend() { return bend; },
      set armedWith(val: 'weapon' | 'hands' | 'legs') { armedWith = val; applyStyle(); },
      get armedWith() { return armedWith; },
      triggerAttack(act: CombatAction) { attack(act); },
    });
  }

  const refusals: Record<BendRefusal, string> = {
    no_water: 'No water here', cooldown: '', tier: 'Not yet: your tier is too low', hush: 'The Dim cannot bend', no_shards: 'No shards left',
  };
  const bendAction: Partial<Record<CombatAction, BendMoveId>> = { uppercut: 'uppercut', ground_pound: 'ground_pound', dash: 'dash_strike', ultimate: 'ultimate' };
  /** Which bending move an action starts in the current style, if any. */
  const bendingMoveFor = (action: CombatAction): BendMoveId | null => {
    if (bendAction[action]) return bendAction[action]!;
    if (fightingStyle === 'bending' && action === 'light') return 'bend_palm';
    if (fightingStyle === 'bending' && action === 'heavy') return 'bend_sweep';
    if (fightingStyle === 'legs' && isLit && action === 'light') return 'bend_palm';
    if (fightingStyle === 'legs' && isLit && action === 'heavy') return 'bend_sweep';
    return null;
  };
  /** Starts a bending move through the meter, the waterskin and the tier; false when refused. */
  const startBending = (action: CombatAction, move: BendMoveId): { ok: boolean; strength: number } => {
    if (isDim) {
      if (action !== 'spark') { notice(refusals.hush); return { ok: false, strength: 0 }; }
      const go = bend.spark(fight.ready('shard_spark', false));
      if (!go.go) { if (refusals[go.why]) notice(refusals[go.why]); return { ok: false, strength: 0 }; }
      fight.setBend(1, false);
      return { ok: combat.press('spark'), strength: 1 };
    }
    if (move === 'ultimate' && !isLit) setBending(true);
    if (!isLit) { notice('Bending is off (B)'); return { ok: false, strength: 0 }; }
    if (combat.current && !isBendMove(combat.current) && !combat.current.startsWith('leg_')) combat.reset();
    const go = bend.begin(move, fight.ready(move, isLit), controller.position);
    if (!go.go) { if (refusals[go.why]) notice(refusals[go.why]); return { ok: false, strength: 0 }; }
    const skip = go.chained || go.free === true;
    fight.setBend(go.strength, skip);
    if (combat.current && !combat.current.startsWith('leg_')) combat.reset();
    chainPass = skip ? move : null;
    const ok = combat.press(action);
    chainPass = null;
    if (ok && go.chained) notice(`Chain ${go.link}`);
    return { ok: ok || true, strength: go.strength };
  };

  let actionBuffer: { action: CombatAction; expiresAt: number } | null = null;

  const triggerAttackEffects = (action: CombatAction, strength = 1, bendMove?: BendMoveId | null): void => {
    // Thrown moves are drawn when they leave the hand (projectileLaunched), not on the key press.
    if (action === 'spark') return;
    if (bendMove && strikeKind(bendMove, fightingStyle) === 'projectile') return;
    if (bendMove === 'dash_strike' && kitElement === 'AQUES') {
      const spec = rules.moveFor('dash_strike', fight.kit);
      const quality = bend.healingQuality(controller.position);
      const mult = bend.healingMultiplier(controller.position);
      mending = { left: 2, perSecond: (spec.heal ?? 24) * mult * strength / 2 };
      elementFx.cast('AQUES', 'dash_strike', controller.position, controller.facing, strength, quality);
      notice(quality === 'wellspring' ? 'Wellspring water Mend (+150%)' : quality === 'natural' ? 'Natural Water Mend (+50%)' : 'Mend (Waterskin)');
      sound.playSwing(1.3, false);
      shoulderCamera.shake(0.15);
      return;
    }
    if (bendMove && kitElement !== 'IGNIS' && fightingStyle !== 'legs') {
      elementFx.cast(kitElement, bendMove, controller.position, controller.facing, strength);
      if (kitElement === 'TERRA') sound.playGroundPound();
      else sound.playSwing(1.3, bendMove === 'ultimate' || bendMove === 'bend_sweep');
      shoulderCamera.shake(bendMove === 'ultimate' ? 0.45 : bendMove === 'bend_palm' ? 0.12 : 0.25);
      return;
    }
    if (bendMove === 'ultimate') {
      // IGNIS Wildfire: a ring of fire rolls outward and keeps burning where it passed.
      bending.spawnGroundPound(controller.position, 'IGNIS');
      sound.playGroundPound();
      shoulderCamera.shake(0.5);
      for (const [radius, count] of [[2.5, 6], [5, 10], [7.5, 14]] as const) {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          fight.spawnBurnPatch(controller.position.clone().add(new Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius)), controller.position, 1.3, 3.5, 'IGNIS');
        }
      }
      return;
    }

    if (fightingStyle === 'bending') {
      if (action === 'heavy') {
        // Ground flame sweep
        bending.spawnFlameSweep(controller.position, controller.facing, heroElement);
        sound.playGroundPound();
        shoulderCamera.shake(0.35);
        const forward = new Vector3(Math.sin(controller.facing), 0, Math.cos(controller.facing));
        const side = new Vector3(Math.cos(controller.facing), 0, -Math.sin(controller.facing));
        fight.spawnBurnPatch(controller.position.clone().addScaledVector(forward, 1.8), controller.position, 1.25, 3.2, toElement(heroElement));
        fight.spawnBurnPatch(controller.position.clone().addScaledVector(forward, 2.7).addScaledVector(side, 0.7), controller.position, 1.1, 2.8, toElement(heroElement));
        fight.spawnBurnPatch(controller.position.clone().addScaledVector(forward, 2.7).addScaledVector(side, -0.7), controller.position, 1.1, 2.8, toElement(heroElement));
      } else if (action === 'ground_pound') {
        bending.spawnGroundPound(controller.position, heroElement);
        sound.playGroundPound();
        shoulderCamera.shake(0.35);
        fight.spawnBurnPatch(controller.position, controller.position, 1.6, 3.5, toElement(heroElement));
      } else if (action === 'uppercut') {
        const forward = new Vector3(Math.sin(controller.facing), 0, Math.cos(controller.facing));
        const pillarPos = controller.position.clone().addScaledVector(forward, 1.2);
        bending.spawnUppercutPillar(pillarPos, heroElement);
        sound.playFireBurst(0.35);
        shoulderCamera.shake(0.25);
        fight.spawnBurnPatch(pillarPos, controller.position, 1.3, 3.2, toElement(heroElement));
      } else {
        // Dash strike
        bending.spawnSlashWave(controller.position, controller.facing, heroElement, true);
        sound.playFireBurst(0.3);
        fight.spawnBurnPatch(controller.position, controller.position, 1.2, 2.8, toElement(heroElement));
      }
    } else if (fightingStyle === 'legs') {
      sound.playSwing(0.9, action === 'heavy');
      const forward = new Vector3(Math.sin(controller.facing), 0, Math.cos(controller.facing));
      const kickingFoot = combat.strikingLimb === 'foot_l' ? footL : footR;
      if (isLit) {
        if (heroElement === 'IGNIS') {
          bending.spawnLegKickArc(controller.position, kickingFoot, controller.facing, action === 'heavy');
          fight.spawnBurnPatch(controller.position.clone().addScaledVector(forward, action === 'heavy' ? 2.2 : 1.4), controller.position, action === 'heavy' ? 1.35 : 1.05, action === 'heavy' ? 3.2 : 2.2, 'IGNIS');
          sound.playFireBurst(action === 'heavy' ? 0.35 : 0.25);
          shoulderCamera.shake(action === 'heavy' ? 0.28 : 0.15);
        } else {
          let reach = 2.2;
          try { reach = rules.moveFor(combat.current as MoveId, fight.kit).reach; } catch { /* not a rules move */ }
          elementFx.castKick(kitElement, bendMove ?? (action === 'heavy' ? 'bend_sweep' : 'bend_palm'), controller.position, kickingFoot, controller.facing, action === 'heavy', strength, reach);
          if (kitElement === 'TERRA') sound.playGroundPound();
          else sound.playSwing(1.3, action === 'heavy');
          shoulderCamera.shake(action === 'heavy' ? 0.3 : 0.15);
        }
      }
    } else if (fightingStyle === 'bare_hands') {
      sound.playSwing(1.2, action === 'heavy');
      if (isLit && heroElement === 'IGNIS') {
        const forward = new Vector3(Math.sin(controller.facing), 0, Math.cos(controller.facing));
        bending.spawnSwingFireSpew(controller.position, controller.facing, 'IGNIS', action === 'heavy');
        if (action === 'heavy' || action === 'ground_pound') {
          fight.spawnBurnPatch(controller.position.clone().addScaledVector(forward, 1.4), controller.position, 1.15, 2.6, 'IGNIS');
        }
      }
    } else {
      // Weapon style
      sound.playSwing(1.0, action === 'heavy' || action === 'ground_pound');
      if (isLit) {
        if (action === 'ground_pound') {
          bending.spawnGroundPound(controller.position, heroElement);
          sound.playGroundPound();
          shoulderCamera.shake(0.35);
          fight.spawnBurnPatch(controller.position, controller.position, 1.6, 3.4, toElement(heroElement));
        } else if (action === 'uppercut') {
          const forward = new Vector3(Math.sin(controller.facing), 0, Math.cos(controller.facing));
          const pillarPos = controller.position.clone().addScaledVector(forward, 1.2);
          bending.spawnUppercutPillar(pillarPos, heroElement);
          sound.playFireBurst(0.35);
          shoulderCamera.shake(0.25);
          fight.spawnBurnPatch(pillarPos, controller.position, 1.3, 3.2, toElement(heroElement));
        } else {
          // Slash wave
          bending.spawnSlashWave(controller.position, controller.facing, heroElement, action === 'heavy' || action === 'dash');
          sound.playFireBurst(0.25);
          // IGNIS fire spews out into the arena on weapon swings!
          if (heroElement === 'IGNIS') {
            const forward = new Vector3(Math.sin(controller.facing), 0, Math.cos(controller.facing));
            const spewPos = controller.position.clone().addScaledVector(forward, action === 'heavy' ? 2.2 : 1.6);
            bending.spawnSwingFireSpew(controller.position, controller.facing, heroElement, action === 'heavy');
            fight.spawnBurnPatch(spewPos, controller.position, action === 'heavy' ? 1.35 : 1.1, action === 'heavy' ? 3.4 : 2.5, 'IGNIS');
          }
        }
      }
    }
  };

  const attack = (action: CombatAction): void => {
    if (!combat.current) {
      alignToTarget();
    }
    const bendMove = bendingMoveFor(action);
    let strength = 1;
    if (bendMove || action === 'spark') {
      const started = startBending(action, bendMove ?? 'bend_palm');
      if (!started.ok) return;
      strength = started.strength;
    } else {
      if (!combat.press(action)) {
        actionBuffer = { action, expiresAt: performance.now() + 380 };
        return;
      }
    }
    actionBuffer = null;
    triggerAttackEffects(action, strength, bendMove);
  };

  const bladeBase = new Vector3();
  const bladeTip = new Vector3();
  const handR = new Vector3();
  const handL = new Vector3();
  const footR = new Vector3();
  const footL = new Vector3();
  const kneeR = new Vector3();
  const kneeL = new Vector3();
  const heroView: HeroView = {
    position: controller.position,
    facing: 0,
    bladeBase,
    bladeTip,
    handR,
    handL,
    footR,
    footL,
    kneeR,
    kneeL,
    get weaponReach() { return hero.weaponSlot.reach; },
    get weaponSlot() { return hero.weaponSlot; },
  };

  // --- Online: ?online joins this zone's room on the game server. ---
  if (playingOnline) {
    const online = await import('./net/online.js');
    const { getServerUrl, getStoredAuthToken } = await import('./auth/server-api.js');
    const { loadHoundTemplate } = await import('./monsters/hound.js');
    const lagMs = Number(new URLSearchParams(window.location.search).get('lag')) || 0;
    online.OnlineSession.connect({
      scene, camera, world: physics.world, controller, hero, combat,
      kit: () => fight.kit,
      alive: () => fight.heroAlive,
      isLit: () => isLit,
      loadAvatar: (outfit) => loadHero(undefined, outfit),
      loadHound: () => loadHoundTemplate(undefined, renderer),
      villains,
      onMyHit(at, damage, killed) {
        bend.gain('hit');
        hitStop = killed ? 0.12 : 0.06;
        if (killed) markKill(false);
        shoulderCamera.shake(killed ? 0.35 : 0.14);
        sound.playImpact(killed, false);
        if (combat.current && isBendMove(combat.current)) bending.spawnHitBurst(at, heroElement);
        else bending.spawnImpact(at, sword.armed);
        fightHud.showDamage(at, damage, killed);
      },
      onHurt(hp, max) {
        const wasAlive = fight.heroAlive;
        fight.heroHealth = { current: Math.min(hp, max), maximum: max };
        hurtAt = performance.now();
        shoulderCamera.shake(0.25);
        sound.playImpact(false, false);
        if (wasAlive && hp <= 0) {
          combat.react('death');
          fightHud.say('You fell');
          reviveIn = balance.hero.respawnSeconds;
        } else if (hp > 0) {
          sound.playHeroHurt();
          if (!combat.current) combat.react('hit');
        }
      },
      onStatus: status,
      onNotice: notice,
      onTier: applyTier,
      onOutfit: (outfit) => { void hero.switchOutfit(parseOutfit(outfit)); },
      clock: zone?.clock,
    }, {
      server: getServerUrl(), zone: inTown ? 'sindr' : 'arena', token: getStoredAuthToken(),
      element: kitElement, role: isDim ? 'Hush' : 'Shaper', lag: lagMs / 1000,
      forcedCarry: forcedCarry ?? undefined,
      night: params.has('night') ? Number(params.get('night')) : undefined,
      clock: params.has('clock') ? Number(params.get('clock')) : undefined,
    }).then((session) => {
      onlineSession = session;
      cleanup.push(() => session.dispose());
      townEconomy?.goOnline(session.channel, () => {
        const list: Array<{ id: string; name: string; position: Vector3 }> = [];
        for (const [id, rp] of session.players) {
          if (rp.hero?.model) {
            list.push({ id, name: id.slice(0, 8), position: rp.hero.model.position });
          }
        }
        return list;
      });
      if (fps) Object.assign((window as unknown as { elements: object }).elements, { online: session });
    }).catch((error: unknown) => status(`Playing offline: ${(error as Error).message}`));
  }
  // --- End online ---

  if (zone) {
    loader.setProgress(0.80, 'Lighting the braziers');
    await Promise.all([zone.ready, bending.ready, lifeSystem?.ready]);
    if (disposed) return;
    loader.setProgress(0.90, 'Attuning the elements');
    const looks = new Group();
    looks.add(...villainLooks(await villains));
    scene.add(looks);
    loader.setProgress(0.92, 'Warming the world');
    try {
      await zone.warm(scene, (p) => {
        loader.setProgress(0.92 + p * 0.07, 'Warming the world');
      });
    } finally {
      looks.removeFromParent();
    }
    if (disposed) return;
  } else {
    loader.setProgress(0.85, 'Lighting the braziers');
    await bending.ready;
    loader.setProgress(0.92, 'Attuning the elements');
  }
  loader.setProgress(1.0, zone ? 'Sindr is ready' : 'The arena is ready');
  resetTime();
  button.disabled = false;
  button.textContent = zone ? 'Enter Sindr' : 'Enter the arena';
  status('');
  panel.hidden = true;
  loader.ready();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const rawDelta = Math.min((now - lastTime) / 1000, balance.controller.maxFrameDelta);
    lastTime = now;

    let timeScale = 1.0;
    if (slowMotion > 0) {
      slowMotion = Math.max(0, slowMotion - rawDelta);
      timeScale = 0.25;
    }
    // The fight and the combat clock stand still together while the fighter picker or home menu is open.
    const picking = document.body.classList.contains('selecting') || document.body.classList.contains('home-open') || document.body.classList.contains('shop-open');
    const delta = rawDelta * timeScale;

    // Validate lock-on target
    if (lockedEnemy && !lockedEnemy.alive) {
      lockedEnemy = fight.findLockTarget(controller.position, null);
    }
    if (remoteLock && remoteLock.view.hp <= 0) remoteLock = null;
    shoulderCamera.lockTarget = remoteLock?.model.position ?? lockedEnemy?.controller.position ?? null;

    const alive = fight.heroAlive;
    nationIntro?.update(rawDelta);
    townEconomy?.update(rawDelta, controller.position);
    for (const action of alive ? input.takeActions() : []) {
      if (action !== 'dodge') {
        heldCalm = false;
        if (fightingStyle !== 'weapon') {
          attack(action);
        } else {
          if (sword.armed) attack(action);
          else { sword.draw(true); pending = action; }
        }
        continue;
      }
      if (!fight.ready('dodge', isLit) || !combat.press(action)) continue;
      fight.recordDodge(isLit);
      sound.playDodge();
      const roll = movementVelocity(input.read(), shoulderCamera.yaw);
      const way = fight.dodgeWay(controller.position, roll.lengthSq() > 0 ? Math.atan2(roll.x, roll.z) : null);
      combat.dodgeOpen = way.open;
      controller.facing = way.angle;
    }
    if (!alive) { input.takeActions(); pending = null; }
    if (pending && (sword.armed || fightingStyle !== 'weapon')) { attack(pending); pending = null; }
    if (alive && input.blocking && fightingStyle === 'weapon' && !sword.engaged) { sword.draw(true); heldCalm = false; }
    combat.blocking = alive && input.blocking && (fightingStyle !== 'weapon' || sword.armed) && !combat.current;
    if (combat.blocking) {
      controls?.used('block');
      const threat = lockedEnemy ?? fight.nearestInFront(controller.position, controller.facing, balance.hero.guardTurnRange, Math.PI);
      const toward = threat
        ? Math.atan2(threat.controller.position.x - controller.position.x, threat.controller.position.z - controller.position.z)
        : shoulderCamera.yaw + Math.PI;
      controller.facing = turnToward(controller.facing, toward, delta);
    }
    if (!picking) combat.update(delta);
    if (alive && actionBuffer) {
      if (performance.now() > actionBuffer.expiresAt) {
        actionBuffer = null;
      } else if (!combat.current || combat.progress >= (1 - balance.combat.comboWindow)) {
        const buffered = actionBuffer.action;
        if (combat.press(buffered)) {
          actionBuffer = null;
          triggerAttackEffects(buffered, 1, bendingMoveFor(buffered));
        }
      }
    }
    bend.tick(delta, controller.position);
    if (mending.left > 0) {
      const step = Math.min(delta, mending.left);
      mending.left -= step;
      fight.healHero(mending.perSecond * step);
    }
    const inLightning = performance.now() < lightningBareUntil;
    if (fightingStyle === 'weapon' && !inLightning) {
      // Stay drawn while fighting or with a villain close by; sheathe after a quiet spell.
      const threatened = !heldCalm && fight.nearestDistance(controller.position) < balance.stance.engageRadius;
      if ((combat.current && combat.current !== 'dodge') || combat.blocking || pending || threatened) {
        calmIn = balance.stance.calmAfterSeconds;
      }
      if (threatened && alive) sword.draw(false);
      calmIn = Math.max(0, calmIn - delta);
      if (calmIn === 0 && !combat.current) sword.sheathe();
    } else {
      if (sword.armed || sword.engaged) {
        sword.forceSheathe();
      }
    }
    // The arena always fights; in the world the shoulder view comes with a drawn weapon, a move, a hit or a villain close by.
    const hurtRecently = performance.now() - hurtAt < balance.stance.calmAfterSeconds * 1000;
    const bareReady = fightingStyle !== 'weapon' && (!zone || fight.nearestDistance(controller.position) < balance.stance.engageRadius);
    shoulderCamera.fight = (sword.engaged || bareReady || combat.current !== null || hurtRecently) ? 1 : 0;
    // Three or more foes close and fighting: the fight view pulls out wide.
    const hx = controller.position.x, hz = controller.position.z;
    shoulderCamera.crowd = fight.enemies.filter((e) => e.alive && !e.challenging
      && Math.hypot(e.controller.position.x - hx, e.controller.position.z - hz) < CROWD_RADIUS).length >= 3;
    if (reviveIn > 0 && (reviveIn -= delta) <= 0) {
      fight.reviveHero();
      combat.reset();
      fightHud.say('');
      if (zone) {
        controller.place(SPAWN.x, 0, SPAWN.z);
        controller.facing = SPAWN.facing;
        shoulderCamera.yaw = SPAWN.facing + Math.PI;
      }
    }
    if (zone) {
      const yardDist = Math.hypot(controller.position.x - 124, controller.position.z - -36);
      if (!playingOnline && yardDist < 12 && !yardSpawned && fight.enemies.filter(e => e.alive).length === 0) {
        yardSpawned = true;
        fight.spawnVillain({ x: 121, z: -38 }, 'brawler', 100);
        fight.spawnVillain({ x: 127, z: -34 }, 'armed', 110);
        notice("Master's Sparring Yard: Defeat the challengers! (K: summon partner)");
      } else if (yardDist > 24) {
        yardSpawned = false;
      }

      streetChallenges?.update(delta, controller.position, alive, controller.facing);

      // --- [creatures: outlaw encounter evaluation in Sindr] ---
      if (robberGang && alive) {
        const isNight = nightness.value >= NIGHT_FROM;
        const hour = isNight ? 23 : 14;
        const zoneType = sindrStreet(controller.position.x, controller.position.z);

        const quarry: Quarry = {
          position: controller.position,
          alive: fight.heroAlive,
        };

        const sentryDistance = sindrSentryDistance(controller.position.x);
        const sentryNearShrine = sentryDistance < 25;

        const senses: OutlawSenses = {
          playerCarry: {
            accountId: 'player_hero',
            chroma: carried().chroma,
            satchelWeight: carried().weight,
          },
          playerLocation: {
            x: controller.position.x,
            z: controller.position.z,
            zoneType,
          },
          timeOfDay: isNight ? 'night' : 'day',
          hour,
          sentriesNear: sentryNearShrine,
          sentryDistance,
        };

        if (zoneType === 'road_out_of_town' && deserterBand) {
          deserterBand.update(delta, quarry, senses.playerCarry, senses.playerLocation);
        } else {
          robberGang.update(delta, quarry, senses);
        }
      }
    }
    hero.sword.updateMatrixWorld(true);
    hero.sword.localToWorld(bladeBase.copy(hero.bladeBase));
    hero.sword.localToWorld(bladeTip.copy(hero.bladeTip));
    hero.getLimbWorldPosition('hand_r', handR);
    hero.getLimbWorldPosition('hand_l', handL);
    hero.getLimbWorldPosition('foot_r', footR);
    hero.getLimbWorldPosition('foot_l', footL);
    hero.getLimbWorldPosition('knee_r', kneeR);
    hero.getLimbWorldPosition('knee_l', kneeL);
    heroView.facing = controller.facing;
    const rooted = combat.current !== null || combat.blocking;
    const speedMultiplier = (isLit ? 1.25 : 1.0) * (bend.windskiffActive ? 1.85 : 1.0);
    // Locked on, the body keeps its chest to the target while the feet carry it any way.
    const lockAt = shoulderCamera.lockTarget;
    const facingLock = lockAt
      ? Math.atan2(lockAt.x - controller.position.x, lockAt.z - controller.position.z)
      : undefined;
    const alpha = stepper.advance(delta, () => {
      // Fists close in further than a blade before the step stops.
      const stopAt = fightingStyle === 'weapon' ? balance.combat.lungeStopDistance : balance.combat.bareLungeStopDistance;
      const stop = combat.current !== 'dodge' && fight.nearestDistance(controller.position) < stopAt;
      const lunge = stop ? 0 : combat.lunge;
      controller.step(rooted ? { forward: 0, right: 0, running: false } : input.read(), shoulderCamera.yaw, lunge, speedMultiplier,
        undefined, rooted ? undefined : facingLock);
      if (!picking) fight.step(heroView, combat, isLit);
      // Every body has moved for this tick; the world steps once.
      physics.step();
    });

    if (bend.windskiffActive) {
      elementFx.updateWindskiff(controller.position, delta, controller.speed, controller.facing);
    }

    const animDelta = delta;
    drawn.lerpVectors(controller.previous, controller.position, alpha);
    if (bend.windskiffActive) drawn.y += 0.45;
    hero.model.position.copy(drawn);
    hero.model.rotation.y = controller.facing + balance.controller.modelForwardYaw;
    if (bend.windskiffActive) {
      wasWindskiffActive = true;
      // In Windskiff mode, hero rides seated atop the air scooter
      hero.anim.play('jump', 0.2); // Airborne tuck posture
      hero.anim.setSpeed('jump', 0); // Freeze tuck in air
      hero.model.position.y = drawn.y + 0.65; // Elevated seat height atop the spinning windskiff
    } else {
      if (wasWindskiffActive) {
        wasWindskiffActive = false;
        // Cleanly restore all mutated bones to initial rest pose
        for (const [name, rot] of initialBoneRotations.entries()) {
          const b = hero.model.getObjectByName(name);
          if (b) b.rotation.set(rot.x, rot.y, rot.z);
        }
        hero.anim.play('idle_relaxed', 0.2);
      }
      if (combat.blocking) {
        hero.anim.play('block', balance.combat.fade);
      } else if (!combat.current && !controller.grounded) {
        turnStep = null;
        hero.anim.play('jump', 0.12);
        hero.anim.setSpeed('jump', 1.0);
      } else if (!combat.current && performance.now() > techniqueClipUntil) {
        const now = performance.now() / 1000;
        const pace = locomotionForSpeed(controller.speed);
        const locked = lockAt !== null;
        if (turnInPlace && pace === 'idle' && !locked && controller.grounded && !turnStep && now >= turnReadyAt) {
          // Standing, a camera swung well off the body starts a 90° step in place.
          const wanted = shoulderCamera.yaw + Math.PI;
          const off = angleDelta(controller.facing, wanted);
          if (Math.abs(off) > TURN_IN_PLACE_ANGLE) {
            turnStep = {
              clip: off > 0 ? 'turn_l' : 'turn_r', from: controller.facing,
              to: controller.facing + Math.sign(off) * Math.PI / 2, startedAt: now, span: TURN_IN_PLACE_SECONDS,
            };
          }
        }
        if (turnStep && pace !== 'idle') {
          // Walking off mid-step: finish the heading at once and let the legs catch up.
          controller.facing = turnStep.to;
          turnStep = null;
          turnReadyAt = now + 0.2;
        }
        if (turnStep) {
          const span = hero.anim.duration(turnStep.clip);
          controller.facing = turnStep.from + (turnStep.to - turnStep.from)
            * Math.min(1, (now - turnStep.startedAt) / turnStep.span);
          hero.anim.play(turnStep.clip, 0.12);
          if (span > 0) hero.anim.setSpeed(turnStep.clip, span / turnStep.span);
          if (now - turnStep.startedAt >= turnStep.span) {
            controller.facing = turnStep.to;
            turnStep = null;
            turnReadyAt = now + 0.25;
          }
        } else {
          let clip = pace === 'idle' && !sword.engaged ? 'idle_relaxed' : pace;
          let clipSpeed = controller.speed;
          if (locked && pace === 'walk') {
            // Track relative to the chest: a sidestep gets the strafe walk, a backpedal runs the walk backwards.
            const move = movementVelocity(input.read(), shoulderCamera.yaw);
            const right = -move.x * Math.cos(controller.facing) + move.z * Math.sin(controller.facing);
            const forward = move.x * Math.sin(controller.facing) + move.z * Math.cos(controller.facing);
            if (Math.abs(right) > Math.abs(forward) + 0.15) {
              clip = right > 0 ? 'strafe_r' : 'strafe_l';
              clipSpeed = Math.abs(right);
            } else if (forward < -0.2) {
              clipSpeed = -Math.abs(clipSpeed);
            }
          }
          hero.anim.play(clip, balance.controller.animationFade);
          if (clip !== 'idle' && clip !== 'idle_relaxed') {
            const authored = (clipSpeeds as Record<string, number>)[clip] ?? 1;
            const scale = clipSpeed / authored;
            hero.anim.setSpeed(clip, Math.abs(scale) < 0.5 ? Math.sign(scale || 1) * 0.5 : scale);
          }
        }
      }
    }
    hero.anim.update(animDelta);
    sword.update(animDelta);
    if (bend.windskiffActive || performance.now() < lightningBareUntil) {
      if (sword.phase === 'armed') sword.forceSheathe();
      hero.sword.visible = false;
      // Sitting riding posture on bone joints atop the sphere
      if (bend.windskiffActive) {
        const thighL = hero.model.getObjectByName('thigh_l');
        const thighR = hero.model.getObjectByName('thigh_r');
        const calfL = hero.model.getObjectByName('calf_l');
        const calfR = hero.model.getObjectByName('calf_r');
        const armL = hero.model.getObjectByName('upperarm_l');
        const armR = hero.model.getObjectByName('upperarm_r');
        const spine = hero.model.getObjectByName('spine_01');
        if (thighL) { thighL.rotation.x = 1.35; thighL.rotation.z = -0.2; }
        if (thighR) { thighR.rotation.x = 1.35; thighR.rotation.z = 0.2; }
        if (calfL) { calfL.rotation.x = -1.6; }
        if (calfR) { calfR.rotation.x = -1.6; }
        if (armL) { armL.rotation.x = 0.75; armL.rotation.z = -0.4; }
        if (armR) { armR.rotation.x = 0.75; armR.rotation.z = 0.4; }
        if (spine) { spine.rotation.x = -0.15; }
      }
    } else {
      hero.sword.visible = true;
      if (wasWindskiffActive) {
        wasWindskiffActive = false;
        hero.anim.setSpeed('jump', 1.0);
        hero.anim.play('idle_relaxed', 0.1);
        for (const [name, rot] of initialBoneRotations.entries()) {
          const b = hero.model.getObjectByName(name);
          if (b) b.rotation.set(rot.x, rot.y, rot.z);
        }
      }
    }
    hero.model.updateMatrixWorld(true);
    hero.sword.updateMatrixWorld(true);
    hero.sword.localToWorld(bladeBase.copy(hero.bladeBase));
    hero.sword.localToWorld(bladeTip.copy(hero.bladeTip));
    hero.getLimbWorldPosition('hand_r', handR);
    hero.getLimbWorldPosition('hand_l', handL);
    hero.getLimbWorldPosition('foot_r', footR);
    hero.getLimbWorldPosition('foot_l', footL);
    hero.getLimbWorldPosition('knee_r', kneeR);
    hero.getLimbWorldPosition('knee_l', kneeL);
    const bladeLit = fightingStyle === 'weapon' && performance.now() >= lightningBareUntil;
    bending.setLit(isLit, heroElement, drawn, controller.facing, bladeLit ? bladeBase : undefined, bladeLit ? bladeTip : undefined);
    bending.syncBurnPatches(fight.activeBurnPatches);
    bending.setBurningVillains(fight.burningVillains);
    bending.update(delta, drawn, camera);
    scene.userData.cameraQuaternion = camera.quaternion;
    elementFx.update(delta);
    fight.draw(picking ? 0 : animDelta, alpha, controller.position);
    const roundInfo: RoundHudInfo = {
      round: fight.currentRoundNumber,
      totalRounds: fight.totalRounds,
      target: fight.roundVillainTarget,
      remaining: fight.villainsRemaining,
      isVictory: fight.isVictory,
      intermission: fight.intermissionRemaining,
    };
    fightHud.update(
      delta,
      fight.heroHealth,
      fight.enemies,
      camera,
      balance.enemy.healthBarHeight,
      isLit,
      sword.armed,
      lockedEnemy,
      heroElement,
      zone ? undefined : roundInfo,
      fightingStyle,
      isDim,
      shoulderCamera.fight > 0,
    );
    const baseSupply = isDim ? `${bend.shards} ${kitElement.toLowerCase()} shards`
      : kitElement === 'AQUES' ? `Waterskin ${bend.hasWaterEnvironment || bend.nearWater(controller.position) ? '∞ (reusable)' : `${bend.waterskin}/${balance.combat.waterskin.charges}`}${bend.healingQuality(controller.position) === 'wellspring' ? ' · Wellspring water Oasis' : bend.nearWater(controller.position) ? ' · Water source' : ''}${bend.isFullMoon ? ' · Full Moon (+50%)' : ''}` : null;
    fightHud.setBending(bend.meter, bend.max, bend.weakBelow, baseSupply);
    fightHud.setPurse(zone ? (forcedCarry ?? townEconomy?.carried?.chroma ?? null) : null);
    shoulderCamera.update(drawn, delta, reducedMotion.matches);
    nationIntro?.applyCamera(camera, delta, reducedMotion.matches);
    threatArrows.update(controller.position, fight.enemies, camera);
    hero.model.visible = camera.position.distanceTo(shoulderCamera.target) > balance.camera.hideHeroDistance;
    lifeSystem?.update(delta);
    contextAction.update();
    const remoteNearby = onlineSession ? [...onlineSession.enemies.values()].filter(foe => foe.view.hp > 0 && foe.model.position.distanceTo(controller.position) < 6) : [];
    const nearby = fight.enemies.filter(foe => foe.alive && foe.controller.position.distanceTo(controller.position) < 6);
    controls?.update({
      tier: fight.tier, hush: isDim, online: playingOnline, alive,
      nearFoe: nearby.length > 0 || remoteNearby.length > 0, incoming: nearby.some(foe => foe.attacking) || remoteNearby.some(foe => foe.view.state === 'strike' || foe.view.state === 'charge'),
      bending: isLit, ultimateReady: bend.meter >= bend.max && fight.ready('ultimate', isLit),
      interact: contextAction.hasOffer,
    });
    sound.update(delta, camera, controller, fight.enemies, sword, {
      heroSteps: hero.anim.takeLanded(),
      ...(zone ? {
        minute: zone.clock.minute,
        playerPos: controller.position,
        surfaceAt: (p: { x: number; y: number; z: number }) => zone.surfaceAt(p.x, p.y, p.z),
        market: zone.sounds.market,
        forge: zone.sounds.forge,
        people: lifeSystem?.townManager.townsfolk,
      } : {}),
    });
    fps?.tick();
    arena.render();
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start the game:', error);
});
