import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SpeechMemory, SpeechRules, SpeechTraffic, type SpeechRule } from '../src/story/speech.js';
import { createDialogueMemory, pickDialogueLine, rulesFromDialogue, talkFacts, type PlayerDialogueContext } from '../src/story/dialogue.js';

const table = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../dialogue.json'), 'utf8'));
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]!; };

const greet: SpeechRule = { id: 'greet', concept: 'talk', criteria: [{ fact: 'who', value: 'smith' }], lines: ['Hello.'] };
const greetNight: SpeechRule = { id: 'greet_night', concept: 'talk', criteria: [{ fact: 'who', value: 'smith' }, { fact: 'time', value: 'night' }], lines: ['Late, isn\'t it?'] };

test('the rule matching the most criteria wins; a failed criterion rules a rule out', () => {
  const rules = new SpeechRules([greet, greetNight]);
  assert.equal(rules.match({ concept: 'talk', speakerId: 'a', facts: { who: 'smith', time: 'night' } })?.rule.id, 'greet_night');
  assert.equal(rules.match({ concept: 'talk', speakerId: 'a', facts: { who: 'smith', time: 'day' } })?.rule.id, 'greet');
  assert.equal(rules.match({ concept: 'talk', speakerId: 'a', facts: { who: 'guard' } }), null);
  assert.equal(rules.match({ concept: 'fight', speakerId: 'a', facts: { who: 'smith' } }), null);
});

test('weights decide between rules, ties go to the random draw, and a missing fact passes only !=', () => {
  const heavy: SpeechRule = { id: 'heavy', concept: 'talk', criteria: [{ fact: 'bounty', value: true, weight: 5 }], lines: ['x'] };
  const tieA: SpeechRule = { id: 'a', concept: 'talk', criteria: [{ fact: 'who', value: 'smith' }, { fact: 'lit', value: true }], lines: ['x'] };
  const tieB: SpeechRule = { id: 'b', concept: 'talk', criteria: [{ fact: 'who', value: 'smith' }, { fact: 'mood', op: '!=', value: 'angry' }], lines: ['x'] };
  const facts = { who: 'smith', lit: true, bounty: true };
  assert.equal(new SpeechRules([greetNight, heavy, tieA]).match({ concept: 'talk', speakerId: 's', facts })?.rule.id, 'heavy');
  const q = { concept: 'talk', speakerId: 's', facts: { who: 'smith', lit: true } };
  assert.equal(new SpeechRules([tieA, tieB], seq(0)).match(q)?.rule.id, 'a');
  assert.equal(new SpeechRules([tieA, tieB], seq(0.99)).match(q)?.rule.id, 'b');
});

test('remembered facts expire, which gives cooldowns', () => {
  const once: SpeechRule = { id: 'once', concept: 'talk', criteria: [{ fact: 'self.toldStory', op: '!=', value: true, weight: 3 }], lines: ['Let me tell you a story.'], remember: [{ fact: 'toldStory', seconds: 60 }] };
  const rules = new SpeechRules([greet, once]);
  const memory = new SpeechMemory();
  const q = { concept: 'talk', speakerId: 'smith1', facts: { who: 'smith' } };
  assert.equal(rules.speak(q, memory, 0)?.rule.id, 'once');
  assert.equal(rules.speak(q, memory, 30)?.rule.id, 'greet');
  assert.equal(rules.speak({ ...q, speakerId: 'smith2' }, memory, 30)?.rule.id, 'once', 'speaker facts are per speaker');
  assert.equal(rules.speak(q, memory, 61)?.rule.id, 'once', 'after expiry the story comes back');
});

test('world facts are shared by every speaker', () => {
  const alarm: SpeechRule = { id: 'alarm', concept: 'fight', criteria: [{ fact: 'world.alarmRaised', op: '!=', value: true }], lines: ['Guards!'], remember: [{ fact: 'alarmRaised', seconds: 20, scope: 'world' }] };
  const rules = new SpeechRules([alarm]);
  const memory = new SpeechMemory();
  assert.ok(rules.speak({ concept: 'fight', speakerId: 'a', facts: {} }, memory, 0));
  assert.equal(rules.speak({ concept: 'fight', speakerId: 'b', facts: {} }, memory, 5), null);
});

test('a speaker never repeats the last line while the rule has another', () => {
  const rules = new SpeechRules([{ ...greet, lines: ['One.', 'Two.'] }], seq(0));
  const memory = new SpeechMemory();
  const said = Array.from({ length: 6 }, (_, i) => rules.speak({ concept: 'talk', speakerId: 's', facts: { who: 'smith' } }, memory, i)!.line);
  for (let i = 1; i < said.length; i++) assert.notEqual(said[i], said[i - 1]);
});

test('a follow-up goes to the best-matching listener, and stops when its conditions fail', () => {
  const reply: SpeechRule[] = [
    { id: 'guard_reply', concept: 'answer_thief', criteria: [{ fact: 'who', value: 'guard' }, { fact: 'danger', value: false }], lines: ['I saw it too.'] },
    { id: 'any_reply', concept: 'answer_thief', criteria: [{ fact: 'danger', value: false }], lines: ['Shame.'] },
  ];
  const rules = new SpeechRules(reply);
  const calm = [{ speakerId: 'porter', facts: { who: 'porter', danger: false } }, { speakerId: 'guard', facts: { who: 'guard', danger: false } }];
  assert.equal(rules.answer('answer_thief', calm)?.speakerId, 'guard');
  const fight = calm.map(l => ({ ...l, facts: { ...l.facts, danger: true } }));
  assert.equal(rules.answer('answer_thief', fight), null);
});

test('traffic: one conversation, capped and spaced chatter, alerts cut reactions but not each other', () => {
  const t = new SpeechTraffic({ maxAmbient: 2, ambientGapSeconds: 3, maxAlerts: 2 });
  assert.deepEqual(t.request('smith', 'conversation', 4, 0), []);
  assert.deepEqual(t.request('inn', 'conversation', 4, 1), ['smith'], 'a new conversation replaces the old');
  assert.deepEqual(t.request('a', 'ambient', 10, 0), []);
  assert.equal(t.request('b', 'ambient', 5, 2), null, 'too soon after the last chatter');
  assert.deepEqual(t.request('b', 'ambient', 5, 3), []);
  assert.equal(t.request('c', 'ambient', 5, 6.5), null, 'two chatter voices already');
  assert.deepEqual(t.request('c', 'ambient', 5, 8), [], 'room once one ends');
  assert.deepEqual(t.request('w1', 'reaction', 3, 10), []);
  assert.deepEqual(t.request('w2', 'reaction', 3, 10), []);
  assert.equal(t.request('w3', 'reaction', 3, 10), null);
  assert.deepEqual(t.request('g1', 'alert', 3, 10), ['w1']);
  assert.deepEqual(t.request('g2', 'alert', 3, 10), ['w2']);
  assert.equal(t.request('g3', 'alert', 3, 10), null);
  t.end('g1');
  assert.ok(!t.speaking(10).includes('g1'));
});

const shaper: PlayerDialogueContext = { name: 'Traveler', isLit: true, role: 'Shaper', element: 'IGNIS' };

test('dialogue.json becomes rules: every Sindr talk situation is reachable', () => {
  const rules = rulesFromDialogue(table);
  assert.ok(rules.find(r => r.id === 'merchant_ignis/sale_made')?.concept === 'sale_made');
  const cases: [string, Partial<PlayerDialogueContext>, string?, ('day' | 'dusk' | 'night')?][] = [
    ['greeting_lit_ignis', {}], ['greeting_dim', { isLit: false, role: 'Hush', element: 'NONE' }],
    ['greeting_outsider_lit', { element: 'AQUES' }], ['heavy_pack', { carriedItemsCount: 5 }],
    ['red_flag', { redFlags: 1 }], ['bounty', { redFlags: 3 }], ['dusk', {}, undefined, 'dusk'], ['night', {}, undefined, 'night'],
  ];
  for (const [want, p, , time] of cases) {
    const got = pickDialogueLine(table, { id: 'g', role: 'guard_sindr', ...(time ? { timeOfDay: time } : {}) }, { ...shaper, ...p });
    assert.equal(got.category, want);
  }
  const inn = { id: 'inn', role: 'innkeeper_sindr' };
  assert.equal(pickDialogueLine(table, inn, shaper, 'lead_inquiry').category, 'sell_lead');
  assert.equal(pickDialogueLine(table, inn, shaper, 'rumour_allborn').category, 'rumour_allborn');
  assert.equal(pickDialogueLine(table, { id: 'w', role: 'worshipper_sindr' }, shaper, 'rumour_allborn').category, 'allborn_hint');
  assert.equal(pickDialogueLine(table, inn, { ...shaper, hasBounty: true }, 'rumour_allborn').category, 'bounty', 'a bounty outranks the question');
});

test('talk facts read the player as lit only when a Shaper, and a bounty from three red flags', () => {
  const f = talkFacts({ id: 'x', role: 'smith_sindr' }, { ...shaper, role: 'Hush', redFlags: 3 });
  assert.equal(f['player.lit'], false);
  assert.equal(f['player.bounty'], true);
  assert.equal(pickDialogueLine(table, { id: 'x', role: 'nobody' }, shaper, 'greeting', createDialogueMemory()).category, 'fallback');
});
