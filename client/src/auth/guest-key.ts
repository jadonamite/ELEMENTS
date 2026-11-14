const GUEST_KEY = 'elements_guest_near_key';

/** The browser retains its guest key locally and never sends the private part. */
export async function guestKey(): Promise<{ accountId: string; signHash: (hash: Uint8Array) => Promise<Uint8Array> }> {
  const stored = localStorage.getItem(GUEST_KEY);
  let privateKey: CryptoKey;
  let publicBytes: Uint8Array;
  if (stored) {
    const jwk = JSON.parse(stored) as JsonWebKey;
    privateKey = await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['sign']);
    publicBytes = Uint8Array.from(atob(jwk.x!.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  } else {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
    localStorage.setItem(GUEST_KEY, JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)));
    privateKey = pair.privateKey;
    publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  return {
    accountId: [...publicBytes].map(v => v.toString(16).padStart(2, '0')).join(''),
    signHash: async hash => new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, Uint8Array.from(hash))),
  };
}
