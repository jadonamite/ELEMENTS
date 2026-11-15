import { guestKey } from './guest-key.js';
import type { DrawingResult } from '../opening.js';
import { roll } from '../../../shared/src/rising/roll.js';

const STORAGE_SESSION_TOKEN_KEY = 'elements_session_token';
const STORAGE_ACCOUNT_ID_KEY = 'elements_account_id';
const STORAGE_DRAWING_KEY = 'elements_drawing_result';
const STORAGE_LOCAL_PLAYER_KEY = 'elements_local_player';
const STORAGE_GUEST_TICKET_KEY = 'elements_guest_ticket';

export function hasGameServer(): boolean {
  return (import.meta as unknown as { env?: { VITE_NO_SERVER?: string } }).env?.VITE_NO_SERVER !== '1';
}

function localDrawing(): DrawingResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_DRAWING_KEY);
    const result = raw ? JSON.parse(raw) as DrawingResult : null;
    if (result?.role === 'Hush') return { role: 'Hush' };
    if (result?.role === 'Shaper' && ['IGNIS', 'AQUES', 'TERRA', 'AURA'].includes(result.element)) return result;
  } catch { /* Storage may be unavailable. */ }
  return null;
}

export function localSession(accountId?: string): SessionResponse {
  if (accountId) setStoredAccountId(accountId);
  const id = accountId ?? getStoredAccountId();
  if (!id) throw new Error('Sign in to resume your character.');
  return { accountId: id, rising: localDrawing() };
}

export function getStoredAuthToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_SESSION_TOKEN_KEY) || localStorage.getItem(STORAGE_SESSION_TOKEN_KEY) || localPlayToken();
  } catch {
    return null;
  }
}

/**
 * Local play signs in without the login service: a development build with no real session uses a
 * "dev:<name>" token, which only a game server started for development accepts. The name is kept, so
 * the same local player owns the same purse and satchel between runs. `?login` asks for the real sign-in.
 */
function localPlayToken(): string | null {
  const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
  if (!dev || typeof window === 'undefined' || new URLSearchParams(window.location.search).has('login')) return null;
  let name = localStorage.getItem(STORAGE_LOCAL_PLAYER_KEY);
  if (!name) {
    name = `local${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(STORAGE_LOCAL_PLAYER_KEY, name);
  }
  return `dev:${name}`;
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(STORAGE_SESSION_TOKEN_KEY, token);
      localStorage.setItem(STORAGE_SESSION_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(STORAGE_SESSION_TOKEN_KEY);
      localStorage.removeItem(STORAGE_SESSION_TOKEN_KEY);
    }
  } catch {
    // Storage access may be restricted
  }
}

export function getStoredAccountId(): string | null {
  try {
    return localStorage.getItem(STORAGE_ACCOUNT_ID_KEY);
  } catch {
    return null;
  }
}

export function setStoredAccountId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(STORAGE_ACCOUNT_ID_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_ACCOUNT_ID_KEY);
    }
  } catch {
    // Storage access may be restricted
  }
}

export function isOfflineMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('offline');
}

export function getServerUrl(): string {
  if (!hasGameServer()) return '';
  if (typeof window === 'undefined') return 'http://127.0.0.1:2567';

  const params = new URLSearchParams(window.location.search);
  const paramUrl = params.get('server');
  if (paramUrl) return paramUrl.replace(/\/$/, '');

  const serverPort = params.get('serverPort');
  if (serverPort) {
    return `http://${window.location.hostname || '127.0.0.1'}:${serverPort}`;
  }

  const envUrl = (import.meta as unknown as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');

  const clientPort = window.location.port;
  if (clientPort === '5215') {
    return 'http://127.0.0.1:2615';
  }
  if (clientPort === '5173') {
    return 'http://127.0.0.1:2567';
  }
  if (clientPort) {
    return `http://${window.location.hostname || '127.0.0.1'}:${clientPort === '5215' ? '2615' : '2567'}`;
  }

  return 'http://127.0.0.1:2567';
}

export interface SessionResponse {
  accountId: string;
  rising: DrawingResult | null;
  grantContracts?: string[];
  grantCaps?: Record<string, string>;
}

export async function postSession(token: string): Promise<SessionResponse> {
  if (!hasGameServer()) return localSession();
  const url = `${getServerUrl()}/api/session`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    throw new Error(`Session request failed with status ${response.status}`);
  }

  return (await response.json()) as SessionResponse;
}

export interface RisingApiResponse {
  accountId: string;
  role: 'Shaper' | 'Hush';
  element?: 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA' | null;
  rising?: {
    role: 'Shaper' | 'Hush';
    element?: 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA' | null;
  };
}

/** The ticket for a Drawing the server holds for this browser until its player signs in. */
export function getGuestTicket(): string | null {
  try {
    return localStorage.getItem(STORAGE_GUEST_TICKET_KEY);
  } catch {
    return null;
  }
}

export function clearGuestTicket(): void {
  try {
    localStorage.removeItem(STORAGE_GUEST_TICKET_KEY);
  } catch {
    // Storage access may be restricted
  }
}

function toDrawing(item: { role: 'Shaper' | 'Hush'; element?: 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA' | null }): DrawingResult {
  return item.role === 'Shaper' && item.element ? { role: 'Shaper', element: item.element } : { role: 'Hush' };
}

/** The Drawing before sign-in: the server rolls and keeps it; this browser keeps only the ticket and what to show. */
export async function postGuestRising(): Promise<DrawingResult> {
  await guestKey();
  const response = await fetch(`${getServerUrl()}/api/rising/guest`, { method: 'POST' });
  if (!response.ok) throw new Error(`Guest rising request failed with status ${response.status}`);
  const data = (await response.json()) as { guestTicket: string; rising: RisingApiResponse['rising'] & object };
  const result = toDrawing(data.rising);
  try {
    localStorage.setItem(STORAGE_GUEST_TICKET_KEY, data.guestTicket);
    localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(result));
  } catch {
    // Storage access may be restricted
  }
  return result;
}

export async function postRising(token?: string, guestTicket?: string | null): Promise<DrawingResult> {
  if (!hasGameServer()) {
    const result = localDrawing() ?? roll(() => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32);
    localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(result));
    return result;
  }
  const url = `${getServerUrl()}/api/rising`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: token ?? '', ...(guestTicket ? { guestTicket } : {}) }),
  });

  if (!response.ok) {
    throw new Error(`Rising request failed with status ${response.status}`);
  }

  const data = (await response.json()) as RisingApiResponse;
  return toDrawing(data.rising ?? data);
}
