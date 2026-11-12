import type { Vector3 } from 'three';
import type { SoundManager } from '../audio.js';
import type { LiveTownsperson } from './town-manager.js';
import { SpeechTraffic, type SpeechMemory, type SpeechRules, type SpeechTier, type TrafficLimits } from '../../../shared/src/story/speech.js';
import { voiceId } from '../../../shared/src/story/voice.js';

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

  /**
   * Speaks `line` in the person's recorded voice from where they stand, if traffic lets it start.
   * Resolves false when there is no recording or no room. Conversation lines show in the talk panel, not as subtitles.
   */
  say(person: LiveTownsperson, line: string, tier: SpeechTier): Promise<boolean> {
    const at = person.position;
    const id = person.data.id;
    return this.o.sound.speak(voiceId(person.data.dialogueRole, person.data.sex), line, { x: at.x, y: at.y + 1.6, z: at.z }, {
      channel: id,
      admit: (seconds) => {
        const cut = this.traffic.request(id, tier, seconds, this.o.now());
        if (!cut) return false;
        for (const other of cut) this.o.sound.stopSpeech(other);
        if (tier !== 'conversation') this.o.subtitle(person.data.name, line, seconds);
        return true;
      },
    });
  }

  /** The speaker stopped early: their line ends and frees its place in traffic. */
  end(person: LiveTownsperson): void {
    this.o.sound.stopSpeech(person.data.id);
    this.traffic.end(person.data.id);
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

function flat(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
