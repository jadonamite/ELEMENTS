import test from 'node:test';
import assert from 'node:assert/strict';
import { loaderDiagram, diagramStrokeProgress } from '../src/ui/loader-diagram.ts';
import { LOADER_PICTURES, loaderPictureDetails } from '../src/ui/loader-pictures.ts';

test('all plates have valid anchors and a deterministic, element-specific page diagram', () => {
  for (const id of LOADER_PICTURES) {
    const plate = loaderPictureDetails(`${id}.jpg`);
    assert.ok(plate.head.every(v => v > 0 && v < 1));
    assert.ok(plate.ground.every(v => v > 0 && v < 1));
    const bounds = { x: 0, y: 140, width: 1280, height: 620 };
    const render = seed => loaderDiagram(plate, 1280, 952, seed, bounds);
    const svg = render(17);
    assert.equal(svg, render(17));
    assert.notEqual(svg, render(18));
    assert.doesNotMatch(svg, /NaN|Infinity|filter|<svg/);
    const count = kind => (svg.match(new RegExp(`loader-diagram-${kind}"`, 'g')) ?? []).length;
    for (const [kind, n] of [['triangle', 4], ['diagonal', 3], ['rectangle', 2], ['circle', 3], ['ellipse', 2], ['parabola', 2], ['fragment', 18], ['branch', 31]]) assert.equal(count(kind), n);
    assert.match(svg, /loader-diagram-disc/);
    assert.match(svg, new RegExp(plate.element));
    // Ground ellipse follows the image's contain transform inside the plate.
    const scale = Math.min(bounds.width / 667, bounds.height / 1000);
    const groundY = bounds.y + (bounds.height - 1000 * scale) / 2 + plate.ground[1] * 1000 * scale;
    assert.ok(svg.includes(groundY.toFixed(2)));
  }
});

test('diagram drawing follows loading work monotonically and is complete in reduced motion', () => {
  for (let line = 0; line < 120; line++) {
    let previous = 0;
    for (let p = 0; p <= 100; p++) {
      const value = diagramStrokeProgress(p / 100, line, false);
      assert.ok(value >= previous && value <= 1);
      previous = value;
    }
    assert.equal(previous, 1);
    assert.equal(diagramStrokeProgress(0, line, false), 0);
    assert.equal(diagramStrokeProgress(0, line, true), 1);
  }
});
