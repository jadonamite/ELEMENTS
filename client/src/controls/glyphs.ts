import { definition, type ControlAction, type InputDevice } from './actions.js';
const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const svg = (body: string, width = 48): string => `<svg class="input-glyph" viewBox="0 0 ${width} 48" width="${width}" height="48" aria-hidden="true" focusable="false">${body}</svg>`;
export function keyGlyph(key: string): string {
  if (key.startsWith('mouse-')) {
    const left = key === 'mouse-left', right = key === 'mouse-right';
    const arrows = key === 'mouse-move' ? '<path d="M0 24 6 18v4h4v4H6v4Zm48 0-6-6v4h-4v4h4v4Z" fill="var(--control-ink)"/>'
      : key === 'mouse-scroll' ? '<path d="m24 4-6 6h4v5h4v-5h4Zm0 35-6-6h4v-5h4v5h4Z" fill="var(--control-key-ink)"/>' : '';
    return svg(`<rect class="glyph-shadow" x="8" y="6" width="32" height="40" rx="16" fill="var(--control-key-depth)"/>
      <rect x="7" y="4" width="34" height="41" rx="16" fill="var(--control-key-side)"/>
      <rect x="7" y="1" width="34" height="40" rx="16" fill="var(--control-key-face)"/>
      <path d="M10 20v-4A12 12 0 0 1 22 4v16Z" fill="${left ? 'var(--control-ember)' : 'var(--control-key-base)'}"/>
      <path d="M26 4a12 12 0 0 1 12 12v4H26Z" fill="${right ? 'var(--control-ember)' : 'var(--control-key-base)'}"/>
      <rect x="22" y="10" width="4" height="8" rx="2" fill="var(--control-key-ink)"/>
      <path d="M11 23h26v2H11Z" fill="var(--control-key-side)"/>
      ${left ? '<path d="M12 17A10 10 0 0 1 20 6v3a7 7 0 0 0-5 8Z" fill="var(--control-ember-light)"/>' : ''}
      ${right ? '<path d="M28 6a10 10 0 0 1 8 11h-3a7 7 0 0 0-5-8Z" fill="var(--control-ember-light)"/>' : ''}${arrows}`);
  }
  const width = key.length > 3 ? 72 : 48;
  return svg(`<rect class="glyph-shadow" x="4" y="9" width="${width - 8}" height="36" rx="7" fill="var(--control-key-depth)"/>
    <rect x="3" y="6" width="${width - 6}" height="37" rx="7" fill="var(--control-key-side)"/>
    <rect x="3" y="2" width="${width - 6}" height="35" rx="7" fill="var(--control-key-face)"/>
    <path d="M10 4h${width - 20}v2H10Z" fill="var(--control-key-light)"/>
    <text x="${width / 2}" y="25" text-anchor="middle" fill="var(--control-key-ink)" font-family="Inter, sans-serif" font-weight="700" font-size="${key.length > 3 ? 12 : 16}">${escape(key)}</text>`, width);
}
// Filled silhouettes share a cream face and recessed dark details.
const blade = '<path d="m29 8 9 1-1 9-14 14-7-7Zm-16 17 12 12-3 3-5-5-7 7-4-4 7-7-3-3Z"/><path d="m30 13-11 14 2 2 13-15Z" fill="var(--control-key-base)"/>';
const shield = '<path d="m24 8 15 6v11c0 9-15 16-15 16S9 34 9 25V14Z"/>';
const symbols: Record<ControlAction, string> = {
  weapon: blade, strike: blade,
  heavy: '<path d="m27 5 14 2-2 14-15 13-9-9ZM11 25l16 14-4 4-6-5-6 7-6-6 7-6-5-5Z"/><path d="M32 12 20 27l3 3 13-16Z" fill="var(--control-key-base)"/>',
  hands: '<path d="M10 25V16a3 3 0 0 1 6 0v7h1V12a3 3 0 0 1 6 0v10h1V11a3 3 0 0 1 6 0v12h1v-7a3 3 0 0 1 6 0v18l-8 8H16l-6-10Z"/><path d="M16 26h15v4H16Zm2 9h9v3h-9Z" fill="var(--control-key-base)"/>',
  legs: '<path d="M18 7h13l-5 13 14 8-13 14H12v-5l12-9-12-5Z"/><path d="m20 14-4 8 10 4 2-3-8-4 2-5Z" fill="var(--control-key-base)"/>',
  stance: '<path d="M9 13h21V7l12 10-12 10v-7H9Zm30 15H18v-7L6 31l12 10v-6h21Z"/>',
  spark: '<path d="M24 4 10 27h12l-3 17 20-28H26l4-12Z"/><path d="m23 18-4 6h8l-2 7 8-11H23Z" fill="var(--control-key-base)"/>',
  technique: '<path d="M7 14c7-11 14 6 21 0l4-4 5 4-5 5c-9 9-16-7-21-1Zm4 11c7-11 14 6 21 0l4-4 5 4-5 5c-9 9-16-7-21-1Zm-4 10c7-11 14 6 21 0l4-4 5 4-5 5c-9 9-16-7-21-1Z"/>',
  duel: '<path d="M6 5h8l23 27 6-4 2 4-14 12-3-4 4-5L6 13Zm36 0v8L16 35l4 5-3 4L3 32l2-4 6 4L34 5Z"/>',
  block: shield + '<path d="m24 14 9 4v7c0 4-6 9-9 11Z" fill="var(--control-key-base)"/>',
  parry: shield + '<path d="m16 23 6 6 11-14 4 4-15 18-10-10Z" fill="var(--control-key-base)"/>',
  move: '<path d="m24 5 9 10h-6v6h6v-6l10 9-10 9v-6h-6v6h6L24 43l-9-10h6v-6h-6v6L5 24l10-9v6h6v-6h-6Z"/>',
  look: '<path d="M5 24S12 11 24 11s19 13 19 13-7 13-19 13S5 24 5 24Z"/><circle cx="24" cy="24" r="9" fill="var(--control-key-base)"/><circle cx="26" cy="22" r="4"/>',
  dodge: '<path d="m6 27 12-12 10 8 8-9h-8V8h17v17h-6v-7L29 32l-11-9-8 8Zm2 9h21v5H8Z"/>',
  jump: '<path d="m24 6 14 15-5 4-6-7v18h-6V18l-6 7-5-4ZM10 39h28v4H10Z"/>',
  rise: '<path d="m24 5 12 14-5 4-4-5v25h-6V18l-4 5-5-4ZM6 29l9-7v10H6Zm27-7 9 7v3h-9Z"/>',
  ground: '<path d="M21 6h6v19l6-7 5 4-14 15-14-15 5-4 6 7ZM6 39h36v5H6Z"/>',
  bend_move: '<path d="M5 28c11 0 10-17 23-17h4V5l13 9-13 10v-7h-4c-8 0-9 17-23 17Zm0 10h24v5H5Z"/>',
  ultimate: '<path d="m24 3 6 15 15 6-15 6-6 15-6-15-15-6 15-6Z"/><path d="m24 17 3 7-3 7-3-7Z" fill="var(--control-key-base)"/>',
  bending: '<path d="M27 4c5 13-8 14-6 25 2-6 6-9 10-11 0 7 9 11 7 18-3 11-25 11-28-1C7 23 23 19 27 4Z"/><path d="M24 28c-2 7-6 6-6 10 0 5 11 5 11 0 0-3-4-5-5-10Z" fill="var(--control-key-base)"/>',
  lock: '<path d="M7 7h12v5h-7v7H7Zm22 0h12v12h-5v-7h-7ZM7 29h5v7h7v5H7Zm29 0h5v12H29v-5h7Z"/><circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="4" fill="var(--control-key-base)"/>',
  menu: '<rect x="10" y="11" width="28" height="6" rx="2"/><rect x="10" y="22" width="28" height="6" rx="2"/><rect x="10" y="33" width="28" height="6" rx="2"/>',
  interact: '<path d="M15 28V16a3 3 0 0 1 6 0v8h1V9a3 3 0 0 1 6 0v15h1V14a3 3 0 0 1 6 0v12h1v-6a3 3 0 0 1 6 0v14l-9 10H20L6 30a4 4 0 0 1 6-5Z"/><path d="M22 29h12v4H22Zm2 7h7v3h-7Z" fill="var(--control-key-base)"/>',
  run: '<circle cx="29" cy="8" r="5"/><path d="m21 14 9 3 6 8h7v6H32l-6-7-5 8 9 6-4 8-6-3 3-4-10-6 6-12-4 1-6 7-5-4 8-10Zm-7 20 6 4-9 9-5-4Z"/>',
};
export function touchGlyph(action: ControlAction): string {
  return svg(`<circle class="glyph-shadow" cx="24" cy="27" r="20" fill="var(--control-key-depth)"/>
    <circle cx="24" cy="25" r="21" fill="var(--control-key-depth)"/>
    <circle cx="24" cy="21" r="21" fill="var(--control-key-side)"/>
    <circle cx="24" cy="22" r="19" fill="var(--control-key-base)"/>
    <g transform="translate(5 3) scale(.8)" fill="currentColor">${symbols[action]}</g>`);
}
export const actionGlyph = (action: ControlAction, device: InputDevice): string =>
  device === 'touch' ? touchGlyph(action) : keyGlyph(definition(action).key);
