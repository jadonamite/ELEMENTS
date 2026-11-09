/** Key of a recorded line: FNV-1a over the spoken text's UTF-8 bytes, as 8 hex digits. The render script uses the same. */
export function lineKey(text: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** The recorded voice a townsperson speaks with: their dialogue role and sex. */
export function voiceId(dialogueRole: string, sex: 'male' | 'female'): string {
  return `${dialogueRole}_${sex}`;
}
