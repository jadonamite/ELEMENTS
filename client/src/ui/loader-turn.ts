export const GLYPH_ELEMENTS = ['IGNIS', 'AQUES', 'AURA', 'TERRA'] as const;
export const ELEMENT_TURN_MS = 1180;
const HOLD_MS = 280;
const TURN_MS = 900;
const smooth = (t: number): number => t * t * (3 - 2 * t);
type Point = readonly [number, number];

/** The dominant sign, its mirrored half, nested diamond and registration axis. */
function vertices(index: number): { sign: Point[]; detail: Point[] } {
  const down = index % 2 === 1;
  const innerWidth = [9, 6, 11, 8][index]!;
  const innerTop = [20, 17, 23, 18][index]!;
  const flip = ([x, y]: Point): Point => [down ? 64 - x : x, down ? 64 - y : y];
  const sign: Point[] = [[32, 6], [8, 38], [56, 38], [32, 6],
    [index >= 2 ? 16 : 32, 27], [index >= 2 ? 48 : 32, 27]];
  const detail: Point[] = [[8, 38], [32, 58], [56, 38],
    [32, innerTop], [32 - innerWidth, 32], [32, 64 - innerTop], [32 + innerWidth, 32], [32, innerTop],
    [32, 0], [32, 64], [29, 3], [35, 3], [29, 61], [35, 61]];
  return {
    sign: sign.map(flip),
    detail: detail.map(flip),
  };
}
const point = (p: Point): string => p.map(v => v.toFixed(3)).join(' ');
function paths(sign: Point[], detail: Point[]): { d: string; detail: string } {
  return {
    d: `M${sign.slice(0, 4).map(point).join('L')}ZM${point(sign[4]!)}L${point(sign[5]!)}`,
    detail: `M${detail.slice(0, 3).map(point).join('L')}M${detail.slice(3, 8).map(point).join('L')}ZM${point(detail[8]!)}L${point(detail[9]!)}M${point(detail[10]!)}L${point(detail[11]!)}M${point(detail[12]!)}L${point(detail[13]!)}`,
  };
}
export function elementGlyph(index: number): { d: string; detail: string; element: string } {
  const shape = vertices(((index % 4) + 4) % 4);
  return { ...paths(shape.sign, shape.detail), element: GLYPH_ELEMENTS[((index % 4) + 4) % 4]! };
}

/** Corresponding vertices travel continuously; no path is replaced during a turn. */
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
  const turn = smooth(Math.max(0, (time % ELEMENT_TURN_MS - HOLD_MS) / TURN_MS));
  const from = vertices(index), to = vertices((index + 1) % 4);
  const interpolate = (points: Point[], target: Point[]): Point[] => points.map(([x, y], i) => {
    // Turn the target back before interpolation; the outer rotation restores it.
    const [tx, ty] = target[i]!;
    return [x + (64 - tx - x) * turn, y + (64 - ty - y) * turn];
  });
  return { ...paths(interpolate(from.sign, to.sign), interpolate(from.detail, to.detail)),
    angle: turn * 180, opacity: 1, element: GLYPH_ELEMENTS[index]!,
    next: { ...elementGlyph(index + 1), opacity: 0 } };
}
