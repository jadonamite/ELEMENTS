import { Scene, Vector3, type Camera } from 'three';
import type { HeroController } from '../controller.js';
import type { CombatSpace } from '../attacks/space.js';
import type { SoundManager } from '../audio.js';
import type { WorldClock } from '../world/clock.js';
import { nightness } from '../world/effects.js';
import { TownManager } from './town-manager.js';
import { loadTownsfolkBodies } from './townsfolk-bodies.js';
import { ShuttersAndLanterns } from './shutters-lanterns.js';
import { WaypointMarker } from '../story/waypoint-marker.js';
import { NpcDialogueUI } from '../story/npc-dialogue-ui.js';
import { LeadManager, type Lead } from '../../../shared/src/story/leads.js';
import { createDialogueMemory, type DialogueMemory, type PlayerDialogueContext } from '../../../shared/src/story/dialogue.js';


export interface SindrLifeOptions {
  scene: Scene;
  camera: Camera;
  controller: HeroController;
  clock: WorldClock;
  sound: SoundManager;
  getPlayerContext: () => PlayerDialogueContext;
  onNotice: (message: string) => void;
  /** Where fighting is happening now; townsfolk run from it. */
  getThreats: () => readonly Vector3[];
  /** The world's solid shapes, so people running from a fight don't run through walls. */
  space?: CombatSpace | null;
}

export class SindrLifeSystem {
  readonly townManager: TownManager;
  readonly shuttersLanterns: ShuttersAndLanterns;
  readonly leadManager: LeadManager;
  readonly waypointMarker: WaypointMarker;
  readonly dialogueUI: NpcDialogueUI;
  readonly dialogueMemory: DialogueMemory;

  private scene: Scene;
  private camera: Camera;
  private controller: HeroController;
  private clock: WorldClock;
  private sound: SoundManager;
  private getPlayerContext: () => PlayerDialogueContext;
  private onNotice: (message: string) => void;
  private getThreats: () => readonly Vector3[];

  constructor(options: SindrLifeOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.controller = options.controller;
    this.clock = options.clock;
    this.sound = options.sound;
    this.getPlayerContext = options.getPlayerContext;
    this.onNotice = options.onNotice;
    this.getThreats = options.getThreats;

    this.townManager = new TownManager(this.scene, options.space ?? null);
    this.shuttersLanterns = new ShuttersAndLanterns();
    this.scene.add(this.shuttersLanterns.group);

    this.leadManager = new LeadManager();
    this.waypointMarker = new WaypointMarker(this.scene);
    this.dialogueMemory = createDialogueMemory();

    this.dialogueUI = new NpcDialogueUI(
      this.dialogueMemory,
      this.sound,
      this.leadManager,
      (lead: Lead) => {
        this.waypointMarker.setLead(lead);
        this.onNotice(`New Lead: ${lead.title} marked on compass`);
      },
    );

    loadTownsfolkBodies().then((bodies) => this.townManager.init(bodies)).catch(console.error);
  }

  update(delta: number): void {
    const minute = this.clock.minute;
    const heroPos = this.controller.position;

    // 1. Update townsfolk routines and locomotion
    this.townManager.update(delta, minute, heroPos, this.getThreats());

    // 2. Update dusk & night world changes (shutters, lanterns, robbers)
    this.shuttersLanterns.update(minute, nightness.value);

    // 3. Update active waypoint marker & check lead completion
    this.waypointMarker.update(delta, this.camera, heroPos);
    const completedLead = this.leadManager.checkTargetReached(heroPos.x, heroPos.z);
    if (completedLead) {
      this.waypointMarker.setLead(null);
      this.onNotice(`Lead Completed: ${completedLead.title} (+${completedLead.rewardChroma} CHROMA)`);
    }

    // 4. Update interaction prompt
    const nearestNpc = this.townManager.getNearestTownsperson(heroPos, 3.2);
    this.dialogueUI.updatePrompt(nearestNpc);
  }

  handleInteract(): boolean {
    const heroPos = this.controller.position;

    // Check if near NPC
    const nearestNpc = this.townManager.getNearestTownsperson(heroPos, 3.5);
    if (nearestNpc) {
      const playerCtx = this.getPlayerContext();
      this.dialogueUI.interact(playerCtx, nearestNpc);
      return true;
    }

    if (this.dialogueUI.isOpen()) {
      this.dialogueUI.close();
      return true;
    }

    return false;
  }

  dispose(): void {
    this.townManager.dispose();
    this.shuttersLanterns.dispose();
    this.waypointMarker.dispose();
    this.dialogueUI.dispose();
  }
}
