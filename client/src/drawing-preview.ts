import './ui/tokens.css';
import './opening.css';
import './opening/drawing-reveal.css';
import type { RisingResult } from '../../shared/src/rising/types.js';
import { playDrawingReveal } from './opening/drawing-reveal.js';

/** Plays the Drawing reveal for any result: drawing.html?result=IGNIS|AQUES|TERRA|AURA|hush-AQUES, with the score. */
const RESULTS: Record<string, RisingResult> = {
  IGNIS: { role: 'Shaper', element: 'IGNIS' }, AQUES: { role: 'Shaper', element: 'AQUES' },
  TERRA: { role: 'Shaper', element: 'TERRA' }, AURA: { role: 'Shaper', element: 'AURA' },
  'hush-IGNIS': { role: 'Hush', element: 'IGNIS' }, 'hush-AQUES': { role: 'Hush', element: 'AQUES' },
  'hush-TERRA': { role: 'Hush', element: 'TERRA' }, 'hush-AURA': { role: 'Hush', element: 'AURA' },
};

const host = document.createElement('div');
host.id = 'opening-overlay';
document.body.style.margin = '0';
document.body.appendChild(host);

const menu = document.createElement('nav');
menu.style.cssText = 'position:fixed;z-index:10;top:8px;left:8px;display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100% - 16px)';
document.body.appendChild(menu);
let music: HTMLAudioElement | null = null;

function play(key: string): void {
  const result = RESULTS[key] ?? RESULTS.IGNIS!;
  music?.pause();
  music = new Audio('/assets/audio/music/drawing.m4a');
  void music.play().catch(() => {});
  void playDrawingReveal(host, result, {
    reducedMotion: new URLSearchParams(location.search).has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches,
    sound: (name, volume = 0.8) => { const a = new Audio(`/assets/audio/${name}.ogg`); a.volume = volume; void a.play().catch(() => {}); },
  });
}

for (const key of Object.keys(RESULTS)) {
  const b = document.createElement('button');
  b.textContent = key;
  b.style.cssText = 'font:12px system-ui;padding:6px 8px;background:#222;color:#eee;border:1px solid #555;cursor:pointer';
  b.addEventListener('click', () => play(key));
  menu.appendChild(b);
}
const first = new URLSearchParams(location.search).get('result');
if (first) play(first);
