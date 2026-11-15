import { Scene, Vector3, type Camera, type Object3D } from 'three';
import type { HeroController } from '../controller.js';
import type { CombatSpace } from '../attacks/space.js';
import type { SoundManager } from '../audio.js';
import type { WorldClock } from '../world/clock.js';
import { SINDR_STREETS, SINDR_WALK, TownManager, type LiveTownsperson } from './town-manager.js';
import { LookBodies, ownLooks } from './townsfolk-bodies.js';
import type { Look } from './crowd.js';
import type { Townsperson } from './townsfolk.js';
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
/** Body files whose wearers are in the street before play; the rest of the crowd follows after. */
const FIRST_FILES = 2;


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
  /** Resolves when the people near the start are in the street; the rest come with `bringInRest`. */
  readonly ready: Promise<void>;
  private disposed = false;
  private readonly bodies: LookBodies;
  private readonly people: readonly Townsperson[];
  private readonly restLooks: readonly Look[];
  private readonly warm: ((model: Object3D) => Promise<void>) | undefined;

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
    // Before play: everyone wearing the body files of the keepers posted nearest where the hero stands, up to
    // FIRST_FILES files (every crowd look is one of a few sheet bodies, so files are what cost download).
    // Everyone else is built after play starts (bringInRest).
    const at = options.controller.position;
    const file = (look: Look): string => `${look.outfit ?? 'rags'}:${look.config.sex}`;
    const lookById = new Map(looks.map(l => [l.id, l]));
    const firstFiles = new Set<string>();
    for (const p of people.filter(p => !p.wander)
      .sort((a, b) => Math.hypot(a.schedule.work.x - at.x, a.schedule.work.z - at.z) - Math.hypot(b.schedule.work.x - at.x, b.schedule.work.z - at.z))) {
      const look = lookById.get(p.look ?? p.id);
      if (look) firstFiles.add(file(look));
      if (firstFiles.size >= FIRST_FILES) break;
    }
    const first = looks.filter(l => firstFiles.has(file(l)));
    this.restLooks = looks.filter(l => !first.includes(l));
    this.people = people;
    this.warm = options.warm;
    const town = this.townManager;
    const lookBodies = this.bodies = new LookBodies(children, undefined, options.warm);
    this.ready = (async () => {
      const [, bodies] = await Promise.all([
        town.prepare(SINDR_STREETS, SINDR_WALK, options.browse ?? [], options.posts ?? []),
        lookBodies.build(first),
      ]);
      if (!this.disposed) town.admit(bodies, people);
    })().catch(console.error);
  }

  /** Builds everyone not yet in the street, readies their bodies for drawing, then places them. */
  async bringInRest(): Promise<void> {
    await this.ready;
    if (this.disposed || this.restLooks.length === 0) return;
    const bodies = await this.bodies.build(this.restLooks);
    for (const body of bodies.values()) {
      if (this.disposed) return;
      await this.warm?.(body.model);
    }
    if (!this.disposed) this.townManager.admit(bodies, this.people);
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
