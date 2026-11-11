import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { HeroController } from '../controller.js';
import type { ShoulderCamera } from '../camera.js';
import type { GameInput } from '../input.js';
import type { Combat } from '../combat.js';
import type { Fight } from '../fight.js';
import type { SoundManager } from '../audio.js';
import type { LeadManager, Lead } from '../../../shared/src/story/leads.js';
import type { WaypointMarker } from './waypoint-marker.js';
import {
  getNationIntroConfig,
  type NationIntroConfig,
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
  | 'lore_and_mission'
  | 'active_mission'
  | 'completed';

export interface NationIntroOptions {
  nation: string;
  isDim: boolean;
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
  onMissionComplete?: (missionLead: Lead) => void;
}

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
  private pendingTimers: any[] = [];

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
  }

  get step(): IntroStep {
    return this.currentStep;
  }

  get isRunning(): boolean {
    return this.currentStep !== 'idle' && this.currentStep !== 'completed';
  }

  start(): void {
    this.startPosition.copy(this.opts.controller.position);
    this.masterPosition.copy(this.startPosition).add(new Vector3(2.5, 0, 0));

    // Begin approach
    this.setStep('approach');
    this.showDialogue(
      this.config.dialogue.greeting,
      this.config.master.voice,
      () => {
        setTimeout(() => {
          this.setStep('greeting');
          this.showDialogue(
            this.config.dialogue.loreTeaser,
            this.config.master.voice,
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

  private setStep(step: IntroStep): void {
    this.currentStep = step;
  }

  private showDialogue(text: string, voice?: string, onDone?: () => void, timeoutMs = 4000): void {
    this.dialogueBox.style.display = 'block';
    this.dialogueLine.textContent = text;

    if (voice) {
      void this.opts.sound.speak(voice, text, {
        x: this.masterPosition.x,
        y: this.masterPosition.y + 1.7,
        z: this.masterPosition.z,
      });
    }

    if (onDone) {
      const timer = setTimeout(() => {
        onDone();
      }, timeoutMs);
      this.pendingTimers.push(timer);
    }
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

      // Low three-quarter cinematic two-shot angle
      this.cinematicPos.set(heroPos.x - 2.8, heroPos.y + 1.25, heroPos.z - 2.0);
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
    this.setStep('step_move');
    this.showDialogue(this.config.dialogue.stepFooting, this.config.master.voice);
    this.showStepPrompt(
      'Footing',
      '<span class="nation-intro-key">W</span> <span class="nation-intro-key">A</span> <span class="nation-intro-key">S</span> <span class="nation-intro-key">D</span> Move · Move mouse to look',
    );
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

    // Interactive step validations
    switch (this.currentStep) {
      case 'step_move': {
        const movedDist = heroPos.distanceTo(this.startPosition);
        if (movedDist >= 2.2) {
          this.hasMoved = true;
          this.setStep('step_sprint_jump');
          this.showDialogue(this.config.dialogue.stepSprintJump, this.config.master.voice);
          this.showStepPrompt(
            'Mobility',
            '<span class="nation-intro-key">Shift</span> Sprint · <span class="nation-intro-key">Space</span> Jump',
          );
        }
        break;
      }

      case 'step_sprint_jump': {
        if (this.opts.input.read().running) this.hasSprinted = true;
        if (!this.opts.controller.grounded) this.hasJumped = true;

        if (this.hasSprinted && this.hasJumped) {
          this.setStep('step_weapon');
          this.opts.onEquipStarterWeapon(this.config.starterWeapon);
          this.showDialogue(this.config.dialogue.weaponHandoff, this.config.master.voice);
          this.showStepPrompt('Armament', '<span class="nation-intro-key">1</span> Draw Weapon');
        }
        break;
      }

      case 'step_weapon': {
        if (this.opts.combat.fightingStyle === 'weapon' || this.opts.fight.heroAlive) {
          this.hasEquippedWeapon = true;
          this.setStep('step_attacks');
          this.showDialogue(this.config.dialogue.stepAttacks, this.config.master.voice);
          this.showStepPrompt(
            'Striking',
            '<span class="nation-intro-key">Left Click</span> Light Attack · <span class="nation-intro-key">Right Click</span> Heavy Attack',
          );
        }
        break;
      }

      case 'step_attacks': {
        const cur = this.opts.combat.current;
        if (cur && (cur.includes('light') || cur.includes('strike'))) this.hasLightAttacked = true;
        if (cur && cur.includes('heavy')) this.hasHeavyAttacked = true;

        if (this.hasLightAttacked && this.hasHeavyAttacked) {
          this.setStep('step_defense');
          this.showDialogue(this.config.dialogue.stepDefense, this.config.master.voice);
          this.showStepPrompt(
            'Defense',
            '<span class="nation-intro-key">Hold R</span> Guard · <span class="nation-intro-key">Left Alt</span> Dodge',
          );
        }
        break;
      }

      case 'step_defense': {
        if (this.opts.combat.blocking) this.hasGuarded = true;
        if (this.opts.combat.current === 'dodge') this.hasDodged = true;

        if (this.hasGuarded && this.hasDodged) {
          this.setStep('lore_and_mission');
          this.hideStepPrompt();

          const roleLine = this.opts.isDim
            ? this.config.dialogue.hushRole
            : this.config.dialogue.shaperRole;

          this.showDialogue(roleLine, this.config.master.voice, () => {
            setTimeout(() => {
              this.dispatchFirstMission();
            }, 1000);
          }, 4500);
        }
        break;
      }

      case 'active_mission': {
        // Check if player has reached the gateway landmark
        if (this.activeMissionLead) {
          const reached = this.opts.leadManager.checkTargetReached(heroPos.x, heroPos.z);
          if (reached && reached.id === this.activeMissionLead.id) {
            this.completeFirstMission(reached);
          }
        }
        break;
      }
    }
  }

  private dispatchFirstMission(): void {
    this.setStep('active_mission');
    const mission = this.config.firstMission;

    this.showDialogue(
      this.config.dialogue.missionBrief,
      this.config.master.voice,
      () => {
        setTimeout(() => {
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
      rewardChroma: mission.rewardChroma,
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
    this.setStep('completed');
    this.opts.waypointMarker.setLead(null);

    // Transfer user from Level 0 -> Level 1 (unlocks bending for Shapers)
    this.opts.applyTier(1);

    const unlockKicker = this.opts.isDim ? 'Rank Attained' : 'Power Awakened';
    const unlockTitle = this.opts.isDim ? 'Level 1 · Wayfarer' : 'Level 1 · Shaper Awoken';
    const unlockDesc = this.opts.isDim
      ? 'The roads of the nation are open. Crafting and town trade unlocked.'
      : 'Elemental bending is now available. Press B to channel your element.';

    this.showMissionBanner(unlockKicker, unlockTitle, unlockDesc);

    if (this.opts.onMissionComplete) {
      this.opts.onMissionComplete(lead);
    }

    const timer = setTimeout(() => {
      this.dispose();
    }, 5000);
    this.pendingTimers.push(timer);
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
    const timer = setTimeout(() => {
      banner.remove();
    }, 4500);
    this.pendingTimers.push(timer);
  }

  dispose(): void {
    for (const t of this.pendingTimers) clearTimeout(t);
    this.pendingTimers = [];
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    if (this.overlay.parentNode) {
      this.overlay.remove();
    }
  }
}
