export const GLYPH_ELEMENTS = ['IGNIS', 'AQUES', 'AURA', 'TERRA'] as const;
export const ELEMENT_TURN_MS = 1120;
export const ELEMENT_HOLD_MS = 220;
const TURN_MS = 900;
const smooth = (t: number): number => t * t * (3 - 2 * t);
type Point = readonly [number, number];

/** Original silhouettes: split flame, breaking wave, single wind ribbon, cleft stone. */
export const EMBLEM_PATHS = [
  'M35 11C26 15 21 23 23 31C19 29 17 25 17 22C10 34 15 47 26 51C22 44 25 39 30 34C29 41 37 42 35 51C47 48 52 37 46 27C45 32 42 34 40 35C43 25 31 24 35 11Z',
  'M44 16C32 10 19 17 15 29C12 37 16 46 24 49C33 53 43 48 50 43C42 45 36 43 32 39C25 33 23 29 26 25C29 20 36 22 35 26C34 29 30 28 29 27C31 35 42 32 44 26C46 22 44 19 40 18C42 18 43 17 44 16Z',
  'M17 21C24 13 39 12 46 20C52 27 47 36 39 38C33 40 28 37 25 34C29 35 35 35 38 32C44 27 40 21 34 21C28 20 24 23 21 26C18 29 17 33 20 37C26 45 40 40 48 42C40 48 21 52 15 41C10 33 12 26 17 21Z',
  'M31 13C35 13 39 17 42 21L50 38C52 42 50 47 46 49L35 50L37 40L32 34L33 23L27 36L31 42L27 50L18 49C14 48 12 44 14 39L22 20C24 16 27 13 31 13Z',
] as const;

/** A single shared ring; the counter is cut out with evenodd fill. */
export const EMBLEM_RING = 'M32 3A29 29 0 1 1 32 61A29 29 0 1 1 32 3ZM32 5.5A26.5 26.5 0 1 0 32 58.5A26.5 26.5 0 1 0 32 5.5Z';
const normalize = (index: number): number => ((Math.trunc(index) % 4) + 4) % 4;
export function elementGlyph(index: number) {
  const i = normalize(index);
  return { d: EMBLEM_PATHS[i]!, detail: EMBLEM_RING, element: GLYPH_ELEMENTS[i]! };
}

/** Sample cubic contours once, then redistribute points at equal arc lengths. */
function resample(path: string): Point[] {
  const tokens = path.match(/[MLCZ]|-?\d+(?:\.\d+)?/g)!;
  const dense: Point[] = [];
  let cursor = 0;
  let current: Point = [0, 0];
  const read = (): Point => [Number(tokens[cursor++]), Number(tokens[cursor++])];
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    if (command === 'M' || command === 'L') { current = read(); dense.push(current); }
    else if (command === 'C') {
      const start = current, a = read(), b = read(), end = read();
      for (let step = 1; step <= 24; step++) {
        const t = step / 24, u = 1 - t;
        dense.push([u ** 3 * start[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * end[0],
          u ** 3 * start[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * end[1]]);
      }
      current = end;
    }
  }
  dense.push(dense[0]!);
  const lengths = [0];
  for (let i = 1; i < dense.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(dense[i]![0] - dense[i - 1]![0], dense[i]![1] - dense[i - 1]![1]));
  const total = lengths.at(-1)!;
  let segment = 1;
  return Array.from({ length: 192 }, (_, i): Point => {
    const distance = total * i / 192;
    while (segment < lengths.length - 1 && lengths[segment]! < distance) segment++;
    const a = dense[segment - 1]!, b = dense[segment]!;
    const mix = (distance - lengths[segment - 1]!) / (lengths[segment]! - lengths[segment - 1]! || 1);
    return [a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix];
  });
}
const contours = EMBLEM_PATHS.map(resample);
const pathFrom = (points: Point[]): string => `M${points.map(p => `${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join('L')}Z`;

/** A continuous contour morph and full turn, followed by a brief upright hold. */
export function elementTurnFrame(elapsed: number, reduced = false) {
  const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (reduced) {
    const period = 4200, fade = 1600;
    const step = Math.floor(time / period), index = step % 4;
    const mix = smooth(Math.max(0, (time % period - (period - fade)) / fade));
    return { ...elementGlyph(index), angle: 0, opacity: 1 - mix,
      next: { ...elementGlyph(index + 1), opacity: mix } };
  }
  const step = Math.floor(time / ELEMENT_TURN_MS), index = step % 4;
  const turn = smooth(Math.max(0, (time % ELEMENT_TURN_MS - ELEMENT_HOLD_MS) / TURN_MS));
  const from = contours[index]!, to = contours[(index + 1) % 4]!;
  const points = from.map(([x, y], i): Point => [x + (to[i]![0] - x) * turn, y + (to[i]![1] - y) * turn]);
  return { d: pathFrom(points), detail: EMBLEM_RING, angle: turn * 360, opacity: 1,
    element: GLYPH_ELEMENTS[index]!, next: { ...elementGlyph(index + 1), opacity: 0 } };
}

/** A quiet meniscus in screen coordinates; time never advances the fill level. */
export function elementInkFrame(progress: number, elapsed = 0, reduced = false) {
  const amount = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const level = 64 - amount * 64;
  const phase = reduced || !Number.isFinite(elapsed) ? 0 : elapsed / 2400;
  const wave = amount === 0 || amount === 1 ? 0 : .7 * Math.sin(phase);
  return { level, d: `M-4 ${level}C14 ${level - .9 - wave} 18 ${level + .9 + wave} 32 ${level}S50 ${level - .9 - wave} 68 ${level}V68H-4Z` };
}
