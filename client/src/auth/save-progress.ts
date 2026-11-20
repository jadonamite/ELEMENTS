import type { DrawingResult } from '../opening.js';
import { mountLoginIsland } from './LoginIsland.js';
import {
  clearGuestTicket,
  getGuestTicket,
  getStoredAuthToken,
  hasGameServer,
  isOfflineMode,
  postRising,
  postSession,
  setStoredAuthToken,
  setStoredAccountId,
} from './server-api.js';

const STORAGE_DRAWING_KEY = 'elements_drawing_result';

const GATE_COPY = {
  title: 'Register at the gate',
  subtitle: 'Sign in or create an account to enter town and keep your character.',
  offline: 'Return to the gate',
  offlineNotice: 'You can return later. The gate stays closed until you sign in.',
};

/** Verifies every existing token too. Cancelling leaves the gate closed. */
export async function saveProgressAtGate(): Promise<DrawingResult | null> {
  if (!hasGameServer() || isOfflineMode()) throw new Error('A connection to the game server is required to enter town.');
  const token = getStoredAuthToken();
  if (token) {
    try {
      const session = await postSession(token);
      setStoredAccountId(session.accountId);
      return await postRising(token, getGuestTicket());
    } catch {
      setStoredAuthToken(null);
    }
  }
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
