/** The hero's clips for leaving the ground, falling, touching down, and getting up after a hard landing. */
export const AIR_CLIPS = {
  rise: 'air_rise',
  fall: 'air_fall',
  land: 'air_land',
  getUp: 'get_up',
} as const;

export type AirPhase = 'ground' | 'rise' | 'fall' | 'land' | 'down' | 'getting_up';

/** What the body is doing this frame, as the controller sees it. */
export interface AirReading {
  grounded: boolean;
  /** Upward speed in m/s; negative while falling. */
  rising: number;
  /** Moving along the ground: a touchdown gives way to the stride at once. */
  moving: boolean;
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
  /** Seconds the take-off clip covers; it is played to fit the actual rise. */
  riseSeconds: number;
  /** m/s², to know how long a rise will last from its upward speed. */
  gravity: number;
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
        if (airborne) this.enter(reading.rising > 0 ? 'rise' : 'fall', reading.rising);
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
      case 'rise': return { name: AIR_CLIPS.rise, loop: false, restart, speed: this.riseSpeed };
      case 'fall': return { name: AIR_CLIPS.fall, loop: true, restart, speed: 1 };
      case 'land': return { name: AIR_CLIPS.land, loop: false, restart, speed: 1 };
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

  private enter(phase: AirPhase, rising = 0): void {
    if (phase === 'rise') this.riseSpeed = this.timing.riseSeconds / Math.max(0.2, rising / this.timing.gravity);
    this.phase = phase;
    this.timer = 0;
    this.changed = true;
  }
}
