import { Account, PublicKey, Signer, type JsonRpcProvider } from 'near-api-js';
import type { useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

type SignRawHash = ReturnType<typeof useSignRawHash>['signRawHash'];

/** Signs NEAR transactions with Privy's embedded wallet, with no popup. */
export class PrivySigner extends Signer {
  constructor(private readonly signRawHash: SignRawHash, private readonly accountId: string,
    private readonly provider: JsonRpcProvider) {
    super();
  }

  async getPublicKey(): Promise<PublicKey> {
    // An implicit account's name is its ed25519 public key in hex.
    if (/^[a-f0-9]{64}$/i.test(this.accountId)) {
      return new PublicKey({ keyType: 0, data: hexToBytes(this.accountId) });
    }
    const { keys } = await new Account(this.accountId, this.provider).getAccessKeyList();
    if (!keys.length) throw new Error('The account has no access key.');
    return PublicKey.fromString(keys[0]!.public_key);
  }

  async signBytes(bytes: Uint8Array): Promise<Uint8Array> {
    const { signature } = await this.signRawHash({
      address: this.accountId,
      chainType: 'near',
      hash: `0x${bytesToHex(bytes)}`,
    });
    return hexToBytes(signature.replace(/^0x/, ''));
  }
}
