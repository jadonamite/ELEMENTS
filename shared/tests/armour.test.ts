import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  armourCatalogue,
  armourOf,
  armourPiece,
  NO_ARMOUR,
  outfitOf,
  rollArmourDrop,
  validateArmour,
  villainDrop,
  itemsFromLoot,
  SINDR_MERCHANTS,
} from '../src/index.js';

const balance = JSON.parse(await readFile(new URL('../balance.json', import.meta.url), 'utf8'));
const catalogue = armourCatalogue(balance.economy.armour);

test('Armour data in balance.json is valid and the IGNIS Shaper set is the first piece', () => {
  assert.deepEqual(validateArmour(balance.economy.armour), []);
  const piece = armourPiece(catalogue, 'armour_shaper_ignis');
  assert.ok(piece);
  assert.equal(piece.outfit, 'shaper_ignis');
  assert.equal(piece.nation, 'IGNIS');
  assert.equal(piece.set, 'shaper');
  assert.ok(piece.armour > 0);
  assert.ok(piece.dropChance > 0 && piece.dropChance <= 1);
  assert.equal(catalogue.defaultOutfit, 'rags');
});

test('Armour validation names every broken field', () => {
  const broken = {
    defaultOutfit: 'Rags!',
    pieces: {
      shield: { name: '', outfit: '', armour: -1, nation: 'MARS', set: '', dropChance: 2 },
    },
  };
  const errors = validateArmour(broken).join('\n');
  assert.match(errors, /defaultOutfit/);
  assert.match(errors, /bad piece id shield/);
  assert.match(errors, /no name/);
  assert.match(errors, /no outfit/);
  assert.match(errors, /armour is not a number/);
  assert.match(errors, /no nation/);
  assert.match(errors, /no set/);
  assert.match(errors, /dropChance/);
  assert.deepEqual(validateArmour(null), ['armour: not an object']);
  assert.throws(() => armourCatalogue(broken), RangeError);
});

test('Nothing worn means rags and no armour; an unknown item is treated as nothing', () => {
  assert.equal(outfitOf(catalogue, null), 'rags');
  assert.equal(outfitOf(catalogue, 'material_linen'), 'rags');
  assert.equal(armourOf(catalogue, null), 0);
  assert.equal(armourOf(catalogue, 'material_linen'), 0);
  assert.equal(outfitOf(catalogue, 'armour_shaper_ignis'), 'shaper_ignis');
  assert.equal(armourOf(catalogue, 'armour_shaper_ignis'), 40);
  assert.equal(outfitOf(NO_ARMOUR, 'armour_shaper_ignis'), 'rags');
});

test('An armed foe carries at most one piece, only as often as its dropChance', () => {
  const piece = catalogue.pieces['armour_shaper_ignis']!;
  assert.deepEqual(rollArmourDrop(catalogue, "IGNIS", () => 0), { armour_shaper_ignis: 1 });
  assert.deepEqual(rollArmourDrop(catalogue, "IGNIS", () => piece.dropChance + 0.01), {});

  let drops = 0;
  const rolls = 20_000;
  let seed = 7;
  const rng = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < rolls; i++) if (Object.keys(rollArmourDrop(catalogue, "IGNIS", rng)).length > 0) drops++;
  const rate = drops / rolls;
  assert.ok(Math.abs(rate - piece.dropChance) < 0.01, `drop rate ${rate} is not near ${piece.dropChance}`);
});

test('A foe that carried armour drops it as gear, and claiming it puts the piece in the satchel', () => {
  const contents = villainDrop({ chroma: 20, shards: {}, gear: { armour_shaper_ignis: 1 } });
  assert.deepEqual(contents.gear, { armour_shaper_ignis: 1 });
  const stacks = itemsFromLoot(contents);
  assert.ok(stacks.some((s) => s.itemId === 'armour_shaper_ignis' && s.quantity === 1));
});

test('The Sindr smith stocks the IGNIS Shaper set as a real item, not a generic armour key', () => {
  const smith = SINDR_MERCHANTS.find((m) => m.id === 'sindr_arms');
  assert.ok(smith);
  assert.equal(smith.inventory['armour'], undefined);
  const shelf = smith.inventory['armour_shaper_ignis'];
  assert.ok(shelf);
  assert.ok(shelf.stock > 0 && shelf.maxStock >= shelf.stock);
  assert.ok(shelf.basePrice > 0);
});

test('A foe carries only its own nation\'s armour', () => {
  for (const nation of ['IGNIS', 'AQUES', 'AURA']) {
    const drop = rollArmourDrop(catalogue, nation, () => 0);
    const [id] = Object.keys(drop);
    assert.equal(catalogue.pieces[id!]!.nation, nation);
  }
  assert.deepEqual(rollArmourDrop(catalogue, 'TERRA', () => 0), {}, 'no TERRA piece exists yet');
});

test('Every armour piece draws an outfit the body kit has a model for', async () => {
  const body = await readFile(new URL('../../client/src/body.ts', import.meta.url), 'utf8');
  for (const piece of Object.values(catalogue.pieces)) assert.match(body, new RegExp(`\\b${piece.outfit}: `), `${piece.id} draws ${piece.outfit}`);
});
