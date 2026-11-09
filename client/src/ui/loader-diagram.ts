import type { LoaderPlate } from './loader-pictures.js';

/** Small deterministic generator; a load keeps its composition through resizes. */
function randomSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function diagramStrokeProgress(progress: number, index: number, reduced: boolean): number {
  if (reduced) return 1;
  const start = (index % 7) * .035;
  return Math.min(1, Math.max(0, (progress - start) / (1 - start)));
}

export interface PlateBounds { x: number; y: number; width: number; height: number }

/** One page-sized SVG, anchored to the contained portrait after layout. */
export function loaderDiagram(plate: LoaderPlate, width: number, height: number, seed: number, bounds: PlateBounds = { x: 0, y: 0, width, height }): string {
  const random = randomSequence(seed + Number(plate.number) * 7919);
  const scale = Math.min(bounds.width / 667, bounds.height / 1000);
  const imageWidth = 667 * scale, imageHeight = 1000 * scale;
  const left = bounds.x + (bounds.width - imageWidth) / 2, top = bounds.y + (bounds.height - imageHeight) / 2;
  const hx = left + plate.head[0] * imageWidth, hy = top + plate.head[1] * imageHeight;
  const gx = left + plate.ground[0] * imageWidth, gy = top + plate.ground[1] * imageHeight;
  const unit = Math.min(bounds.height * 1.1, width * 1.25);
  const cx = gx + (random() - .5) * unit * .1, cy = (hy + gy) * .5;
  const out: string[] = [];
  const n = (value: number): string => value.toFixed(2);
  const path = (d: string, kind = 'guide', weight = .7): void => {
    out.push(`<path class="loader-diagram-line loader-diagram-${kind}" pathLength="100" stroke-width="${weight}" d="${d}"/>`);
  };
  const point = (x: number, y: number): string => `${n(x)} ${n(y)}`;
  const polygon = (x: number, y: number, radius: number, sides: number, angle: number, kind: string): void => {
    const points = Array.from({ length: sides }, (_, i) => point(x + Math.cos(angle + i * Math.PI * 2 / sides) * radius, y + Math.sin(angle + i * Math.PI * 2 / sides) * radius));
    path(`M${points.join('L')}Z`, kind);
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, kind: string): void => {
    path(`M${point(x - rx, y)}a${n(rx)} ${n(ry)} 0 1 0 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-rx * 2)} 0`, kind);
  };

  // Long diagonals and overlapping constructions spread beyond the portrait.
  path(`M0 ${n(height * .05)}L${point(width, height * .94)}`, 'diagonal');
  path(`M0 ${n(height * .97)}L${point(width, height * .02)}`, 'diagonal');
  path(`M${point(width * .12, 0)}L${point(width * .79, height)}`, 'diagonal');
  polygon(cx - unit * .1, cy - unit * .05, unit * .53, 3, -Math.PI / 2, 'triangle');
  polygon(cx + unit * .1, cy, unit * .43, 3, Math.PI / 2, 'triangle');
  polygon(cx, cy + unit * .08, unit * .34, 3, -.95 + random() * .25, 'triangle');
  polygon(cx - unit * .06, cy + unit * .02, unit * .6, 3, -1.25, 'triangle');
  const rx = cx - unit * .44, ry = hy + unit * .08;
  path(`M${point(rx, ry)}h${n(unit * .76)}v${n(unit * .57)}h${n(-unit * .76)}Z`, 'rectangle');
  path(`M${point(cx - unit * .31, cy - unit * .24)}h${n(unit * .71)}v${n(unit * .61)}h${n(-unit * .71)}Z`, 'rectangle');
  ellipse(cx, cy, unit * .37, unit * .37, 'circle');
  ellipse(cx + unit * .14, cy - unit * .09, unit * .26, unit * .26, 'circle');
  ellipse(cx - unit * .1, cy + unit * .07, unit * .31, unit * .31, 'circle');
  ellipse(gx, gy, Math.min(width * .43, unit * .45), unit * .045, 'ellipse');
  ellipse(gx + unit * .06, gy - unit * .035, unit * .25, unit * .025, 'ellipse');
  path(`M${point(cx - unit * .58, hy)}Q${point(cx, gy + unit * .48)} ${point(cx + unit * .57, hy - unit * .02)}`, 'parabola');
  path(`M${point(cx - unit * .55, gy)}Q${point(cx + unit * .02, hy - unit * .53)} ${point(cx + unit * .48, gy)}`, 'parabola');

  path(`M${point(hx, 0)}V${n(height)}M${point(width * .03, gy)}H${n(width * .97)}M${point(width * .08, hy)}H${n(width * .88)}`, 'dimension', .9);
  for (let i = 0; i < 13; i++) {
    const y = hy + (gy - hy) * i / 12;
    path(`M${point(hx - (i % 3 ? 3 : 6), y)}h${i % 3 ? 6 : 12}`, 'tick');
    const x = cx - unit * .44 + unit * .88 * i / 12;
    path(`M${point(x, gy - 4)}v8`, 'tick');
  }

  // Element-specific branching: sparks, delta channels, cracks, wind-blown twigs.
  const branchX = hx + unit * .17, branchY = hy + unit * .22;
  const branch = (x: number, y: number, length: number, angle: number, depth: number): void => {
    const nx = x + Math.cos(angle) * length, ny = y + Math.sin(angle) * length;
    const bend = (random() - .5) * length * .5;
    const d = plate.element === 'AQUES' || plate.element === 'AURA'
      ? `M${point(x, y)}Q${point((x + nx) / 2 + bend, (y + ny) / 2)} ${point(nx, ny)}`
      : `M${point(x, y)}L${point((x + nx) / 2 + bend, (y + ny) / 2)}L${point(nx, ny)}`;
    path(d, 'branch', depth === 4 ? .9 : .6);
    if (depth === 0) return;
    const spread = plate.element === 'TERRA' ? .9 : plate.element === 'AQUES' ? .6 : .48;
    branch(nx, ny, length * (.58 + random() * .12), angle - spread, depth - 1);
    branch(nx, ny, length * (.57 + random() * .14), angle + spread, depth - 1);
  };
  branch(branchX, branchY + unit * .24, unit * .16, plate.element === 'AURA' ? -1.03 : -1.6, 4);

  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1;
    const x = Math.min(width - 12, Math.max(12, cx + side * unit * (.22 + random() * .35)));
    const y = height * (.06 + random() * .9);
    polygon(x, y, unit * (.009 + random() * .019), i % 4 === 0 ? 4 : 3, random() * Math.PI * 2, 'fragment');
  }

  // Pale registration strokes remain visible where they cross the dark subject.
  path(`M${point(hx, hy + unit * .12)}V${n(gy)}M${point(cx - unit * .2, cy + unit * .14)}L${point(cx + unit * .21, cy + unit * .14)}L${point(hx, cy - unit * .13)}Z`, 'overprint', .8);
  const discRadius = Math.max(8, unit * .045);
  out.push(`<circle class="loader-diagram-disc" cx="${n(hx + unit * .105)}" cy="${n(Math.max(discRadius, hy - unit * .04))}" r="${n(discRadius)}"/>`);
  out.push(`<g class="loader-diagram-labels"><text x="${n(cx - unit * .43)}" y="${n(cy - unit * .23)}">${plate.element} / ${plate.number}</text><text x="${n(cx + unit * .29)}" y="${n(gy - unit * .12)}">${plate.head.map(v => v.toFixed(2)).join(' : ')}</text><text x="${n(cx + unit * .28)}" y="${n(gy + unit * .06)}">Ø ${String(Math.round(unit)).padStart(3, '0')}</text></g>`);
  return out.join('');
}
