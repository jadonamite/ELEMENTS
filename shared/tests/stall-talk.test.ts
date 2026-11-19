import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dialogueRules, talkFacts, type PlayerDialogueContext } from '../src/story/dialogue.js';
import { SpeechMemory } from '../src/story/speech.js';
import { merchantRole, stallFacts } from '../src/story/stall-talk.js';
import { lineKey, voiceId } from '../src/story/voice.js';

const root = path.resolve(import.meta.dirname, '../..');
const table = JSON.parse(fs.readFileSync(path.join(root, 'shared/dialogue.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'client/public/assets/voice/manifest.json'), 'utf8')) as Record<string, Record<string, unknown>>;
const rules = dialogueRules(table);

const local: PlayerDialogueContext = { name: 'K', isLit: true, role: 'Shaper', element: 'IGNIS' };
const outsider: PlayerDialogueContext = { name: 'K', isLit: true, role: 'Shaper', element: 'AQUES' };
const hush: PlayerDialogueContext = { name: 'K', isLit: false, role: 'Hush', element: 'IGNIS' };

const stall = (stock: number[], status = 'open') => ({ nation: 'IGNIS', status, inventory: Object.fromEntries(stock.map((s, i) => [`shelf${i}`, { stock: s }])) });
const quote = (demand: number, colour = 0) => ({ steps: [{ rule: 'scarcity', effect: 1 }, { rule: 'recent_demand', effect: demand }, { rule: 'color_balance', effect: colour }, { rule: 'outsider', effect: 0.2 }] });

function situation(player: PlayerDialogueContext, facts: Record<string, string | number | boolean>, concept = 'talk'): string {
  const role = merchantRole('IGNIS');
  const said = rules.speak({ concept, speakerId: 'keeper', facts: { ...talkFacts({ id: 'keeper', role }, player), ...facts } }, new SpeechMemory());
  assert.ok(said, `no line for ${concept}`);
  return said.rule.id;
}

test('Stall facts: a bare shelf, and prices moved by trade, not by the stall level or the outsider rate', () => {
  assert.deepEqual(stallFacts(stall([100, 50]), [quote(0), quote(0)], 0.1), { 'stall.short': false, 'stall.emptyShelf': false, 'stall.prices': 'steady' });
  assert.equal(stallFacts(stall([100, 50], 'broke_buying_paused'), [quote(0), quote(0)], 0.1)['stall.short'], true);
  assert.equal(stallFacts(stall([0, 50]), [null, quote(0)], 0.1)['stall.emptyShelf'], true);
  assert.equal(stallFacts(stall([100, 50]), [quote(0.3), quote(0.1)], 0.1)['stall.prices'], 'rising');
  assert.equal(stallFacts(stall([100, 50]), [quote(-0.2, -0.1), quote(0)], 0.1)['stall.prices'], 'falling');
  // A bare shelf's quote does not count toward the price.
  assert.equal(stallFacts(stall([0, 50]), [quote(2), quote(0)], 0.1)['stall.prices'], 'steady');
});

test('Opening a stall: the keeper greets a local or an outsider, and a bare shelf beats moving prices', () => {
  const steady = { 'stall.emptyShelf': false, 'stall.prices': 'steady' };
  assert.equal(situation(local, steady), 'merchant_ignis/greeting_local');
  assert.equal(situation(hush, steady), 'merchant_ignis/greeting_local');
  assert.equal(situation(outsider, steady), 'merchant_ignis/greeting_outsider');
  assert.equal(situation(outsider, { ...steady, 'stall.prices': 'rising' }), 'merchant_ignis/prices_rising');
  assert.equal(situation(local, { ...steady, 'stall.prices': 'falling' }), 'merchant_ignis/prices_falling');
  assert.equal(situation(local, { 'stall.emptyShelf': true, 'stall.prices': 'rising' }), 'merchant_ignis/out_of_stock');
  // A purse too short to buy from the player is said first: it changes what the player can do here.
  assert.equal(situation(local, { 'stall.short': true, 'stall.emptyShelf': true, 'stall.prices': 'rising' }), 'merchant_ignis/going_broke');
});

test('A sale either way is part of the exchange at the counter, said at conversation priority', () => {
  for (const concept of ['sale_made', 'bought_from_player']) {
    const said = rules.speak({ concept, speakerId: 'keeper', facts: { who: 'merchant_ignis' } });
    assert.equal(said?.rule.id, `merchant_ignis/${concept}`);
    assert.equal(said?.tier, 'conversation');
  }
});

test('A Sentry stops a flagged player at alert priority and closes the matter', () => {
  for (const concept of ['red_flag_fined', 'red_flag_fine_paid']) {
    const said = rules.speak({ concept, speakerId: 'sentry_1', facts: { who: 'sentry' } });
    assert.equal(said?.tier, 'alert');
  }
});

test('Every line a Sentry says has a recording in both voices', () => {
  for (const situationName of ['greeting_local', 'red_flag_fined', 'red_flag_fine_paid']) {
    for (const line of table.sentry[situationName] as string[]) {
      for (const sex of ['male', 'female'] as const) assert.ok(manifest[voiceId('sentry', sex)]?.[lineKey(line)], `sentry ${sex} has no recording of "${line}"`);
    }
  }
});

test('Every line a stall keeper can say has a recording in both voices', () => {
  const role = merchantRole('IGNIS');
  for (const situationName of ['greeting_local', 'greeting_outsider', 'prices_rising', 'prices_falling', 'out_of_stock', 'going_broke', 'sale_made', 'bought_from_player']) {
    for (const line of table[role][situationName] as string[]) {
      for (const sex of ['male', 'female'] as const) {
        assert.ok(manifest[voiceId(role, sex)]?.[lineKey(line)], `${role} ${sex} has no recording of "${line}"`);
      }
    }
  }
});
