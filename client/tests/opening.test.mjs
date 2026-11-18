import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAge, parseBirthDate, performDrawingRoll } from '../src/opening.js';

test('calculateAge determines age accurately without date leakage', () => {
  const today = new Date('2026-10-29T12:00:00Z');

  // Born yesterday 13 years ago -> 13
  assert.equal(calculateAge('2013-10-28', today), 13);
  // Born today 13 years ago -> 13
  assert.equal(calculateAge('2013-10-29', today), 13);
  // Born tomorrow 13 years ago -> 12 (underage)
  assert.equal(calculateAge('2013-10-30', today), 12);
  // Invalid string
  assert.equal(calculateAge('invalid-date', today), -1);
});

test('performDrawingRoll distributes between Shaper (85%) and Hush (15%)', () => {
  const counts = { Hush: 0, Shaper: 0, IGNIS: 0, AQUES: 0, TERRA: 0, AURA: 0 };
  const total = 5000;

  for (let i = 0; i < total; i++) {
    const res = performDrawingRoll();
    if (res.role === 'Hush') {
      counts.Hush++;
      assert.ok(['IGNIS', 'AQUES', 'TERRA', 'AURA'].includes(res.element), 'a Hush draws a nation');
    } else {
      counts.Shaper++;
      assert.ok(res.element);
      counts[res.element]++;
    }
  }

  const hushRate = counts.Hush / total;
  const shaperRate = counts.Shaper / total;

  // Expected 15% Hush (tolerance 11% - 19%)
  assert.ok(hushRate >= 0.11 && hushRate <= 0.19, `Hush rate unexpected: ${hushRate}`);
  assert.ok(shaperRate >= 0.81 && shaperRate <= 0.89, `Shaper rate unexpected: ${shaperRate}`);

  // All 4 elements represented
  assert.ok(counts.IGNIS > 0);
  assert.ok(counts.AQUES > 0);
  assert.ok(counts.TERRA > 0);
  assert.ok(counts.AURA > 0);
});

test('parseBirthDate accepts real past dates and names the field that is wrong', () => {
  const today = new Date(2026, 10, 18);
  assert.deepEqual(parseBirthDate('7', '3', '1999', today), { ok: true, iso: '1999-03-07' });
  assert.equal(parseBirthDate('31', '2', '2000', today).field, 'day');
  assert.equal(parseBirthDate('29', '2', '2000', today).ok, true);
  assert.equal(parseBirthDate('1', '', '2000', today).field, 'month');
  assert.equal(parseBirthDate('1', '1', '99', today).field, 'year');
  assert.equal(parseBirthDate('1', '12', '2026', today).field, 'year');
  assert.equal(calculateAge(parseBirthDate('18', '11', '2013', today).iso, today), 13);
  assert.equal(calculateAge(parseBirthDate('19', '11', '2013', today).iso, today), 12);
});
