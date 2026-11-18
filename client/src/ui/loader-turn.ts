export const GLYPH_ELEMENTS = ['IGNIS', 'AQUES', 'AURA', 'TERRA'] as const;
export const ELEMENT_TURN_MS = 1120;
export const ELEMENT_HOLD_MS = 220;
const TURN_MS = 900;
const smooth = (t: number): number => t * t * (3 - 2 * t);
type Point = readonly [number, number];

/** Original silhouettes: split flame, breaking wave, gale, mountain ridge. */
export const EMBLEM_PATHS = [
  'M35 11C26 15 21 23 23 31C19 29 17 25 17 22C10 34 15 47 26 51C22 44 25 39 30 34C29 41 37 42 35 51C47 48 52 37 46 27C45 32 42 34 40 35C43 25 31 24 35 11Z',
  'M44 16C32 10 19 17 15 29C12 37 16 46 24 49C33 53 43 48 50 43C42 45 36 43 32 39C25 33 23 29 26 25C29 20 36 22 35 26C34 29 30 28 29 27C31 35 42 32 44 26C46 22 44 19 40 18C42 18 43 17 44 16Z',
  'M13 28C23 21 31 30 39 28C44 27 44 20 39 20C35 20 33 22 33 24C29 18 35 13 41 14C53 16 54 32 42 36C31 40 23 30 13 34ZM14 40C25 35 35 46 49 38C46 50 26 50 14 46Z',
  'M30 13L38 27L42 23L51 46C52 49 50 51 47 51L15 51C12 51 12 48 14 45L21 29L24 31ZM30 24L23 38L29 34L35 38Z',
] as const;

/** The Hush mark, in the same grid: a hammer striking an anvil, sparks off the face. */
export const HUSH_EMBLEM_PATH =
  'M9 33.76C13.60 32.38 17.28 31.92 20.96 31.92L52.24 31.92L52.24 37.44L43.96 37.44C41.20 37.44 39.36 39.28 39.36 42.04L39.36 43.88C39.36 45.72 41.20 46.64 43.96 47.56L47.64 48.48L47.64 51.24L18.20 51.24L18.20 48.48L21.88 47.56C24.64 46.64 26.48 45.72 26.48 43.88L26.48 42.04C26.48 39.28 24.64 38.36 20.96 38.36C16.36 37.90 12.68 36.06 9 33.76Z' +
  'M36.09 26.90L30.81 30.60L22.39 18.54L27.67 14.84Z' +
  'M32.67 22L45.49 13.04C46.17 12.60 46.26 11.77 45.80 11.22C45.34 10.67 44.60 10.58 43.90 10.78L31.09 19.74Z' +
  'M38.44 28.70L43.50 25.02L39.82 29.90ZM40.28 30.26L46.72 28.70L40.83 31.28ZM24.27 29.71L19.67 26.95L23.72 30.63Z';

/** A single shared ring; the counter is cut out with evenodd fill. */
export const EMBLEM_RING = 'M32 3A29 29 0 1 1 32 61A29 29 0 1 1 32 3ZM32 5.5A26.5 26.5 0 1 0 32 58.5A26.5 26.5 0 1 0 32 5.5Z';
const normalize = (index: number): number => ((Math.trunc(index) % 4) + 4) % 4;
export function elementGlyph(index: number) {
  const i = normalize(index);
  return { d: EMBLEM_PATHS[i]!, detail: EMBLEM_RING, element: GLYPH_ELEMENTS[i]! };
}

/** Sample cubic contours once, then redistribute points at equal arc lengths. */
function resampleContour(path: string): Point[] {
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
// Keep separate islands and counters throughout a morph. A missing contour
// starts as a point inside the body and grows continuously into its next shape.
const contours = EMBLEM_PATHS.map(path => {
  const parts = path.match(/M[^M]+/g)!.map(resampleContour);
  return [parts[0]!, parts[1] ?? Array.from({ length: 192 }, (): Point => [32, 38])];
});
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
  const d = from.map((contour, part) => pathFrom(contour.map(([x, y], i): Point =>
    [x + (to[part]![i]![0] - x) * turn, y + (to[part]![i]![1] - y) * turn]))).join('');
  return { d, detail: EMBLEM_RING, angle: turn * 360, opacity: 1,
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
