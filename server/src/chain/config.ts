import { readLegacyClaims, type LegacyClaims } from './legacy.js';
export interface ChainConfig {
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
  explorerUrl: string;
  gameAccount: string;
  privateKey: string;
  worldProvisionerKey?: string;
  contractId: string;
  playerSecret: string;
  legacyClaims?: LegacyClaims;
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
    ...(env.NEAR_WORLD_PROVISIONER_KEY ? { worldProvisionerKey: env.NEAR_WORLD_PROVISIONER_KEY } : {}),
    contractId,
    playerSecret,
    ...(contractId === 'chroma-v2.elements-dev.testnet' ? {legacyClaims:readLegacyClaims()} : {}),
    settleEveryMs: Number(env.CHAIN_SETTLE_MS) || 60_000,
    batchSize: Number(env.CHAIN_BATCH_SIZE) || 80,
  };
}

/** Items use their own contract and courier key. World-key derivation is shared with CHROMA. */
export function readItemsChainConfig(env: NodeJS.ProcessEnv = process.env): ChainConfig | null {
  const gameAccount = env.NEAR_ACCOUNT_ID;
  const playerSecret = env.CHAIN_PLAYER_SECRET;
  const contractId = env.ITEMS_CONTRACT_ID;
  const privateKey = env.ITEMS_PRIVATE_KEY;
  if (!gameAccount || !playerSecret || !contractId || !privateKey) return null;
  const network = env.NEAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  return {
    network, rpcUrl: env.NEAR_RPC_URL || `https://rpc.${network}.fastnear.com`,
    explorerUrl: network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io',
    gameAccount, playerSecret, contractId, privateKey,
    ...(contractId === 'items-v4.elements-dev.testnet' ? {legacyClaims:readLegacyClaims()} : {}),
    ...(env.NEAR_WORLD_PROVISIONER_KEY ? { worldProvisionerKey: env.NEAR_WORLD_PROVISIONER_KEY } : {}),
    settleEveryMs: Number(env.CHAIN_SETTLE_MS) || 60_000,
    batchSize: Number(env.CHAIN_BATCH_SIZE) || 80,
  };
}
