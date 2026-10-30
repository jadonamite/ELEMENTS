import { PrivyClient } from '@privy-io/server-auth';

export interface VerifiedAuthUser {
  userId: string;
}

export type TokenVerifier = (token: string) => Promise<VerifiedAuthUser>;

let customVerifier: TokenVerifier | null = null;
let privyClientInstance: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  if (privyClientInstance) {
    return privyClientInstance;
  }
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID || '';
  const appSecret = process.env.PRIVY_APP_SECRET || '';
  if (!appId || !appSecret) {
    // If not configured, instantiate with placeholder or throw on use
    privyClientInstance = new PrivyClient(appId || 'missing-app-id', appSecret || 'missing-secret');
  } else {
    privyClientInstance = new PrivyClient(appId, appSecret);
  }
  return privyClientInstance;
}

export function setTokenVerifier(verifier: TokenVerifier | null): void {
  customVerifier = verifier;
}

export async function verifyToken(token: string | undefined | null): Promise<VerifiedAuthUser> {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    throw new Error('Missing auth token');
  }

  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  if (!cleanToken) {
    throw new Error('Missing auth token');
  }

  if (customVerifier) {
    return customVerifier(cleanToken);
  }

  const client = getPrivyClient();
  const claims = await client.verifyAuthToken(cleanToken);
  if (!claims || !claims.userId) {
    throw new Error('Token verification returned no user ID');
  }

  return { userId: claims.userId };
}
