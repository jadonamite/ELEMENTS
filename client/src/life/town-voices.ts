import type { Object3D, Vector3 } from 'three';
import type { SoundManager } from '../audio.js';
import type { LiveTownsperson } from './town-manager.js';
import { SpeechTraffic, type SpeechMemory, type SpeechRules, type SpeechTier, type TrafficLimits } from '../../../shared/src/story/speech.js';
import { voiceId } from '../../../shared/src/story/voice.js';

/** Someone who can speak: who they are, the dialogue group they speak as, where they stand, and their body. */
export interface Speaker {
  id: string;
  name: string;
  role: string;
  position: Vector3;
  body: Object3D | null;
}

export interface SayOptions {
  role?: string | undefined;
  subtitle?: boolean | undefined;
  ended?: (() => void) | undefined;
}

export interface TownVoicesOptions {
  sound: SoundManager;
  rules: SpeechRules;
  memory: SpeechMemory;
  limits: TrafficLimits;
  /** One radius for hearing a voice and seeing its subtitle. */
  hearRadius: number;
  /** Seconds of game time, for cooldowns and traffic. */
  now: () => number;
  hero: () => Vector3;
  /** Shows a spoken line as a subtitle under the speaker's name. */
  subtitle: (name: string, line: string, seconds: number) => void;
}

/**
 * Every townsperson's voice in the street. Lines go through one traffic control, so a conversation, a
 * couple of shouted reactions and a trickle of chatter can overlap without the street talking over itself.
 */
export class TownVoices {
  private readonly traffic: SpeechTraffic;

  constructor(private readonly o: TownVoicesOptions) {
    this.traffic = new SpeechTraffic(o.limits);
  }

  /** The speech rules every voice in the street answers by. */
  get rules(): SpeechRules {
    return this.o.rules;
  }

  /** Game time in seconds, as cooldowns and traffic count it. */
  now(): number {
    return this.o.now();
  }

  /**
   * Speaks `line` in the person's recorded voice from where they stand, if traffic lets it start.
   * `role` is the dialogue group the line came from when the person speaks as something other than their
   * own (a trader keeping a merchant's stall). Conversation lines show in the talk panel, so they get a
   * subtitle only when `subtitle` asks for one.
   */
  say(person: LiveTownsperson, line: string, tier: SpeechTier,
    { role = person.data.dialogueRole, subtitle = tier !== 'conversation', ended }: SayOptions = {}): Promise<boolean> {
    return this.speak({ id: person.data.id, name: person.data.name, role, position: person.position, body: person.body.model }, line, tier, { subtitle, ended });
  }

  /**
   * Speaks for anyone with a body and a place (a townsperson, the master who meets a newcomer): the voice is
   * the speaker's dialogue group in the sex their body was built as. Resolves false when the body is not
   * there yet or does not say its sex, when there is no recording, or when traffic has no room.
   * `ended` is called when the line has played through.
   */
  speak(speaker: Speaker, line: string, tier: SpeechTier, { subtitle = tier !== 'conversation', ended }: Omit<SayOptions, 'role'> = {}): Promise<boolean> {
    const sex = bodySex(speaker.body);
    if (!sex) return Promise.resolve(false);
    const at = speaker.position;
    return this.o.sound.speak(voiceId(speaker.role, sex), line, { x: at.x, y: at.y + 1.6, z: at.z }, {
      channel: speaker.id,
      admit: (seconds) => {
        const cut = this.traffic.request(speaker.id, tier, seconds, this.o.now());
        if (!cut) return false;
        for (const other of cut) this.o.sound.stopSpeech(other);
        if (subtitle) this.o.subtitle(speaker.name, line, seconds);
        if (ended) setTimeout(ended, seconds * 1000);
        return true;
      },
    });
  }

  /** The speaker stopped early: their line ends and frees its place in traffic. */
  end(speakerId: string): void {
    this.o.sound.stopSpeech(speakerId);
    this.traffic.end(speakerId);
  }

  /**
   * Something happened at `at` (a speech concept: fight_started, flee, red_flag_raised, loot_dropped,
   * theft_seen). Of `people` near it whom the hero can hear, the best match says their line.
   */
  witness(concept: string, at: Vector3, people: readonly LiveTownsperson[]): void {
    const hero = this.o.hero(), r = this.o.hearRadius;
    const near = people.filter(p => flat(p.position, at) <= r && flat(p.position, hero) <= r);
    if (near.length === 0) return;
    const said = this.o.rules.answer(concept, near.map(p => ({ speakerId: p.data.id, facts: { who: p.data.dialogueRole } })), this.o.memory, this.o.now());
    const speaker = said && near.find(p => p.data.id === said.speakerId);
    if (said && speaker) void this.say(speaker, said.line, said.tier);
  }
}

/** The sex a body was built as (the body kit marks every model it builds); null when there is no body yet or it does not say. */
export function bodySex(body: Object3D | null): 'male' | 'female' | null {
  const sex = body?.userData.sex as unknown;
  return sex === 'male' || sex === 'female' ? sex : null;
}

function flat(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
