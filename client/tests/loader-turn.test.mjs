import test from 'node:test';
import assert from 'node:assert/strict';
import { elementGlyph, elementTurnFrame, elementInkFrame, ELEMENT_TURN_MS, ELEMENT_HOLD_MS } from '../src/ui/loader-turn.ts';
const points = frame => {
  const values = frame.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const a = frame.angle * Math.PI / 180;
  return Array.from({length: values.length / 2}, (_, i) => {
    const x = values[2 * i] - 32, y = values[2 * i + 1] - 32;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  });
};

test('all four transitions preserve a continuous contour across the hold and cycle boundary', () => {
  assert.equal(new Set(Array.from({length:4}, (_,i)=>elementGlyph(i).d)).size, 4);
  for (let i = 0; i < 4; i++) {
    const start = i * ELEMENT_TURN_MS;
    const held = elementTurnFrame(start + ELEMENT_HOLD_MS);
    assert.deepEqual(held, elementTurnFrame(start));
    const mid = elementTurnFrame(start + ELEMENT_HOLD_MS + 450);
    assert.notEqual(mid.d, held.d);
    assert.equal(mid.angle, 180);
    assert.equal(mid.next.opacity, 0);
    const end = points(elementTurnFrame(start + ELEMENT_TURN_MS - .01));
    const next = points(elementTurnFrame(start + ELEMENT_TURN_MS));
    assert.equal(end.length, 192);
    end.forEach((p,j)=>assert.ok(Math.hypot(p[0]-next[j][0], p[1]-next[j][1]) < .01));
  }
});

test('reduced motion uses a slow opacity blend with no rotation', () => {
  const f = elementTurnFrame(3400, true);
  assert.equal(f.angle, 0);
  assert.equal(f.opacity, .5);
  assert.equal(f.next.opacity, .5);
  assert.equal(f.element, 'IGNIS');
  assert.equal(f.next.element, 'AQUES');
  assert.equal(elementTurnFrame(4200,true).d, elementGlyph(1).d);
});

test('ink level follows progress only and waves stop under reduced motion', () => {
  const levels = [0,.1,.5,.9,1].map(p=>elementInkFrame(p).level);
  assert.deepEqual(levels,[64,57.6,32,6.399999999999999,0]);
  assert.equal(elementInkFrame(.5,10000).level,32);
  assert.notEqual(elementInkFrame(.5,0).d,elementInkFrame(.5,2400).d);
  assert.equal(elementInkFrame(.5,0,true).d,elementInkFrame(.5,2400,true).d);
  for(const p of [NaN, Infinity, -1, 2]) assert.doesNotMatch(elementInkFrame(p).d,/NaN|Infinity/);
  assert.deepEqual(elementTurnFrame(NaN),elementTurnFrame(0));
});
