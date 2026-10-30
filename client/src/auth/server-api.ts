import type { DrawingResult } from '../opening.js';

const STORAGE_SESSION_TOKEN_KEY = 'elements_session_token';
const STORAGE_ACCOUNT_ID_KEY = 'elements_account_id';

export function getStoredAuthToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_SESSION_TOKEN_KEY) || localStorage.getItem(STORAGE_SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
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
}

export async function postSession(token: string): Promise<SessionResponse> {
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

export async function postRising(token?: string): Promise<DrawingResult> {
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
    body: JSON.stringify({ token: token ?? '' }),
  });

  if (!response.ok) {
    throw new Error(`Rising request failed with status ${response.status}`);
  }

  const data = (await response.json()) as RisingApiResponse;
  const item = data.rising ?? data;
  if (item.role === 'Shaper' && item.element) {
    return { role: 'Shaper', element: item.element };
  }
  return { role: 'Hush' };
}
