export interface SessionGrantPayload {
  message: string;
  nonce: number[];
  recipient: string;
  callback_url: null;
}
export interface SignedSessionGrant {
  payload: SessionGrantPayload;
  public_key: string;
  signature: string;
}
export interface SessionGrantTerms {
  holder_id: string;
  expires_at: string;
  caps: Record<string, string>;
  rules: 'elements-session-v1';
}

/** Borsh payload bytes, including the NEP-413 domain tag. */
export function sessionGrantBytes(payload: SessionGrantPayload): Uint8Array {
  if (payload.nonce.length !== 32 || payload.nonce.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('Invalid nonce');
  if (payload.callback_url !== null) throw new Error('Callbacks are not supported');
  const string = (value: string): number[] => {
    const bytes = new TextEncoder().encode(value);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, bytes.length, true);
    return [...length, ...bytes];
  };
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, 2 ** 31 + 413, true);
  return Uint8Array.from([...tag, ...string(payload.message), ...payload.nonce, ...string(payload.recipient), 0]);
}
