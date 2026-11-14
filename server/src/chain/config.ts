import { readLegacyClaims, type LegacyClaims } from './legacy.js';

const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;
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
  /** The retired contract and batch whose balances this contract's genesis copied. */
  genesisFrom?: { contract: string; batch: number };
  settleEveryMs: number;
  batchSize: number;
}

/** "contract@batch": the old contract and the last batch the new contract's genesis includes. */
function parseGenesisFrom(value: string | undefined): { contract: string; batch: number } | undefined {
  if (!value) return undefined;
  const match = /^([a-z0-9._-]+)@(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`Genesis checkpoint must be contract@batch, got ${value}`);
  return { contract: match[1]!, batch: Number(match[2]) };
}

/** The fixed legacy claim list, when it names this contract. */
function claimsFor(contractId: string, network: string): LegacyClaims | undefined {
  if (network !== 'testnet') return undefined;
  const list = readLegacyClaims();
  return list.contracts.chroma === contractId || list.contracts.items === contractId ? list : undefined;
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
    ...optional('legacyClaims', claimsFor(contractId, network)),
    ...optional('genesisFrom', parseGenesisFrom(env.CHROMA_GENESIS_FROM)),
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
    ...optional('legacyClaims', claimsFor(contractId, network)),
    ...optional('genesisFrom', parseGenesisFrom(env.ITEMS_GENESIS_FROM)),
    ...(env.NEAR_WORLD_PROVISIONER_KEY ? { worldProvisionerKey: env.NEAR_WORLD_PROVISIONER_KEY } : {}),
    settleEveryMs: Number(env.CHAIN_SETTLE_MS) || 60_000,
    batchSize: Number(env.CHAIN_BATCH_SIZE) || 80,
  };
}
