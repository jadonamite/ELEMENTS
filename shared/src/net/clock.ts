/** The zone's time of day, kept by the server so every player sees the same hour. */

export interface DayNightConfig {
  dayMinutes: number;
  duskMinutes: number;
  nightMinutes: number;
  dawnMinutes: number;
  startMinute: number;
}

export const cycleMinutes = (c: DayNightConfig): number => c.dayMinutes + c.duskMinutes + c.nightMinutes + c.dawnMinutes;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 by day, 1 at night, easing through dusk and dawn. Matches the browser's sky. */
export function nightnessAt(minute: number, c: DayNightConfig): number {
  const m = ((minute % cycleMinutes(c)) + cycleMinutes(c)) % cycleMinutes(c);
  const duskEnd = c.dayMinutes + c.duskMinutes;
  const nightEnd = duskEnd + c.nightMinutes;
  if (m < c.dayMinutes) return 0;
  if (m < duskEnd) return smooth(c.dayMinutes, duskEnd, m);
  if (m < nightEnd) return 1;
  return 1 - smooth(nightEnd, cycleMinutes(c), m);
}

/** Robbers count it as night from this much darkness on, as the browser always has. */
export const NIGHT_FROM = 0.45;

/** Server to client: the zone's clock. `speed` is game minutes per real minute. */
export interface ClockMsg { minute: number; speed: number }
