import { Group, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { MISSION_COPY } from '../../../shared/src/story/missions.js';
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
import {
  getNationIntroConfig,
  type NationIntroConfig,
  type NationIntroDialogue,
} from '../../../shared/src/story/nation-intro.js';

export type IntroStep =
  | 'idle'
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
  onEquipStarterWeapon: (weapon: 'sword' | 'staff') => void;
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
  /** Runs as the instruction starts. */
  begin?: () => void;
  /** Reads this frame's play; true once the step is done. May update the prompt card on partial progress. */
  done: () => boolean;
}

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
        step: 'step_move', line: 'stepFooting', kicker: 'Footing',
        prompt: `${key('W')} ${key('A')} ${key('S')} ${key('D')} Move · Move mouse to look`,
        done: () => (this.hasMoved ||= controller.position.distanceTo(this.startPosition) >= 2.2),
      },
      {
        step: 'step_sprint_jump', line: 'stepSprintJump', kicker: 'Mobility',
        prompt: `${key('Shift')} Sprint · ${key('Space')} Jump`,
        done: () => {
          if (input.read().running) this.hasSprinted = true;
          if (!controller.grounded) this.hasJumped = true;
          return this.hasSprinted && this.hasJumped;
        },
      },
      {
        step: 'step_weapon', line: 'weaponHandoff', kicker: 'Armament',
        prompt: `${key('1')} Draw Weapon`,
        begin: () => this.opts.onEquipStarterWeapon(this.config.starterWeapon),
        done: () => (this.hasEquippedWeapon ||= combat.fightingStyle === 'weapon'),
      },
      {
        step: 'step_attacks', line: 'stepAttacks', kicker: 'Striking',
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
        step: 'step_defense', line: 'stepDefense', kicker: 'Defense',
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

  start(): void {
    this.startPosition.copy(this.opts.controller.position);
    const forward = new Vector3(Math.sin(this.opts.controller.facing), 0, Math.cos(this.opts.controller.facing));
    const right = new Vector3(-forward.z, 0, forward.x);
    // Ahead and off to one side: straight ahead, the hero's own body hides him from the camera behind.
    this.masterPosition.copy(this.startPosition).addScaledVector(forward, 2.6).addScaledVector(right, 1.4);
    this.masterApproaching = true;
    this.masterReady = this.opts.scene
      ? this.loadMaster(forward).catch(error => {
        if (!this.disposed) console.error('Nation Master failed to load:', error);
      })
      : Promise.resolve();

    // Begin approach
    this.setStep('approach');
    this.showDialogue(
      this.config.dialogue.greeting,
      () => {
        this.schedule(() => {
          this.setStep('greeting');
          this.showDialogue(
            this.config.dialogue.loreTeaser,
            () => {
              this.startTraining();
            },
            6000,
          );
        }, 1200);
      },
      3500,
    );
  }

  private async loadMaster(forward: Vector3): Promise<void> {
    const { model, clips, anim } = await buildMasterBody(this.opts.loaders, this.config.nation);
    if (this.disposed) { releaseMaster(model); return; }
    model.position.copy(this.masterPosition).addScaledVector(forward, 5.5);
    model.rotation.y = Math.atan2(this.masterPosition.x - model.position.x, this.masterPosition.z - model.position.z);
    this.masterModel = model;
    this.opts.scene.add(model);
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
    this.beginCameraBlend();
    this.beginStep(0);
  }

  private beginStep(index: number): void {
    const step = this.training[index];
    if (!step) return;
    this.trainingIndex = index;
    this.setStep(step.step);
    step.begin?.();
    this.playMasterPose('fold_arms', 'idle');
    this.showDialogue(this.config.dialogue[step.line]);
    this.showStepPrompt(step.kicker, step.prompt);
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
    this.setStep('lore_and_mission');
    this.hideStepPrompt();
    const roleLine = this.opts.isDim() ? this.config.dialogue.hushRole : this.config.dialogue.shaperRole;
    this.showDialogue(roleLine, () => {
      this.schedule(() => {
        this.offerHomeChoice();
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
    if (this.masterModel) {
      if (this.masterApproaching) {
        const distance = this.masterModel.position.distanceTo(this.masterPosition);
        if (distance > 0.15) {
          const step = Math.min(distance, delta * WALK_SPEED);
          this.masterModel.position.lerp(this.masterPosition, step / distance);
          this.masterModel.rotation.y = Math.atan2(this.masterPosition.x - this.masterModel.position.x, this.masterPosition.z - this.masterModel.position.z);
          this.playMasterPose('walk_sage', 'walk');
        } else {
          this.masterApproaching = false;
          this.playMasterPose('talk', 'idle');
        }
      } else {
        this.masterModel.rotation.y = Math.atan2(heroPos.x - this.masterModel.position.x, heroPos.z - this.masterModel.position.z);
        if (this.masterDispatched) this.playMasterPose('point', 'gesture', 'talk', 'idle');
        else if (this.currentStep === 'heard') { /* the acknowledgement's nod plays out */ }
        else if (this.currentStep.startsWith('step_')) this.playMasterPose('fold_arms', 'idle');
        else if (this.dialogueBox.style.display !== 'none') this.playMasterPose('talk', 'gesture', 'idle');
      }
    }

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

  private offerHomeChoice(): void {
    this.showDialogue('You have your footing. The town gate is ahead.');
    const choices = document.createElement('div');
    choices.className = 'mission-choices';
    const add = (label: string, run: () => void) => {
      const button = document.createElement('button');
      button.className = 'mission-choice'; button.textContent = label;
      button.addEventListener('click', () => { choices.remove(); run(); });
      choices.appendChild(button);
    };
    add('How can I return home?', () => {
      this.showDialogue(MISSION_COPY.allborn, () => this.dispatchFirstMission(), 6000);
    });
    add('I will find the gate', () => this.dispatchFirstMission());
    this.dialogueBox.appendChild(choices);
    this.cleanupFns.push(() => choices.remove());
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resumeAtGate(): void {
    this.beginCameraBlend();
    this.opts.onEquipStarterWeapon(this.config.starterWeapon);
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

