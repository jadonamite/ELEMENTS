import test from 'node:test';
import assert from 'node:assert/strict';
import balance from '../../shared/balance.json' with { type: 'json' };
import { createCombatRules } from '../../shared/src/combat/index.ts';
import { availableActions, ACTIONS } from '../src/controls/actions.ts';
import { mergeControlProgress, normalizeControlProgress, needsControlLesson } from '../../shared/src/controls/index.ts';
import { actionGlyph, keyGlyph } from '../src/controls/glyphs.ts';

test('Help and touch share the combat rules for every tier, role and gated action', () => {
  const rules = createCombatRules(balance.combat);
  for (let tier = 1; tier <= 7; tier++) for (const hush of [false, true]) {
    const ids = new Set(availableActions(tier, hush).map(a => a.id));
    for (const a of ACTIONS) {
      const expected = (!a.move || rules.tierAllows(a.move, tier)) && !(a.shaper && hush) && !(a.hush && !hush);
      assert.equal(ids.has(a.id), expected, `${tier}:${hush}:${a.id}`);
    }
  }
  assert.ok(!availableActions(1, false).some(a => a.id === 'heavy'));
  assert.ok(!availableActions(4, false).some(a => a.id === 'ultimate'));
  assert.ok(availableActions(5, false).some(a => a.id === 'ultimate'));
  assert.ok(availableActions(1, true).some(a => a.id === 'spark'));
  assert.ok(!availableActions(7, true).some(a => a.id === 'bending'));
  assert.ok(!availableActions(7, false, true).some(a => a.id === 'duel'));
});

test('learning bounds untrusted records and stale devices cannot forget a learned action', () => {
  const dirty = { strike: { uses: 999, shown: -2 }, heavy: { uses: NaN, shown: 2.9 }, unknown: { uses: 1, shown: 1 } };
  assert.deepEqual(normalizeControlProgress(dirty), { strike: { uses: 3, shown: 0 }, heavy: { uses: 0, shown: 2 } });
  const learned = { strike: { uses: 3, shown: 1 } };
  assert.equal(needsControlLesson(learned, 'strike'), false);
  assert.equal(needsControlLesson({ heavy: { uses: 0, shown: 3 } }, 'heavy'), false);
  assert.equal(needsControlLesson({}, 'move'), true);
  const merged = mergeControlProgress(learned, { strike: { uses: 0, shown: 2 }, move: { uses: 2, shown: 1 } });
  assert.deepEqual(merged, { move: { uses: 2, shown: 1 }, strike: { uses: 3, shown: 2 } });
  assert.equal(needsControlLesson(merged, 'strike'), false);
  assert.deepEqual(normalizeControlProgress([]), {});
});

test('all actions have authored device glyphs; arbitrary key text is escaped', () => {
  for (const action of ACTIONS) for (const device of ['desktop', 'touch']) {
    const glyph = actionGlyph(action.id, device);
    assert.match(glyph, /<svg/); assert.match(glyph, /aria-hidden="true"/);
    assert.doesNotMatch(glyph, /<script|onload=|https:/);
  }
  assert.match(keyGlyph('<&'), /&lt;&amp;/);
  assert.match(keyGlyph('mouse-scroll'), /<svg/);
});
