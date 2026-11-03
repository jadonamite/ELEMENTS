import { Scene, Vector3, type Camera } from 'three';
import type { HeroController } from '../controller.js';
import type { SoundManager } from '../audio.js';
import type { Satchel } from '../world/satchel.js';
import type { WorldClock } from '../world/clock.js';
import { nightness } from '../world/effects.js';
import { TownManager, setTownsfolkBodyFactory, type TownsfolkBodyFactory } from './town-manager.js';
import { ShuttersAndLanterns } from './shutters-lanterns.js';
import { CorpseDropManager } from './corpse-drop.js';
import { WaypointMarker } from '../story/waypoint-marker.js';
import { NpcDialogueUI } from '../story/npc-dialogue-ui.js';
import { LeadManager, type Lead } from '../../../shared/src/story/leads.js';
import { createDialogueMemory, type DialogueMemory, type PlayerDialogueContext } from '../../../shared/src/story/dialogue.js';

export { setTownsfolkBodyFactory, type TownsfolkBodyFactory };

export interface SindrLifeOptions {
  scene: Scene;
  camera: Camera;
  controller: HeroController;
  clock: WorldClock;
  sound: SoundManager;
  satchel: Satchel;
  getPlayerContext: () => PlayerDialogueContext;
  onNotice: (message: string) => void;
}

export class SindrLifeSystem {
  readonly townManager: TownManager;
  readonly shuttersLanterns: ShuttersAndLanterns;
  readonly corpseDrops: CorpseDropManager;
  readonly leadManager: LeadManager;
  readonly waypointMarker: WaypointMarker;
  readonly dialogueUI: NpcDialogueUI;
  readonly dialogueMemory: DialogueMemory;

  private scene: Scene;
  private camera: Camera;
  private controller: HeroController;
  private clock: WorldClock;
  private sound: SoundManager;
  private satchel: Satchel;
  private getPlayerContext: () => PlayerDialogueContext;
  private onNotice: (message: string) => void;

  constructor(options: SindrLifeOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.controller = options.controller;
    this.clock = options.clock;
    this.sound = options.sound;
    this.satchel = options.satchel;
    this.getPlayerContext = options.getPlayerContext;
    this.onNotice = options.onNotice;

    this.townManager = new TownManager(this.scene);
    this.shuttersLanterns = new ShuttersAndLanterns();
    this.scene.add(this.shuttersLanterns.group);

    this.corpseDrops = new CorpseDropManager(this.scene, this.satchel);
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

    void this.townManager.init();
  }

  update(delta: number): void {
    const minute = this.clock.minute;
    const heroPos = this.controller.position;

    // 1. Update townsfolk routines and locomotion
    this.townManager.update(delta, minute, heroPos);

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
    const nearestDrop = this.corpseDrops.getNearestDrop(heroPos, 2.8);
    if (nearestDrop) {
      // Prompt to recover dropped satchel
      this.dialogueUI.updatePrompt(null);
      const promptEl = document.getElementById('npc-prompt');
      if (promptEl) {
        const names = nearestDrop.items.map(i => `${i.count} ${i.name}`).join(', ');
        promptEl.innerHTML = `<kbd>E</kbd> Take Dropped Materials (${names})`;
        promptEl.style.display = 'block';
      }
    } else {
      const nearestNpc = this.townManager.getNearestTownsperson(heroPos, 3.2);
      this.dialogueUI.updatePrompt(nearestNpc);
    }
  }

  onHeroDied(): void {
    const pos = this.controller.position;
    this.corpseDrops.onHeroDeath(pos.x, pos.y, pos.z);
  }

  handleInteract(): boolean {
    const heroPos = this.controller.position;

    // Check if near dropped materials
    const nearestDrop = this.corpseDrops.getNearestDrop(heroPos, 2.8);
    if (nearestDrop) {
      const recovered = this.corpseDrops.takeDrop(nearestDrop);
      if (recovered.length > 0) {
        const summary = recovered.map(i => `${i.count} ${i.name}`).join(', ');
        this.onNotice(`Recovered materials: ${summary}`);
        this.sound.playThump(90, 0.2, 0.5);
        return true;
      }
    }

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
    this.corpseDrops.dispose();
    this.waypointMarker.dispose();
    this.dialogueUI.dispose();
  }
}
