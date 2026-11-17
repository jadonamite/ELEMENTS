import type { LoaderPlate } from './loader-pictures.js';

export function diagramStrokeProgress(progress: number, index: number, reduced: boolean): number {
  if (reduced) return 1;
  const start = (index % 7) * .035;
  return Math.min(1, Math.max(0, (progress - start) / (1 - start)));
}

export interface PlateBounds { x: number; y: number; width: number; height: number }

/** One page-sized SVG; every guide keys off the plate's subject and ground anchors. */
export function loaderDiagram(plate: LoaderPlate, width: number, height: number, seed: number, bounds: PlateBounds = { x: 0, y: 0, width, height }): string {
  const scale = Math.min(bounds.width / 667, bounds.height / 1000);
  const imageWidth = 667 * scale, imageHeight = 1000 * scale;
  const left = bounds.x + (bounds.width - imageWidth) / 2, top = bounds.y + (bounds.height - imageHeight) / 2;
  const hx = left + plate.head[0] * imageWidth, hy = top + plate.head[1] * imageHeight;
  const gx = left + plate.ground[0] * imageWidth, gy = top + plate.ground[1] * imageHeight;
  const unit = Math.min(bounds.height * 1.1, width * 1.25);
  const cx = (hx + gx) / 2, cy = (hy + gy) / 2;
  const angle = -Math.PI / 2 + ((seed % 7) - 3) * .018;
  const out: string[] = [];
  const n = (value: number): string => value.toFixed(2);
  const path = (d: string, kind = 'guide', weight = .7): void => {
    out.push(`<path class="loader-diagram-line loader-diagram-${kind}" pathLength="100" stroke-width="${weight}" d="${d}"/>`);
  };
  const point = (x: number, y: number): string => `${n(x)} ${n(y)}`;
  const polygon = (x: number, y: number, radius: number, sides: number, rotation: number, kind: string): void => {
    const points = Array.from({ length: sides }, (_, i) => point(x + Math.cos(rotation + i * Math.PI * 2 / sides) * radius, y + Math.sin(rotation + i * Math.PI * 2 / sides) * radius));
    path(`M${points.join('L')}Z`, kind);
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, kind: string): void => {
    path(`M${point(x - rx, y)}a${n(rx)} ${n(ry)} 0 1 0 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-rx * 2)} 0`, kind);
  };

  // Page diagonals converge on the head and foot anchors; the cross-lines measure them.
  path(`M0 ${n(hy)}L${point(width, gy)}`, 'diagonal');
  path(`M0 ${n(gy)}L${point(width, hy)}`, 'diagonal');
  path(`M${point(hx, 0)}L${point(gx, height)}`, 'diagonal');
  path(`M${point(cx - unit * .48, hy - unit * .06)}L${point(hx, hy - unit * .34)}L${point(cx + unit * .48, gy + unit * .04)}Z`, 'triangle');
  path(`M${point(cx - unit * .43, cy - unit * .28)}L${point(cx + unit * .43, cy - unit * .28)}L${point(cx + unit * .04, cy + unit * .5)}Z`, 'triangle');
  path(`M${point(cx + unit * .35, cy - unit * .2)}L${point(cx - unit * .34, cy + unit * .28)}L${point(cx + unit * .18, cy + unit * .42)}Z`, 'triangle');
  polygon(cx, cy, unit * .33, 3, angle, 'triangle');

  // Two registration frames and nested arcs hold the figure in a measurable field.
  path(`M${point(hx - unit * .28, hy - unit * .12)}h${n(unit * .56)}v${n(gy - hy + unit * .16)}h${n(-unit * .56)}Z`, 'rectangle');
  path(`M${point(cx - unit * .39, cy - unit * .31)}h${n(unit * .78)}v${n(unit * .62)}h${n(-unit * .78)}Z`, 'rectangle');
  ellipse(cx, cy, unit * .38, unit * .38, 'circle');
  ellipse(cx, cy, unit * .28, unit * .28, 'circle');
  ellipse(hx, hy + unit * .18, unit * .3, unit * .3, 'circle');
  ellipse(gx, gy, Math.min(width * .43, unit * .45), unit * .045, 'ellipse');
  ellipse(gx, gy - unit * .035, unit * .25, unit * .025, 'ellipse');
  path(`M${point(cx - unit * .58, hy)}Q${point(cx, cy + unit * .52)} ${point(cx + unit * .57, hy - unit * .02)}`, 'parabola');
  path(`M${point(cx - unit * .55, gy)}Q${point(cx + unit * .02, cy - unit * .53)} ${point(cx + unit * .48, gy)}`, 'parabola');

  path(`M${point(hx, 0)}V${n(height)}M${point(width * .03, gy)}H${n(width * .97)}M${point(width * .08, hy)}H${n(width * .88)}`, 'dimension', .9);
  for (let i = 0; i < 13; i++) {
    const y = hy + (gy - hy) * i / 12;
    path(`M${point(hx - (i % 3 ? 3 : 6), y)}h${i % 3 ? 6 : 12}`, 'tick');
    const x = cx - unit * .44 + unit * .88 * i / 12;
    path(`M${point(x, gy - 4)}v8`, 'tick');
  }

  // The branch is a stable element study that begins at the subject's head line.
  const branch = (x: number, y: number, length: number, direction: number, depth: number): void => {
    const spread = plate.element === 'TERRA' ? .72 : plate.element === 'AQUES' ? .42 : .52;
    const nx = x + Math.cos(direction) * length, ny = y + Math.sin(direction) * length;
    const mx = (x + nx) / 2, my = (y + ny) / 2;
    const bend = plate.element === 'AQUES' || plate.element === 'AURA' ? unit * .018 : 0;
    const d = bend ? `M${point(x, y)}Q${point(mx + bend, my)} ${point(nx, ny)}` : `M${point(x, y)}L${point(mx, my)}L${point(nx, ny)}`;
    path(d, 'branch', depth === 4 ? .9 : .6);
    if (depth === 0) return;
    const scale = plate.element === 'IGNIS' ? .58 : .62;
    branch(nx, ny, length * scale, direction - spread, depth - 1);
    branch(nx, ny, length * scale, direction + spread, depth - 1);
  };
  branch(hx + unit * .17, hy + unit * .46, unit * .14, plate.element === 'AURA' ? -1.03 : -1.6, 4);

  // Small registration diamonds sit on the head and ground measurements in paired order.
  for (let i = 0; i < 9; i++) {
    const x = bounds.x + bounds.width * (.08 + i * .105);
    polygon(x, hy - unit * .06, unit * .012, 4, Math.PI / 4, 'fragment');
    polygon(x, gy + unit * .06, unit * .012, 4, Math.PI / 4, 'fragment');
  }

  // The solid disc marks the head point, matching the poster's focal registration mark.
  const discRadius = Math.max(8, unit * .045);
  out.push(`<circle class="loader-diagram-disc" cx="${n(hx + unit * .105)}" cy="${n(Math.max(discRadius, hy - unit * .04))}" r="${n(discRadius)}"/>`);
  out.push(`<g class="loader-diagram-labels"><text x="${n(cx - unit * .43)}" y="${n(cy - unit * .23)}">${plate.element} / ${plate.number}</text><text x="${n(cx + unit * .29)}" y="${n(gy - unit * .12)}">${plate.head.map(v => v.toFixed(2)).join(' : ')}</text><text x="${n(cx + unit * .28)}" y="${n(gy + unit * .06)}">Ø ${String(Math.round(unit)).padStart(3, '0')}</text></g>`);
  return out.join('');
}
