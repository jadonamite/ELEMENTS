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
import type { ContextOffer } from '../ui/context-action.js';

/** How near a townsperson stands to be talked to, metres. */
const TALK_REACH = 3.5;


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
  readonly ready: Promise<void>;
  private disposed = false;

  private scene: Scene;
  private readonly offerAt = new Vector3();
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

    this.ready = loadTownsfolkBodies().then((bodies) => {
      if (!this.disposed) this.townManager.init(bodies);
    }).catch(console.error);
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

  }

  /** Talking to the nearest townsperson is what the context key does, while no talk is open. */
  contextOffer(): ContextOffer | null {
    if (this.dialogueUI.isOpen()) return null;
    const npc = this.townManager.getNearestTownsperson(this.controller.position, TALK_REACH);
    if (!npc) return null;
    const p = npc.position;
    return { verb: `Talk to ${npc.data.name}`, at: this.offerAt.set(p.x, p.y + 2.1, p.z), act: () => this.handleInteract() };
  }

  /** Closes an open talk; false when none is open. */
  closeTalk(): boolean {
    if (!this.dialogueUI.isOpen()) return false;
    this.dialogueUI.close();
    return true;
  }

  handleInteract(): boolean {
    const heroPos = this.controller.position;

    // Check if near NPC
    const nearestNpc = this.townManager.getNearestTownsperson(heroPos, TALK_REACH);
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
    this.disposed = true;
    this.townManager.dispose();
    this.shuttersLanterns.dispose();
    this.waypointMarker.dispose();
    this.dialogueUI.dispose();
  }
}
