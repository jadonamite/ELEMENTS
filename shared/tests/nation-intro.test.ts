import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getNationIntroConfig, NATION_INTROS } from '../src/story/nation-intro.js';
import { lineKey, voiceId } from '../src/story/voice.js';

test('Nation intro configurations: all four nations defined and complete', () => {
  const nations = ['IGNIS', 'AQUES', 'TERRA', 'AURA'] as const;

  for (const nation of nations) {
    const config = NATION_INTROS[nation];
    assert.ok(config, `Nation ${nation} must have intro configuration`);
    assert.equal(config.nation, nation);
    assert.ok(config.zoneName.length > 0, `${nation} must have a zone name`);
    assert.ok(config.arrivalLandmark.length > 0, `${nation} must have an arrival landmark`);

    // Master configuration
    assert.ok(config.master.id.length > 0);
    assert.ok(config.master.name.length > 0);
    assert.ok(config.master.title.length > 0);
    assert.ok(config.master.greetingBark.length > 0);
    assert.ok(config.master.look.length > 0);

    // Starter weapon
    if (nation === 'AURA') {
      assert.equal(config.starterWeapon, 'staff');
    } else {
      assert.equal(config.starterWeapon, 'sword');
    }

    // Dialogue prompts
    assert.ok(config.dialogue.greeting.length > 0);
    assert.ok(config.dialogue.loreTeaser.length > 0);
    assert.ok(config.dialogue.stepFooting.length > 0);
    assert.ok(config.dialogue.stepSprintJump.length > 0);
    assert.ok(config.dialogue.weaponHandoff.length > 0);
    assert.ok(config.dialogue.stepAttacks.length > 0);
    assert.ok(config.dialogue.stepDefense.length > 0);
    assert.ok(config.dialogue.shaperRole.length > 0);
    assert.ok(config.dialogue.hushRole.length > 0);
    assert.ok(config.dialogue.missionBrief.length > 0);

    // First mission gateway
    assert.ok(config.firstMission.id.length > 0);
    assert.ok(config.firstMission.title.length > 0);
    assert.ok(config.firstMission.objective.length > 0);
    assert.ok(config.firstMission.target.radius > 0);
    assert.ok(typeof config.firstMission.target.x === 'number');
    assert.ok(typeof config.firstMission.target.z === 'number');
  }
});

test('getNationIntroConfig: resolves case-insensitively and falls back to IGNIS', () => {
  const ignis = getNationIntroConfig('ignis');
  assert.equal(ignis.nation, 'IGNIS');

  const aura = getNationIntroConfig('aura');
  assert.equal(aura.nation, 'AURA');
  assert.equal(aura.starterWeapon, 'staff');

  const fallback = getNationIntroConfig('UNKNOWN_NATION');
  assert.equal(fallback.nation, 'IGNIS');
});

test('Every intro line is recorded in its master\'s own voice, the sex their body is built as', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../client/public/assets/voice/manifest.json', import.meta.url), 'utf8')) as Record<string, Record<string, number>>;
  for (const config of Object.values(NATION_INTROS)) {
    const voice = voiceId(config.master.id, config.master.sex);
    for (const [step, line] of Object.entries(config.dialogue)) {
      assert.ok(manifest[voice]?.[lineKey(line)], `${voice} has no recording of ${step}: ${line}`);
    }
  }
});
