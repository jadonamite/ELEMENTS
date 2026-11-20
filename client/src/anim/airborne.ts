import type { AnimationClip, VectorKeyframeTrack } from 'three';

/**
 * The hero's jump, cut from Mixamo's Jumping In Place and Forward Running Jump at the frames the feet leave the ground,
 * reach the top and touch down: a set for a standing jump and one for a running jump. Getting up follows a hard landing.
 */
export const AIR_CLIPS = {
  rise: 'air_rise',
  fall: 'air_fall',
  land: 'air_land',
  runRise: 'air_run_rise',
  runFall: 'air_run_fall',
  runLand: 'air_run_land',
  getUp: 'get_up',
} as const;

/**
 * The game lifts the body itself, so the rising and falling pieces keep their legs and arms but hold the hips at the
 * height they start at; otherwise the jump would climb twice. Touchdowns keep the dip that absorbs the landing.
 */
export function levelAirborneHips(clips: readonly AnimationClip[]): AnimationClip[] {
  return clips.map(clip => {
    if (!/^air_(run_)?(rise|fall)$/.test(clip.name)) return clip;
    const rise = clips.find(c => c.name === clip.name.replace('fall', 'rise')) ?? clip;
    const start = (rise.tracks.find(t => t.name === 'pelvis.position') as VectorKeyframeTrack | undefined)?.values[1];
    if (start === undefined) return clip;
    const copy = clip.clone();
    const hips = copy.tracks.find(t => t.name === 'pelvis.position');
    if (hips) for (let i = 1; i < hips.values.length; i += 3) hips.values[i] = start;
    return copy;
  });
}

export type AirPhase = 'ground' | 'rise' | 'fall' | 'land' | 'down' | 'getting_up';

/** What the body is doing this frame, as the controller sees it. */
export interface AirReading {
  grounded: boolean;
  /** Upward speed in m/s; negative while falling. */
  rising: number;
  /** Moving along the ground: a touchdown gives way to the stride at once. */
  moving: boolean;
  /** Speed along the ground, m/s. */
  speed: number;
}

/** What the phase asks the animation to do this frame. */
export interface AirClip {
  name: string;
  loop: boolean;
  /** Start the clip from its first frame, even if it is already showing. */
  restart: boolean;
  /** Playback speed, 1 at its authored speed; 0 holds the frame. */
  speed: number;
}

export interface AirTiming {
  /** Seconds the touchdown clip holds the body before locomotion takes over again. */
  landSeconds: number;
  /** Seconds of the get-up clip. */
  getUpSeconds: number;
  /** Seconds each piece covers at its authored speed; rise and fall are played to fit the actual flight. */
  duration(clip: string): number;
  /** m/s², to know how long a rise and its fall will last from the upward speed. */
  gravity: number;
  /** Moving faster than this along the ground at take-off (m/s) is a running jump. */
  runSpeed: number;
}

/**
 * The airborne phase follows the body, never a timer: rising while the body moves up, falling (looped for as
 * long as the fall lasts) once it comes down, and a touchdown when it lands. A fall marked hard leaves the body
 * down on the ground until `getUp` is called. Between phases the locomotion clips own the body (`ground`).
 */
export class Airborne {
  phase: AirPhase = 'ground';
  private timer = 0;
  private hardFall = false;
  private changed = true;
  private riseSpeed = 1;
  private fallSpeed = 1;
  /** This jump uses the running set. */
  private running = false;

  constructor(private readonly timing: AirTiming) {}

  /** The next landing puts the body down on the ground, where it stays until `getUp`. */
  fallHard(): void {
    this.hardFall = true;
  }

  /** Raises a body that is down; a body already up is unaffected. */
  getUp(): void {
    if (this.phase !== 'down') return;
    this.enter('getting_up');
  }

  /** True while the body cannot walk: down on the ground or getting up. */
  get holding(): boolean {
    return this.phase === 'down' || this.phase === 'getting_up';
  }

  /** Advances the phase and returns the clip it wants, or null when locomotion owns the body. */
  update(reading: AirReading, dt: number): AirClip | null {
    this.timer += dt;
    const airborne = !reading.grounded;
    switch (this.phase) {
      case 'ground':
      case 'land':
        if (airborne) {
          this.running = reading.speed > this.timing.runSpeed;
          this.enter(reading.rising > 0 ? 'rise' : 'fall', reading.rising);
        }
        else if (this.phase === 'land' && (reading.moving || this.timer >= this.timing.landSeconds)) this.enter('ground');
        break;
      case 'rise':
        if (!airborne) this.touchDown();
        else if (reading.rising <= 0) this.enter('fall');
        break;
      case 'fall':
        if (!airborne) this.touchDown();
        else if (reading.rising > 0) this.enter('rise', reading.rising);
        break;
      case 'down':
        break;
      case 'getting_up':
        if (this.timer >= this.timing.getUpSeconds) this.enter('ground');
        break;
    }
    const restart = this.changed;
    this.changed = false;
    switch (this.phase) {
      case 'ground': return null;
      // A fall longer than the jump's own holds its last frame, legs ready for the ground.
      case 'rise': return { name: this.clip('rise'), loop: false, restart, speed: this.riseSpeed };
      case 'fall': return { name: this.clip('fall'), loop: false, restart, speed: this.fallSpeed };
      case 'land': return { name: this.clip('land'), loop: false, restart, speed: 1 };
      case 'down': return { name: AIR_CLIPS.getUp, loop: false, restart, speed: 0 };
      case 'getting_up': return { name: AIR_CLIPS.getUp, loop: false, restart, speed: 1 };
    }
  }

  private touchDown(): void {
    if (this.hardFall) {
      this.hardFall = false;
      this.enter('down');
    } else this.enter('land');
  }

  private clip(piece: 'rise' | 'fall' | 'land'): string {
    if (!this.running) return AIR_CLIPS[piece];
    return piece === 'rise' ? AIR_CLIPS.runRise : piece === 'fall' ? AIR_CLIPS.runFall : AIR_CLIPS.runLand;
  }

  /** On take-off both halves are timed to the flight: up to the top, and back down from it. */
  private enter(phase: AirPhase, rising = 0): void {
    if (phase === 'rise') {
      const half = Math.max(0.15, rising / this.timing.gravity);
      this.riseSpeed = this.timing.duration(this.clip('rise')) / half;
      this.fallSpeed = this.timing.duration(this.clip('fall')) / half;
    } else if (phase === 'fall' && this.phase !== 'rise') this.fallSpeed = 1;
    this.phase = phase;
    this.timer = 0;
    this.changed = true;
  }
}
