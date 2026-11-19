import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import balance from '../balance.json' with { type: 'json' };
import { dialogueRules } from '../src/story/dialogue.js';
import { SpeechMemory } from '../src/story/speech.js';
import { lineKey, voiceId } from '../src/story/voice.js';
import { getNationIntroConfig } from '../src/story/nation-intro.js';
import { acceptSituation, refusalSituation, type ClimbRefusal } from '../src/growth/climb.js';

const root = path.resolve(import.meta.dirname, '../..');
const table = JSON.parse(fs.readFileSync(path.join(root, 'shared/dialogue.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'client/public/assets/voice/manifest.json'), 'utf8')) as Record<string, Record<string, unknown>>;
const rules = dialogueRules(table);
const tierNames = balance.combat.tiers.names;
const REASONS: ClimbRefusal[] = ['no_master', 'top', 'not_qualified', 'short', 'no_trials'];

const say = (concept: string) => rules.speak({ concept, speakerId: 'master_ignis', facts: { who: 'master_ignis' } }, new SpeechMemory());

test('Brandr refuses with the line for the reason the server gave, at conversation priority', () => {
  const cases: Array<[ClimbRefusal, boolean, string]> = [
    ['not_qualified', true, 'refuse_not_qualified'], ['short', true, 'refuse_short'], ['no_trials', true, 'refuse_no_trials'],
    ['top', true, 'refuse_top'], ['no_master', false, 'refuse_hush'], ['no_master', true, 'refuse_foreign'],
  ];
  for (const [reason, hasMaster, situation] of cases) {
    assert.equal(refusalSituation(reason, hasMaster), situation);
    const said = say(situation);
    assert.equal(said?.rule.id, `master_ignis/${situation}`, `${reason} has no line`);
    assert.equal(said?.tier, 'conversation');
    assert.ok((table.master_ignis[situation] as string[]).includes(said!.line));
  }
  for (const reason of REASONS) for (const hasMaster of [true, false]) assert.ok(table.master_ignis[refusalSituation(reason, hasMaster)], reason);
});

test('Brandr takes a fighter on naming the tier they fight for, for every tier from Ictus to Primus', () => {
  for (const name of tierNames.slice(1)) {
    const situation = acceptSituation(name);
    const said = say(situation);
    assert.equal(said?.rule.id, `master_ignis/${situation}`);
    assert.equal(said?.tier, 'conversation');
    for (const line of table.master_ignis[situation] as string[]) assert.ok(line.includes(name), `"${line}" does not name ${name}`);
  }
});

test('Brandr names only real tiers and none of the old ranks', () => {
  const lines = Object.entries(table.master_ignis).filter(([k, v]) => !k.startsWith('_') && Array.isArray(v)).flatMap(([, v]) => v as string[]);
  for (const line of lines) assert.doesNotMatch(line, /\b(novice|adepts?|advanced techniques|crimson quarter|ignis masters)\b/i, line);
});

test('Every line Brandr can say has a recording in his own voice', () => {
  const { id, sex } = getNationIntroConfig('IGNIS').master;
  for (const [situation, lines] of Object.entries(table[id])) {
    if (situation.startsWith('_') || !Array.isArray(lines)) continue;
    for (const line of lines as string[]) assert.ok(manifest[voiceId(id, sex)]?.[lineKey(line)], `${id} ${sex} has no recording of "${line}" (${situation})`);
  }
});
