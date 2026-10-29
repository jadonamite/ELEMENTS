import '../ui/tokens.css';
import './style.css';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, useLogin, useLogout, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { Account, JsonRpcProvider } from 'near-api-js';
import { NEAR } from 'near-api-js/tokens';
import { PrivySigner } from './signer.js';

const RPC_URL = 'https://test.rpc.fastnear.com';
const EXPLORER_TX = 'https://testnet.nearblocks.io/txns/';
const FAUCET_URL = 'https://near-faucet.io/';
const provider = new JsonRpcProvider({ url: RPC_URL });

type Balance = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; near: string };

function LoginTest() {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const creating = useRef(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [balance, setBalance] = useState<Balance>({ state: 'loading' });
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  // Find the user's NEAR wallet, or make one the first time they log in.
  useEffect(() => {
    if (!authenticated || !user) { setAccount(null); return; }
    const wallet = user.linkedAccounts.find(a => a.type === 'wallet' && a.chainType === 'near');
    if (wallet?.type !== 'wallet') {
      if (!creating.current) {
        creating.current = true;
        createWallet({ chainType: 'near' })
          .catch((e: unknown) => setError(`The NEAR wallet could not be created: ${message(e)}`))
          .finally(() => { creating.current = false; });
      }
      return;
    }
    setAccount(new Account(wallet.address, provider, new PrivySigner(signRawHash, wallet.address, provider)));
  }, [authenticated, user, createWallet, signRawHash]);

  const refreshBalance = useCallback(async () => {
    if (!account) return;
    setBalance({ state: 'loading' });
    try {
      setBalance({ state: 'ready', near: Number(NEAR.toDecimal(await account.getBalance())).toFixed(4) });
    } catch {
      // A new implicit account doesn't exist on chain until someone sends it NEAR.
      setBalance({ state: 'missing' });
    }
  }, [account]);
  useEffect(() => { void refreshBalance(); }, [refreshBalance]);

  const sendTest = async (): Promise<void> => {
    if (!account) return;
    setSending(true);
    setError('');
    setTxHash('');
    try {
      const result = await account.transfer({ receiverId: account.accountId, amount: 1n });
      setTxHash(result.transaction.hash);
      await refreshBalance();
    } catch (e) {
      setError(`The test transaction failed: ${message(e)}`);
    } finally {
      setSending(false);
    }
  };

  if (!ready) return <Shell><p className="muted">Loading login…</p></Shell>;
  if (!authenticated) {
    return (
      <Shell>
        <p>Log in with Google or email. Privy makes a NEAR testnet wallet for you on first login.</p>
        <button type="button" className="primary" onClick={() => login()}>Log in</button>
      </Shell>
    );
  }
  const who = user?.google?.email ?? user?.email?.address ?? 'your account';
  return (
    <Shell>
      <p>Logged in as <strong>{who}</strong>.</p>
      {!account ? <p className="muted">Creating your NEAR wallet…</p> : (
        <>
          <dl>
            <dt>NEAR testnet account</dt>
            <dd><code>{account.accountId}</code></dd>
            <dt>Balance</dt>
            <dd>
              {balance.state === 'loading' && 'Checking…'}
              {balance.state === 'ready' && `${balance.near} NEAR`}
              {balance.state === 'missing' && (
                <>Not on testnet yet. Copy the account above into the <a href={FAUCET_URL} target="_blank" rel="noreferrer">NEAR testnet faucet</a>, request NEAR, then check again.</>
              )}
            </dd>
          </dl>
          <div className="row">
            <button type="button" className="primary" disabled={sending || balance.state !== 'ready'} onClick={() => void sendTest()}>
              {sending ? 'Sending…' : 'Send test transaction'}
            </button>
            <button type="button" onClick={() => void refreshBalance()}>Check balance</button>
          </div>
          <p className="muted">Sends 1 yoctoNEAR to this same account, signed in the background with no popup.</p>
          {txHash && (
            <p role="status">Sent. <a href={EXPLORER_TX + txHash} target="_blank" rel="noreferrer">View transaction {txHash.slice(0, 10)}…</a></p>
          )}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="quiet" onClick={() => void logout()}>Log out</button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <h1>ELEMENTS login test</h1>
      {children}
    </main>
  );
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    {appId ? (
      <PrivyProvider appId={appId} config={{ loginMethods: ['google', 'email'], appearance: { theme: 'dark', showWalletLoginFirst: false } }}>
        <LoginTest />
      </PrivyProvider>
    ) : (
      <Shell><p className="error">VITE_PRIVY_APP_ID is missing from the root .env file.</p></Shell>
    )}
  </StrictMode>,
);
