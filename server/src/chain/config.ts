export interface ChainConfig {
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
  explorerUrl: string;
  gameAccount: string;
  privateKey: string;
  contractId: string;
  playerSecret: string;
  settleEveryMs: number;
  batchSize: number;
}

/** Settlement runs only when every chain setting is present; otherwise the game plays off chain. */
export function readChainConfig(env: NodeJS.ProcessEnv = process.env): ChainConfig | null {
  const gameAccount = env.NEAR_ACCOUNT_ID;
  const privateKey = env.NEAR_PRIVATE_KEY;
  const contractId = env.CHROMA_CONTRACT_ID;
  const playerSecret = env.CHAIN_PLAYER_SECRET;
  if (!gameAccount || !privateKey || !contractId || !playerSecret) return null;

  const network = env.NEAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  return {
    network,
    rpcUrl: env.NEAR_RPC_URL || `https://rpc.${network}.fastnear.com`,
    explorerUrl: network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io',
    gameAccount,
    privateKey,
    contractId,
    playerSecret,
    settleEveryMs: Number(env.CHAIN_SETTLE_MS) || 60_000,
    batchSize: Number(env.CHAIN_BATCH_SIZE) || 80,
  };
}
