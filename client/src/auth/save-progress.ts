import type { DrawingResult } from '../opening.js';
import { mountLoginIsland } from './LoginIsland.js';
import {
  clearGuestTicket,
  getGuestTicket,
  getStoredAuthToken,
  hasGameServer,
  isOfflineMode,
  postRising,
} from './server-api.js';

const STORAGE_DRAWING_KEY = 'elements_drawing_result';

const GATE_COPY = {
  title: 'Keep your rising',
  subtitle: 'You made it to Sindr. Sign in to keep your rising, your look and everything you earn from here on.',
  offline: 'Play without saving',
  offlineNotice: 'Trading needs an account. Without one, nothing you do here is kept.',
};

/**
 * The sign-in asked at Sindr's gate. A guest signs in and the server makes the Drawing it held
 * for this browser the account's own; an account that already rose keeps its first result.
 * Resolves with the account's Drawing, or null when nothing changed (already signed in, no
 * server, or the player chose to go on without saving).
 */
export function saveProgressAtGate(): Promise<DrawingResult | null> {
  if (!hasGameServer() || isOfflineMode() || getStoredAuthToken()) return Promise.resolve(null);
  if (document.pointerLockElement) document.exitPointerLock();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'opening-overlay';
    overlay.className = 'save-progress';
    document.body.appendChild(overlay);
    const host = document.createElement('div');
    overlay.appendChild(host);

    let island: { unmount: () => void } | null = null;
    const finish = (result: DrawingResult | null): void => {
      island?.unmount();
      island = null;
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 400);
      resolve(result);
    };

    island = mountLoginIsland(host, {
      copy: GATE_COPY,
      onOffline: () => finish(null),
      onSuccess: (payload) => {
        const claim = payload.rising ? Promise.resolve(payload.rising) : postRising(payload.token, getGuestTicket());
        void claim
          .then((result) => {
            clearGuestTicket();
            try {
              localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(result));
            } catch {
              // Storage access may be restricted
            }
            finish(result);
          })
          .catch(() => finish(null));
      },
    });
  });
}
