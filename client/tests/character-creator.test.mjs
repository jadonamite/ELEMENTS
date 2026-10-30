import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BODY_PRESET_OPTIONS,
  getDefaultCharacterConfig,
  HAIR_COLOR_PRESETS,
  HAIR_STYLE_OPTIONS,
  rollRandomCharacter,
  sanitizeCharacterConfig,
  saveStoredCharacter,
  SKIN_TONE_PRESETS,
  STORAGE_CHARACTER_KEY,
} from '../src/creator/creator-types.js';

test('SKIN_TONE_PRESETS provides at least 10 universal human skin tones', () => {
  assert.ok(SKIN_TONE_PRESETS.length >= 10, 'Must have at least 10 skin tone presets');
  for (const preset of SKIN_TONE_PRESETS) {
    assert.ok(preset.id, 'Preset must have an id');
    assert.ok(preset.name, 'Preset must have a display name');
    assert.match(preset.hex, /^#[0-9a-fA-F]{6}$/, 'Preset hex must be a valid 6-char hex color');
    assert.equal(typeof preset.color, 'number');
  }
});

test('BODY_PRESET_OPTIONS provides 3 to 4 stable proportional presets', () => {
  assert.ok(
    BODY_PRESET_OPTIONS.length >= 3 && BODY_PRESET_OPTIONS.length <= 4,
    'Must provide 3 to 4 body presets'
  );
  const ids = BODY_PRESET_OPTIONS.map(b => b.id);
  assert.ok(ids.includes('lean'));
  assert.ok(ids.includes('average'));
  assert.ok(ids.includes('broad'));
  for (const preset of BODY_PRESET_OPTIONS) {
    assert.equal(preset.scale.length, 3);
    for (const axis of preset.scale) {
      assert.ok(axis >= 0.85 && axis <= 1.25, 'Scale axes must remain within safe physiological ranges');
    }
  }
});

test('HAIR_STYLE_OPTIONS and HAIR_COLOR_PRESETS offer valid options for both sexes', () => {
  const femaleHairs = HAIR_STYLE_OPTIONS.filter(h => h.allowedSex.includes('female'));
  const maleHairs = HAIR_STYLE_OPTIONS.filter(h => h.allowedSex.includes('male'));
  assert.ok(femaleHairs.length >= 4, 'Female must have at least 4 hair choices');
  assert.ok(maleHairs.length >= 4, 'Male must have at least 4 hair choices');
  assert.ok(HAIR_COLOR_PRESETS.length >= 8, 'Must have at least 8 hair color options');
});

test('sanitizeCharacterConfig and rollRandomCharacter produce valid non-leaking configurations', () => {
  // Test fallback on corrupt/foreign input
  const sanitized = sanitizeCharacterConfig({
    sex: 'invalid',
    skinToneId: 'alien_green',
    birthDate: '1990-01-01',
    realName: 'Private Info',
  });
  assert.equal(sanitized.sex, 'female');
  assert.equal(sanitized.skinToneId, 'bronze');
  assert.equal(sanitized.birthDate, undefined);
  assert.equal(sanitized.realName, undefined);

  // Test random rolls
  for (let i = 0; i < 50; i++) {
    const rolled = rollRandomCharacter();
    assert.ok(rolled.sex === 'male' || rolled.sex === 'female');
    assert.ok(SKIN_TONE_PRESETS.some(p => p.id === rolled.skinToneId));
    assert.ok(HAIR_STYLE_OPTIONS.some(h => h.id === rolled.hairStyleId));
    assert.ok(HAIR_COLOR_PRESETS.some(c => c.id === rolled.hairColorId));
    assert.ok(BODY_PRESET_OPTIONS.some(b => b.id === rolled.bodyPreset));
  }
});

test('saveStoredCharacter excludes any personal data or birth dates', () => {
  const fakeStorage = {};
  const origStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => fakeStorage[k] ?? null,
    setItem: (k, v) => { fakeStorage[k] = v; },
    removeItem: (k) => { delete fakeStorage[k]; },
    clear: () => { Object.keys(fakeStorage).forEach(k => delete fakeStorage[k]); },
    length: 0,
    key: () => null,
  };

  try {
    const config = {
      ...getDefaultCharacterConfig('male'),
      birthDate: '2005-04-12',
      email: 'player@example.com',
    };
    saveStoredCharacter(config);

    const raw = fakeStorage[STORAGE_CHARACTER_KEY];
    assert.ok(raw, 'Saved character must exist in localStorage');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.sex, 'male');
    assert.equal(parsed.birthDate, undefined);
    assert.equal(parsed.email, undefined);
  } finally {
    globalThis.localStorage = origStorage;
  }
});

test('creator male and female GLBs share identical 65-bone Quaternius Armature with hero.glb', async () => {
  function readGlbJson(buffer) {
    const jsonLength = buffer.readUInt32LE(12);
    return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  }

  const heroBuffer = await readFile(new URL('../public/assets/characters/hero.glb', import.meta.url));
  const femaleBuffer = await readFile(new URL('../public/assets/characters/creator/female.glb', import.meta.url));
  const maleBuffer = await readFile(new URL('../public/assets/characters/creator/male.glb', import.meta.url));

  const heroGltf = readGlbJson(heroBuffer);
  const femaleGltf = readGlbJson(femaleBuffer);
  const maleGltf = readGlbJson(maleBuffer);

  const heroJointNames = heroGltf.skins[0].joints.map((idx) => heroGltf.nodes[idx].name);
  const femaleJointNames = femaleGltf.skins[0].joints.map((idx) => femaleGltf.nodes[idx].name);
  const maleJointNames = maleGltf.skins[0].joints.map((idx) => maleGltf.nodes[idx].name);

  assert.equal(heroJointNames.length, 65, 'Hero skeleton must have 65 joints');
  assert.equal(femaleJointNames.length, 65, 'Female skeleton must have 65 joints');
  assert.equal(maleJointNames.length, 65, 'Male skeleton must have 65 joints');

  for (let i = 0; i < 65; i++) {
    assert.equal(
      femaleJointNames[i],
      heroJointNames[i],
      `Female joint mismatch at index ${i}: ${femaleJointNames[i]} vs ${heroJointNames[i]}`
    );
    assert.equal(
      maleJointNames[i],
      heroJointNames[i],
      `Male joint mismatch at index ${i}: ${maleJointNames[i]} vs ${heroJointNames[i]}`
    );
  }

  // Key bones check
  const requiredBones = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'hand_r', 'hand_l', 'foot_r', 'foot_l', 'Head', 'neck_01'];
  for (const b of requiredBones) {
    assert.ok(femaleJointNames.includes(b), `Female missing bone ${b}`);
    assert.ok(maleJointNames.includes(b), `Male missing bone ${b}`);
  }
});
