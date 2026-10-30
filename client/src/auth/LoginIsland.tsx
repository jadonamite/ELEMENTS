import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getAccessToken, PrivyProvider, useLogin, usePrivy } from '@privy-io/react-auth';
import type { DrawingResult } from '../opening.js';
import {
  postSession,
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
}

function LoginCard({ onSuccess, onOffline }: LoginIslandProps) {
  const { ready, authenticated } = usePrivy();
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSession = useCallback(async () => {
    try {
      setIsVerifying(true);
      setError(null);
      const token = await getAccessToken();
      if (!token) {
        setIsVerifying(false);
        return;
      }
      const session = await postSession(token);
      setStoredAuthToken(token);
      setStoredAccountId(session.accountId);
      onSuccess({
        accountId: session.accountId,
        token,
        rising: session.rising,
      });
    } catch {
      setError('Unable to reach authentication server. You can continue offline.');
      setIsVerifying(false);
    }
  }, [onSuccess]);

  const { login } = useLogin({
    onComplete: () => {
      void handleSession();
    },
    onError: () => {
      setError('Login could not be completed.');
    },
  });

  useEffect(() => {
    if (ready && authenticated && !isVerifying) {
      void handleSession();
    }
  }, [ready, authenticated, isVerifying, handleSession]);

  if (!ready || isVerifying) {
    return (
      <div class-name="opening-modal login-modal">
        <h2>Enter ELEMENTS</h2>
        <p className="opening-subtitle">Connecting...</p>
        <div className="login-loading-spinner" />
      </div>
    );
  }

  return (
    <div className="opening-modal login-modal">
      <h2>Enter the Realm</h2>
      <p className="opening-subtitle">
        Sign in so your character and your rising are saved to your account. You rise only once.
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
          Continue Offline
        </button>
      </div>

      <p className="login-offline-notice">
        Offline play is not saved.
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

function MissingConfigCard({ onOffline }: { onOffline: () => void }) {
  return (
    <div className="opening-modal login-modal">
      <h2>Enter ELEMENTS</h2>
      <p className="opening-subtitle">
        Authentication configuration is not set. You can continue in offline mode.
      </p>
      <div className="login-actions">
        <button
          type="button"
          className="opening-button primary"
          onClick={onOffline}
        >
          Continue Offline
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
        <MissingConfigCard onOffline={props.onOffline} />
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
