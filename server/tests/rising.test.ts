import test from 'node:test';
import assert from 'node:assert/strict';
import { roll, canAwaken, type RisingResult } from '@elements/shared';

// Deterministic Mulberry32 PRNG for reproducible tests
function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('Rising distribution: 100,000 rolls are 85% Lit (+/-0.5%) and 21.25% each nation (+/-0.5%)', () => {
  const rand = createMulberry32(1337);
  const total = 100000;
  const counts: Record<string, number> = {
    Hush: 0,
    IGNIS: 0,
    AQUES: 0,
    TERRA: 0,
    AURA: 0,
  };

  for (let i = 0; i < total; i++) {
    const res: RisingResult = roll(rand);
    if (res.role === 'Hush') {
      counts.Hush++;
    } else {
      counts[res.element]++;
    }
  }

  const litCount = counts.IGNIS + counts.AQUES + counts.TERRA + counts.AURA;
  const litRate = litCount / total;
  const hushRate = counts.Hush / total;

  // Lit is 85% +/- 0.5% (84.5% to 85.5%)
  assert.ok(
    litRate >= 0.845 && litRate <= 0.855,
    `Lit rate ${litRate * 100}% outside expected 84.5% - 85.5% range`,
  );

  // Hush is 15% +/- 0.5% (14.5% to 15.5%)
  assert.ok(
    hushRate >= 0.145 && hushRate <= 0.155,
    `Hush rate ${hushRate * 100}% outside expected 14.5% - 15.5% range`,
  );

  // Each nation is 21.25% +/- 0.5% (20.75% to 21.75%)
  for (const nation of ['IGNIS', 'AQUES', 'TERRA', 'AURA'] as const) {
    const rate = counts[nation] / total;
    assert.ok(
      rate >= 0.2075 && rate <= 0.2175,
      `${nation} rate ${rate * 100}% outside expected 20.75% - 21.75% range`,
    );
  }
});

test('Rising Vakna cap: at most 0.5% of world population can awaken', () => {
  // Population of 1,000: 0.5% = 5 players max
  assert.equal(canAwaken(0, 1000), true);
  assert.equal(canAwaken(4, 1000), true); // 5th can awaken (5 / 1000 = 0.005)
  assert.equal(canAwaken(5, 1000), false); // 6th cannot awaken (6 / 1000 = 0.006 > 0.005)

  // Population of 200: 0.5% = 1 player max
  assert.equal(canAwaken(0, 200), true); // 1 / 200 = 0.005
  assert.equal(canAwaken(1, 200), false); // 2 / 200 = 0.01

  // Small population: 100: 0.5% = 0.5, so 1 awakening is 1% > 0.5%
  assert.equal(canAwaken(0, 100), false);

  // Edge cases
  assert.equal(canAwaken(0, 0), false);
  assert.equal(canAwaken(0, -10), false);
  assert.equal(canAwaken(-1, 1000), false);
});
