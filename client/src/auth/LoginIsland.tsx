import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getAccessToken, PrivyProvider, useLogin, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { claimGuestSession, grantSession } from './session-grants.js';
import type { DrawingResult } from '../opening.js';
import {
  postSession,
  hasGameServer,
  localSession,
  setStoredAccountId,
  setStoredAuthToken,
} from './server-api.js';

export interface LoginSuccessPayload {
  accountId: string;
  token: string;
  rising: DrawingResult | null;
}

export interface LoginIslandProps {
  onSuccess: (payload: LoginSuccessPayload) => void;
  onOffline: () => void;
  /** Words for where the sign-in is asked; the opening's own words otherwise. */
  copy?: { title: string; subtitle: string; offline: string; offlineNotice: string };
}

function LoginCard({ onSuccess, onOffline, copy }: LoginIslandProps) {
  const { ready, authenticated, user } = usePrivy();
  const sessionStarted = useRef(false);
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSession = useCallback(async () => {
    if (sessionStarted.current) return;
    if (!hasGameServer() && !user?.id) return;
    sessionStarted.current = true;
    try {
      setIsVerifying(true);
      setError(null);
      const token = hasGameServer() ? await getAccessToken() : '';
      if (hasGameServer() && !token) {
        sessionStarted.current = false;
        setIsVerifying(false);
        return;
      }
      const session = hasGameServer() ? await postSession(token!) : localSession(user!.id);
      if (session.grantContracts?.length) {
        const linked = user?.linkedAccounts.find(a => a.type === 'wallet' && a.chainType === 'near');
        const address = linked?.type === 'wallet' ? linked.address : (await createWallet({ chainType: 'near' })).wallet.address;
        await grantSession(token!, address, session.grantContracts, session.grantCaps ?? { CHROMA: '100000' }, async hash => {
          const { signature } = await signRawHash({ address, chainType: 'near', hash: `0x${bytesToHex(hash)}` });
          return hexToBytes(signature.replace(/^0x/, ''));
        });
        await claimGuestSession(token!, address, session.grantContracts, session.grantCaps ?? { CHROMA: "100000" });
      }
      setStoredAuthToken(token);
      setStoredAccountId(session.accountId);
      onSuccess({
        accountId: session.accountId,
        token: token ?? '',
        rising: session.rising,
      });
    } catch {
      sessionStarted.current = false;
      setError(hasGameServer()
        ? (copy ? 'Sign-in could not be verified. Try again or return to the gate.' : 'Unable to reach authentication server. You can continue offline.')
        : 'Sign-in could not be completed. Try again or continue offline.');
      setIsVerifying(false);
    }
  }, [onSuccess, user, createWallet, signRawHash]);

  const { login } = useLogin({
    onComplete: () => {
      void handleSession();
    },
    onError: () => {
      setError('Login could not be completed.');
    },
  });

  useEffect(() => {
    if (ready && authenticated) {
      void handleSession();
    }
  }, [ready, authenticated, handleSession]);

  if (!ready || isVerifying) {
    return (
      <div className="opening-modal login-modal">
        <h2>Enter ELEMENTS</h2>
        <p className="opening-subtitle">Connecting...</p>
        <div className="login-loading-spinner" />
      </div>
    );
  }

  return (
    <div className="opening-modal login-modal">
      <h2>{copy?.title ?? 'Enter the Realm'}</h2>
      <p className="opening-subtitle">
        {copy?.subtitle ?? (hasGameServer()
          ? 'Sign in so your character and your rising are saved to your account. You rise only once.'
          : 'Sign in to enter. Your character and rising are saved in this browser.')}
      </p>

      {error && (
        <p className="opening-error" role="alert">
          {error}
        </p>
      )}

      <div className="login-actions">
        <button
          type="button"
          className="opening-button primary"
          onClick={() => login()}
        >
          Sign In with Google or Email
        </button>
        <button
          type="button"
          className="opening-button secondary"
          onClick={onOffline}
        >
          {copy?.offline ?? 'Continue Offline'}
        </button>
      </div>

      <p className="login-offline-notice">
        {copy?.offlineNotice ?? 'Offline play is not saved.'}
      </p>

      <div className="opening-footer">
        <a href="/legal/terms.html" target="_blank" rel="noreferrer">
          Terms
        </a>
        <a href="/legal/privacy.html" target="_blank" rel="noreferrer">
          Privacy
        </a>
      </div>
    </div>
  );
}

function MissingConfigCard({ onOffline, copy }: { onOffline: () => void; copy?: LoginIslandProps['copy'] }) {
  return (
    <div className="opening-modal login-modal">
      <h2>Enter ELEMENTS</h2>
      <p className="opening-subtitle">
        {copy ? 'Sign-in is unavailable. Return to the gate and try again later.' : 'Authentication configuration is not set. You can continue in offline mode.'}
      </p>
      <div className="login-actions">
        <button
          type="button"
          className="opening-button primary"
          onClick={onOffline}
        >
          {copy?.offline ?? 'Continue Offline'}
        </button>
      </div>
    </div>
  );
}

export function mountLoginIsland(
  container: HTMLElement,
  props: LoginIslandProps,
): { unmount: () => void } {
  const root: Root = createRoot(container);
  const appId = (import.meta as unknown as { env?: { VITE_PRIVY_APP_ID?: string } }).env
    ?.VITE_PRIVY_APP_ID;

  root.render(
    <StrictMode>
      {appId ? (
        <PrivyProvider
          appId={appId}
          config={{
            loginMethods: ['google', 'email'],
            appearance: {
              theme: 'dark',
              showWalletLoginFirst: false,
            },
          }}
        >
          <LoginCard {...props} />
        </PrivyProvider>
      ) : (
        <MissingConfigCard onOffline={props.onOffline} copy={props.copy} />
      )}
    </StrictMode>,
  );

  return {
    unmount: () => {
      try {
        root.unmount();
      } catch {
        // Container may have been unmounted already
      }
    },
  };
}
