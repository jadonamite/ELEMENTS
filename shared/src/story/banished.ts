import * as fs from 'node:fs';

/**
 * The Edict's banished names (dialogue.json `_meta.banished`). Read from the file on the server; the browser,
 * where node:fs is a stub, falls back to the same list written out.
 */
function loadBanished(): string[] {
  try {
    const raw = fs.readFileSync(new URL('../../dialogue.json', import.meta.url), 'utf-8');
    const list = JSON.parse(raw)?._meta?.banished;
    if (Array.isArray(list) && list.every((w) => typeof w === 'string')) return list;
  } catch {
    // fall through to the written list
  }
  return ['fire', 'fires', 'flame', 'flames', 'fiery', 'water', 'waters', 'earth', 'air', 'wind', 'winds'];
}

export const BANISHED_NAMES: readonly string[] = loadBanished();

// A banished word alone, or with a plain ending (fireball, watery, earthen, windy); hyphens and spacing tricks
// between its letters ("f-i-r-e", "w a t e r") count too. Words that merely contain one (affair, window) do not.
const stems = [...new Set(BANISHED_NAMES.map((w) => w.toLowerCase()))].sort((a, b) => b.length - a.length);
const spaced = (w: string): string => w.split('').join('[\\s._*-]?');
const BANISHED_RE = new RegExp(`(?<![a-z])(?:${stems.map(spaced).join('|')})(?:s|y|ed|en|ball|light|lit)?(?![a-z])`, 'i');

/** True when the text speaks a banished name. */
export function speaksBanished(text: string): boolean {
  return BANISHED_RE.test(text.normalize('NFKD').replace(/[̀-ͯ]/g, ''));
}

/** The line itself when it is clean, otherwise the written fallback. */
export function cleanLine(text: string, fallback: string): string {
  return speaksBanished(text) ? fallback : text;
}
