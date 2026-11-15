import { Scene, Vector3, type Camera, type Object3D } from 'three';
import type { HeroController } from '../controller.js';
import type { CombatSpace } from '../attacks/space.js';
import type { SoundManager } from '../audio.js';
import type { WorldClock } from '../world/clock.js';
import { SINDR_STREETS, SINDR_WALK, TownManager, type LiveTownsperson } from './town-manager.js';
import { loadLookBodies, ownLooks } from './townsfolk-bodies.js';
import { drawnCrowd, drawnInTown, makeCrowd, staffPosts, type PlayerPerson } from './crowd.js';
import type { Browse, Post } from '../world/builder.js';
import { SINDR_TOWNSFOLK } from './townsfolk.js';
import { WaypointMarker } from '../story/waypoint-marker.js';
import { NpcDialogueUI, type MindDesk } from '../story/npc-dialogue-ui.js';
import { LeadManager, type Lead } from '../../../shared/src/story/leads.js';
import { createDialogueMemory, dialogueRules, type DialogueMemory, type PlayerDialogueContext } from '../../../shared/src/story/dialogue.js';
import dialogueData from '../../../shared/dialogue.json';
import { TownVoices } from './town-voices.js';
import type { ContextOffer } from '../ui/context-action.js';
import balance from '../../../shared/balance.json';

const TALK = balance.speech.talk;
const { traffic: TRAFFIC, hearRadius: HEAR_RADIUS } = balance.speech;
/** People wandering the streets beside the named townsfolk and the keepers of posts, and how many looks they share. */
const CROWD_PEOPLE = 110;
const CROWD_LOOKS = 30;


/** An open conversation as the input sees it. */
export interface Conversation {
  active(): boolean;
  /** Runs reply `index` (0-based); false when there is none. */
  choose(index: number): boolean;
  step(direction: number): void;
  confirm(): boolean;
}

export interface SindrLifeOptions {
  scene: Scene;
  camera: Camera;
  controller: HeroController;
  clock: WorldClock;
  sound: SoundManager;
  getPlayerContext: () => PlayerDialogueContext;
  onNotice: (message: string) => void;
  /** The sheet person the player is; the town draws nobody as their double. */
  playerPerson?: PlayerPerson | undefined;
  /** Where fighting is happening now; townsfolk run from it. */
  getThreats: () => readonly Vector3[];
  /** The world's solid shapes, so people running from a fight don't run through walls. */
  space?: CombatSpace | null;
  /** Where people belong, as the town was built; each gets someone. */
  posts?: readonly Post[];
  warm?: (model: Object3D) => Promise<void>;
  /** Where passers-by stop to look at goods, as the town was built. */
  browse?: readonly Browse[];
  /** Shows a line someone in the street said, under their name, for `seconds`. */
  subtitle: (name: string, line: string, seconds: number) => void;
  /** The server's minds, when the game is online: people answer in their own words. */
  mind?: MindDesk | undefined;
}

export class SindrLifeSystem {
  readonly townManager: TownManager;
  readonly leadManager: LeadManager;
  readonly waypointMarker: WaypointMarker;
  readonly dialogueUI: NpcDialogueUI;
  readonly dialogueMemory: DialogueMemory;
  readonly voices: TownVoices;
  readonly ready: Promise<void>;
  private disposed = false;

  private scene: Scene;
  private readonly offerAt = new Vector3();
  private readonly facing = new Vector3();
  private camera: Camera;
  private controller: HeroController;
  private clock: WorldClock;
  private sound: SoundManager;
  private getPlayerContext: () => PlayerDialogueContext;
  private onNotice: (message: string) => void;
  private getThreats: () => readonly Vector3[];
  /** Where fights were first seen this frame, by whom. */
  private readonly alarms: Array<{ person: LiveTownsperson; at: Vector3 }> = [];

  constructor(options: SindrLifeOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.controller = options.controller;
    this.clock = options.clock;
    this.sound = options.sound;
    this.getPlayerContext = options.getPlayerContext;
    this.onNotice = options.onNotice;
    this.getThreats = options.getThreats;

    this.townManager = new TownManager(this.scene, options.space ?? null, Math.random, new URLSearchParams(window.location.search).get('fxQuality') === 'low');

    this.leadManager = new LeadManager();
    this.waypointMarker = new WaypointMarker(this.scene);
    this.dialogueMemory = createDialogueMemory();
    this.voices = new TownVoices({
      sound: this.sound,
      rules: dialogueRules(dialogueData),
      memory: this.dialogueMemory.speech,
      limits: TRAFFIC,
      hearRadius: HEAR_RADIUS,
      now: () => performance.now() / 1000,
      hero: () => this.controller.position,
      subtitle: options.subtitle,
    });
    this.townManager.onAlarm = (person, at) => this.alarms.push({ person, at });

    this.dialogueUI = new NpcDialogueUI(
      this.dialogueMemory,
      this.sound,
      this.voices,
      this.leadManager,
      () => this.clock.phase,
      (lead: Lead) => {
        this.waypointMarker.setLead(lead);
        this.onNotice(`New Lead: ${lead.title} marked on compass`);
      },
      options.mind,
    );

    // The named townsfolk, then a crowd wearing its own looks, copied round the streets.
    // Only sheet people are drawn (drawnInTown); the rest wait for their sheets.
    const crowd = drawnCrowd(makeCrowd(CROWD_PEOPLE, CROWD_LOOKS, undefined, options.playerPerson));
    const named = ownLooks(SINDR_TOWNSFOLK, options.playerPerson).filter(drawnInTown);
    const cast = SINDR_TOWNSFOLK.filter(p => p.look || named.some(l => l.id === p.id));
    const keepers = staffPosts(options.posts ?? [], crowd, cast);
    const people = [...cast, ...keepers, ...crowd.people];
    const looks = [...named, ...crowd.looks];
    const children = new Set(people.filter(p => p.role === 'child').map(p => p.look ?? p.id));
    this.ready = loadLookBodies(looks, children, undefined, options.warm).then(async (bodies) => {
      if (!this.disposed) await this.townManager.init(bodies, people, SINDR_STREETS, SINDR_WALK, options.browse ?? [], options.posts ?? []);
    }).catch(console.error);
  }

  update(delta: number): void {
    const minute = this.clock.minute;
    const heroPos = this.controller.position;

    // 1. Update townsfolk routines and locomotion
    this.townManager.update(delta, minute, heroPos, this.getThreats(), this.camera);
    this.speakAlarms();

    // 2. Update active waypoint marker & check lead completion
    this.waypointMarker.update(delta, this.camera, heroPos);
    const completedLead = this.leadManager.checkTargetReached(heroPos.x, heroPos.z);
    if (completedLead) {
      this.waypointMarker.setLead(null);
      this.onNotice(`Lead Completed: ${completedLead.title} (+${completedLead.rewardChroma} CHROMA)`);
    }

    // Walking away, or a fight coming close, ends the conversation.
    const partner = this.dialogueUI.partner;
    if (partner && (this.fightNear() ||
      Math.hypot(partner.position.x - heroPos.x, partner.position.z - heroPos.z) > TALK.leaveDistance)) {
      this.dialogueUI.close();
    }
  }

  /** Something happened at `at` that townsfolk nearby may call out (red_flag_raised, loot_dropped, theft_seen, ...). */
  witness(concept: string, at: Vector3): void {
    this.voices.witness(concept, at, this.townManager.townsfolk);
  }

  /** A fight newly seen this frame: someone near it calls it out, and one of those running shouts as they go. */
  private speakAlarms(): void {
    if (this.alarms.length === 0) return;
    const at = this.alarms[0]!.at;
    this.voices.witness('fight_started', at, this.townManager.townsfolk);
    this.voices.witness('flee', at, this.alarms.map(a => a.person));
    this.alarms.length = 0;
  }

  /** The townsperson the player faces within reach, offered on the context key; none during a fight. */
  contextOffer(): ContextOffer | null {
    if (this.dialogueUI.isOpen() || this.fightNear()) return null;
    const npc = this.talkTarget();
    if (!npc) return null;
    const p = npc.position;
    return { verb: `Talk to ${npc.data.name}`, at: this.offerAt.set(p.x, p.y + 2.1, p.z), act: () => this.talkTo(npc) };
  }

  /** While a conversation is open, the context key, number keys, wheel and left button answer it. */
  get conversation(): Conversation {
    const ui = this.dialogueUI;
    return {
      active: () => ui.isOpen(),
      choose: index => ui.choose(index),
      step: direction => ui.step(direction),
      confirm: () => ui.confirm(),
    };
  }

  private talkTarget() {
    this.camera.getWorldDirection(this.facing);
    return this.townManager.getTalkTarget(this.controller.position, this.facing.x, this.facing.z,
      TALK.reach, TALK.minFacingDot, TALK.besideReach);
  }

  private fightNear(): boolean {
    const hero = this.controller.position;
    const limit = TALK.noTalkNearFoeMetres;
    return this.getThreats().some(at => at !== hero && Math.hypot(at.x - hero.x, at.z - hero.z) < limit);
  }

  private talkTo(npc: NonNullable<ReturnType<TownManager['getTalkTarget']>>): void {
    this.dialogueUI.interact(this.getPlayerContext(), npc);
  }

  /** Opens a talk with the keeper of a shop (from the shop window); false when they are not at hand. */
  talkToKeeper(merchantId: string): boolean {
    const keeper = this.townManager.townsfolk.find(p => p.data.keeps === merchantId);
    if (!keeper) return false;
    this.dialogueUI.interact(this.getPlayerContext(), keeper);
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.townManager.dispose();
    this.waypointMarker.dispose();
    this.dialogueUI.dispose();
  }
}
