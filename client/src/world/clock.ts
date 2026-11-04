import { Color, Vector3 } from 'three';
import balance from '../../../shared/balance.json';
import { nightness } from './effects.js';

const cfg = balance.world.dayNight;
const DAY = cfg.dayMinutes, DUSK = cfg.duskMinutes, NIGHT = cfg.nightMinutes, DAWN = cfg.dawnMinutes;
/** One full cycle in minutes. Minute 0 is the start of the day. */
export const CYCLE = DAY + DUSK + NIGHT + DAWN;
const MAX_ELEVATION = (cfg.sunMaxElevationDeg * Math.PI) / 180;
const MOON = new Vector3(-0.35, 0.78, -0.52).normalize();

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type MoonPhase = 'new' | 'waxing_crescent' | 'first_quarter' | 'waxing_gibbous' | 'full' | 'waning_gibbous' | 'last_quarter' | 'waning_crescent';

/** Sky state shared with the sky shader: the sun's direction (also below the horizon) and the sunrise/sunset glow. */
export const skyUniforms = {
  uSunDir: { value: new Vector3(0, 1, 0) },
  uMoonDir: { value: MOON.clone() },
  uDusk: { value: 0 },
  uFullMoon: { value: 1 },
};

export interface Light {
  /** Direction toward whichever light is up: the sun by day, the moon at night. */
  direction: Vector3;
  color: Color;
  intensity: number;
}

const SUN_LOW = new Color(1.0, 0.5, 0.24);
const SUN_HIGH = new Color(1.0, 0.94, 0.84);
const MOONLIGHT = new Color(0.62, 0.72, 1.0);
const FULL_MOONLIGHT = new Color(0.72, 0.84, 1.15);

/**
 * Game time on a 24-minute loop: day, dusk, night, dawn. The sun rises in the east (+x),
 * crosses the south and sets in the west; at night a cool moon takes over.
 * ?night=0..1 pins the hour (tests rely on it), ?clock=minutes sets the start,
 * ?daySpeed=n runs the clock n times faster.
 * ?moon=full forces a full moon (empowering water benders).
 */
export class WorldClock {
  minute: number;
  speed = 1;
  private readonly pinnedNight: number | null = null;
  moonPhase: MoonPhase = 'full';
  readonly light: Light = { direction: new Vector3(), color: new Color(), intensity: 0 };

  constructor(params: URLSearchParams) {
    this.minute = cfg.startMinute;
    const moonParam = params.get('moon');
    if (moonParam) {
      if (moonParam === 'full') this.moonPhase = 'full';
      else if (moonParam === 'new') this.moonPhase = 'new';
    }
    const night = Number(params.get('night'));
    if (params.has('night') && Number.isFinite(night)) {
      const x = Math.min(1, Math.max(0, night));
      this.pinnedNight = x;
      // Day pins the start hour, full night the middle of the night, anything between a point in the dusk.
      this.minute = x <= 0 ? cfg.startMinute : x >= 1 ? DAY + DUSK + NIGHT / 2 : DAY + DUSK * x;
      this.speed = 0;
    }
    const clock = Number(params.get('clock'));
    if (params.has('clock') && Number.isFinite(clock)) this.minute = ((clock % CYCLE) + CYCLE) % CYCLE;
    const speed = Number(params.get('daySpeed'));
    if (params.has('daySpeed') && Number.isFinite(speed)) this.speed = speed;
    this.update(0);
  }

  /** Whether the full moon currently exerts its peak lunar power. */
  get isFullMoon(): boolean {
    return this.moonPhase === 'full' && nightness.value > 0.45;
  }

  /** Advance by real seconds and refresh nightness, the sky and the main light. */
  update(seconds: number): void {
    this.minute = (this.minute + (seconds / 60) * this.speed) % CYCLE;
    const m = this.minute;
    nightness.value = this.pinnedNight ?? (
      m < DAY ? 0
        : m < DAY + DUSK ? smooth(DAY, DAY + DUSK, m)
          : m < DAY + DUSK + NIGHT ? 1
            : 1 - smooth(DAY + DUSK + NIGHT, CYCLE, m));

    // The sun is up from the start of dawn to the end of dusk, and below the horizon through the night.
    const sun = skyUniforms.uSunDir.value;
    const risen = (m + DAWN) % CYCLE;
    const upSpan = DAWN + DAY + DUSK;
    if (risen < upSpan) {
      const a = Math.PI * (risen / upSpan);
      sun.set(Math.cos(a), Math.sin(a) * Math.sin(MAX_ELEVATION), Math.sin(a) * Math.cos(MAX_ELEVATION));
    } else {
      const a = Math.PI * ((risen - upSpan) / NIGHT);
      sun.set(-Math.cos(a), -Math.sin(a) * 0.6, Math.sin(a) * 0.3).normalize();
    }
    skyUniforms.uDusk.value = 1 - smooth(0.0, 0.32, Math.abs(sun.y));

    const l = this.light;
    if (sun.y > 0) {
      l.direction.copy(sun);
      l.color.copy(SUN_LOW).lerp(SUN_HIGH, smooth(0.15, 0.75, sun.y));
      l.intensity = 2.4 * smooth(-0.01, 0.22, sun.y);
    } else {
      l.direction.copy(MOON);
      l.color.copy(this.isFullMoon ? FULL_MOONLIGHT : MOONLIGHT);
      l.intensity = (this.isFullMoon ? 1.8 : 1.3) * smooth(0.0, 0.15, -sun.y);
      skyUniforms.uFullMoon.value = this.isFullMoon ? 1.5 : 1.0;
    }
  }
}
