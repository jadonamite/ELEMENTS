import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  pickDialogueLine,
  createDialogueMemory,
  type PlayerDialogueContext,
  type SpeakerDialogueContext,
} from '../src/story/dialogue.js';

const dialoguePath = path.resolve(import.meta.dirname, '../../shared/dialogue.json');
const dialogueData = JSON.parse(fs.readFileSync(dialoguePath, 'utf8'));

test('Three NPCs give different, fitting lines to a Lit IGNIS player and to a Dim player', () => {
  const litPlayer: PlayerDialogueContext = {
    name: 'Kaelen',
    isLit: true,
    role: 'Shaper',
    element: 'IGNIS',
    carriedItemsCount: 1,
    redFlags: 0,
    hasBounty: false,
    feelingScore: 50,
  };

  const dimPlayer: PlayerDialogueContext = {
    name: 'Doran',
    isLit: false,
    role: 'Dim',
    element: 'NONE',
    carriedItemsCount: 1,
    redFlags: 0,
    hasBounty: false,
    feelingScore: 50,
  };

  const npcs: SpeakerDialogueContext[] = [
    { id: 'smith_brokk', role: 'smith_sindr' },
    { id: 'trader_surna', role: 'trader_sindr' },
    { id: 'guard_garrick', role: 'guard_sindr' },
  ];

  for (const npc of npcs) {
    const memory = createDialogueMemory();
    const litResult = pickDialogueLine(dialogueData, npc, litPlayer, 'greeting', memory);
    const dimResult = pickDialogueLine(dialogueData, npc, dimPlayer, 'greeting', memory);

    assert.ok(litResult.text.length > 0, `${npc.role} returned empty line for Lit player`);
    assert.ok(dimResult.text.length > 0, `${npc.role} returned empty line for Dim player`);

    // The lines must be different and tailored to player nature
    assert.notEqual(litResult.text, dimResult.text, `${npc.role} gave identical lines to Lit and Dim`);
    assert.equal(litResult.category, 'greeting_lit_ignis', `${npc.role} did not use greeting_lit_ignis`);
    assert.equal(dimResult.category, 'greeting_dim', `${npc.role} did not use greeting_dim`);
  }
});

test('Repeat lines never come back to back for any speaker', () => {
  const player: PlayerDialogueContext = {
    name: 'Ash',
    isLit: true,
    role: 'Shaper',
    element: 'IGNIS',
    carriedItemsCount: 0,
    redFlags: 0,
    hasBounty: false,
    feelingScore: 50,
  };

  const speaker: SpeakerDialogueContext = {
    id: 'smith_test',
    role: 'smith_sindr',
  };

  const memory = createDialogueMemory();
  let previousLine = '';

  for (let i = 0; i < 50; i++) {
    const result = pickDialogueLine(dialogueData, speaker, player, 'greeting', memory);
    if (i > 0) {
      assert.notEqual(
        result.text,
        previousLine,
        `Line repeated back-to-back on iteration ${i}: "${result.text}"`,
      );
    }
    previousLine = result.text;
  }
});

test('Red flags and bounties trigger warnings instead of standard greetings', () => {
  const markedPlayer: PlayerDialogueContext = {
    name: 'Outlaw',
    isLit: true,
    role: 'Shaper',
    element: 'IGNIS',
    carriedItemsCount: 0,
    redFlags: 1,
    hasBounty: false,
    feelingScore: 50,
  };

  const bountyPlayer: PlayerDialogueContext = {
    name: 'Hunted',
    isLit: true,
    role: 'Shaper',
    element: 'IGNIS',
    carriedItemsCount: 0,
    redFlags: 3,
    hasBounty: true,
    feelingScore: 20,
  };

  const guard: SpeakerDialogueContext = { id: 'guard_1', role: 'guard_sindr' };
  const trader: SpeakerDialogueContext = { id: 'trader_1', role: 'trader_sindr' };

  const guardMarked = pickDialogueLine(dialogueData, guard, markedPlayer, 'greeting');
  assert.equal(guardMarked.category, 'red_flag');

  const traderBounty = pickDialogueLine(dialogueData, trader, bountyPlayer, 'greeting');
  assert.equal(traderBounty.category, 'bounty');
});

test('Heavy pack triggers satchel warning from observant merchants', () => {
  const heavyPlayer: PlayerDialogueContext = {
    name: 'PackMule',
    isLit: true,
    role: 'Shaper',
    element: 'IGNIS',
    carriedItemsCount: 8,
    redFlags: 0,
    hasBounty: false,
    feelingScore: 50,
  };

  const trader: SpeakerDialogueContext = { id: 'trader_pack', role: 'trader_sindr' };
  const res = pickDialogueLine(dialogueData, trader, heavyPlayer, 'greeting');
  assert.equal(res.category, 'heavy_pack');
});
