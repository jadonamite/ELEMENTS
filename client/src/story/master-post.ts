import { type Group, type Scene, Vector3 } from 'three';
import type { Loaders } from '../assets/loaders.js';
import type { AnimationPlayer } from '../anim/player.js';
import { buildMasterBody, releaseMaster } from './master-body.js';
import type { Enemy, VillainKind } from '../enemy.js';
import type { TownVoices } from '../life/town-voices.js';
import type { ContextOffer } from '../ui/context-action.js';
import type { SpeechMemory } from '../../../shared/src/story/speech.js';
import type { NationMasterConfig } from '../../../shared/src/story/nation-intro.js';
import type { ClimbTerms, EnrolOutcome } from '../economy/api.js';
import { CLIMB, acceptSituation, refusalSituation, type ClimbRefusal } from '../../../shared/src/growth/climb.js';

export interface MasterPostOptions {
  scene: Scene;
  /** The game's shared model loaders. */
  loaders: Loaders;
  nation: string;
  master: NationMasterConfig & { post: { x: number; z: number; facing: number } };
  voices: TownVoices;
  memory: SpeechMemory;
  /** Tier names, Tiro to Primus. */
  tierNames: readonly string[];
  /** How close the player stands to ask, metres. */
  reach: number;
  climb: { terms(): Promise<ClimbTerms>; enrol(): Promise<EnrolOutcome>; trialWon(): Promise<{ tier: number }> };
  spawnTrial(at: { x: number; z: number }, kind: VillainKind, health: number): Enemy;
  heroAlive(): boolean;
  applyTier(tier: number): void;
  notice(text: string): void;
  /** True while something else (the intro) has the master. */
  hidden(): boolean;
}

/**
 * A nation's master at their post in town, where a fighter climbs the tiers (LORE 7, 11): ask to train, and
 * the master tells you the fee rose if it did, then takes you on for the named tier (the fee is paid) or turns
 * you away with the real reason. Taken on, you fight the master's trial; win it and the tier is yours.
 */
export class MasterPost {
  private model: Group | null = null;
  private anim: AnimationPlayer | null = null;
  private busy = false;
  private trial: { enemy: Enemy; next: number } | null = null;
  private disposed = false;
  private readonly at: Vector3;
  private readonly offerAt = new Vector3();

  constructor(private readonly o: MasterPostOptions) {
    const p = o.master.post;
    this.at = new Vector3(p.x, 0, p.z);
    void buildMasterBody(o.loaders, o.nation).then(({ model, clips, anim }) => {
      if (this.disposed) { releaseMaster(model); return; }
      model.position.copy(this.at);
      model.rotation.y = p.facing;
      this.model = model;
      o.scene.add(model);
      this.anim = anim;
      const idle = clips.find(c => /fold_arms/i.test(c.name)) ?? clips.find(c => /idle/i.test(c.name));
      if (idle) this.anim.play(idle.name, 0);
    }).catch(console.error);
  }

  update(delta: number, hero: Vector3): void {
    if (!this.model) return;
    this.model.visible = !this.o.hidden();
    this.anim?.update(delta);
    if (Math.hypot(hero.x - this.at.x, hero.z - this.at.z) < 8) this.model.rotation.y = Math.atan2(hero.x - this.at.x, hero.z - this.at.z);
    const trial = this.trial;
    if (!trial) return;
    if (!trial.enemy.alive) {
      this.trial = null;
      void this.o.climb.trialWon().then(({ tier }) => {
        this.o.applyTier(tier);
        this.o.notice(`Trial won. You are ${this.o.tierNames[tier - 1] ?? `tier ${tier}`} now.`);
      }).catch(() => this.o.notice('The trial could not be recorded'));
    } else if (!this.o.heroAlive()) {
      this.trial = null;
      this.o.notice('Trial lost. The fee stands; ask the master again when you are ready.');
    }
  }

  /** "Train with the master" when the player stands at the post; nothing while the master is busy or a trial runs. */
  contextOffer(hero: Vector3): ContextOffer | null {
    if (!this.model || !this.model.visible || this.busy || this.trial) return null;
    if (Math.hypot(hero.x - this.at.x, hero.z - this.at.z) > this.o.reach) return null;
    return { verb: `Train with ${this.o.master.name}`, at: this.offerAt.set(this.at.x, 2.1, this.at.z), act: () => void this.ask() };
  }

  /** The player asks to train for their next tier. */
  async ask(): Promise<string[]> {
    const said: string[] = [];
    if (this.busy) return said;
    this.busy = true;
    try {
      const terms = await this.o.climb.terms();
      const early: ClimbRefusal | null = terms.master !== this.o.master.id ? 'no_master' : terms.next === null ? 'top' : null;
      if (early) {
        await this.refuse(early, terms, 0, said);
        return said;
      }
      if (terms.feeRose && !terms.paid) said.push(await this.say('fee_rising'));
      const r = await this.o.climb.enrol();
      if (r.outcome === 'refused') {
        await this.refuse(r.reason, terms, r.fee, said);
        return said;
      }
      const name = this.tierName(r.next);
      said.push(await this.say(acceptSituation(name), 'accept_student'));
      this.o.notice(`${r.fee > 0 ? `Paid ${r.fee} CHROMA. ` : ''}Trial for ${name}: defeat the master's challenger.`);
      const side = new Vector3(Math.sin(this.o.master.post.facing), 0, Math.cos(this.o.master.post.facing)).multiplyScalar(6).add(this.at);
      const enemy = this.o.spawnTrial({ x: side.x, z: side.z }, CLIMB.trialKind as VillainKind, CLIMB.trialHealth[String(r.next)] ?? 200);
      this.trial = { enemy, next: r.next };
      return said;
    } catch {
      this.o.notice(`${this.o.master.name} cannot be reached right now.`);
      return said;
    } finally {
      this.busy = false;
    }
  }

  /** The master turns the fighter away with the line for this reason; the notice carries the numbers. */
  private async refuse(reason: ClimbRefusal, terms: ClimbTerms, fee: number, said: string[]): Promise<void> {
    said.push(await this.say(refusalSituation(reason, terms.master !== null), 'refuse_student'));
    const name = this.tierName(terms.next);
    this.o.notice(
      reason === 'no_master' ? (terms.master ? `${this.o.master.name} trains only the Shapers of ${this.o.nation}.` : 'A Hush climbs with a master smith, not a fighting master.')
      : reason === 'top' ? 'You stand at the top of the climb.'
      : reason === 'short' ? `The fee for ${name} is ${fee} CHROMA.`
      : reason === 'no_trials' ? `${this.o.master.name} is not holding trials yet.`
      : `Win ${Math.max(0, terms.winsNeeded - terms.wins)} more fights before the trial for ${name}.`);
  }

  private tierName(tier: number | null): string {
    return this.o.tierNames[(tier ?? 1) - 1] ?? `tier ${tier}`;
  }

  /**
   * The master says a line of the first of `concepts` they have lines for, in their own voice and the sex of their
   * body; resolves with the line when it has played ('' when nothing was said).
   */
  private say(...concepts: string[]): Promise<string> {
    const m = this.o.master;
    const now = this.o.voices.now();
    let r = null;
    for (const concept of concepts) {
      r = this.o.voices.rules.speak({ concept, speakerId: m.id, facts: { who: m.id } }, this.o.memory, now);
      if (r) break;
    }
    if (!r || !this.model) return Promise.resolve('');
    const line = r;
    return new Promise((done) => {
      void this.o.voices.speak({ id: m.id, name: m.name, role: m.id, position: this.model!.position, body: this.model }, line.line, line.tier,
        { subtitle: true, ended: () => done(line.line) }).then(spoken => { if (!spoken) done(line.line); });
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.model) { this.o.scene.remove(this.model); releaseMaster(this.model); }
    this.anim?.dispose();
  }
}
