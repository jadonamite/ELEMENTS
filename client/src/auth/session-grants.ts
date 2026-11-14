import { PublicKey } from 'near-api-js';
import { sessionGrantBytes, type SignedSessionGrant, type SessionGrantTerms } from '@elements/shared';
import { getServerUrl } from './server-api.js';

export type HashSigner = (hash: Uint8Array) => Promise<Uint8Array>;
import { guestKey } from './guest-key.js';
export { guestKey } from './guest-key.js';

export function implicitPublicKey(address: string): string {
  if (!/^[a-f0-9]{64}$/.test(address)) throw new Error('Expected an implicit account');
  const bytes = Uint8Array.from(address.match(/../g)!, hex => parseInt(hex, 16));
  return new PublicKey({ keyType: 0, data: bytes }).toString();
}

export async function makeSessionGrant(holder: string, publicKey: string, contract: string, caps: Record<string, string>, sign: HashSigner): Promise<SignedSessionGrant> {
  const terms: SessionGrantTerms = { holder_id: holder, expires_at: (BigInt(Date.now() + 4 * 60 * 60 * 1000) * 1_000_000n).toString(), caps, rules: 'elements-session-v1' };
  const payload = { message: JSON.stringify(terms), nonce: [...crypto.getRandomValues(new Uint8Array(32))], recipient: contract, callback_url: null };
  const bytes = sessionGrantBytes(payload);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
  const signature = await sign(hash);
  return { payload, public_key: publicKey, signature: btoa(String.fromCharCode(...signature)) };
}

export async function grantSession(token: string, holder: string, contracts: string[], caps: Record<string, string>, sign: HashSigner): Promise<void> {
  for (const contract of contracts) {
    const signed = await makeSessionGrant(holder, implicitPublicKey(holder), contract, caps, sign);
    const response = await fetch(`${getServerUrl()}/api/chain/grant`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(signed),
    });
    if (!response.ok) throw new Error(`Session authorisation failed (${response.status})`);
  }
}

export async function claimGuestSession(token: string, destination: string, contracts: string[], caps: Record<string, string>): Promise<void> {
  if (!contracts.length || !localStorage.getItem('elements_guest_near_key')) return;
  const guest = await guestKey();
  const proof = await makeSessionGrant(guest.accountId, implicitPublicKey(guest.accountId), destination, {}, guest.signHash);
  const grants = await Promise.all(contracts.map(contract => makeSessionGrant(guest.accountId, implicitPublicKey(guest.accountId), contract, caps, guest.signHash)));
  const response = await fetch(`${getServerUrl()}/api/chain/claim-guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ grants, proof }),
  });
  if (!response.ok) throw new Error(`Guest claim failed (${response.status})`);
}
