import { Group, Matrix4, PerspectiveCamera, Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import type { Loaders } from '../assets/loaders.js';
import { buildMasterBody, releaseMaster } from './master-body.js';
import type { AnimationPlayer } from '../anim/player.js';
import type { HeroController } from '../controller.js';
import type { ShoulderCamera } from '../camera.js';
import type { GameInput } from '../input.js';
import type { Combat } from '../combat.js';
import type { Fight } from '../fight.js';
import type { SoundManager } from '../audio.js';
import type { LeadManager, Lead } from '../../../shared/src/story/leads.js';
import type { WaypointMarker } from './waypoint-marker.js';
import { voiceId } from '../../../shared/src/story/voice.js';
import { WALK_SPEED } from '../life/town-manager.js';
import { gripAligned, palmSocket, snapToSocket } from '../weapon-mount.js';
import type { ControlAction } from '../controls/actions.js';
import {
  getNationIntroConfig,
  type NationIntroConfig,
  type NationIntroDialogue,
} from '../../../shared/src/story/nation-intro.js';

export type IntroStep =
  | 'idle'
  /** The hero falls into the arrival ground and lies where they landed. */
  | 'arriving'
  /** Down on the ground; the master walks in. */
  | 'down'
  | 'approach'
  | 'greeting'
  | 'step_move'
  | 'step_sprint_jump'
  | 'step_weapon'
  | 'step_attacks'
  | 'step_defense'
  /** A training step is done: the master acknowledges it before the next instruction. */
  | 'heard'
  | 'lore_and_mission'
  | 'active_mission'
  | 'awaiting_gate'
  | 'completed';

export interface NationIntroOptions {
  scene: import('three').Scene;
  /** The game's shared model loaders. */
  loaders: Loaders;
  nation: string;
  /** Read when needed: signing in at the gate can bring back an account's earlier Drawing. */
  isDim: () => boolean;
  controller: HeroController;
  shoulderCamera: ShoulderCamera;
  input: GameInput;
  combat: Combat;
  fight: Fight;
  sound: SoundManager;
  leadManager: LeadManager;
  waypointMarker: WaypointMarker;
  applyTier: (tier: number) => void;
  /** The hero's arrival: dropped from above, down on landing, raised when the master offers an arm. */
  arrival: {
    drop(): void;
    /** True once the hero lies on the ground after the fall. */
    down(): boolean;
    standUp(): void;
    /** True once the hero is on their feet again. */
    standing(): boolean;
  };
  /** Narrows the player's controls to those taught so far; null gives every control back. */
  restrictControls: (taught: ReadonlySet<ControlAction> | null) => void;
  /** The starter weapon the master carries in, sheathed, and hands over: the blade and the sheath it rides in. */
  weapon: { assetPath: string; carry?: { assetPath: string } };
  /** The hero's right palm, where the weapon is held for the moment it is taken. */
  heroPalm: () => Object3D | null;
  /** The hero reaches out to take something. */
  heroReach: () => void;
  /** The weapon is the hero's: it rides sheathed on their back from now on. */
  receiveWeapon: () => void;
  onTrainingComplete?: () => void;
  onMissionComplete?: (missionLead: Lead) => void;
  /** Runs at the gate before the level is granted: the sign-in that keeps the player's progress. */
  beforeUnlock?: () => Promise<void>;
}

/** One training step: the master's instruction, the prompt card, and the check that it has been done. */
interface TrainingStep {
  step: IntroStep;
  line: keyof NationIntroDialogue;
  kicker: string;
  prompt: string;
  /** The controls this step teaches; the player can use them from the moment it is taught. */
  teaches: ControlAction[];
  /** Runs as the instruction starts; the prompt and the controls wait for what it returns. */
  begin?: () => Promise<void> | void;
  /** Reads this frame's play; true once the step is done. May update the prompt card on partial progress. */
  done: () => boolean;
}

/** Time after the landing before the hero starts to rise, in milliseconds. */
const RISE_AFTER_LANDING_MS = 2000;
/** How far up the road the master waits, metres: near enough to arrive as the hero finishes rising. */
const MASTER_WAITS_AT = 5;
/** The master's walking pace, m/s: slower and more measured than the town crowd's. */
const MASTER_WALK_SPEED = 1.05;
/** A turn about the grip's across axis, so a weapon held in a hanging hand points at the ground. */
const POINT_DOWN = new Matrix4().makeRotationX(Math.PI);
/** How far each finger joint closes round a grip, radians. */
const FINGER_CURL = 1.1;

const key = (label: string): string => `<span class="nation-intro-key">${label}</span>`;

export class NationIntroFlow {
  readonly config: NationIntroConfig;
  private currentStep: IntroStep = 'idle';
  private startPosition = new Vector3();
  private hasMoved = false;
  private hasSprinted = false;
  private hasJumped = false;
  private hasEquippedWeapon = false;
  private hasLightAttacked = false;
  private hasHeavyAttacked = false;
  private hasGuarded = false;
  private hasDodged = false;
  private activeMissionLead: Lead | null = null;
  private masterPosition = new Vector3();
  private masterModel: Group | null = null;
  private masterAnim: AnimationPlayer | null = null;
  private masterClipNames: string[] = [];
  private masterPose = '';
  /** Settles when the master's body has loaded or failed to; lines wait on it for a voice. */
  private masterReady!: Promise<void>;
  private masterApproaching = false;
  /** Called once when the master reaches where he was walking to. */
  private onMasterArrived: (() => void) | null = null;
  /** The sheathed weapon in the master's hand, then briefly in the hero's, until it goes to the hero's back. */
  private masterProp: Object3D | null = null;
  /** The palm holding the weapon now, and whether it is held out hilt first (else carried point down). */
  private propPalm: Object3D | null = null;
  private propPresented = false;
  /** Holding the weapon out to the hero. */
  private handing = false;

  /** Controls the master has taught so far; nothing else answers during the lesson. */
  private readonly taught = new Set<ControlAction>();
  private masterDispatched = false;
  private disposed = false;
  private pendingTimers: any[] = [];
  private readonly training: TrainingStep[];
  private trainingIndex = -1;
  /** Settles once the line now showing has been heard out (its recording, or its reading time). */
  private lineHeard: Promise<void> = Promise.resolve();

  // Camera staging and smooth-blend
  private cameraMode: 'cinematic' | 'blending' | 'released' = 'cinematic';
  private blendProgress = 0;
  private readonly blendDuration = 1.2; // 1.2 seconds smooth blend
  private readonly cinematicPos = new Vector3();
  private readonly cinematicLookAt = new Vector3();
  private readonly blendStartPos = new Vector3();
  private readonly blendStartQuat = new Quaternion();
  private readonly tempTargetPos = new Vector3();
  private readonly tempTargetQuat = new Quaternion();

  // Overlay elements
  private overlay: HTMLElement;
  private dialogueBox: HTMLElement;
  private speakerName: HTMLElement;
  private speakerTitle: HTMLElement;
  private dialogueLine: HTMLElement;
  private stepCard: HTMLElement;
  private stepKicker: HTMLElement;
  private stepPrompt: HTMLElement;

  private cleanupFns: Array<() => void> = [];

  constructor(private readonly opts: NationIntroOptions) {
    this.config = getNationIntroConfig(opts.nation);

    // Build DOM overlay
    this.overlay = document.createElement('aside');
    this.overlay.className = 'nation-intro-overlay';
    this.overlay.setAttribute('aria-live', 'polite');

    this.overlay.innerHTML = `
      <div class="nation-intro-dialogue" style="display: none;">
        <div class="nation-intro-speaker">
          <span class="nation-intro-name">${this.config.master.name}</span>
          <span class="nation-intro-title">${this.config.master.title}</span>
        </div>
        <p class="nation-intro-line"></p>
      </div>
      <div class="nation-intro-step-card" style="display: none;">
        <span class="nation-intro-step-kicker">Fundamental Training</span>
        <p class="nation-intro-step-prompt"></p>
      </div>
    `;

    this.dialogueBox = this.overlay.querySelector('.nation-intro-dialogue')!;
    this.speakerName = this.overlay.querySelector('.nation-intro-name')!;
    this.speakerTitle = this.overlay.querySelector('.nation-intro-title')!;
    this.dialogueLine = this.overlay.querySelector('.nation-intro-line')!;
    this.stepCard = this.overlay.querySelector('.nation-intro-step-card')!;
    this.stepKicker = this.overlay.querySelector('.nation-intro-step-kicker')!;
    this.stepPrompt = this.overlay.querySelector('.nation-intro-step-prompt')!;

    document.body.appendChild(this.overlay);

    // Start player at Level 0 (Uninitiated: bending inactive)
    this.opts.applyTier(0);
    this.training = this.trainingSteps();
  }

  private trainingSteps(): TrainingStep[] {
    const { controller, input, combat } = this.opts;
    return [
      {
        step: 'step_move', line: 'stepFooting', kicker: 'Footing', teaches: ['move', 'look'],
        prompt: `${key('W')} ${key('A')} ${key('S')} ${key('D')} Move · Move mouse to look`,
        done: () => (this.hasMoved ||= controller.position.distanceTo(this.startPosition) >= 2.2),
      },
      {
        step: 'step_sprint_jump', line: 'stepSprintJump', kicker: 'Mobility', teaches: ['run', 'jump'],
        prompt: `${key('Shift')} Sprint · ${key('Space')} Jump`,
        done: () => {
          if (input.read().running) this.hasSprinted = true;
          if (!controller.grounded) this.hasJumped = true;
          return this.hasSprinted && this.hasJumped;
        },
      },
      {
        step: 'step_weapon', line: 'weaponHandoff', kicker: 'Armament', teaches: ['weapon'],
        prompt: `${key('1')} Draw Weapon`,
        begin: () => this.handOverWeapon(),
        done: () => (this.hasEquippedWeapon ||= combat.fightingStyle === 'weapon'),
      },
      {
        step: 'step_attacks', line: 'stepAttacks', kicker: 'Striking', teaches: ['strike', 'heavy'],
        prompt: `${key('Left Click')} Light Attack · ${key('Right Click')} Heavy Attack`,
        done: () => {
          const cur = combat.current;
          if (cur && (cur.includes('light') || cur.includes('strike') || cur.includes('slash'))) this.hasLightAttacked = true;
          if (cur && cur.includes('heavy')) this.hasHeavyAttacked = true;
          if (this.hasLightAttacked !== this.hasHeavyAttacked) {
            this.showStepPrompt('Striking', this.hasLightAttacked
              ? `Light attack completed · ${key('Right Click')} Heavy Attack`
              : `Heavy attack completed · ${key('Left Click')} Light Attack`);
          }
          return this.hasLightAttacked && this.hasHeavyAttacked;
        },
      },
      {
        step: 'step_defense', line: 'stepDefense', kicker: 'Defense', teaches: ['block', 'parry', 'dodge'],
        prompt: `${key('Hold R')} Guard · ${key('Left Alt')} Dodge`,
        done: () => {
          if (combat.blocking) this.hasGuarded = true;
          if (combat.current === 'dodge') this.hasDodged = true;
          if (this.hasGuarded !== this.hasDodged) {
            this.showStepPrompt('Defense', this.hasGuarded
              ? `Guard completed · ${key('Left Alt')} Dodge`
              : `Dodge completed · ${key('Hold R')} Guard`);
          }
          return this.hasGuarded && this.hasDodged;
        },
      },
    ];
  }

  get step(): IntroStep {
    return this.currentStep;
  }

  get isRunning(): boolean {
    return this.currentStep !== 'idle' && this.currentStep !== 'completed';
  }

  /**
   * The arrival: the hero falls into the ground ahead of the master's post and lies where they land. Nothing
   * answers the keys yet. Once they are down the master walks in, offers an arm with his first line, and the
   * hero gets up; his lesson then opens the controls one at a time.
   */
  start(): void {
    this.startPosition.copy(this.opts.controller.position);
    const forward = new Vector3(Math.sin(this.opts.controller.facing), 0, Math.cos(this.opts.controller.facing));
    const right = new Vector3(-forward.z, 0, forward.x);
    // Ahead and off to one side: straight ahead, the hero's own body hides him from the camera behind.
    this.masterPosition.copy(this.startPosition).addScaledVector(forward, 2.6).addScaledVector(right, 1.4);
    this.lockControls();
    this.masterReady = this.opts.scene
      ? this.loadMaster(forward).catch(error => {
        if (!this.disposed) console.error('Nation Master failed to load:', error);
      })
      : Promise.resolve();
    this.setStep('arriving');
    this.opts.arrival.drop();
  }

  /** Down on the ground: the hero gathers themself and rises; the master sets off up the road as they do. */
  private arrived(): void {
    this.setStep('down');
    this.schedule(() => {
      this.opts.arrival.standUp();
      this.walkIn();
    }, RISE_AFTER_LANDING_MS);
  }

  /** The master walks in from up the road; the greeting waits for him to arrive and the hero to be up. */
  private walkIn(): void {
    void this.masterReady.then(() => {
      if (this.disposed) return;
      if (!this.masterModel) { this.greetWhenStanding(); return; }
      this.masterModel.visible = true;
      this.masterApproaching = true;
    });
  }

  /** He has arrived: the greeting starts as soon as the hero is on their feet. */
  private greetWhenStanding(): void {
    if (this.opts.arrival.standing()) this.greet();
    else this.schedule(() => this.greetWhenStanding(), 150);
  }

  /** The master's greeting, then the lore; the lesson follows. */
  private greet(): void {
    this.setStep('approach');
    this.playMasterPose('talk', 'idle');
    this.showDialogue(this.config.dialogue.greeting, () => {
      this.setStep('greeting');
      this.showDialogue(this.config.dialogue.loreTeaser, () => this.startTraining(), 6000);
    }, 3500);
  }

  /** Only the menu answers until the master teaches something. */
  private lockControls(): void {
    this.opts.restrictControls(this.taught);
  }

  /** Every control answers again: the lesson is over, or the intro has gone. */
  private unlockControls(): void {
    this.opts.restrictControls(null);
  }

  /**
   * The master walks up to the hero with the weapon and holds it out while he speaks; the hero reaches for it
   * and it goes to their back. Resolves once it is theirs.
   */
  private async handOverWeapon(): Promise<void> {
    const model = this.masterModel;
    const prop = this.masterProp;
    if (!model || !prop) { this.opts.receiveWeapon(); return; }
    // He comes to stand in front of the hero, where the player's camera sees the weapon pass; from behind he walks
    // round the hero's side rather than through them.
    const hero = this.opts.controller.position;
    const facing = this.opts.controller.facing;
    const ahead = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    const side = new Vector3(-ahead.z, 0, ahead.x);
    const from = new Vector3().subVectors(model.position, hero).setY(0);
    if (from.dot(ahead) < 0.5) {
      this.masterPosition.copy(hero).addScaledVector(side, from.dot(side) >= 0 ? 1.6 : -1.6).addScaledVector(ahead, 0.8);
      this.masterApproaching = true;
      await new Promise<void>(arrived => { this.onMasterArrived = arrived; });
      if (this.disposed) return;
    }
    this.masterPosition.copy(hero).addScaledVector(ahead, 1.3);
    this.masterApproaching = true;
    await new Promise<void>(arrived => { this.onMasterArrived = arrived; });
    if (this.disposed) return;
    // He holds it out hilt first; the hero reaches and takes it, sheath and all, then slings it on their back. The
    // camera takes the side-on two-shot for the moment the weapon passes, then eases back behind the hero.
    this.cameraMode = 'cinematic';
    this.handing = true;
    this.propPresented = true;
    this.playMasterPose('point', 'gesture', 'talk');
    await new Promise<void>(resolve => this.schedule(resolve, 1100));
    if (this.disposed) return;
    this.opts.heroReach();
    await new Promise<void>(resolve => this.schedule(resolve, 450));
    if (this.disposed) return;
    this.propPalm = this.opts.heroPalm();
    this.playMasterPose('talk', 'idle');
    await new Promise<void>(resolve => this.schedule(resolve, 900));
    if (this.disposed) return;
    prop.removeFromParent();
    this.masterProp = null;
    this.propPalm = null;
    this.opts.receiveWeapon();
    this.handing = false;
    this.beginCameraBlend();
  }

  /**
   * The weapon follows the palm holding it, after this frame's animation: carried point down at the master's side,
   * or held out hilt first. The holding hand's fingers close round the grip, which the walking and talking clips,
   * made for empty hands, leave open.
   */
  private holdProp(): void {
    const prop = this.masterProp, palm = this.propPalm;
    if (!prop || !palm) return;
    snapToSocket(prop, palm);
    if (!this.propPresented) {
      prop.matrix.multiply(POINT_DOWN);
      prop.matrix.decompose(prop.position, prop.quaternion, prop.scale);
      prop.updateMatrixWorld(true);
    }
    const hand = palm.parent;
    if (!hand) return;
    for (const finger of ['index', 'middle', 'ring', 'pinky']) {
      for (const joint of ['01', '02', '03']) {
        const bone = hand.getObjectByName(`${finger}_${joint}_r`);
        if (bone) bone.rotation.z = FINGER_CURL;
      }
    }
  }

  private async loadMaster(forward: Vector3): Promise<void> {
    const { model, clips, anim } = await buildMasterBody(this.opts.loaders, this.config.nation);
    if (this.disposed) { releaseMaster(model); return; }
    // He waits out of sight until the hero is down, then walks in from up the road.
    model.position.copy(this.masterPosition).addScaledVector(forward, MASTER_WAITS_AT);
    model.rotation.y = Math.atan2(this.masterPosition.x - model.position.x, this.masterPosition.z - model.position.z);
    model.visible = this.currentStep !== 'arriving';
    this.masterModel = model;
    this.opts.scene.add(model);
    // He carries the starter weapon sheathed in his right hand until he hands it over. Blade and sheath are joined
    // at the grip, the way the hero's back carry joins them.
    try {
      const { weapon } = this.opts;
      const [blade, sheath] = await Promise.all([
        this.opts.loaders.model(weapon.assetPath),
        weapon.carry ? this.opts.loaders.model(weapon.carry.assetPath) : Promise.resolve(null),
      ]);
      if (this.disposed) return;
      const prop = new Group();
      prop.name = 'MasterWeapon';
      prop.add(gripAligned(blade.scene.clone(true)));
      if (sheath) prop.add(gripAligned(sheath.scene.clone(true)));
      prop.traverse(node => { const mesh = node as Mesh; if (mesh.isMesh) mesh.castShadow = true; });
      this.masterProp = prop;
      this.propPalm = palmSocket(model);
    } catch (error) {
      console.error('The master\'s weapon failed to load:', error);
    }
    this.masterClipNames = clips.map(c => c.name);
    this.masterAnim = anim;
    this.masterPose = '';
    this.playMasterPose('walk_sage', 'walk');
  }

  private schedule(callback: () => void, delayMs: number): void {
    let timer: ReturnType<typeof setTimeout>;
    timer = setTimeout(() => {
      this.pendingTimers = this.pendingTimers.filter(pending => pending !== timer);
      if (!this.disposed) callback();
    }, delayMs);
    this.pendingTimers.push(timer);
  }

  private playMasterPose(...preferred: string[]): void {
    if (!this.masterAnim) return;
    for (const want of preferred) {
      const match = this.masterClipNames.find(name => name.toLowerCase().includes(want.toLowerCase()));
      if (match) {
        if (this.masterPose === match) return;
        this.masterAnim.play(match, 0.25);
        this.masterPose = match;
        return;
      }
    }
  }

  private setStep(step: IntroStep): void {
    this.currentStep = step;
  }

  private showDialogue(text: string, onDone?: () => void, timeoutMs = 4000): void {
    this.dialogueBox.style.display = 'block';
    this.dialogueLine.textContent = text;
    if (!this.masterApproaching && !this.masterDispatched) this.playMasterPose('talk', 'gesture', 'idle');
    const shown = performance.now();
    this.lineHeard = new Promise<void>(heard => {
      void this.speakLine(text).then(seconds => {
        // The next beat waits for the line to be heard out, and never comes sooner than its reading time.
        if (!this.disposed) this.schedule(heard, Math.max(timeoutMs, seconds * 1000 + 500) - (performance.now() - shown));
      });
    });
    if (onDone) void this.lineHeard.then(onDone);
  }

  /**
   * The master says the line in their recorded voice: their dialogue group and the sex their body was built as.
   * Until the body has loaded there is no voice to pick; the line waits for it and is spoken if still showing.
   * Resolves with the recording's length in seconds, 0 when nothing was spoken.
   */
  private async speakLine(text: string): Promise<number> {
    await this.masterReady;
    const sex = this.masterModel?.userData.sex as 'male' | 'female' | undefined;
    if (this.disposed || !this.masterModel || !sex || this.dialogueLine.textContent !== text) return 0;
    const at = this.masterModel.position;
    let seconds = 0;
    await this.opts.sound.speak(voiceId(this.config.master.id, sex), text, { x: at.x, y: at.y + 1.7, z: at.z }, {
      channel: this.config.master.id,
      admit: (length) => { seconds = length; return true; },
    });
    return seconds;
  }


  /**
   * Directs the cinematic camera and smoothly blends into shoulderCamera when training begins.
   * Returns true while overriding camera position/orientation.
   */
  applyCamera(camera: PerspectiveCamera, delta: number, reducedMotion = false): boolean {
    if (this.cameraMode === 'released' || this.currentStep === 'idle' || this.currentStep === 'completed') {
      return false;
    }

    const heroPos = this.opts.controller.position;

    // The arrival: low behind the landing spot and a little to its right, following the hero down out of the open
    // sky, with the road the master walks in on beyond them.
    if (this.cameraMode === 'cinematic' && (this.currentStep === 'arriving' || this.currentStep === 'down')) {
      const fx = Math.sin(this.opts.controller.facing), fz = Math.cos(this.opts.controller.facing);
      const ground = this.startPosition;
      this.cinematicPos.set(ground.x - fx * 4.5 - fz * 1.6, ground.y + 1.4, ground.z - fz * 4.5 + fx * 1.6);
      this.cinematicLookAt.set(heroPos.x + fx * 1.5, heroPos.y + 0.9, heroPos.z + fz * 1.5);
      camera.position.copy(this.cinematicPos);
      camera.lookAt(this.cinematicLookAt);
      return true;
    }

    if (this.cameraMode === 'cinematic') {
      const midX = (heroPos.x + this.masterPosition.x) / 2;
      const midY = (heroPos.y + this.masterPosition.y) / 2 + 1.25;
      const midZ = (heroPos.z + this.masterPosition.z) / 2;
      this.cinematicLookAt.set(midX, midY, midZ);

      // Two-shot from the side of the line between them, a little behind the hero: neither can stand in front of the other.
      const ax = this.masterPosition.x - heroPos.x, az = this.masterPosition.z - heroPos.z;
      const len = Math.hypot(ax, az) || 1;
      const ux = ax / len, uz = az / len;
      // The master stands off to one side of the hero's path; the camera takes the other side of the line.
      const fx = Math.sin(this.opts.controller.facing), fz = Math.cos(this.opts.controller.facing);
      const side = -fz * ax + fx * az >= 0 ? 1 : -1;
      this.cinematicPos.set(midX - ux * 1.6 + side * uz * 3.4, heroPos.y + 1.5, midZ - uz * 1.6 - side * ux * 3.4);
      camera.position.copy(this.cinematicPos);
      camera.lookAt(this.cinematicLookAt);

      this.blendStartPos.copy(camera.position);
      this.blendStartQuat.copy(camera.quaternion);
      return true;
    }

    if (this.cameraMode === 'blending') {
      this.tempTargetPos.copy(camera.position);
      this.tempTargetQuat.copy(camera.quaternion);

      const speed = reducedMotion ? 16.0 : (1.0 / this.blendDuration);
      this.blendProgress += delta * speed;
      const t = Math.min(1.0, this.blendProgress);
      // Smoothstep easing (Hermite interpolation)
      const eased = t * t * (3 - 2 * t);

      camera.position.lerpVectors(this.blendStartPos, this.tempTargetPos, eased);
      camera.quaternion.copy(this.blendStartQuat).slerp(this.tempTargetQuat, eased);

      if (t >= 1.0) {
        this.cameraMode = 'released';
        return false;
      }
      return true;
    }

    return false;
  }

  beginCameraBlend(): void {
    if (this.cameraMode === 'cinematic') {
      this.cameraMode = 'blending';
      this.blendProgress = 0;
    }
  }

  private startTraining(): void {
    // The lesson starts with the hero on their feet.
    if (!this.opts.arrival.standing()) { this.schedule(() => this.startTraining(), 200); return; }
    this.beginCameraBlend();
    this.beginStep(0);
  }

  /** The master gives the instruction; its controls answer, and its card shows, once anything it begins is done. */
  private beginStep(index: number): void {
    const step = this.training[index];
    if (!step) return;
    this.trainingIndex = index;
    this.setStep(step.step);
    this.playMasterPose('fold_arms', 'idle');
    this.showDialogue(this.config.dialogue[step.line]);
    void Promise.resolve(step.begin?.()).then(() => {
      if (this.disposed || this.trainingIndex !== index) return;
      for (const action of step.teaches) this.taught.add(action);
      if (index === 0) this.startPosition.copy(this.opts.controller.position);
      this.showStepPrompt(step.kicker, step.prompt);
    });
  }

  /**
   * The step just done is acknowledged before anything else is asked: checks stop and the card goes, the master
   * finishes the line he was saying, nods through his acknowledgement, and the next step starts once it is heard out.
   */
  private stepHeard(): void {
    const index = this.trainingIndex;
    this.setStep('heard');
    this.hideStepPrompt();
    void this.lineHeard.then(() => {
      if (this.disposed) return;
      this.showDialogue(this.config.stepHeard[index] ?? '', () => {
        if (index + 1 < this.training.length) this.beginStep(index + 1);
        else this.finishTraining();
      }, 1800);
      this.nodMaster();
    });
  }

  /** The master nods once (holding its last frame); without a nod clip he keeps talking. */
  private nodMaster(): void {
    const nod = this.masterClipNames.find(name => name.toLowerCase() === 'nod');
    if (!this.masterAnim || !nod) return;
    this.masterAnim.play(nod, 0.2, false);
    this.masterPose = nod;
  }

  private finishTraining(): void {
    this.unlockControls();
    this.setStep('lore_and_mission');
    this.hideStepPrompt();
    const roleLine = this.opts.isDim() ? this.config.dialogue.hushRole : this.config.dialogue.shaperRole;
    this.showDialogue(roleLine, () => {
      this.schedule(() => {
        this.dispatchFirstMission();
      }, 1000);
    }, 4500);
  }

  private showStepPrompt(kicker: string, promptHtml: string): void {
    this.stepCard.style.display = 'block';
    this.stepKicker.textContent = kicker;
    this.stepPrompt.innerHTML = promptHtml;
  }

  private hideStepPrompt(): void {
    this.stepCard.style.display = 'none';
  }

  update(delta: number): void {
    if (this.currentStep === 'idle' || this.currentStep === 'completed') return;

    const heroPos = this.opts.controller.position;
    this.masterAnim?.update(delta);
    this.holdProp();
    if (this.masterModel) {
      if (this.masterApproaching) {
        const distance = this.masterModel.position.distanceTo(this.masterPosition);
        if (distance > 0.15) {
          // A slow, measured walk: the stride clip is slowed to the same pace, so the feet keep the ground.
          const step = Math.min(distance, delta * MASTER_WALK_SPEED);
          this.masterModel.position.lerp(this.masterPosition, step / distance);
          this.masterModel.rotation.y = Math.atan2(this.masterPosition.x - this.masterModel.position.x, this.masterPosition.z - this.masterModel.position.z);
          this.playMasterPose('walk_sage', 'walk');
          this.masterAnim?.setSpeed(this.masterPose, MASTER_WALK_SPEED / WALK_SPEED);
        } else {
          this.masterApproaching = false;
          this.playMasterPose('talk', 'idle');
          const arrived = this.onMasterArrived;
          this.onMasterArrived = null;
          arrived?.();
          if (this.currentStep === 'down') this.greetWhenStanding();
        }
      } else {
        this.masterModel.rotation.y = Math.atan2(heroPos.x - this.masterModel.position.x, heroPos.z - this.masterModel.position.z);
        if (this.handing || this.currentStep === 'approach') { /* holding the weapon or an arm out */ }
        else if (this.masterDispatched) this.playMasterPose('point', 'gesture', 'talk', 'idle');
        else if (this.currentStep === 'heard') { /* the acknowledgement's nod plays out */ }
        else if (this.currentStep.startsWith('step_')) this.playMasterPose('fold_arms', 'idle');
        else if (this.dialogueBox.style.display !== 'none') this.playMasterPose('talk', 'gesture', 'idle');
      }
    }

    if (this.currentStep === 'arriving' && this.opts.arrival.down()) this.arrived();
    if (this.currentStep.startsWith('step_') && this.training[this.trainingIndex]?.done()) this.stepHeard();

    switch (this.currentStep) {
      case 'active_mission': {
        // Check if player has reached the gateway landmark
        if (this.activeMissionLead) {
          const lead = this.activeMissionLead;
          if (Math.hypot(heroPos.x - lead.target.x, heroPos.z - lead.target.z) <= lead.target.radius) this.completeFirstMission(lead);
        }
        break;
      }
    }
  }

  /** Training was done on an earlier visit: the hero has the weapon and every control, and goes to the gate. */
  resumeAtGate(): void {
    this.unlockControls();
    this.beginCameraBlend();
    this.opts.receiveWeapon();
    this.dispatchFirstMission();
  }

  retryGate(): void {
    if (this.activeMissionLead && this.currentStep !== 'completed') {
      this.setStep('active_mission'); this.completeFirstMission(this.activeMissionLead);
    }
  }

  private dispatchFirstMission(): void {
    this.opts.onTrainingComplete?.();
    this.masterDispatched = true;
    this.playMasterPose('point', 'gesture', 'talk', 'idle');
    this.setStep('active_mission');
    const mission = this.config.firstMission;

    this.showDialogue(
      this.config.dialogue.missionBrief,
      () => {
        this.schedule(() => {
          this.dialogueBox.style.display = 'none';
        }, 3000);
      },
      5000,
    );

    // Register lead in lead manager and set active waypoint
    const missionLead: Lead = {
      id: mission.id,
      title: mission.title,
      description: mission.description,
      cost: 0,
      rewardChroma: 0,
      target: mission.target,
      purchased: true,
      completed: false,
    };

    this.activeMissionLead = missionLead;
    this.opts.leadManager.addLead(missionLead);
    this.opts.leadManager.activeLeadId = missionLead.id;
    this.opts.waypointMarker.setLead(missionLead);

    // Display Quest Notification Banner
    this.showMissionBanner('First Mission Assigned', mission.title, mission.objective);
  }

  private completeFirstMission(lead: Lead): void {
    if (this.currentStep === 'awaiting_gate' || this.currentStep === 'completed') return;
    this.setStep('awaiting_gate');
    this.hideStepPrompt();
    this.dialogueBox.style.display = 'none';
    if (!this.opts.beforeUnlock) return;
    void this.opts.beforeUnlock().then(() => {
      if (this.disposed) return;
      lead.completed = true;
      this.setStep('completed');
      this.opts.waypointMarker.setLead(null);
      this.grantFirstLevel(lead);
    }).catch(() => {
      if (this.disposed) return;
      this.showStepPrompt('Registration required', 'Speak with the registrar to try again.');
      const retry = document.createElement('button');
      retry.className = 'mission-choice';
      retry.textContent = 'Speak with the registrar';
      retry.addEventListener('click', () => { retry.remove(); this.setStep('active_mission'); this.completeFirstMission(lead); });
      this.stepPrompt.appendChild(retry);
    });
  }

  private grantFirstLevel(lead: Lead): void {
    // Transfer user from Level 0 -> Level 1 (unlocks bending for Shapers)
    this.opts.applyTier(1);

    const isDim = this.opts.isDim();
    const unlockKicker = isDim ? 'Rank Attained' : 'Power Awakened';
    const unlockTitle = isDim ? 'Level 1 · Wayfarer' : 'Level 1 · Shaper Awoken';
    const unlockDesc = isDim
      ? 'The roads of the nation are open. Crafting and town trade unlocked.'
      : 'Elemental bending is now available. Press B to channel your element.';

    this.showMissionBanner(unlockKicker, unlockTitle, unlockDesc);

    if (this.opts.onMissionComplete) {
      this.opts.onMissionComplete(lead);
    }

    this.schedule(() => {
      this.dispose();
    }, 5000);
  }

  private showMissionBanner(kicker: string, title: string, desc: string): void {
    if (typeof document === 'undefined') return;
    const banner = document.createElement('div');
    banner.className = 'nation-mission-banner';
    banner.innerHTML = `
      <div class="nation-mission-kicker">${kicker}</div>
      <h2 class="nation-mission-title">${title}</h2>
      <p class="nation-mission-desc">${desc}</p>
    `;
    document.body.appendChild(banner);
    this.schedule(() => {
      banner.remove();
    }, 4500);
    this.cleanupFns.push(() => banner.remove());
  }

  dispose(): void {
    this.disposed = true;
    this.unlockControls();
    this.masterProp?.removeFromParent();
    this.propPalm = null;
    for (const t of this.pendingTimers) clearTimeout(t);
    this.pendingTimers = [];
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    this.masterAnim?.dispose();
    this.masterAnim = null;
    this.masterClipNames = [];
    this.masterPose = '';
    if (this.masterModel) {
      this.opts.scene.remove(this.masterModel);
      releaseMaster(this.masterModel);
      this.masterModel = null;
    }
    if (this.overlay.parentNode) {
      this.overlay.remove();
    }
  }
}

