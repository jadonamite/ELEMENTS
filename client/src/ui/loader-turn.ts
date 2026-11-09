const ELEMENTS = ['IGNIS', 'AQUES', 'AURA', 'TERRA'] as const;
export const ELEMENT_TURN_MS = 1180;
const HOLD_MS = 280;
const TURN_MS = 900;
const smooth = (t: number): number => t * t * (3 - 2 * t);

function triangle(radius: number, bar: number, inverted = false): string {
  const sign = inverted ? -1 : 1;
  const n = (value: number): string => value.toFixed(3);
  return `M32 ${n(32 - radius * sign)}L${n(32 - radius * .866)} ${n(32 + radius * .5 * sign)}L${n(32 + radius * .866)} ${n(32 + radius * .5 * sign)}ZM${n(32 - 15 * bar)} 32H${n(32 + 15 * bar)}`;
}

/** One path keeps its vertices through every half turn. */
export function elementTurnFrame(elapsed: number, reduced = false): { d: string; angle: number; opacity: number; element: string } {
  const time = Math.max(0, elapsed);
  if (reduced) {
    const period = 3000, fade = 1200;
    const step = Math.floor(time / period);
    const phase = time % period;
    const mix = Math.max(0, (phase - (period - fade)) / fade);
    const index = (step + Number(mix >= .5)) % 4;
    return {
      d: triangle(26, Number(index >= 2), index % 2 === 1), angle: 0,
      opacity: mix === 0 ? 1 : Math.abs(1 - 2 * smooth(mix)), element: ELEMENTS[index]!,
    };
  }
  const step = Math.floor(time / ELEMENT_TURN_MS);
  const phase = Math.max(0, (time % ELEMENT_TURN_MS - HOLD_MS) / TURN_MS);
  const turn = smooth(phase);
  const index = step % 4;
  const fromBar = Number(index >= 2), toBar = Number((index + 1) % 4 >= 2);
  return {
    d: triangle(26 - Math.sin(turn * Math.PI) * 1.5, fromBar + (toBar - fromBar) * turn),
    angle: (step % 4) * 180 + turn * 180,
    opacity: 1, element: ELEMENTS[index]!,
  };
}
