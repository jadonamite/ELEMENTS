import './ui/tokens.css';
import './cover.css';
import { BOOT_ASSETS } from './cover-assets.js';

const PASSED_KEY = 'elements_cover_passed';
/** Matches the cover's fade in cover.css (--duration-moderate). */
const LEAVE_MS = 300;

type GameModule = typeof import('./main.js');

/**
 * Fetches each file once, in order, so the browser cache holds it before the game asks.
 * Stops when the signal aborts, so it never races the game for the same file.
 */
async function warmCache(urls: readonly string[], signal: AbortSignal): Promise<void> {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  for (const url of urls) {
    if (signal.aborted) return;
    try {
      const response = await fetch(url, { priority: 'low', signal } as RequestInit);
      await response.arrayBuffer();
    } catch {
      // A failed warm-up only means the game fetches this file itself.
    }
  }
}

function rememberPassed(): void {
  try { sessionStorage.setItem(PASSED_KEY, '1'); } catch { /* private mode: the cover shows again on reload */ }
}

function showCover(cover: HTMLElement, game: Promise<GameModule>): void {
  const play = cover.querySelector<HTMLButtonElement>('#cover-play')!;
  const status = cover.querySelector<HTMLElement>('#cover-status')!;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const warming = new AbortController();
  void game.then(() => warmCache(BOOT_ASSETS, warming.signal), () => undefined);

  play.addEventListener('click', () => {
    warming.abort();
    play.disabled = true;
    play.setAttribute('aria-busy', 'true');
    game.then(({ startGame }) => {
      rememberPassed();
      startGame();
      if (reducedMotion) { cover.remove(); return; }
      cover.classList.add('cover-leaving');
      setTimeout(() => cover.remove(), LEAVE_MS);
    }, (error: unknown) => {
      console.error('The game failed to download:', error);
      play.removeAttribute('aria-busy');
      play.disabled = false;
      play.textContent = 'Reload to retry';
      status.textContent = 'The game could not be downloaded. Check your connection.';
      play.addEventListener('click', () => window.location.reload(), { once: true });
    });
  }, { once: true });
}

const game: Promise<GameModule> = import('./main.js');
const cover = document.getElementById('cover');
if (cover && !document.documentElement.classList.contains('cover-passed')) {
  showCover(cover, game);
} else {
  cover?.remove();
  void game.then(({ startGame }) => startGame());
}
